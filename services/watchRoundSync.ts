/**
 * 2026-08-24 (Tim's call — "wire them owner-only") — PHONE → WATCH, the half nobody filled.
 *
 * services/watchCaddieBridge has registered the watchBridge sender since 2026-07-06, and its own
 * header says "sendNotification/sendLiveScore/sendVoicePrompt/sendRoundState from anywhere in the
 * app now actually reach the watch." The transport was true. The sentence was not: an orphan sweep
 * on 08-24 found that all FOUR senders had zero callers. The pipe was built, connected, and nothing
 * was ever put into it — so a Galaxy Watch running the companion got swing feedback and live pin
 * yardage, and never once got the score, the hole, or a word the caddie said.
 *
 * ONE OWNER, deliberately. The alternative was four call sites sprinkled through roundStore and the
 * voice path — the most load-bearing code in the app, during a feature freeze, to serve a watch only
 * Tim owns. This module subscribes instead, so the round store is untouched and there is a single
 * place to look when the watch says something wrong.
 *
 * OWNER-GATED at every entry (isOwnerEmail), per the feature freeze: watch extras are Beta 2, and
 * this ships now only because it cannot appear for anyone else. Remove the gate to promote it.
 *
 * FIRE-AND-FORGET, ALWAYS. Every push is wrapped and voided. A watch that is asleep, absent, or on
 * iOS must never delay a hole transition or a spoken line — the send itself already no-ops without a
 * registered sender, and this adds a second belt so a throw cannot escape into a caller.
 */
import { useRoundStore } from '../store/roundStore';
import { useToastStore } from '../store/toastStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { sendLiveScore, sendNotification, sendRoundState, sendVoicePrompt } from './watchBridge';
import { devLog } from './devLog';

/** The freeze boundary. Everything below is a no-op for anyone who is not the owner. */
function ownerOnly(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prof = require('../store/playerProfileStore') as typeof import('../store/playerProfileStore');
    return prof.isOwnerEmail(prof.usePlayerProfileStore.getState().email);
  } catch {
    return false;
  }
}

/** Never let a watch push reach a caller as an exception, or as latency. */
function fire(label: string, run: () => Promise<void>): void {
  if (!ownerOnly()) return;
  try {
    void run().catch((e) => devLog(`[watchSync] ${label} failed: ${String(e)}`));
  } catch (e) {
    devLog(`[watchSync] ${label} threw: ${String(e)}`);
  }
}

/** The caddie's spoken line, mirrored to the wrist. Called from voiceService.speak. */
export function pushWatchVoicePrompt(text: string): void {
  const t = (text ?? '').trim();
  if (!t) return;
  fire('voicePrompt', () => sendVoicePrompt(t.slice(0, 300)));
}

/** A short proactive line the watch should surface. */
export function pushWatchNotification(text: string, subtitle?: string | null): void {
  const t = (text ?? '').trim();
  if (!t) return;
  fire('notification', () => sendNotification(t.slice(0, 200), subtitle ?? null));
}

let unsubToast: (() => void) | null = null;
let lastToastSeq = -1;
let unsubscribe: (() => void) | null = null;
/** Last values pushed, so a store write that changed something else does not re-send. */
let lastState = '';
let lastScore = '';

/**
 * Subscribe to the round and push state + score as they change.
 *
 * Deduplicated on the VALUES, not on the store write: roundStore updates on nearly every user
 * action, and a watch that receives an identical score forty times an hour is a battery complaint.
 */
export function startWatchRoundSync(): void {
  /**
   * 2026-08-24 (verification pass — found by re-reading my own code, not by a failure).
   *
   * This used to early-return when `ownerOnly()` was false, and never retry. But
   * playerProfileStore is ASYNC-PERSISTED, and initWatchCaddieBridge runs off
   * `settingsHydratedForBoot` — a DIFFERENT store's hydration. So on a cold boot the email could
   * still be null here, the owner check would fail, and the watch would silently receive nothing for
   * the entire session. Gating a feature on a value that has not loaded yet, with no re-check, is
   * the same shape as the `dcHydrated` guard in play.tsx and precisely the kind of half-wiring this
   * whole day has been about.
   *
   * So the subscription is now unconditional and the OWNER CHECK LIVES AT EVERY PUSH (see `fire`),
   * which makes hydration order irrelevant. A non-owner pays one early-returning function call per
   * round-store write and sends nothing — the boundary is unchanged, it is just no longer decided
   * once, too early.
   */
  if (unsubscribe) return;

  const pushIfChanged = () => {
    /**
     * 2026-08-24 (verification pass, second bug in the same function) — DO NOT RECORD A PUSH THAT
     * DID NOT HAPPEN.
     *
     * The dedupe keys below are set before `fire` decides whether to send. While the profile was
     * unhydrated the seed ran, wrote lastState, and sent nothing — so when the owner's email
     * finally arrived, the state looked ALREADY SENT and the watch stayed empty. A cache of
     * "what we last delivered" that records non-deliveries is worse than no cache.
     *
     * Bailing here means the keys only ever reflect something genuinely put on the wire.
     */
    if (!ownerOnly()) return;
    let s;
    try { s = useRoundStore.getState(); } catch { return; }

    const active = !!s.isRoundActive;
    const hole = typeof s.currentHole === 'number' ? s.currentHole : null;
    const stateKey = `${active}|${hole}`;
    if (stateKey !== lastState) {
      lastState = stateKey;
      fire('roundState', () => sendRoundState(active, hole));
    }

    // Only while a round is live, and only when a hole has actually been scored — vsPar is null
    // until a scored hole has a known par, and the watch must not display a fabricated even-par.
    if (!active || hole == null) return;
    let vsPar: number | null = null;
    let total = 0;
    try {
      vsPar = typeof s.getScoreVsPar === 'function' ? s.getScoreVsPar() : null;
      total = typeof s.getTotalScore === 'function' ? s.getTotalScore() : 0;
    } catch { return; }
    if (vsPar == null || total <= 0) return;

    const scoreKey = `${vsPar}|${total}|${hole}`;
    if (scoreKey === lastScore) return;
    lastScore = scoreKey;
    fire('liveScore', () => sendLiveScore({ vsPar, hole, totalScore: total }));
  };

  try {
    unsubscribe = useRoundStore.subscribe(pushIfChanged);
    pushIfChanged();   // seed the watch with where we are right now, not at the next change

    /**
     * Toasts are the app's existing NON-VOICE notification stream — 114 call sites, everything from
     * "course is ready" to a save confirmation. Subscribing here is what gives sendNotification a
     * real source without touching any of those 114 sites, and without inventing a new notion of
     * "notification" that would then need its own owner.
     *
     * Keyed on `seq`, not on the message: the store bumps a monotonic counter precisely so two
     * identical toasts in a row are distinguishable, and a repeat is a real second event.
     */
    lastToastSeq = (() => { try { return useToastStore.getState().seq; } catch { return -1; } })();
    unsubToast = useToastStore.subscribe(() => {
      let t;
      try { t = useToastStore.getState(); } catch { return; }
      if (t.seq === lastToastSeq || !t.message) return;
      lastToastSeq = t.seq;
      pushWatchNotification(t.message);
    });
    /**
     * And if the profile hydrates AFTER this ran, seed then. Without it, an owner whose email
     * arrived late would get nothing until the round state next changed — which on a boot mid-round
     * could be never.
     */
    if (!ownerOnly()) {
      const unsubProfile = usePlayerProfileStore.subscribe(() => {
        if (!ownerOnly()) return;
        try { unsubProfile(); } catch { /* non-fatal */ }
        pushIfChanged();
      });
    }
    devLog('[watchSync] started');
  } catch (e) {
    devLog(`[watchSync] subscribe failed: ${String(e)}`);
    unsubscribe = null;
  }
}

export function stopWatchRoundSync(): void {
  try { unsubscribe?.(); } catch { /* non-fatal */ }
  try { unsubToast?.(); } catch { /* non-fatal */ }
  unsubscribe = null;
  unsubToast = null;
  lastToastSeq = -1;
  lastState = '';
  lastScore = '';
}
