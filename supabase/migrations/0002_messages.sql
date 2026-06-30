-- ============================================================================
-- SmartPlay Caddie — minimal in-app messaging (Tim ↔ Tank to start)
-- Migration 0002 — messages table
--
-- RUN THIS in the Supabase SQL editor of Tim's EXISTING project (same as 0001).
--
-- ISOLATION (see 0001): everything lives in the `smartplay` schema. This
-- migration must NEVER create/alter/reference any object in `public` or name a
-- SmartManage table. The server client (api/_supabase.ts) is pinned to
-- `smartplay`, so it physically cannot reach SmartManage data.
--
-- Idempotent: safe to run more than once (IF NOT EXISTS throughout).
-- ============================================================================

create schema if not exists smartplay;

-- ── messages ────────────────────────────────────────────────────────────────
-- One row per message between two app users, identified by account email.
-- Minimal "to start" — a real backend (not a stub): send + poll a thread.
create table if not exists smartplay.messages (
  id          bigint generated always as identity primary key,
  from_email  text not null,
  to_email    text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

comment on table smartplay.messages is
  'SmartPlay minimal in-app messaging (Tim<->Tank to start). Identity = account email. SmartPlay-only; never references public/SmartManage tables.';

-- Query helpers: inbox by recipient, sent by sender, and a 2-person thread.
create index if not exists messages_to_idx   on smartplay.messages (to_email, created_at);
create index if not exists messages_from_idx on smartplay.messages (from_email, created_at);
create index if not exists messages_pair_idx on smartplay.messages (from_email, to_email, created_at);

-- Grants — a NEW table in the smartplay schema is NOT auto-granted to the API roles,
-- so PostgREST (the JS client) gets permission-denied until these run. The server uses
-- the service_role key (bypasses RLS); anon/authenticated included for completeness.
grant usage on schema smartplay to anon, authenticated, service_role;
grant all on smartplay.messages to service_role;
grant select, insert, update on smartplay.messages to anon, authenticated;
-- Future smartplay tables: auto-grant so this never bites again.
alter default privileges in schema smartplay grant all on tables to service_role;
alter default privileges in schema smartplay grant select, insert, update on tables to anon, authenticated;
