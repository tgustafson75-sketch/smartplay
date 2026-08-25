/**
 * THE DRILL SAID WHAT SMART MOTION WOULD LOOK AT. THIS MAKES IT LOOK.
 *
 * 2026-08-24 (Tim: "check all swing lab cards… drills that engage smartmotion and supposed to be
 * focused on specific things. I see now it's probably made up or at best half built").
 *
 * He was right, and the code says so out loud. app/drills/[issue].tsx renders the practice CTA under
 * a comment reading "sub-text names what Smart Motion will look at", and passes `drillFocus` on the
 * route. SmartMotion receives it — and routes it ONLY to setScreenContext, which makes the CADDIE
 * drill-aware if you happen to ask it a question. The ANALYSIS never saw it. Every drill produced
 * the same generic biomech read, so "Smart Motion will look at your posture" and "…at your path"
 * returned identical work.
 *
 * Nothing here is new measurement. Posture, path, tempo and contact are ALREADY computed on every
 * swing; they were simply never singled out as the drill's answer. That is the shape of almost
 * everything found this week: the app knew, and never said. [[the-app-usually-already-knows]]
 *
 * HONESTY IS THE HARD PART, not the mapping. Two of the seven focuses in data/drillCatalog — grip
 * and connection — are NOT reliably pose-derivable from a phone at swing speed: hands are small,
 * occluded by the club, and the 2D projection cannot resolve grip. Those must say so plainly and
 * point at what CAN see them (Setup Check reads grip from a still address photo), rather than
 * inventing a number to fill the slot. [[smartmotion-metrics-honesty]]
 */
import type { SwingBiomechanics } from '../poseAnalysisApi';

/** What a drill declares in data/drillCatalog `practice.focus`. */
export type DrillFocus = 'posture' | 'path' | 'grip' | 'connection' | 'tempo' | 'speed' | 'contact' | string;

export type DrillFocusRead = {
  /** The focus, in the player's words. */
  label: string;
  /** The one line that answers "did I do the thing this drill is about". */
  line: string;
  /** True when a real measurement backs the line; false when we are being honest about not seeing it. */
  measured: boolean;
};

export type FocusInputs = {
  biomech?: SwingBiomechanics | null;
  /** From services/acousticsAnalyzer — 'pure' | 'good' | 'okay' | 'bad'. */
  contactGrade?: string | null;
  /** Backswing:downswing ratio from the tempo read. */
  tempoRatio?: number | null;
  /** From the club-path read; DTL only, null elsewhere. */
  pathVerdict?: string | null;
};

const LABEL: Record<string, string> = {
  posture: 'Posture', path: 'Club path', grip: 'Grip', connection: 'Connection',
  tempo: 'Tempo', speed: 'Speed', contact: 'Contact',
};

/**
 * The drill's focus, answered from what this swing actually measured — or an honest statement that
 * this focus is not something the camera can read, and where it CAN be read instead.
 *
 * Returns null only for a focus we have never heard of, so a caller can fall back to the generic
 * read rather than printing an empty card.
 */
export function drillFocusRead(focus: DrillFocus | null | undefined, input: FocusInputs): DrillFocusRead | null {
  const f = (focus ?? '').trim().toLowerCase();
  if (!f) return null;
  const label = LABEL[f] ?? null;
  if (!label) return null;
  const b = input.biomech ?? null;

  switch (f) {
    case 'posture': {
      // Spine-angle change address→impact is the posture measurement, and it reads at every angle.
      const d = b?.spineAngleDeltaDeg;
      if (d == null) return { label, line: 'Could not read your spine angle on this one — get your whole body in frame and try again.', measured: false };
      const mag = Math.abs(Math.round(d));
      return {
        label,
        line: mag <= 5
          ? `Held your posture — spine angle moved ${mag}°. That is the drill working.`
          : `Spine angle moved ${mag}° from address to impact. Under 5° is holding it; this is the thing to feel.`,
        measured: true,
      };
    }
    case 'path': {
      if (input.pathVerdict) return { label, line: input.pathVerdict, measured: true };
      return { label, line: 'Path needs a down-the-line camera — film from behind the ball and I can read it.', measured: false };
    }
    case 'tempo': {
      const r = input.tempoRatio;
      if (r == null || !Number.isFinite(r)) return { label, line: 'No clean tempo read on this one — I need to hear or see the strike.', measured: false };
      const shown = Math.round(r * 10) / 10;
      return {
        label,
        line: shown >= 2.6 && shown <= 3.4
          ? `${shown}:1 — right in the tour window. That is the rhythm to keep.`
          : `${shown}:1 backswing to downswing. Tour sits around 3:1 — ${shown < 2.6 ? 'yours is quick from the top' : 'yours is slow coming down'}.`,
        measured: true,
      };
    }
    case 'contact': {
      const g = (input.contactGrade ?? '').toLowerCase();
      if (!g) return { label, line: 'No strike read on this one — the microphone needs to hear the ball.', measured: false };
      return {
        label,
        line: g === 'pure' || g === 'good'
          ? `Struck it ${g}. That is what the drill is for.`
          : `Strike read ${g} — that is the one to chase on the next rep.`,
        measured: true,
      };
    }
    case 'speed': {
      // Speed is measured elsewhere (watch IMU / ball speed), not from pose. Say so rather than
      // dressing a turn metric up as clubhead speed.
      return { label, line: 'Speed is measured from the strike and the watch, not the camera — this drill trains the feel, the numbers come from the swing data.', measured: false };
    }
    case 'grip':
    case 'connection': {
      /**
       * Deliberately NOT faked. At swing speed the hands are small, occluded by the club and
       * unresolvable in 2D — this is exactly the "only AI/pose-derivable metrics" line. Setup Check
       * reads grip properly from a still address photo, so point there instead of guessing.
       */
      return {
        label,
        line: f === 'grip'
          ? 'I cannot read your grip at swing speed — the hands are too small and the club covers them. Setup Check reads it properly from a still address photo.'
          : 'Connection is a feel this drill trains; the camera cannot measure arm-to-chest contact reliably at speed. What I can show you is whether the posture and sequence held.',
        measured: false,
      };
    }
    default:
      return null;
  }
}
