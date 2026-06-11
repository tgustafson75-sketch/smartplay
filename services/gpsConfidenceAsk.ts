/**
 * 2026-05-24 — GPS confidence-gated proactive ask orchestrator (Flow B).
 *
 * Subscribes to gpsManager.subscribePoorSignal (the existing >15m
 * sustained-45s threshold the toast already fires under) and asks
 * Kevin to speak a "GPS is soft here — what hole are you on?" question
 * when the gate matches AND a chain of honest cooldowns / trust
 * checks pass.
 *
 * Built per the integration map at GPS-VERIFY-DISCOVERY.md (Flow B
 * feasibility section). Existing primitives — subscribePoorSignal,
 * isVoiceAllowed, useTrustLevelStore, speak — are all wired today;
 * what's NEW is the glue that turns a GPS event into a spoken
 * question without going through a user-initiated intent dispatch.
 *
 * The proactive ask IS the honest "we don't know" tell. Kevin only
 * asks when the GPS is soft, so the question itself signals low
 * confidence to the player — they hear "what hole?" and immediately
 * know the yardage they JUST heard from Flow A had the soft-GPS
 * caveat.
 *
 * Cooldown layers (in priority order):
 *   1. Trust level — bail at L1 (Quiet mode); never override the
 *      user's "shush" setting
 *   2. Per-hole — don't re-ask the same hole this round (they
 *      already told us; respect their attention)
 *   3. Per-time — at most one ask per ~5 minutes regardless of hole
 *      (absorbs accuracy-flap pathological cases)
 *
 * On the answer: the user taps the mic and says "I'm on hole 4" /
 * "hole 7" / etc. That utterance routes through the existing
 * voice classifier → navigateHandler → setCurrentHole. The
 * orchestrator does NOT auto-open the mic — Tim and Tank tap-to-talk
 * for every other voice intent today, so this matches the established
 * pattern. (Auto-listen could land in a follow-up if needed.)
 */

import { subscribePoorSignal } from './gpsManager';
import { useGpsHealthStore } from '../store/gpsHealthStore';
import { getApiBaseUrl } from './apiBase';

/** Per-time cooldown between proactive asks. 5 min absorbs accuracy
 *  flap (parking lot under trees → open fairway) without re-asking. */
const ASK_COOLDOWN_MS = 5 * 60_000;

let unsubPoorSignal: (() => void) | null = null;
let unsubRound: (() => void) | null = null;
let initialized = false;

/**
 * Initialize the GPS confidence-gated ask orchestrator. Safe to call
 * multiple times — only the first call wires the subscriber. Returns
 * a teardown function for symmetry, but in practice this is called
 * once at app root and lives for the process lifetime.
 */
export function initGpsConfidenceAsk(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  unsubPoorSignal = subscribePoorSignal((info) => {
    // Always update the rolling accuracy reading so the owner debug
    // card can show "GPS dropped to ~22m at 14:18". This runs even
    // when the ask doesn't fire — recording the signal is independent
    // of speaking about it.
    useGpsHealthStore.getState().recordAccuracy(info.accuracy_m);

    void maybeAskWhatHole(info.accuracy_m);
  });

  // 2026-05-24 — Round-active transitions reset the per-hole cooldown
  // so the next round gets fresh asks. We import roundStore lazily
  // here (dynamic require) to avoid a static dep — this service is
  // initialized at app root and doesn't need to drag in roundStore
  // until the subscriber actually fires.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const round = require('../store/roundStore') as typeof import('../store/roundStore');
    let prevHole = round.useRoundStore.getState().currentHole;
    let prevActive = round.useRoundStore.getState().isRoundActive;
    unsubRound = round.useRoundStore.subscribe((s) => {
      // Round start / end → fresh cooldowns
      if (s.isRoundActive !== prevActive) {
        prevActive = s.isRoundActive;
        useGpsHealthStore.getState().clearRoundCooldowns();
      }
      // Hole change while active → the per-hole cooldown for the
      // PREVIOUS hole stays in the set (don't re-ask hole 3 if we
      // already asked); the new hole hasn't been asked yet so it
      // becomes eligible.
      if (s.currentHole !== prevHole) {
        prevHole = s.currentHole;
      }
    });
  } catch (e) {
    console.log('[gpsConfidenceAsk] round subscribe failed (non-fatal):', e);
  }

  console.log('[gpsConfidenceAsk] orchestrator initialized');

  return () => {
    unsubPoorSignal?.();
    unsubRound?.();
    unsubPoorSignal = null;
    unsubRound = null;
    initialized = false;
  };
}

/**
 * The actual gate + ask. Pulled out for testability and to keep the
 * subscriber callback shallow. All store reads are .getState() —
 * runs outside React, no hooks.
 */
async function maybeAskWhatHole(accuracy_m: number | null): Promise<void> {
  // Lazy imports so this module stays import-cheap at app boot.
  let settings: typeof import('../store/settingsStore');
  let trust: typeof import('../store/trustLevelStore');
  let round: typeof import('../store/roundStore');
  let voiceService: typeof import('./voiceService');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    settings = require('../store/settingsStore') as typeof import('../store/settingsStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    trust = require('../store/trustLevelStore') as typeof import('../store/trustLevelStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    round = require('../store/roundStore') as typeof import('../store/roundStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    voiceService = require('./voiceService') as typeof import('./voiceService');
  } catch (e) {
    console.log('[gpsConfidenceAsk] dependency load failed (non-fatal):', e);
    return;
  }

  const trustLevel = trust.useTrustLevelStore.getState().level;
  const isRoundActive = round.useRoundStore.getState().isRoundActive;
  const currentHole = isRoundActive ? round.useRoundStore.getState().currentHole : null;
  const health = useGpsHealthStore.getState();

  // Gate 0 — No active round. The whole point of this orchestrator is
  // in-round confidence: "we don't know which hole you're on, please
  // tell us." Outside a round (SwingLab upload, swing library, demo,
  // settings), Kevin asking "what hole?" is nonsense — there's no hole.
  // 2026-06-04 — Tim hit this uploading a swing in the library; the
  // poor-signal threshold tripped and Kevin asked "what hole?" with
  // zero round context.
  if (!isRoundActive) {
    console.log('[gpsConfidenceAsk] skip — no active round');
    return;
  }

  // Gate 1 — Trust level. L1 (Quiet) suppresses all non-user-initiated
  // speech via voiceService.isVoiceAllowed already; we short-circuit
  // here so we don't even consume the speak queue slot. This is the
  // documented L1-respect rule from the auto-memory.
  if (trustLevel === 1) {
    console.log('[gpsConfidenceAsk] skip — trust L1 (Quiet)');
    return;
  }

  // Gate 2 — Per-time cooldown. At most one ask per ASK_COOLDOWN_MS.
  if (health.isTimeCooldownActive()) {
    console.log('[gpsConfidenceAsk] skip — within time cooldown');
    return;
  }

  // Gate 3 — Per-hole cooldown. Don't re-ask the same hole this
  // round even if accuracy stays soft; the player already told us.
  if (currentHole != null && health.isHoleCooldownActive(currentHole)) {
    console.log('[gpsConfidenceAsk] skip — hole', currentHole, 'already asked this round');
    return;
  }

  // All gates passed — speak the question.
  const voiceGender = settings.useSettingsStore.getState().voiceGender;
  const language = settings.useSettingsStore.getState().language ?? 'en';
  const apiUrl = getApiBaseUrl();
  const text = "GPS is a little soft here — what hole are you on?";

  try {
    // userInitiated: false — this IS a proactive ask. The
    // isVoiceAllowed gate in voiceService is the second-line defense
    // for the L1 check (we short-circuited above for cleanliness).
    await voiceService.speak(text, voiceGender, language, apiUrl);
  } catch (e) {
    console.log('[gpsConfidenceAsk] speak failed (non-fatal):', e);
    // Don't record the ask if speak failed — keeps the cooldown open
    // for the next chance.
    return;
  }

  // Record the ask AFTER speak resolves so the cooldown reflects an
  // actual spoken question, not just an attempt.
  useGpsHealthStore.getState().recordAsk(
    {
      at: Date.now(),
      hole: currentHole,
      accuracy_m,
      reason: 'poor_signal',
    },
    ASK_COOLDOWN_MS,
  );
}
