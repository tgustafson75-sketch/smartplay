/**
 * 2026-05-22 — Hands-Free Orchestrator.
 *
 * One entry point in front of every hands-free input (Bluetooth
 * earbud taps, smartwatch taps, on-screen "Tap to talk" button).
 * Resolves tap PATTERNS into ACTIONS, manages the smart pause /
 * resume around in-flight voice playback, and threads everything
 * through the existing listeningSession + voiceService surfaces.
 *
 * Pattern → Action mapping (Pass 1; later passes can expand):
 *   single        → toggle listening (Kevin/Serena starts/stops the mic)
 *   double        → repeat the last spoken caddie line   (watch only — see handleTap)
 *   triple        → stop/mute current playback ("Kevin shush")   (watch only)
 *   long_press    → reserved (Pass 2: persona quick-switch)
 *
 * Speech on a tap (2026-10-28): a single press is listeningSession.toggle()'s alone (it opens, ends
 *   the capture, or shushes the reply); triple stops playback as its meaning. Nothing here stops
 *   speech unconditionally any more — see handleTap.
 *   - (Retired 2026-08-29) audio routed to the phone speaker AND voiceOnPhoneSpeaker
 *     setting is false, suppress the listening session (the user
 *     doesn't have earbuds in; the conversation would broadcast).
 *     Toast informs them.
 *
 * Wire reality check (unchanged): real BT-button capture needs the
 * native bridge in mediaKeyBridge.ts. This orchestrator works against
 * the EVENT-BUS shape — when the native bridge ships, every tap flows
 * through here automatically.
 */

import {
  subscribeTapPattern, type TapPattern,
} from './earbudControl';
import { subscribeWatchTap, subscribeWatchVoice, subscribeWatchCommand, type WatchCommand } from './watchBridge';
import { emitSmartMotionCommand, isSmartMotionActive } from './smartMotionRecordBus';
import { devLog } from './devLog';

// 2026-08-07 (Tim — "record button on the watch to control SmartMotion record + stop"). Act on a watch
// control command from the phone: open SmartMotion + start/stop the camera. Uses the same record bus the
// on-screen buttons + earbud tap use, so behavior is identical. When SmartMotion isn't open yet, a record/
// toggle command opens it with ?autoRecord=1 so the camera rolls on arrival (the promise holds).
function handleWatchCommand(command: WatchCommand): void {
  try {
    const { router } = require('expo-router') as typeof import('expo-router');
    switch (command) {
      case 'open_smartmotion':
        if (!isSmartMotionActive()) router.push('/swinglab/smartmotion' as never);
        break;
      case 'smartmotion_record':
        if (isSmartMotionActive()) emitSmartMotionCommand('start');
        else router.push('/swinglab/smartmotion?autoRecord=1' as never);
        break;
      case 'smartmotion_stop':
        emitSmartMotionCommand('stop');
        break;
      /**
       * 2026-09-21 — the WATCH tap. Replaces the long-press Tim asked to remove.
       *
       * Always a countdown, because this command can only come from a wrist: the player is away
       * from the phone and has to walk into frame. When SmartMotion is already open the screen
       * runs the countdown itself; when it is closed the route carries it, so the count starts the
       * moment the camera is ready rather than the moment the screen mounts.
       */
      case 'smartmotion_countdown':
        if (isSmartMotionActive()) emitSmartMotionCommand('countdown');
        else router.push('/swinglab/smartmotion?autoRecord=1&countdown=5' as never);
        break;
      case 'smartmotion_toggle':
        if (isSmartMotionActive()) emitSmartMotionCommand('toggle');
        else router.push('/swinglab/smartmotion?autoRecord=1' as never);
        break;
    }
    devLog(`[handsFree] watch command handled: ${command}`);
  } catch (e) { devLog('[handsFree] watch command failed: ' + String(e)); }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

let started = false;
const unsubs: (() => void)[] = [];

/**
 * Wire the orchestrator. Idempotent — calling twice is a no-op. Called
 * once at app start from app/_layout.tsx (or wherever listeningSession
 * is initialized today; this can sit alongside).
 */
export function startHandsFreeOrchestrator(): void {
  if (started) return;
  started = true;
  unsubs.push(subscribeTapPattern((p) => { void handleTap('earbud', p); }));
  unsubs.push(subscribeWatchTap((p) => { void handleTap('watch', p); }));
  unsubs.push(subscribeWatchVoice((utterance) => { void handleWatchVoice(utterance); }));
  unsubs.push(subscribeWatchCommand(handleWatchCommand));
  devLog('[handsFree] orchestrator started');
}

export function stopHandsFreeOrchestrator(): void {
  while (unsubs.length > 0) {
    const u = unsubs.pop();
    try { u?.(); } catch { /* non-fatal */ }
  }
  started = false;
  devLog('[handsFree] orchestrator stopped');
}

// ─── Tap dispatch ────────────────────────────────────────────────────────

type TapSource = 'earbud' | 'watch';

/**
 * 2026-10-28 (voice engineering review, VOICE-ENG-1) — ONE OWNER PER TAP.
 *
 * Every earbud press reached listeningSession.toggle() TWICE: listeningSession's own subscriber acts
 * on the press at once (subscribeEarbudTap — the low-latency path, and the one the trigger haptic and
 * every echo guard are built around), and this pattern handler then called toggle() again ~350 ms
 * later for 'single'. The second reach was absorbed by an echo guard — and, in 'responding', mailed
 * as a tap_swallowed "failure" for a tap that had worked. Worse, this handler ran stopSpeaking()
 * unconditionally first, so the second reach CLIPPED the caddie's own "Yeah?" open cue (and any line
 * after a close) mid-word.
 *
 * Now:
 *   • every earbud press belongs to listeningSession alone — nothing here acts on it (R2-4, in handleTap);
 *   • the watch has no other path, so its 'single' is its one toggle;
 *   • the watch's double / triple act only while the session is IDLE. While a turn is live the presses that
 *     made the chain were already consumed by toggle() (open, "I'm done", shush), and acting on them
 *     again is the double owner this removes;
 *   • nothing stops speech unconditionally: the triple "shush" stops it because that is its meaning,
 *     and a replay's speak() replaces whatever was playing on its own.
 */
async function sessionIsIdle(): Promise<boolean> {
  try {
    const ls = await import('./listeningSession');
    return ls.getSessionState() === 'idle';
  } catch { return true; }
}

async function handleTap(source: TapSource, pattern: TapPattern): Promise<void> {
  devLog(`[handsFree] tap source=${source} pattern=${pattern}`);

  /**
   * 2026-10-28 (recheck VOICE-ENG-R2-4) — EVERY EARBUD PRESS IS listeningSession's, NOT ONLY THE SINGLE.
   * Its subscriber acts on each press the instant it lands, so the presses of a double or triple were
   * already an open, an "I'm ready" or a close by the time the chain classified here:
   *   • from idle, press 1 opens the mic — the session is never idle when a 'double' resolves;
   *   • on earbuds / unknown routes the bridge coalesces presses closer than 350 ms (tapCoalescer), the
   *     same as the classify window, so a second press never even joined the chain;
   *   • on a wired remote (150 ms) a close-then-press DID resolve as 'double' with the session idle again,
   *     and replayed from the start the very line the player had just stopped.
   * So the earbud double / triple could only ever fire as that wrong replay. The replay and the shush
   * stay on the watch, which has no other path; on an earbud, a press during a reply is already the
   * shush (toggle), and "what did you say?" is a question the caddie answers from the conversation.
   */
  if (source === 'earbud' && pattern !== 'long_press') return;

  if (pattern === 'single') {
    try {
      const ls = await import('./listeningSession');
      await ls.toggle();
    } catch (e) {
      devLog('[handsFree] toggle failed: ' + String(e));
    }
    return;
  }

  if (pattern === 'long_press') {
    // Reserved for Pass 2 — persona quick-switch via long press.
    devLog('[handsFree] long_press received — no action wired in Pass 1');
    return;
  }

  if (!(await sessionIsIdle())) {
    devLog(`[handsFree] ${pattern} ignored — a turn is live; its presses were the session's`);
    return;
  }

  if (pattern === 'double') {
    await replayLastCaddieLine();
    return;
  }

  // triple — the explicit "shush": stop what is playing, confirm without voice.
  try {
    const voice = await import('./voiceService');
    await voice.stopSpeaking?.('screen:handsFree-triple')?.catch?.(() => undefined);
  } catch { /* non-fatal */ }
  try {
    const toast = await import('../store/toastStore');
    toast.useToastStore.getState().show('Quieted.');
  } catch { /* non-fatal */ }
}

async function handleWatchVoice(utterance: string): Promise<void> {
  // The watch already transcribed the utterance on-device; route
  // straight through the voice intent classifier the same way the
  // phone's listening session would. The classifier handles every
  // existing intent (record swing, analyze, query state, etc).
  devLog(`[handsFree] watch-voice → intent route: "${utterance.slice(0, 60)}"`);
  try {
    const ls = await import('./listeningSession');
    await ls.handleTranscribedUtterance?.(utterance);
  } catch (e) {
    devLog('[handsFree] watch-voice route failed: ' + String(e));
  }
}

// ─── Replay last line ────────────────────────────────────────────────────

/**
 * Replay the last caddie line — useful when the user missed it
 * (wind / playing partner talked over it / quick double-tap on
 * earbuds). Reads from a small in-memory cache that voiceService
 * populates on every speak() call.
 *
 * Defensive: when no line has been captured yet, no-op + toast.
 */
async function replayLastCaddieLine(): Promise<void> {
  try {
    const voice = await import('./voiceService');
    const last = voice.getLastSpokenLine?.();
    if (!last || !last.trim()) {
      const toast = await import('../store/toastStore');
      toast.useToastStore.getState().show('No recent line to replay.');
      return;
    }
    /**
     * 2026-10-31 (caddie-voice CV-2) — replay plays the clip the player already heard. Each speak() is a
     * fresh paid render, and speak() logs the line again, so a replay used to cost a TTS call and append a
     * second copy of the caddie's line to the log that feeds the recap. A line with no clip in memory (the
     * device voice, a fixed line) is spoken from the cached persona clips only: still no render, no log.
     */
    if (await voice.replayLastRenderedClip?.(last)) {
      devLog('[handsFree] replayed last caddie clip');
      return;
    }
    const settings = (await import('../store/settingsStore')).useSettingsStore.getState();
    await voice.speakDeviceNotice?.(last, settings.language ?? 'en', settings.voiceGender);
    devLog('[handsFree] replayed last caddie line');
  } catch (e) {
    devLog('[handsFree] replay failed: ' + String(e));
  }
}

// ─── Public testing surface ──────────────────────────────────────────────

/** Manually fire a pattern — used by Settings → Dev "test earbud
 *  patterns" panel and by automated tests. */
export async function debugFirePattern(pattern: TapPattern, source: TapSource = 'earbud'): Promise<void> {
  await handleTap(source, pattern);
}
