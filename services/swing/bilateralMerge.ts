/**
 * 2026-06-14 (Tim — bilateral / second video source) — merge two ALREADY-analyzed
 * swings of the SAME swing from two angles (down-the-line + face-on) into one combined
 * read. Pure / sync / offline-safe / never-throws (cnsShotRead discipline).
 *
 * The honest design ([[multi-angle-bilateral-analysis]]):
 *   - Each clip is analyzed independently first (its own file), then LINKED.
 *   - DTL is valid for path / plane / over-the-top / early-extension / attack angle.
 *     Face-on is valid for weight shift / hip rotation / sway / reverse-pivot / setup.
 *     So the merge takes each angle's VALID half — the union of two complementary 2D
 *     reads. This is "bilateral 2D fusion", NOT metric 3D (that needs synced + CALIBRATED
 *     capture; frame rate + camera geometry are the real ceilings, not timestamp precision).
 *   - ALIGNMENT (Tim's acoustic-anchor insight): both devices hear the SAME ball strike,
 *     so each swing's detected impact (impactSec) is a shared physical anchor. When both
 *     carry an impact we report the read as impact-aligned (same instant, two angles).
 */

export type SwingAngle = 'down_the_line' | 'face_on';

export interface BilateralSwingInput {
  sessionId: string;
  angle: SwingAngle | null;           // from upload.angleOverride
  label: string;                      // e.g. "7-iron · Jun 14"
  impactSec: number | null;           // detectionOffsetSeconds — the acoustic anchor
  faultName: string | null;           // primary_issue.name / primary_fault
  category: string | null;            // primary_issue.category
  breakdown: string | null;           // mechanical_breakdown
  fix: string | null;                 // primary_issue.fix / feel_cue
  /** Model-named strengths (primary_issue.strengths once the server field deploys). */
  strengths?: string[] | null;
  /** Whether this swing's read flagged a real fault (false ⇒ a clean-base positive). */
  hasFault?: boolean;
}

export interface BilateralAngleRead {
  angle: SwingAngle;
  label: string;
  faultName: string | null;
  breakdown: string | null;
  fix: string | null;
  /** What this angle is the authority on. */
  reads: string;
  /** 2026-06-14 (Tim) — model-named strengths for this swing (from /api/swing-analysis
   *  `strengths`, once deployed). Empty until then. */
  strengths: string[];
  /** Honest fallback positive when the model named no explicit strength but this angle
   *  flagged no fault — "nothing flagged from the domain this angle reads". Null otherwise.
   *  Face-on owns the fundamentals (setup: stance/ball position/grip) + the finish; DTL
   *  owns path/plane. Honest by construction: absence of a flagged fault, not invented praise. */
  cleanNote: string | null;
}

export interface BilateralRead {
  dtl: BilateralAngleRead | null;
  faceOn: BilateralAngleRead | null;
  headline: string;
  notes: string[];
  /** True when BOTH swings carried a detected impact → impact-aligned. */
  alignedAtImpact: boolean;
}

const DTL_READS = 'path, plane, over-the-top, early extension, attack angle';
const FACEON_READS = 'weight shift, hip rotation, sway, reverse pivot, setup';

// Honest "clean base" positive when no fault was flagged from this angle. Names the
// domains the angle actually reads (face-on owns Tank's fundamentals + the finish;
// DTL owns path/plane) — it's the ABSENCE of a flagged fault, framed as a base to
// build on, not invented praise.
const FACEON_CLEAN = 'Setup (stance, ball position, grip) and finish — nothing flagged from face-on.';
const DTL_CLEAN = 'Path & plane looked sound — nothing flagged from down the line.';

function toAngleRead(s: BilateralSwingInput | null, angle: SwingAngle): BilateralAngleRead | null {
  if (!s) return null;
  const modelStrengths = (s.strengths ?? []).filter((x) => typeof x === 'string' && x.trim());
  // Only offer the clean-base note when the model named NO explicit strength AND this
  // angle flagged no fault (s.hasFault === false). If hasFault is undefined we stay quiet.
  const cleanNote = (modelStrengths.length === 0 && s.hasFault === false)
    ? (angle === 'down_the_line' ? DTL_CLEAN : FACEON_CLEAN)
    : null;
  return {
    angle,
    label: s.label,
    faultName: s.faultName,
    breakdown: s.breakdown,
    fix: s.fix,
    reads: angle === 'down_the_line' ? DTL_READS : FACEON_READS,
    strengths: modelStrengths,
    cleanNote,
  };
}

/**
 * Merge two analyzed swings into one bilateral read. Order-independent; classifies each
 * by its angle. Honest about missing/duplicate angles and impact alignment.
 */
export function mergeBilateral(a: BilateralSwingInput, b: BilateralSwingInput): BilateralRead {
  const notes: string[] = [];

  // Classify by angle (order-independent).
  let dtlIn: BilateralSwingInput | null = null;
  let faceOnIn: BilateralSwingInput | null = null;
  for (const s of [a, b]) {
    if (s.angle === 'down_the_line' && !dtlIn) dtlIn = s;
    else if (s.angle === 'face_on' && !faceOnIn) faceOnIn = s;
  }

  // Same-angle or unknown-angle handling — honest, never silently mislabel.
  if (!dtlIn && !faceOnIn) {
    // Neither clip has an angle tag. Best effort: present both as-is, ask for tags.
    notes.push('Couldn\'t tell the two angles apart — upload each clip with its Camera Angle set (Down-the-line / Face-on) for a true bilateral read.');
  } else if (a.angle && a.angle === b.angle) {
    notes.push(`Both clips read as ${a.angle === 'down_the_line' ? 'down-the-line' : 'face-on'}. Link one of each angle for the full picture — this shows only that angle.`);
  } else {
    if (!dtlIn) notes.push('No down-the-line clip linked — add one for path / plane / early-extension.');
    if (!faceOnIn) notes.push('No face-on clip linked — add one for weight shift / sway / rotation.');
  }

  const dtl = toAngleRead(dtlIn, 'down_the_line');
  const faceOn = toAngleRead(faceOnIn, 'face_on');

  // Impact alignment (Tim's acoustic anchor): both detected an impact → same-instant.
  const alignedAtImpact = (dtlIn?.impactSec != null) && (faceOnIn?.impactSec != null);
  if (dtl && faceOn) {
    notes.push(alignedAtImpact
      ? 'Aligned on the acoustic impact — both angles read at the same instant.'
      : 'Couldn\'t align on impact (one clip had no acoustic strike) — the diagnoses are still combined.');
    notes.push('Bilateral 2D read — two angles of the same swing. Not 3D (that needs synced, calibrated capture).');
  }

  // Headline: combine each angle's fault, honestly.
  const parts: string[] = [];
  if (dtl?.faultName) parts.push(`Down-the-line: ${dtl.faultName}`);
  if (faceOn?.faultName) parts.push(`Face-on: ${faceOn.faultName}`);
  let headline: string;
  if (parts.length === 2) headline = parts.join('  ·  ');
  else if (parts.length === 1) headline = parts[0];
  else headline = 'Linked — open each angle below for its read.';

  return { dtl, faceOn, headline, notes, alignedAtImpact };
}
