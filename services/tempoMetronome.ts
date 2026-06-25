/**
 * 2026-06-24 — Tempo metronome (actual vs ideal).
 *
 * The audible half of Smart Tempo: a tiny scheduler that plays the tempo
 * trainer's two tones (tick = takeaway/top, tock = strike) at a swing's
 * THREE beats — backswing-start, top, impact — so the player HEARS their
 * rhythm and can A/B it against the tour-standard 3:1.
 *
 *   • IDEAL  — beats spaced on a 3:1 backswing:downswing ratio. The total
 *     cycle is anchored to the SAME duration as the user's measured swing
 *     (when a TempoResult is supplied) so "ideal" and "your tempo" are the
 *     same length on the clock and the only thing that differs is WHERE the
 *     middle "top" beat falls — exactly the offset the TempoPatch shows.
 *   • ACTUAL — beats spaced on the user's REAL measured backswingMs /
 *     downswingMs (from computeTempo). Honest: every interval comes from the
 *     marks the player placed; nothing is fabricated.
 *
 * Reuses the expo-av Audio pattern proven in app/swinglab/tempo-trainer.tsx:
 * load tick.mp3 + tock.mp3 once, replayAsync() on each beat, recursive
 * setTimeout cycle with a rest so reps are distinct. The trainer is a fixed
 * 3:1 drill with no measurement; THIS plays a real read back.
 *
 * NOTE (same caveat as the trainer): it plays through the speaker, so it is
 * a REVIEW-time control, never meant to run during live cage acoustic
 * capture (the strike mic would hear the tones).
 */

import { Audio } from 'expo-av';
import type { TempoResult } from './smartTempo';

export type MetronomeMode = 'actual' | 'ideal' | 'both';

/** One scheduled tone within a cycle. */
interface Beat {
  /** ms from the start of this cycle. */
  atMs: number;
  /** 'tick' = takeaway / top, 'tock' = strike. */
  tone: 'tick' | 'tock';
  /** Which lane this beat belongs to (for the onBeat highlight). */
  lane: 'actual' | 'ideal';
  /** Beat name for the UI highlight. */
  name: 'takeaway' | 'top' | 'strike';
}

const REST_MS = 1400;       // pause between reps so each swing's rhythm is distinct
const COMPARE_GAP_MS = 700; // gap between the two lanes in 'both' mode (ideal then actual)
// When we can't anchor to a measured total (no result), use the tempo
// trainer's "Standard" preset: 800ms back + ~267ms down = a clean 3:1.
const DEFAULT_BACKSWING_MS = 800;

export interface TempoMetronomeCallbacks {
  /** Fired on every tone with the active beat (for a visual pulse / label). */
  onBeat?: (b: { lane: 'actual' | 'ideal'; name: Beat['name']; tone: Beat['tone'] }) => void;
  /** Fired when the loop stops (manual stop, error, or never-started). */
  onStop?: () => void;
}

/**
 * An imperative, self-contained metronome handle. Create once (loads the
 * tones), call play(result, mode) to start a looping comparison, stop() to
 * halt, and dispose() to free the audio when the screen unmounts.
 *
 * Honesty: the ACTUAL lane is built ONLY from result.backswingMs /
 * result.downswingMs — the player's real measured marks. The IDEAL lane is a
 * pure 3:1 derivation. No interval is invented.
 */
export class TempoMetronome {
  private tick: Audio.Sound | null = null;
  private tock: Audio.Sound | null = null;
  private ready = false;
  private running = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private cb: TempoMetronomeCallbacks;

  constructor(cb: TempoMetronomeCallbacks = {}) {
    this.cb = cb;
  }

  /** Load both tones. Safe to await multiple times; loads once. */
  async load(): Promise<void> {
    if (this.ready) return;
    try {
      const tick = new Audio.Sound();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await tick.loadAsync(require('../assets/audio/tempo/tick.mp3'));
      const tock = new Audio.Sound();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await tock.loadAsync(require('../assets/audio/tempo/tock.mp3'));
      this.tick = tick;
      this.tock = tock;
      this.ready = true;
    } catch {
      /* tones just won't play; callers degrade to the silent visual patch */
    }
  }

  get isReady(): boolean { return this.ready; }
  get isRunning(): boolean { return this.running; }

  /**
   * Build the beats for ONE cycle in the given mode from a measured result.
   * Exposed (static) for tests + the visual layer's timing.
   *
   *   ACTUAL: takeaway @0 · top @backswingMs · strike @(back+down)
   *   IDEAL : the same TOTAL duration, re-split 3:1 — so top lands at
   *           total * 3/4. Anchoring to the measured total makes the two
   *           lanes directly comparable (same length, top beat shifts).
   */
  static buildBeats(result: TempoResult | null, mode: MetronomeMode): { beats: Beat[]; cycleMs: number } {
    const backMs = result && result.backswingMs > 0 ? result.backswingMs : DEFAULT_BACKSWING_MS;
    const downMs = result && result.downswingMs > 0 ? result.downswingMs : DEFAULT_BACKSWING_MS / 3;
    const totalMs = backMs + downMs;

    // IDEAL re-splits the SAME total on a 3:1 ratio (back = 3/4, down = 1/4).
    const idealBackMs = totalMs * 0.75;

    const actualBeats: Beat[] = [
      { atMs: 0, tone: 'tick', lane: 'actual', name: 'takeaway' },
      { atMs: backMs, tone: 'tick', lane: 'actual', name: 'top' },
      { atMs: totalMs, tone: 'tock', lane: 'actual', name: 'strike' },
    ];
    const idealBeats: Beat[] = [
      { atMs: 0, tone: 'tick', lane: 'ideal', name: 'takeaway' },
      { atMs: idealBackMs, tone: 'tick', lane: 'ideal', name: 'top' },
      { atMs: totalMs, tone: 'tock', lane: 'ideal', name: 'strike' },
    ];

    if (mode === 'actual') return { beats: actualBeats, cycleMs: totalMs };
    if (mode === 'ideal') return { beats: idealBeats, cycleMs: totalMs };

    // BOTH — play ideal first, then the player's actual after a short gap, so
    // the difference is heard back-to-back within one looped cycle.
    const offset = totalMs + COMPARE_GAP_MS;
    const both = [
      ...idealBeats,
      ...actualBeats.map(b => ({ ...b, atMs: b.atMs + offset })),
    ];
    return { beats: both, cycleMs: offset + totalMs };
  }

  /**
   * Start looping the comparison. Returns immediately. Re-calling play()
   * restarts cleanly on the new mode/result. No-op (and onStop) if the tones
   * never loaded.
   */
  async play(result: TempoResult | null, mode: MetronomeMode): Promise<void> {
    await this.load();
    this.stop(); // clear any prior loop
    if (!this.ready) { this.cb.onStop?.(); return; }
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false, shouldDuckAndroid: true });
    } catch { /* may be muted on silent */ }
    this.running = true;
    this.scheduleCycle(result, mode);
  }

  private scheduleCycle(result: TempoResult | null, mode: MetronomeMode): void {
    if (!this.running) return;
    const { beats, cycleMs } = TempoMetronome.buildBeats(result, mode);
    for (const b of beats) {
      const fire = () => {
        if (!this.running) return;
        const snd = b.tone === 'tick' ? this.tick : this.tock;
        void snd?.replayAsync().catch(() => undefined);
        this.cb.onBeat?.({ lane: b.lane, name: b.name, tone: b.tone });
      };
      if (b.atMs <= 0) fire();
      else this.timers.push(setTimeout(fire, b.atMs));
    }
    // Loop after the cycle + a rest so reps are distinct.
    this.timers.push(setTimeout(() => this.scheduleCycle(result, mode), cycleMs + REST_MS));
  }

  /** Halt the loop and clear timers (does NOT unload the tones). */
  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (wasRunning) this.cb.onStop?.();
  }

  /** Stop + unload the tones. Call on screen unmount. */
  async dispose(): Promise<void> {
    this.stop();
    try { await this.tick?.unloadAsync(); } catch { /* */ }
    try { await this.tock?.unloadAsync(); } catch { /* */ }
    this.tick = null;
    this.tock = null;
    this.ready = false;
  }
}
