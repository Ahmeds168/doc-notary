-- Decentralized Document Notary — Supabase schema
-- This table indexes on-chain notarization records for fast search/listing.
-- The blockchain remains the source of truth for verification; this table
-- is a queryable cache/enrichment layer (filenames, storage keys, etc.)
-- that the chain does not store.

create table if not exists documents (
  id                bigint generated always as identity primary key,
  document_hash     text not null unique,           -- 0x-prefixed sha256 hash, matches on-chain record
  label             text,                            -- original filename
  submitter_address text not null,                   -- wallet address that notarized it (lowercased)
  tx_hash           text not null,                    -- Sepolia transaction hash
  block_timestamp   bigint not null,                  -- unix timestamp from the block
  storage_key       text not null,                    -- R2 object key
  file_size_bytes   bigint,
  content_type      text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_documents_submitter on documents (submitter_address);
create index if not exists idx_documents_created_at on documents (created_at desc);
create index if not exists idx_documents_hash on documents (document_hash);

-- Row Level Security: reads are public (verification should be checkable by anyone),
-- writes are restricted to the service role (backend only — never expose write access
-- to the anon/public key).
alter table documents enable row level security;

create policy "Public can read documents"
  on documents for select
  using (true);

create policy "Only service role can insert"
  on documents for insert
  to service_role
  with check (true);
