/**
 * 2026-10-27 (audit R1) — THE SMARTMOTION SHOT MAP BELONGS TO SWING 1. One owner for who may write it and
 * which saved swing may show it.
 *
 * `session.smart_motion_shot_map` is ONE snapshot per session (tempo, launch, effort, the club + effort carry
 * estimate, the BODY icon tiles). SmartMotion wrote it from two places: the live commit (guarded to swing 1)
 * and Save / New Set (NOT guarded), so saving while swing 3 was on screen stamped swing 3's tempo and launch
 * over the session. The library then drew that one snapshot on EVERY swing of the set, so swings 1 and 2
 * showed swing 3's numbers.
 *
 * Both rules live here so the two screens cannot drift:
 *  - shotMapToPersist: a snapshot is written only from swing 1 (index 0), and only when something real
 *    was read; otherwise null (write nothing).
 *  - shotMapForShot: the saved snapshot is shown only on swing 1. Every other swing has no saved tempo or
 *    launch of its own, and showing swing 1's there is presenting another swing's numbers as this one's.
 *
 * 2026-10-27 (SB4x) — a snapshot records its swing (swingIndex). One saved before that, by a build whose Save
 * was not guarded, may be ANY swing's: on a set of more than one swing it is nobody's (isUnknownSwingMap).
 */
import type { SmartMotionShotMap } from '../../store/swingSessionStore';

/** The swing whose read the session's shot map holds. */
export const SHOT_MAP_SWING_INDEX = 0;

export interface ShotMapSource {
  estCarry: number | null | undefined;
  effortPct: number | null | undefined;
  ballTrace: { side: string; divergenceDeg: number } | null | undefined;
  /** Cage rig geometry; recorded only in practice mode (isPractice). */
  practiceCanvasFeet: number | null | undefined;
  cameraBehindFeet: number | null | undefined;
  isPractice: boolean;
  angle: SmartMotionShotMap['angle'];
  club: string | null | undefined;
  tempo: { ratio?: number | null; backswingMs?: number | null; downswingMs?: number | null; sequencingScore?: number | null } | null | undefined;
  /** A body read exists for the swing (it alone is reason enough to write the BODY tiles). */
  hasBiomech: boolean;
  bodyItems: { key: string; label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; icon?: unknown }[];
}

/** The snapshot to save for the swing on screen, or null when nothing may be written. */
export function shotMapToPersist(src: ShotMapSource, selectedSwing: number): SmartMotionShotMap | null {
  if (selectedSwing !== SHOT_MAP_SWING_INDEX) return null;
  const anything = src.estCarry != null || src.effortPct != null || !!src.ballTrace
    || (src.isPractice && src.practiceCanvasFeet != null) || !!src.tempo || src.hasBiomech;
  if (!anything) return null;
  return {
    swingIndex: SHOT_MAP_SWING_INDEX,
    estCarry: src.estCarry ?? null,
    effortPct: src.effortPct ?? null,
    trace: src.ballTrace ? { side: src.ballTrace.side, divergenceDeg: src.ballTrace.divergenceDeg } : null,
    canvasFeet: src.isPractice ? (src.practiceCanvasFeet ?? null) : null,
    cameraBehindFeet: src.isPractice ? (src.cameraBehindFeet ?? null) : null,
    angle: src.angle,
    club: src.club ?? null,
    tempo: src.tempo ? {
      ratio: src.tempo.ratio ?? null,
      backswingMs: src.tempo.backswingMs ?? null,
      downswingMs: src.tempo.downswingMs ?? null,
      sequencingScore: src.tempo.sequencingScore ?? null,
    } : null,
    bodyItems: src.bodyItems.map((b) => ({ key: b.key, label: b.label, tone: b.tone, icon: typeof b.icon === 'string' ? b.icon : undefined })),
  };
}

/** An older build's snapshot on a set of more than one swing: which swing it was read from is unknown. */
export function isUnknownSwingMap(map: SmartMotionShotMap | null | undefined, shotCount: number): boolean {
  return !!map && typeof map.swingIndex !== 'number' && shotCount > 1;
}

/** The saved snapshot as the swing at `shotIdx` may show it: swing 1's own, nobody else's — and never an
 *  unstamped one on a multi-swing set (it may be swing 3's). */
export function shotMapForShot(
  map: SmartMotionShotMap | null | undefined,
  shotIdx: number,
  shotCount: number,
): SmartMotionShotMap | null {
  if (shotIdx !== SHOT_MAP_SWING_INDEX || !map || isUnknownSwingMap(map, shotCount)) return null;
  if (typeof map.swingIndex === 'number' && map.swingIndex !== SHOT_MAP_SWING_INDEX) return null;
  return map;
}
