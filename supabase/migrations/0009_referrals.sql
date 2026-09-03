-- 2026-09-03 — Referrals (api/referral.ts).
--
-- Tim: "And a referral link. If a friend signs up, user gets 30 days."
--
-- ── WHAT "SIGNS UP" MEANS IN AN APP WITH NO SIGN-UP ────────────────────────────────────────────
-- SmartPlay has no accounts and no sign-in; the privacy policy says so plainly. So a referral cannot
-- be settled by "an account was created" — there is no such event. Counting INSTALLS instead would
-- be worse than useless: an install is a tap, it costs nothing, and an emulator farms them all day.
--
-- A referral is settled here when the friend actually PLAYS — the same real-use bar the light-use
-- trial extension uses (a round started or a swing recorded). That is the honest reading of "signs
-- up" for this product, it is the moment the friend became a user rather than a download, and it is
-- the cheapest possible defence against farming: a fake install has to play golf.
--
-- ── IDENTITY, WITHOUT AN IDENTITY ──────────────────────────────────────────────────────────────
-- The only stable handle is services/installId.ts — a locally-generated random per-install string,
-- deliberately not a device id (see that file). The shareable CODE is a one-way hash of it:
--   code = sha256(REFERRAL_SALT + install)[0..9]
-- Two properties follow, and both matter:
--   • Sharing your code does NOT let anyone redeem your days. Redemption requires the INSTALL, and
--     the server recomputes the code from it. A code is a deposit slip, not a key.
--   • The code cannot be walked back to the install id that appears on diagnostic reports, so the
--     growth feature and the support channel do not become a way to join a person's data together.
--
-- Reinstalling mints a new install id and therefore a new code, which loses unredeemed credit. That
-- is the correct trade rather than a bug to fix: making referral credit survive a reinstall would
-- require exactly the durable device identity installId.ts exists to avoid.
--
-- Isolation: `smartplay` schema (never `public`/SmartManage). RLS on with NO client policies — only
-- the Vercel service key touches it, always through api/referral.ts.

create schema if not exists smartplay;

create table if not exists smartplay.referrals (
  -- The FRIEND's install. Primary key, so one install can be referred exactly once, ever — this is
  -- the single most important abuse control here and it is enforced by the database rather than by
  -- a check the server could forget. Reinstall-farming still costs a fresh round of golf per cycle.
  referred_install text        primary key,
  -- Whose code was used. Hashed install id; see above. Never joined to anything else.
  referrer_code    text        not null,
  claimed_at       timestamptz not null default now(),
  -- Set when the friend actually played. Null = claimed but not yet earned; nothing pays out on it.
  qualified_at     timestamptz,
  -- Set when the referrer's app banked the days, so a redeem cannot pay twice.
  redeemed_at      timestamptz,
  -- Stored per row rather than read from a constant at redemption time, so changing the offer later
  -- cannot retroactively re-price referrals somebody already earned.
  reward_days      int         not null default 30
);

-- Redemption and status both ask "this code's qualified, unredeemed rows"; nothing else queries here.
create index if not exists referrals_referrer_idx
  on smartplay.referrals (referrer_code, qualified_at, redeemed_at);

alter table smartplay.referrals enable row level security;
-- Deliberately NO policies: the service key bypasses RLS, and nothing else may reach this table.

-- Stated EXPLICITLY rather than relying on 0007's default privileges, for the same reason 0008 does:
-- `alter default privileges` only covers tables later created BY THE SAME ROLE, so a table created
-- from the SQL editor under a different role silently misses them — it exists and every write fails.
grant usage on schema smartplay to service_role;
grant all on smartplay.referrals to service_role;
revoke all on smartplay.referrals from anon, authenticated;
