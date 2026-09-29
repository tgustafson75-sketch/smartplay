/**
 * 2026-09-29 — WHAT THE MODEL SAW, AND WHAT IT IS THEREFORE ALLOWED TO CLAIM.
 *
 * Two halves, both used by api/swing-analysis for every provider (Gemini, OpenAI, Anthropic):
 *
 *  1. LABELLED FRAMES. Every image is preceded by a text label — "Frame 3 — 1240 ms into the clip" —
 *     so the model reads a timed SEQUENCE, not a stack of stills, and the index it cites in evidence
 *     and in fault_frame_index is the index printed next to the picture. (Same idea as the standalone
 *     SmartMotion app's frameBlocks, src/lib/server/claude.ts.) The index is 0-based on purpose:
 *     fault_frame_index is 0-based, and two numbering schemes for one set of pictures is how a
 *     "Frame 3" in the evidence ends up pointing at a different picture than fault_frame_index 3.
 *
 *  2. PHASE COVERAGE, ENFORCED IN CODE. The model reports which swing phases it actually saw
 *     (`phases_visible`). Arithmetic belongs in code, not in the prompt: a fault that is DEFINED by a
 *     phase — over-the-top happens at the top, early extension at impact — cannot be honestly named
 *     from frames that never showed that phase, however confident the prose sounds. So:
 *       - neither top NOR impact seen → confidence is capped at 'low';
 *       - a named fault whose required phase was not seen is refused (primary_fault 'inconclusive',
 *         detected_issue 'none') and the refusal is recorded in `phase_gate`.
 *     The table is deliberately small and conservative: only faults whose definition names a phase.
 *     [[arithmetic-belongs-in-code-not-the-model]] [[silence-is-not-an-answer]]
 */

export type IncomingFrame = { b64: string; media_type?: string; t_ms?: unknown };

export type PhasesVisible = { address: boolean; top: boolean; impact: boolean; finish: boolean };
export type Phase = keyof PhasesVisible;

/** A frame's time, or null when the client did not send a usable one (older clients). */
export function frameTimeMs(f: IncomingFrame): number | null {
  const t = f.t_ms;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? Math.round(t) : null;
}

/** "Frame 3 — 1240 ms into the clip", or "Frame 3" when the time is unknown. */
export function frameLabel(index: number, tMs: number | null): string {
  return tMs == null ? `Frame ${index}` : `Frame ${index} — ${tMs} ms into the clip`;
}

type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Gemini parts: label text, then the image, for every frame, in order. */
export function geminiFrameParts(frames: IncomingFrame[]) {
  return frames.flatMap((f, i) => [
    { text: frameLabel(i, frameTimeMs(f)) },
    { inlineData: { mimeType: f.media_type ?? 'image/jpeg', data: f.b64 } },
  ]);
}

/** OpenAI chat content: label text, then the image, for every frame, in order. */
export function openAIFrameContent(frames: IncomingFrame[]) {
  return frames.flatMap((f, i) => [
    { type: 'text' as const, text: frameLabel(i, frameTimeMs(f)) },
    {
      type: 'image_url' as const,
      image_url: { url: `data:${f.media_type ?? 'image/jpeg'};base64,${f.b64}`, detail: 'high' as const },
    },
  ]);
}

/** Anthropic content blocks: label text, then the image, for every frame, in order. */
export function anthropicFrameContent(frames: IncomingFrame[]) {
  return frames.flatMap((f, i) => [
    { type: 'text' as const, text: frameLabel(i, frameTimeMs(f)) },
    {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        // jpeg/png are the real cases; cast to the SDK's media_type union.
        media_type: (f.media_type ?? 'image/jpeg') as MediaType,
        data: f.b64,
      },
    },
  ]);
}

/**
 * Coerce whatever the model returned into four booleans, or null when it returned nothing usable.
 * A present object with a missing or non-true key reads as NOT SEEN: a phase the model will not
 * vouch for is a phase it did not see. An absent object is UNKNOWN and enforces nothing — an older
 * or non-compliant response must not be punished for a field it was never asked for.
 */
export function normalizePhasesVisible(v: unknown): PhasesVisible | null {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return { address: o.address === true, top: o.top === true, impact: o.impact === true, finish: o.finish === true };
}

/**
 * The phase(s) a fault is defined by. Any ONE listed phase satisfies the requirement.
 * Only faults whose own definition in the prompt names a phase are here; the rest (plane, head
 * movement, sway through the whole backswing…) are left to the evidence gate that already exists.
 */
export const PRIMARY_FAULT_PHASES: Readonly<Record<string, readonly Phase[]>> = {
  over_the_top: ['top'],         // "the club moves OUT and OVER the swing plane on transition from the top"
  casting: ['top'],              // lag lost from the top: needs the hinge at the top to compare against
  reverse_pivot: ['top'],        // "weight stays on lead foot at top"
  early_extension: ['impact'],   // "hips/spine push toward the ball … loss of posture at impact"
  spine_angle_loss: ['impact'],  // posture change measured into impact
  chicken_wing: ['impact', 'finish'], // "lead arm bends/folds through impact" — impact or just after it
};

export const DETECTED_ISSUE_PHASES: Readonly<Record<string, readonly Phase[]>> = {
  over_the_top: ['top'],
  reverse_pivot: ['top'],
  early_extension: ['impact'],
  chicken_wing: ['impact', 'finish'],
  club_face_open: ['impact'],
  club_face_closed: ['impact'],
  attack_angle_steep: ['impact'],
  attack_angle_shallow: ['impact'],
};

const PHASE_WORDS: Record<string, Record<Phase, string>> = {
  en: { address: 'your setup', top: 'the top of your swing', impact: 'impact', finish: 'your finish' },
  es: { address: 'tu posición inicial', top: 'la parte alta del swing', impact: 'el impacto', finish: 'tu final' },
  zh: { address: '站位准备', top: '上杆顶点', impact: '击球瞬间', finish: '收杆' },
};

/** The honest line that replaces an observation which named a fault the frames could not show. */
export function refusedFaultObservation(fault: string, missing: Phase[], language: string): string {
  const lang = language === 'es' || language === 'zh' ? language : 'en';
  const words = PHASE_WORDS[lang];
  const phase = missing.map((m) => words[m]).join(lang === 'zh' ? '或' : lang === 'es' ? ' ni ' : ' or ');
  const name = fault.replace(/_/g, ' ');
  if (lang === 'es') return `No vi ${phase} en estos fotogramas, así que no voy a diagnosticar ${name} todavía. Graba el swing completo y lo reviso.`;
  if (lang === 'zh') return `这些画面里没有看到${phase}，所以我暂时不判断「${name}」。请录下完整的挥杆，我再看一次。`;
  return `I couldn't see ${phase} in these frames, so I won't call ${name} yet. Record the whole swing and I'll read it again.`;
}

type Coverable = {
  confidence: 'high' | 'medium' | 'low';
  detected_issue: string;
  severity: string;
  primary_fault?: string;
  cause?: string;
  fix?: string;
  drill?: string;
  evidence?: string;
  observation: string;
  layman_explanation?: string;
  valid_swing?: boolean;
  phases_visible?: PhasesVisible | null;
  phase_gate?: { refused: string; missing: Phase[] } | null;
};

const unseen = (req: readonly Phase[] | undefined, seen: PhasesVisible): Phase[] | null =>
  req && !req.some((p) => seen[p]) ? [...req] : null;

/**
 * Apply the coverage rules to a normalized read, in place. `phases_visible` must already be
 * normalized (normalizePhasesVisible). No-op when coverage is unknown or the swing was not valid.
 */
export function enforcePhaseCoverage<T extends Coverable>(parsed: T, language: string): T {
  parsed.phase_gate = null;
  const seen = parsed.phases_visible ?? null;
  if (!seen || parsed.valid_swing === false) return parsed;

  if (!seen.top && !seen.impact) parsed.confidence = 'low';

  const pf = parsed.primary_fault;
  const missingForPrimary = pf ? unseen(PRIMARY_FAULT_PHASES[pf], seen) : null;
  if (pf && missingForPrimary) {
    parsed.phase_gate = { refused: pf, missing: missingForPrimary };
    parsed.primary_fault = 'inconclusive';
    parsed.confidence = 'low';
    parsed.cause = '';
    parsed.fix = '';
    parsed.drill = '';
    parsed.evidence = '';
    parsed.observation = refusedFaultObservation(pf, missingForPrimary, language);
    // An inconclusive primary means no named fault anywhere — same reconcile normalizeAnalysis does.
    parsed.detected_issue = 'none';
    parsed.severity = 'none';
    parsed.layman_explanation = '';
    return parsed;
  }

  const missingForDetected = unseen(DETECTED_ISSUE_PHASES[parsed.detected_issue], seen);
  if (missingForDetected) {
    parsed.phase_gate = { refused: parsed.detected_issue, missing: missingForDetected };
    parsed.detected_issue = 'none';
    parsed.severity = 'none';
    parsed.layman_explanation = '';
  }
  return parsed;
}
