-- 2026-07-10 (audit S3) — per-IP read throttle for the backup endpoint.
-- The backup row is protected only by sha256(email::passphrase); without a throttle a
-- known email could be paired with brute-forced passphrase guesses. api/backup.ts counts
-- read attempts per (ip, minute) here and rejects >30/min. Fail-open in code, so the API
-- keeps working before this migration is applied — apply it to ACTIVATE the throttle.

create table if not exists smartplay.backup_rate_limit (
  k    text primary key,                 -- "<ip>:<unix-minute>"
  n    integer not null default 0,        -- attempts in that minute
  at   timestamptz not null default now()
);

-- Only the service key (server) touches this; enable RLS with no policies so the anon
-- key can never read/write it.
alter table smartplay.backup_rate_limit enable row level security;

-- Housekeeping: an index to prune old rows (optional cron: delete where at < now() - interval '1 day').
create index if not exists backup_rate_limit_at_idx on smartplay.backup_rate_limit (at);
