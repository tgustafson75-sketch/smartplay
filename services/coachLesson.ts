/**
 * 2026-07-23 (Tim — Coach Caddie Card, Phase 1).
 *
 * A COMPARTMENTALIZED guided-lesson engine. The Caddie names ONE focus, the golfer makes a swing,
 * we analyze it, and the Caddie gives feedback scoped to THAT focus — then the next rep. This
 * module is pure content + verdict logic: no camera, no TTS, and CRITICALLY no imports of the
 * frozen live-voice loop (useVoiceCaddie / usePipecatVoice / VAD). The screen composes it with the
 * existing standalone primitives (SmartMotion analysis + voiceService.speak), exactly like
 * juniorSwingAnalyzer / puttingAnalysisService already do.
 *
 * HONESTY: when the metric for the focus isn't readable, the verdict is 'unclear' and we ask for
 * another rep — we never invent a grade (smartmotion-contact-honesty).
 */
import type { SwingBiomechanics } from './poseAnalysisApi';

export interface LessonFocus {
  id: string;
  label: string;
  /** What the Caddie says to set up the rep. */
  instruction: string;
  /** A short swing cue the Caddie can repeat while the golfer sets up. */
  cue: string;
}

// Each focus maps to a metric analyzeSwingFromVideo already returns, so feedback is grounded in
// real measurement — never a generic platitude.
export const LESSON_FOCUSES: LessonFocus[] = [
  { id: 'weight_shift', label: 'Weight shift', instruction: "Let's work on shifting into your lead side. Make a swing and feel your weight move onto your front foot through impact.", cue: 'Press into your lead foot through the ball.' },
  { id: 'shoulder_turn', label: 'Full shoulder turn', instruction: "This one's about a fuller backswing turn. Turn your lead shoulder behind the ball, then swing.", cue: 'Lead shoulder under your chin at the top.' },
  { id: 'hip_turn', label: 'Hip turn', instruction: "Let's free up your hips. Feel them turn back and then clear through. Go ahead and swing.", cue: 'Let the hips lead the downswing.' },
  { id: 'posture', label: 'Keep your spine angle', instruction: "We'll hold your posture through the swing — no standing up early. Set up and swing.", cue: 'Stay in your posture to the finish.' },
  { id: 'sequencing', label: 'Transition & sequence', instruction: "This is about a smooth transition — let the lower body start down first. When you're ready, swing.", cue: 'Smooth from the top, ground up.' },
  { id: 'steady_head', label: 'Steady head', instruction: "Let's keep your head steady through the strike. Pick a spot and swing.", cue: 'Quiet head, let the club release.' },
];

export function focusById(id: string): LessonFocus | null {
  return LESSON_FOCUSES.find((f) => f.id === id) ?? null;
}

/**
 * A guided lesson — an ordered sequence of focuses the caddie works through, a few reps each,
 * auto-advancing so it plays like a coached session instead of one-off swings. The capture per
 * rep is unchanged (still turn-based); the PLAN adds the session structure + spoken transitions.
 */
export interface LessonPlan {
  id: string;
  label: string;
  /** One-line description shown on the card. */
  blurb: string;
  /** Focus ids, in teaching order. */
  focusIds: string[];
  /** What the caddie says to open the session. */
  intro: string;
}

export const LESSON_PLANS: LessonPlan[] = [
  { id: 'full-tuneup', label: 'Full swing tune-up', blurb: 'Weight shift → transition → posture', focusIds: ['weight_shift', 'sequencing', 'posture'],
    intro: "Let's run a full tune-up. We'll work through your weight shift, then your transition, then your posture — a few swings on each. Ready when you are." },
  { id: 'more-power', label: 'More power', blurb: 'Fuller turn → free hips → shift', focusIds: ['shoulder_turn', 'hip_turn', 'weight_shift'],
    intro: "This session's about power — a fuller shoulder turn, freer hips, and shifting hard into the ball. Let's build it in that order." },
  { id: 'better-contact', label: 'Better contact', blurb: 'Posture → steady head → sequence', focusIds: ['posture', 'steady_head', 'sequencing'],
    intro: "We'll clean up your strike — hold your posture, keep your head quiet, and smooth out the sequence. First up, posture." },
];

export function planById(id: string): LessonPlan | null {
  return LESSON_PLANS.find((p) => p.id === id) ?? null;
}

/** Spoken transition when the session moves to the next focus. */
export function transitionLine(nextFocus: LessonFocus): string {
  return `Good work. Now let's shift to ${nextFocus.label.toLowerCase()}. ${nextFocus.instruction}`;
}

/** Spoken wrap-up when the session's focuses are done. */
export function sessionSummaryLine(planLabel: string): string {
  return `That's the ${planLabel.toLowerCase()} done. Nice session — take those feels to the course. Tap to run it again or pick something new.`;
}

export type FocusVerdict = 'good' | 'refine' | 'unclear';
export interface FocusFeedback {
  verdict: FocusVerdict;
  /** The line the Caddie speaks. */
  line: string;
  /** The measured value backing the verdict, for the on-screen chip (null when unclear). */
  metricLabel: string | null;
}

const round = (n: number) => Math.round(n);

/**
 * Turn a swing analysis into feedback scoped to ONE focus. Only reads the metric that focus is
 * about; everything else in the analysis is ignored (that's the point — coach the one thing).
 */
export function composeFocusFeedback(focusId: string, a: SwingBiomechanics): FocusFeedback {
  const unclear = (what: string): FocusFeedback => ({
    verdict: 'unclear',
    line: `I couldn't read your ${what} clearly on that one — keep your whole swing in frame and let's go again.`,
    metricLabel: null,
  });

  switch (focusId) {
    case 'weight_shift': {
      const v = a.weightShiftPct;
      if (v == null) return unclear('weight shift');
      const label = `${round(v)}% lead at impact`;
      if (v >= 55) return { verdict: 'good', line: `Nice — ${round(v)}% of your weight was on your lead side at impact. That's a solid shift. Same feel again.`, metricLabel: label };
      if (v < 45) return { verdict: 'refine', line: `You stayed back a touch — ${round(v)}% on your lead side. Feel like you finish with your belt buckle over your front foot. Let's run it back.`, metricLabel: label };
      return { verdict: 'refine', line: `Getting there — ${round(v)}% forward. Push a little more into that lead foot through the ball. Again.`, metricLabel: label };
    }
    case 'shoulder_turn': {
      const v = a.shoulderTurnDeg;
      if (v == null) return unclear('shoulder turn');
      const label = `${round(v)}° shoulder turn`;
      if (v >= 85) return { verdict: 'good', line: `Great turn — ${round(v)}° of shoulder rotation. You're loaded behind it. Keep that.`, metricLabel: label };
      if (v < 75) return { verdict: 'refine', line: `A bit short — ${round(v)}° of turn. Get that lead shoulder all the way under your chin. Let's go again.`, metricLabel: label };
      return { verdict: 'refine', line: `Close — ${round(v)}°. A touch more turn and you're there. Again.`, metricLabel: label };
    }
    case 'hip_turn': {
      const v = a.hipTurnDeg;
      if (v == null) return unclear('hip turn');
      const label = `${round(v)}° hip turn`;
      if (v >= 40 && v <= 58) return { verdict: 'good', line: `That's the window — ${round(v)}° of hip turn. Good separation. Same again.`, metricLabel: label };
      if (v < 40) return { verdict: 'refine', line: `Hips were quiet — ${round(v)}°. Let them turn back more so you can clear through. Run it back.`, metricLabel: label };
      return { verdict: 'refine', line: `A lot of hip turn there — ${round(v)}°. Feel a touch more coil in the shoulders against steadier hips. Again.`, metricLabel: label };
    }
    case 'posture': {
      const v = a.spineAngleDeltaDeg;
      if (v == null) return unclear('spine angle');
      const label = `${round(v)}° spine change`;
      if (v <= 8) return { verdict: 'good', line: `Held it well — only ${round(v)}° of spine-angle change. No early extension. Keep it.`, metricLabel: label };
      if (v > 15) return { verdict: 'refine', line: `You stood up a bit — ${round(v)}° of spine change. Stay in your posture all the way to the finish. Let's go again.`, metricLabel: label };
      return { verdict: 'refine', line: `Mostly steady — ${round(v)}°. Hold that tilt just a hair longer through the ball. Again.`, metricLabel: label };
    }
    case 'sequencing': {
      const v = a.sequencingScore;
      if (v == null) return unclear('transition');
      const label = `sequence ${round(v)}/100`;
      if (v >= 70) return { verdict: 'good', line: `Smooth — a ${round(v)} on sequencing. Lower body led that nicely. Same tempo again.`, metricLabel: label };
      if (v < 55) return { verdict: 'refine', line: `The transition rushed a little — ${round(v)} on sequence. Let the hips start down before the arms. Run it back.`, metricLabel: label };
      return { verdict: 'refine', line: `Decent sequence — ${round(v)}. A smoother change of direction and it'll climb. Again.`, metricLabel: label };
    }
    case 'steady_head': {
      const v = a.headDriftPxNorm;
      if (v == null) return unclear('head movement');
      const pct = round(v * 100);
      const label = `${pct}% head drift`;
      if (v <= 0.05) return { verdict: 'good', line: `Rock steady — barely any head movement. That's a great base. Keep it.`, metricLabel: label };
      if (v > 0.1) return { verdict: 'refine', line: `Your head moved a fair bit through the swing. Pick a spot behind the ball and keep it quiet. Let's go again.`, metricLabel: label };
      return { verdict: 'refine', line: `A little head drift — nearly there. Keep it quiet through the strike. Again.`, metricLabel: label };
    }
    default:
      return unclear('swing');
  }
}
