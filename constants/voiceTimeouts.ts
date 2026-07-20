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
// 2026-06-26 — 30s → 15s → 20s. The brain answers in ~3-5s (measured: cold 4.4s,
// warm 3.0s, TTS included). 15s was too tight: a LEGIT multi-round tool chain
// (cold Lambda + lookup_course→lookup_hole→answer) can run ~15-20s and was being
// aborted client-side.
// 2026-07-20 (pre-ship audit) — 20s → 30s. The default brain (api/pipecat-turn) runs a
// provider CASCADE of up to 3×9s = 27s worst case; on a slow first provider turn a cold
// Lambda pushed a HEALTHY turn past the 20s client abort → pipecat got cancelled and the
// path fell through to the kevin fallback (an "ask me again" first-try failure). 30s clears
// the 27s server cascade with headroom while still failing fast on a truly dead network
// (transcribe already caps at 12s and the spoken fallback fires on abort).
export const BRAIN_FETCH_TIMEOUT_MS = 30_000;
