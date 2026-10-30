-- Anonymous billing funnel counts (no user ids, emails or IPs).
--
-- One row per step, written by the backend only:
--   checkout_started   a signed-in user was sent to Kelviq checkout
--   checkout_returned  someone came back from checkout (success URL)
--   upgraded           a plan changed free -> standard via Kelviq
--   downgraded         a plan changed standard -> free via Kelviq
-- Pricing-page views come from Vercel Web Analytics.

create table if not exists public.funnel_events (
  id          bigint generated always as identity primary key,
  event       text not null check (event in ('checkout_started', 'checkout_returned', 'upgraded', 'downgraded')),
  period      text check (period in ('monthly', 'yearly')),
  created_at  timestamptz not null default now()
);

create index if not exists funnel_events_created_at_idx on public.funnel_events (created_at);

alter table public.funnel_events enable row level security;  -- no policies: service role only

grant select, insert on table public.funnel_events to service_role;
