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
 * 2026-11-09 (Report Card blocker, "messages leak"): the fixed default key that used to live here was
 * public (this repo is public), and production accepted it, so anyone could read an allow-listed
 * participant's thread. The default is removed: the server accepts only MESSAGING_APP_SECRET and
 * refuses everything while it is unset. Messaging is off in store builds (MESSAGING_RELEASED=false),
 * so no player loses anything. Real per-user identity is the remaining follow-up before release.
 */

/** The key the CLIENT sends: EXPO_PUBLIC_MESSAGING_KEY, or '' (no key -> the server refuses). */
export function getMessagingKey(): string {
  return (process.env.EXPO_PUBLIC_MESSAGING_KEY ?? '').trim();
}

/** The key the SERVER accepts: MESSAGING_APP_SECRET only. Unset -> '' -> every request is refused. */
export function getMessagingServerKey(): string {
  return (process.env.MESSAGING_APP_SECRET ?? '').trim();
}

/** Length-safe constant-time-ish comparison (avoids leaking the key length via early return). */
export function keysMatch(provided: unknown, expected: string): boolean {
  if (!expected || typeof provided !== 'string' || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
