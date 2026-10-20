/**
 * THE LIVE STRIKE METER — what the HUD shows while SmartMotion records.
 *
 * 2026-10-20 (Tim, practice bay: "the sound is too sensitive"). The card lit "Ball Smash Detected"
 * whenever the raw level was over -30 dBFS, and drew the meter on an absolute -60..0 scale. A bay
 * with neighbours hitting, a fan and talking sits near -30 on its own, so the badge stayed lit and
 * the bar stayed full with nobody swinging.
 *
 * The detector that actually segments swings (strikeDetector) never used an absolute bar: a strike
 * must clear its LOCAL floor by thresholdDb. This meter uses the same rule live, so the card shows
 * what the detector will count. The background is levelled out: the bar shows height above the
 * room, not loudness.
 *
 * Pure: samples in, a reading out. The floor is a trailing median, so one sharp strike barely moves it.
 */

const FLOOR_WINDOW_MS = 1500;

export type LiveStrikeReading = {
  /** Trailing-median ambient level, dBFS. */
  floorDb: number;
  /** 0..1 — height of this sample above the floor, as a fraction of the strike threshold. */
  level: number;
  /** True when this sample clears floor + thresholdDb (what strikeDetector would admit). */
  hit: boolean;
};

export function createLiveStrikeMeter(thresholdDb: number) {
  const win: { t: number; dB: number }[] = [];
  return {
    push(timeMs: number, dB: number): LiveStrikeReading {
      // The floor is measured BEFORE this sample joins, so a strike never raises its own bar.
      while (win.length && timeMs - win[0]!.t > FLOOR_WINDOW_MS) win.shift();
      const floorDb = win.length ? median(win.map((s) => s.dB)) : dB;
      win.push({ t: timeMs, dB });
      const above = dB - floorDb;
      return {
        floorDb,
        level: Math.max(0, Math.min(1, above / thresholdDb)),
        hit: win.length > 1 && above >= thresholdDb,
      };
    },
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
