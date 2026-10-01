import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../../supabase/", import.meta.url));

// Minimal stand-in for the parts of Supabase the SQL files depend on: the auth schema,
// auth.uid(), and the anon/authenticated/service_role roles referenced by policies.
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`;

/** Fresh in-memory Postgres with schema.sql + all migrations applied (optionally seeded in between). */
export async function createMigratedDb({ beforeMigrations } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  await db.exec(await readFile(`${root}schema.sql`, "utf8"));
  if (beforeMigrations) await beforeMigrations(db);
  await db.exec(await readFile(`${root}migrations/001_auth_ownership_operations.sql`, "utf8"));
  return db;
}
