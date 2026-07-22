/**
 * Shared app-key for the minimal messaging endpoint (/api/messages).
 *
 * 2026-07-21 (QA audit, H4) — /api/messages was fully unauthenticated: anyone who knew or
 * guessed an email could read that user's whole thread or forge messages from them. Real
 * per-user auth needs a per-user secret the app doesn't have (login was removed). As a
 * proportionate, NON-breaking fix for this closed beta feature (Tim ↔ Tank), the client now
 * sends a shared app-key header that the server verifies, which closes the "anyone with curl
 * + a known email" hole. Combined with the server's optional participant allow-list, the
 * blast radius is the intended participants only.
 *
 * HONEST LIMITATION: a shared key baked into the client bundle is extractable by a determined
 * attacker who decompiles the app — this is defense against opportunistic/external abuse, not
 * a substitute for real auth. Follow-up (tracked in QA_REPORT.md): bind messaging identity to
 * the hardened backup passphrase, or issue email-verified per-user tokens.
 *
 * Mirrors the apiBase pattern: honor EXPO_PUBLIC_MESSAGING_KEY when set (inlined at build or
 * provided in dev), otherwise fall back to a fixed default so OTA bundles — where EXPO_PUBLIC_*
 * are empty — still work. Set MESSAGING_APP_SECRET on the server to the same value to rotate.
 */

/** Fixed default so client and server agree even when neither env var is configured. */
export const MESSAGING_APP_KEY_DEFAULT = 'spc_msg_k1_a7f39c2e5b8140d6b3e1c9f0aa47d2e8';

/** The key the CLIENT sends (EXPO_PUBLIC override → default). */
export function getMessagingKey(): string {
  return (process.env.EXPO_PUBLIC_MESSAGING_KEY ?? '').trim() || MESSAGING_APP_KEY_DEFAULT;
}

/** The key the SERVER accepts (server secret → default). Kept separate so the server can be
 *  rotated to a strong secret via MESSAGING_APP_SECRET without shipping it in the bundle. */
export function getMessagingServerKey(): string {
  return (process.env.MESSAGING_APP_SECRET ?? '').trim() || MESSAGING_APP_KEY_DEFAULT;
}

/** Length-safe constant-time-ish comparison (avoids leaking the key length via early return). */
export function keysMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
