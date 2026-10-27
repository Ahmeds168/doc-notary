-- Explicit table grants.
--
-- From 30 October 2026, Supabase no longer grants new tables in the public
-- schema to anon, authenticated and service_role automatically. Tables created
-- before then already have those grants; this migration states them explicitly
-- so a fresh project (or any table recreated later) keeps working.
--
-- Access model:
--   service_role   the backend API: full access to every table.
--   authenticated  read only; row level security limits each user to their own rows.
--   anon           no table access (verification goes through the backend).

grant select, insert, update, delete on table public.documents               to service_role;
grant select, insert, update, delete on table public.profiles                to service_role;
grant select, insert, update, delete on table public.notarization_operations to service_role;
grant select, insert, update, delete on table public.relayer_leases          to service_role;

grant select on table public.documents               to authenticated;
grant select on table public.profiles                to authenticated;
grant select on table public.notarization_operations to authenticated;

-- When adding a table in a later migration, add its grants alongside it, e.g.:
--   grant select, insert, update, delete on table public.<new_table> to service_role;
