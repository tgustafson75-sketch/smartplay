/**
 * 2026-06-23 (audit dedup) — single source of truth for the client→brain fetch
 * timeout. It lived as two literals (useVoiceCaddie.BRAIN_TIMEOUT_MS +
 * listeningSession.KEVIN_FETCH_TIMEOUT_MS) kept in sync only by a comment; if one
 * drifted, that path would abort a healthy-but-slow brain and go mute on good
 * signal. Both now import this constant.
 *
 * 30s is the OUTER bound: the server brain's realistic worst case (cold Lambda +
 * a tool round) is ~20s, so 30s gives margin without killing a working call.
 */
// 2026-06-26 — 30s → 15s. The brain answers in ~3-5s (measured: cold 4.4s, warm
// 3.0s for "good morning", TTS included). If it isn't back in 15s the request
// isn't getting through — fail fast so the spoken fallback fires instead of
// leaving the user staring at "thinking" for half a minute.
export const BRAIN_FETCH_TIMEOUT_MS = 15_000;
