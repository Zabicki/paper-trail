-- Enables pgTAP so RLS policies can be verified by test rather than assumed
-- (supabase/tests/database/*.test.sql, run via `supabase test db`).
-- Kept as its own migration: this is testing infrastructure, not product schema.
create extension if not exists pgtap with schema extensions;
