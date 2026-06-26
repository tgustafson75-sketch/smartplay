/**
 * 2026-06-09 — Smart Motion hands-free record bus.
 *
 * Lets active-listening voice commands ("caddie, record" / "start" / "stop")
 * drive the Smart Motion capture without the user touching the screen: stand
 * at the range, say start, hit for a minute, say stop (or let the 60s window
 * auto-wrap), review, then go again.
 *
 * Design: the SMART MOTION SCREEN owns the start/stop logic. A voice command
 * just emits a nudge on this bus; the screen decides what to do based on its
 * current phase (toggle: if recording → stop, else → start). That keeps the
 * behavior robust even if the classifier can't perfectly tell "start" from
 * "stop" — one recognized capture phrase always does the right thing.
 *
 * The `active` flag tells voice handlers whether the Smart Motion screen is
 * mounted, so "record my swing" controls the open window instead of trying to
 * open a new capture surface.
 *
 * 2026-06-22 — Voice layer additions:
 *  - DrillConfig: Kevin → SmartMotion (club + shot count from voice setup)
 *  - SmartMotionVoiceEvent: SmartMotion → Kevin (entered, session_complete)
 *  - 'close' added to SmartMotionCommand
 */

// 'puttOn' / 'puttOff' let a hands-free voice club change ("switch to putter" /
// "now I'm on my 7-iron") set the per-recording putt mode on the Smart Motion
// screen, matching what picking the putter in the picker or a club scan does —
// so a voice putter change is analyzed AS A PUTT, and any non-putter club
// change clears putt mode back to a full-swing read.
export type SmartMotionCommand = 'start' | 'stop' | 'toggle' | 'scanClub' | 'puttOn' | 'puttOff' | 'close';

type Listener = (cmd: SmartMotionCommand) => void;

const listeners: Set<Listener> = new Set();
let active = false;
// 2026-06-16 (Tim — earbud-tap-to-stop) — true ONLY while a swing is actively
// RECORDING (camera owns the mic). Voice handlers read this to know the mic is
// reserved: an earbud/glasses tap during recording must STOP the capture, never
// open a listen session (that would race the camera's audio = "Only one Recording
// object" crash). Frees the moment recording stops → voice takes over.
let recording = false;

/** Subscribe to record commands. Returns an unsubscribe fn. */
export function subscribeSmartMotionCommand(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Emit a record command to the mounted Smart Motion screen (if any). */
export function emitSmartMotionCommand(cmd: SmartMotionCommand): void {
  for (const cb of listeners) {
    try { cb(cmd); } catch (e) { console.log('[smartMotionRecordBus] listener error:', e); }
  }
}

/** The Smart Motion screen calls this on mount/unmount so voice handlers know
 *  whether a capture surface is live. */
export function setSmartMotionActive(v: boolean): void { active = v; }

/** True when the Smart Motion screen is mounted and can take a voice command. */
export function isSmartMotionActive(): boolean { return active; }

/** The Smart Motion screen calls this on record start/stop so voice handlers know
 *  the mic is reserved by the camera (block listening; a tap means STOP). */
export function setSmartMotionRecording(v: boolean): void { recording = v; }

/** True while a swing is actively recording (camera owns the mic). */
export function isSmartMotionRecording(): boolean { return recording; }

// ── Drill config: Kevin → SmartMotion ────────────────────────────────────────

export interface DrillConfig {
  /** Club ID (e.g. '7I', 'DR'). Undefined = keep current. */
  club?: string;
  /** Number of swings in the session (1, 3, or 5). Undefined = keep current. */
  shotCount?: number;
}

const drillConfigListeners: Set<(cfg: DrillConfig) => void> = new Set();

/** Kevin fires this after processing the user's drill setup voice turn. */
export function emitDrillConfig(cfg: DrillConfig): void {
  for (const cb of drillConfigListeners) {
    try { cb(cfg); } catch (e) { console.log('[smartMotionRecordBus] drillConfig error:', e); }
  }
}

/** SmartMotion subscribes to receive Kevin's drill configuration. */
export function subscribeDrillConfig(cb: (cfg: DrillConfig) => void): () => void {
  drillConfigListeners.add(cb);
  return () => { drillConfigListeners.delete(cb); };
}

// ── Voice events: SmartMotion → Kevin ────────────────────────────────────────

export type SmartMotionVoiceEvent =
  // 2026-06-26 — `entered` carries the drill (when opened in drill mode) so the
  // greeting is drill-AWARE instead of the redundant/laggy "what are we working
  // on?" — opening the Tempo drill already answers that question.
  | { type: 'entered'; drillName?: string; drillFocus?: string }
  | { type: 'session_complete'; swingCount: number; summary: string };

const voiceEventListeners: Set<(e: SmartMotionVoiceEvent) => void> = new Set();

/** SmartMotion emits this when Kevin should react (on open, on session done). */
export function emitSmartMotionVoiceEvent(e: SmartMotionVoiceEvent): void {
  for (const cb of voiceEventListeners) {
    try { cb(e); } catch (e2) { console.log('[smartMotionRecordBus] voiceEvent error:', e2); }
  }
}

/** caddie.tsx subscribes to drive Kevin's voice responses. */
export function subscribeSmartMotionVoiceEvent(
  cb: (e: SmartMotionVoiceEvent) => void,
): () => void {
  voiceEventListeners.add(cb);
  return () => { voiceEventListeners.delete(cb); };
}
