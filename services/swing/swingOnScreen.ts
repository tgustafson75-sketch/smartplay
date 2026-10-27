/**
 * 2026-10-27 (audit R1, the conversation half) — THE NUMBERS ON THE SCREEN ARE ASKABLE.
 *
 * SmartMotion's review and the library's swing page both show a swing's tempo (backswing : downswing),
 * where the ball started against the aim line, and the club + effort carry estimate. None of it reached
 * services/caddieRequestBody, so "how was my tempo on that one?" was answered from the library's latest
 * marked tempo — possibly another swing — or not at all. A capability on a screen is half-wired until the
 * caddie can be asked about it (CLAUDE.md, the second half of the lens).
 *
 * This is the per-turn line: it changes swing to swing, so it rides the MESSAGE (api/kevin's live facts
 * block), never the cached system prompt.
 *
 * Honesty rules, in code so the model never has to infer them:
 *  - the carry is the club + effort ESTIMATE and is always called one (audit R3);
 *  - a library swing other than swing 1 has no saved tempo or start line (the session's shot map is swing
 *    1's), and the line says so instead of letting swing 1's numbers stand for it;
 *  - an older build's map on a multi-swing set names no swing (it may be swing 3's): nobody's measured numbers.
 */
import type { SmartMotionShotMap } from '../../store/swingSessionStore';
import { SHOT_MAP_SWING_INDEX, isUnknownSwingMap } from './smartMotionShotMap';

export interface SwingOnScreen {
  /** 1-based swing number on screen, and how many swings the set has. */
  swing: number;
  of: number;
  tempo: { ratio: number; backswingMs: number | null; downswingMs: number | null } | null;
  /** Where the ball started against the aim line (down-the-line only). */
  launch: { side: string; deg: number } | null;
  /** The club + effort carry estimate (yards). Never a measurement. */
  estCarryYds: number | null;
  /** True for a library swing whose tempo / start line were never saved (only swing 1's are). */
  notSavedForThisSwing?: boolean;
  /** True when the saved numbers are an older build's, with no record of which swing they came from. */
  savedSwingUnknown?: boolean;
}

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function swingOnScreenForCaddie(s: SwingOnScreen | null | undefined): string | null {
  if (!s || !fin(s.swing) || !fin(s.of) || s.swing < 1) return null;
  const which = s.of > 1 ? `Swing ${s.swing} of ${s.of}` : 'The swing';
  if (s.savedSwingUnknown) {
    return `${which} is on their screen. Its tempo and start line are from an older version's save that did not record which swing they came from, so they are not this swing's measured numbers — say so if asked, and never give them as this swing's.`;
  }
  if (s.notSavedForThisSwing) {
    return `${which} is on their screen. Its tempo and start line were not saved (the library keeps them for swing 1 only) — say so if asked, and never give swing 1's numbers as this swing's.`;
  }
  const parts: string[] = [];
  if (s.tempo && fin(s.tempo.ratio) && s.tempo.ratio > 0) {
    const split = fin(s.tempo.backswingMs) && fin(s.tempo.downswingMs)
      ? ` (${(s.tempo.backswingMs / 1000).toFixed(2)} s back, ${(s.tempo.downswingMs / 1000).toFixed(2)} s down)`
      : '';
    parts.push(`measured tempo ${s.tempo.ratio.toFixed(1)}:1 backswing to downswing${split}`);
  }
  if (s.launch && fin(s.launch.deg)) {
    const side = s.launch.side === 'left' || s.launch.side === 'right' ? s.launch.side : 'straight';
    parts.push(side === 'straight'
      ? 'the ball started on the aim line'
      : `the ball started ${Math.round(s.launch.deg)}° ${side} of the aim line`);
  }
  const measured = parts.length > 0 ? parts.join('; ') : 'no tempo or start line was read on this swing';
  const carry = fin(s.estCarryYds) && s.estCarryYds > 0
    ? ` Carry about ${Math.round(s.estCarryYds)} yards is an ESTIMATE from the club and the effort he set, not measured from the swing.`
    : '';
  return `${which} is on their screen: ${measured}.${carry}`;
}

/** The library swing page: the session's shot map is swing 1's, so only swing 1 carries its numbers. */
export function swingOnScreenFromShotMap(
  map: SmartMotionShotMap | null | undefined,
  shotIdx: number,
  shotCount: number,
): SwingOnScreen | null {
  if (!map) return null;
  const swing = shotIdx + 1;
  const of = Math.max(1, shotCount);
  if (isUnknownSwingMap(map, shotCount)) {
    return { swing, of, tempo: null, launch: null, estCarryYds: null, savedSwingUnknown: true };
  }
  if (shotIdx !== SHOT_MAP_SWING_INDEX) {
    return { swing, of, tempo: null, launch: null, estCarryYds: null, notSavedForThisSwing: true };
  }
  const t = map.tempo;
  return {
    swing, of,
    tempo: t && fin(t.ratio) ? { ratio: t.ratio, backswingMs: t.backswingMs ?? null, downswingMs: t.downswingMs ?? null } : null,
    launch: map.trace ? { side: map.trace.side, deg: map.trace.divergenceDeg } : null,
    estCarryYds: map.estCarry ?? null,
  };
}
