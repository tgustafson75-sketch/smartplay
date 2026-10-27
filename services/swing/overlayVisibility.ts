/**
 * 2026-10-26 (Tim: "Tracing is still on by default, and off doesn't work") — WHAT THE SWING OVERLAY DRAWS,
 * one owner for both review screens.
 *
 * The library swing ([swing_id].tsx) turned the Swing Trace on by itself whenever a stored arc existed and
 * turned it back on for every swing opened; SmartMotion's review drew the arc and the blue club whenever a
 * strike was confirmed, with no toggle at all (its Motion chip only ever flipped the skeleton). Two screens,
 * two rules, neither of them the player's. Here the overlay is OPT-IN, layer by layer:
 *   - the skeleton only when the player turned on Motion (or the Motion-only view);
 *   - the clubhead arc, its dots and the blue club only when the player turned on Swing Trace, and only on a
 *     swing whose arc today's tracker stored. Off is off: no arc, no club, no head dot.
 * The ball-flight trace (shot tracer) is a different thing and is not decided here.
 */
import { arcIsCurrent } from './analysisVersion';

/** A stored clubhead point as the screens hand it to the overlay: full-frame normalized, tMs in the clip,
 *  and the MEASURED grip (the inner end of the moving shaft) when the tracker saw one. */
export type OverlayArcPoint = { x: number; y: number; tMs: number; gx?: number; gy?: number };

type ArcHolder = {
  club_arc?: { x: number; y: number; tMs: number; gx?: number; gy?: number }[] | null;
  club_arc_version?: number;
  club_arc_source?: unknown;
};

/**
 * The arc a screen may draw for one shot: the shot's own, or the session's for the first swing — and only
 * one TODAY's tracker stored (club_arc_version). An older build's arc (no grip, an older window, maybe the
 * pre-10-05 finder) is not drawn: turning the trace on asks the run for a fresh one and nothing shows until
 * it lands. Grip fields are kept, never stripped.
 */
export function drawableClubArc(
  session: ArcHolder & { shots: (ArcHolder & { id: string; clipUri?: string | null })[] },
  shot: ArcHolder & { id: string },
): OverlayArcPoint[] | null {
  const first = session.shots.find((x) => x.clipUri)?.id === shot.id;
  const own = shot.club_arc_source !== undefined || shot.club_arc !== undefined;
  const holder: ArcHolder | null = own ? shot : (first ? session : null);
  // Current by its source (analysisVersion.arcIsCurrent), read the way the shot run reads it (hasFinalArc).
  const source = shot.club_arc_source ?? (first ? session.club_arc_source : undefined);
  if (!holder || !arcIsCurrent(holder.club_arc_version, source)) return null;
  const arc = holder.club_arc;
  if (!arc || arc.length < 3) return null;
  return arc.map((p) => {
    const o: OverlayArcPoint = { x: p.x, y: p.y, tMs: p.tMs };
    if (typeof p.gx === 'number' && typeof p.gy === 'number' && Number.isFinite(p.gx) && Number.isFinite(p.gy)) {
      o.gx = p.gx; o.gy = p.gy;
    }
    return o;
  });
}

export type OverlayLayersIn<A> = {
  /** The player's Motion toggle. */
  userSkeleton: boolean;
  /** The player's Swing Trace toggle. */
  userTrace: boolean;
  /** The Motion-only view (video hidden): it shows the skeleton. */
  motionOnly?: boolean;
  /** The fault spotlight ring (the default review's way of pointing at the fault; not the skeleton). */
  spotlight?: boolean;
  hasPose: boolean;
  arc: A[] | null | undefined;
  /** SmartMotion: the arc is only drawn for a confirmed strike, never a practice swing. */
  shotConfirmed?: boolean;
};

export type OverlayLayers<A> = {
  mount: boolean;
  skeleton: boolean;
  trace: boolean;
  /** What the overlay's clubArc prop gets: null unless the trace is on — so the blue club goes with it. */
  clubArc: A[] | null;
};

/**
 * 2026-10-27 (SB4x) — the line under a lit Swing Trace chip that draws nothing, on both review screens.
 * Never a silent chip: the run is out ("Tracing the clubhead…"), or it settled with no clubhead to draw
 * (with Re-analyze), or there is an arc but no body read to draw it against.
 *   drawn:   the arc is on screen (the screen's own mount rule);
 *   hasArc:  a drawable arc exists (drawableClubArc);
 *   hasBody: the swing has a body read (the arc is found FROM it, and the library draws over it);
 *   pending: the screen's ask for this swing is out (useShotDetailRequest).
 * With no body read the honest reason is the body, not the clubhead.
 */
export type SwingTraceNote = 'tracing' | 'no_clubhead' | 'no_body' | null;
export function swingTraceNote(n: { wanted: boolean; drawn: boolean; hasArc: boolean; hasBody: boolean; pending: boolean }): SwingTraceNote {
  if (!n.wanted || n.drawn) return null;
  if (n.pending) return 'tracing';
  return n.hasArc || !n.hasBody ? 'no_body' : 'no_clubhead';
}

export function overlayLayers<A>(i: OverlayLayersIn<A>): OverlayLayers<A> {
  const skeleton = i.hasPose && (i.userSkeleton || !!i.motionOnly);
  const trace = i.userTrace && i.shotConfirmed !== false && !!i.arc && i.arc.length >= 3;
  const clubArc = trace ? (i.arc as A[]) : null;
  return { mount: skeleton || trace || !!i.spotlight, skeleton, trace, clubArc };
}
