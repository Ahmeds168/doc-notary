-- Migration 001 — Supabase Auth ownership, plans, durable notarization operations.
--
-- Review before running. This file is NOT applied automatically by the backend or CI
-- (CI only runs it against a throwaway in-memory Postgres). Apply it manually in the
-- Supabase SQL editor (or `psql`) against the real project after `schema.sql`.
--
-- What it does:
--   1. profiles: one row per auth user, carrying the billing `plan` (free / standard).
--   2. documents: adds `user_id` (owner), `original_filename` (private), `is_legacy`.
--      Existing rows are marked is_legacy = true and stay UNOWNED (user_id null).
--      They are never auto-assigned to anyone — see README "Legacy records".
--   3. documents RLS: removes the old "public can read everything" policy, which exposed
--      storage keys and filenames to anyone holding the anon key.
--   4. notarization_operations: durable per-attempt state machine used for idempotent
--      retries, quota accounting, relayer spend accounting and reconciliation.
--   5. reserve_notarization(): atomic quota + spend-limit + duplicate check.
--   6. relayer_leases + acquire/release functions: cross-instance broadcast lock.
--
-- Safe to re-run: every statement is idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Profiles / plans
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  plan                text not null default 'free' check (plan in ('free', 'standard')),
  -- Where the current plan value came from. 'kelviq' is reserved for the billing sync.
  plan_source         text not null default 'default' check (plan_source in ('default', 'manual', 'kelviq')),
  plan_updated_at     timestamptz not null default now(),
  billing_customer_id text,
  created_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());
-- No insert/update/delete policies: plan changes only through the service role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any users that signed up before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Document ownership
-- ---------------------------------------------------------------------------

-- `label` keeps its meaning for legacy rows (the original filename, which the old backend
-- ALSO sent on-chain, so it is already public). New rows store only the opt-in on-chain
-- label in `label` and keep the original filename private in `original_filename`.
alter table public.documents
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists original_filename text,
  add column if not exists operation_id uuid;

-- Added with default true so every pre-existing row is flagged as legacy, then the default
-- is flipped so rows written by the new backend are not.
alter table public.documents add column if not exists is_legacy boolean not null default true;
alter table public.documents alter column is_legacy set default false;

create index if not exists idx_documents_user_created
  on public.documents (user_id, created_at desc);

-- Hashes are compared as lowercase 0x-prefixed hex everywhere.
update public.documents set document_hash = lower(document_hash) where document_hash <> lower(document_hash);
update public.documents set submitter_address = lower(submitter_address) where submitter_address <> lower(submitter_address);

-- ---------------------------------------------------------------------------
-- 3. Document RLS — no more public reads of storage keys / filenames
-- ---------------------------------------------------------------------------

drop policy if exists "Public can read documents" on public.documents;
drop policy if exists "Owners can read own documents" on public.documents;
create policy "Owners can read own documents"
  on public.documents for select
  to authenticated
  using (user_id = auth.uid());
-- "Only service role can insert" from schema.sql is kept. The backend uses the service role
-- for all reads/writes; public verification goes through the backend, which returns only
-- non-sensitive fields.

-- ---------------------------------------------------------------------------
-- 4. Notarization operations
-- ---------------------------------------------------------------------------
-- status lifecycle:
--   reserved      quota + spend reserved, nothing stored or sent yet
--   uploaded      file stored in R2
--   broadcasting  tx signed and its hash persisted; broadcast in progress
--   submitted     broadcast accepted by the RPC node, awaiting receipt
--   confirmed     receipt status 1 (see `indexed` for the documents row)
--   failed        definitively NOT on-chain from this attempt (or reverted)
--   uncertain     tx may or may not land; the reconciler keeps checking

create table if not exists public.notarization_operations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users (id) on delete set null,
  document_hash     text not null check (document_hash ~ '^0x[0-9a-f]{64}$'),
  status            text not null default 'reserved'
                    check (status in ('reserved', 'uploaded', 'broadcasting', 'submitted', 'confirmed', 'failed', 'uncertain')),
  indexed           boolean not null default false,
  storage_key       text,
  object_created    boolean not null default false,  -- true if THIS operation created the R2 object
  original_filename text,
  label             text not null default '',        -- exactly what is (or will be) written on-chain
  file_size_bytes   bigint,
  content_type      text,
  tx_hash           text,
  tx_nonce          bigint,
  block_number      bigint,
  block_timestamp   bigint,
  submitter_address text,
  reserved_cost_wei numeric(78, 0) not null default 0,
  actual_cost_wei   numeric(78, 0),
  error_code        text,
  attempts          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);

-- At most one non-failed operation per hash, across every backend instance. This is what
-- turns concurrent duplicate submissions into a single on-chain transaction.
create unique index if not exists uq_operations_active_hash
  on public.notarization_operations (document_hash)
  where status <> 'failed';

create index if not exists idx_operations_user_created
  on public.notarization_operations (user_id, created_at desc);

create index if not exists idx_operations_needs_reconcile
  on public.notarization_operations (updated_at)
  where status in ('reserved', 'uploaded', 'broadcasting', 'submitted', 'uncertain')
     or (status = 'confirmed' and not indexed);

alter table public.notarization_operations enable row level security;

drop policy if exists "Users can read own operations" on public.notarization_operations;
create policy "Users can read own operations"
  on public.notarization_operations for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. Atomic reservation: duplicate check + monthly quota + in-flight cap + daily spend
-- ---------------------------------------------------------------------------

create or replace function public.reserve_notarization(
  p_user_id            uuid,
  p_document_hash      text,
  p_monthly_limit      integer,
  p_max_in_flight      integer,
  p_reserved_cost_wei  numeric,
  p_daily_budget_wei   numeric,
  p_storage_key        text,
  p_original_filename  text,
  p_label              text,
  p_file_size_bytes    bigint,
  p_content_type       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing   public.notarization_operations;
  v_op         public.notarization_operations;
  v_used       integer;
  v_in_flight  integer;
  v_spent      numeric;
  v_month      timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_day        timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  -- One global transaction-scoped lock: every instance's reservations are serialized, so
  -- quota and budget checks can never both pass on a stale count.
  perform pg_advisory_xact_lock(hashtext('doc_notary.reserve_notarization'));

  select * into v_existing
    from public.notarization_operations
   where document_hash = p_document_hash and status <> 'failed'
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate', 'operation', to_jsonb(v_existing));
  end if;

  -- Failed attempts never consume quota (the user was not served).
  select count(*) into v_used
    from public.notarization_operations
   where user_id = p_user_id and status <> 'failed' and created_at >= v_month;
  if v_used >= p_monthly_limit then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', v_used);
  end if;

  select count(*) into v_in_flight
    from public.notarization_operations
   where user_id = p_user_id
     and status in ('reserved', 'uploaded', 'broadcasting', 'submitted', 'uncertain');
  if v_in_flight >= p_max_in_flight then
    return jsonb_build_object('ok', false, 'reason', 'in_flight', 'inFlight', v_in_flight);
  end if;

  -- Spend = actual gas cost where known (including reverted txs, which still burn gas),
  -- otherwise the reservation for operations that may still spend.
  select coalesce(sum(coalesce(actual_cost_wei, case when status = 'failed' then 0 else reserved_cost_wei end)), 0)
    into v_spent
    from public.notarization_operations
   where created_at >= v_day;
  if v_spent + p_reserved_cost_wei > p_daily_budget_wei then
    return jsonb_build_object('ok', false, 'reason', 'budget');
  end if;

  insert into public.notarization_operations (
    user_id, document_hash, status, storage_key, original_filename, label,
    file_size_bytes, content_type, reserved_cost_wei
  ) values (
    p_user_id, p_document_hash, 'reserved', p_storage_key, p_original_filename, coalesce(p_label, ''),
    p_file_size_bytes, p_content_type, p_reserved_cost_wei
  )
  returning * into v_op;

  return jsonb_build_object('ok', true, 'operation', to_jsonb(v_op), 'used', v_used + 1);
end;
$$;

revoke all on function public.reserve_notarization(uuid, text, integer, integer, numeric, numeric, text, text, text, bigint, text) from public;
revoke all on function public.reserve_notarization(uuid, text, integer, integer, numeric, numeric, text, text, text, bigint, text) from anon, authenticated;
grant execute on function public.reserve_notarization(uuid, text, integer, integer, numeric, numeric, text, text, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Relayer broadcast lease (one signer at a time across instances)
-- ---------------------------------------------------------------------------

create table if not exists public.relayer_leases (
  name       text primary key,
  holder     text,
  expires_at timestamptz not null default now()
);
alter table public.relayer_leases enable row level security;  -- no policies: service role only

insert into public.relayer_leases (name) values ('relayer') on conflict (name) do nothing;

create or replace function public.acquire_relayer_lease(p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.relayer_leases
     set holder = p_holder,
         expires_at = now() + make_interval(secs => p_ttl_seconds)
   where name = 'relayer'
     and (holder is null or holder = p_holder or expires_at < now());
  return found;
end;
$$;

create or replace function public.release_relayer_lease(p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.relayer_leases set holder = null, expires_at = now()
   where name = 'relayer' and holder = p_holder;
$$;

revoke all on function public.acquire_relayer_lease(text, integer) from public;
revoke all on function public.acquire_relayer_lease(text, integer) from anon, authenticated;
revoke all on function public.release_relayer_lease(text) from public;
revoke all on function public.release_relayer_lease(text) from anon, authenticated;
grant execute on function public.acquire_relayer_lease(text, integer) to service_role;
grant execute on function public.release_relayer_lease(text) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Rollback (manual, review first — drops operation history):
--   drop function if exists public.release_relayer_lease(text);
--   drop function if exists public.acquire_relayer_lease(text, integer);
--   drop table if exists public.relayer_leases;
--   drop function if exists public.reserve_notarization(uuid, text, integer, integer, numeric, numeric, text, text, text, bigint, text);
--   drop table if exists public.notarization_operations;
--   drop policy if exists "Owners can read own documents" on public.documents;
--   alter table public.documents drop column if exists is_legacy, drop column if exists operation_id,
--     drop column if exists original_filename, drop column if exists user_id;
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_user();
--   drop table if exists public.profiles;
--   -- Re-creating the old "Public can read documents" policy is intentionally not listed.
