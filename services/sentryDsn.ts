/**
 * services/sentryDsn.ts — ONE OWNER FOR "WHICH DSN, AND IS THERE ONE".
 *
 * 2026-09-21. The OTA-safe resolution was fixed once, on 2026-07-06, and only in the file that
 * happened to be audited.
 *
 * The problem it solved: `EXPO_PUBLIC_SENTRY_DSN` lives in the EAS server environment, so it is
 * present at BUILD time and EMPTY in any OTA bundle exported from a laptop. app/_layout.tsx got a
 * hardcoded public-DSN fallback that day and has initialised Sentry correctly ever since —
 * but services/analytics.ts kept gating on the raw env var:
 *
 *     const hasDsn = !!process.env.EXPO_PUBLIC_SENTRY_DSN;
 *
 * so every analytics event and breadcrumb it guards worked in the STORE BUILD and went silent on
 * the first OTA after it. The instrument dies exactly when a hotfix ships, which is the moment you
 * most need to see what the fix did. The 07-06 note calls this out as "silently OFF fleet-wide";
 * it was still half-true in this file fourteen weeks later.
 *
 * A DSN is a write-only public ingest key — designed to ship in clients, unlike the Maps key — so
 * embedding it is safe. What is not safe is two files disagreeing about whether one exists.
 * [[two-owners-is-the-root-cause]]
 */

/** Public ingest key. Safe to embed; it can only write events, never read them. */
const SENTRY_DSN_FALLBACK =
  'https://94204d567ba053ad6f9dc3f39ff84655@o4511297513717760.ingest.us.sentry.io/4511297527283712';

/** The DSN this bundle should use — the env var when a build supplied one, the public key otherwise. */
export const SENTRY_DSN: string = process.env.EXPO_PUBLIC_SENTRY_DSN || SENTRY_DSN_FALLBACK;

/** True whenever events can be sent at all. Never gate on the bare env var — see the header. */
export const HAS_SENTRY_DSN: boolean = SENTRY_DSN.length > 0;
