import type { CanonicalIssue, SwingAnalysis } from './poseDetection';
import type { PrimaryIssue } from '../store/cageStore';
import { rankFaults } from './knowledgeBase/causalEngine';

/**
 * 2026-06-24 — Causal first-domino tie-in.
 *
 * Maps each CanonicalIssue (what the vision analysis classifies) to the
 * causalEngine fault key that names its ROOT in the first-domino ladder, so
 * that when a SESSION surfaces 2+ DISTINCT issues across swings the consensus
 * can lead with the earliest-causal ROOT rather than the most-frequent one.
 *
 * HONESTY: a mapping exists ONLY where the causal lineage is sound. `null`
 * means "no honest root key" — those issues fall straight back to the existing
 * most-frequent tally and are never re-ranked or dropped.
 *
 *   swing_path_outside_in → 'over-the-top'  (outside-in path IS the over-the-top
 *       signature — same P2 transition root)
 *   over_the_top          → 'over-the-top'
 *   swing_path_inside_out → 'slide'          (the in-to-out / lower-body-slide
 *       lineage; 'slide' is the closest real P2 key — see CAUSAL_CHAINS
 *       strong-grip→slide→hook)
 *   attack_angle_steep    → 'steep'
 *   attack_angle_shallow  → null             (no clean root key; 'scooping'/casting
 *       is a guess, so leave it to the frequency tally)
 *   early_extension       → 'early-extension'
 *   chicken_wing          → 'chicken-wing'
 *   reverse_pivot         → 'reverse-pivot'
 *   club_face_open        → null             (an open face at impact is an OUTCOME
 *       with several roots — weak grip, but also over-the-top/timing; not
 *       reliably a grip issue from 2D phone video, so we DON'T assert 'weak-grip')
 *   club_face_closed      → null             (same — closed face ≠ reliably a
 *       strong grip from what we can see)
 *   none                  → null
 *
 * The two face issues and shallow attack are intentionally null: ranking them
 * to a setup root would be a measurement claim we can't make from the frames.
 */
export const CANONICAL_TO_FAULT: Record<CanonicalIssue, string | null> = {
  swing_path_outside_in: 'over-the-top',
  over_the_top: 'over-the-top',
  swing_path_inside_out: 'slide',
  attack_angle_steep: 'steep',
  attack_angle_shallow: null,
  early_extension: 'early-extension',
  chicken_wing: 'chicken-wing',
  reverse_pivot: 'reverse-pivot',
  club_face_open: null,
  club_face_closed: null,
  none: null,
};

/** Reverse lookup: a causalEngine fault key → the CanonicalIssue it maps from.
 *  Built from CANONICAL_TO_FAULT so the root selected by rankFaults() can be
 *  resolved back to the issue whose consensus tally entry we should lead with. */
const FAULT_TO_CANONICAL: Record<string, CanonicalIssue> = (() => {
  const m: Record<string, CanonicalIssue> = {};
  (Object.entries(CANONICAL_TO_FAULT) as [CanonicalIssue, string | null][]).forEach(
    ([issue, key]) => {
      // First-writer wins so the lead canonical for a shared key (e.g.
      // 'over-the-top' ← both over_the_top and swing_path_outside_in) is stable.
      if (key && !(key in m)) m[key] = issue;
    },
  );
  return m;
})();

/**
 * Phase K — Aggregate per-swing analyses into a session-level Primary Issue.
 *
 * Strategy:
 * - Discard low-confidence analyses (per-swing) from primary-issue tally
 *   (their observations stay for context but don't drive the call).
 * - Tally `detected_issue` across remaining swings.
 * - Primary issue = most-frequent issue, weighted by severity (significant
 *   counts 3x, moderate 2x, minor 1x).
 * - When the top issue is `none` or has fewer than 2 occurrences across the
 *   session, return null Primary Issue (Mike sees "no clear primary issue
 *   from this session" — honest, not a forced call).
 * - When a primary issue is identified:
 *     - mechanical_breakdown = the LLM's per-swing observation (specific
 *       to what was actually visible in THAT swing's frames). Falls back
 *       to ISSUE_COACH_VOICE.mechanical only if observation is missing.
 *     - feel_cue = ISSUE_COACH_VOICE.feel (canonical per-fault drill cue;
 *       the LLM doesn't generate feel cues).
 *
 * 2026-05-16 — Tim reported five swings from three golfers producing the
 * same spoken analysis. Root cause was the classifier discarding each
 * swing's observation and substituting the canonical per-issue breakdown
 * string, so any two over_the_top swings (a common amateur fault) spoke
 * IDENTICALLY. Now the LLM's observation comes through verbatim.
 */

export const ISSUE_DISPLAY_NAME: Record<CanonicalIssue, string> = {
  club_face_open: 'Open Clubface at Impact',
  club_face_closed: 'Closed Clubface at Impact',
  swing_path_outside_in: 'Outside-In Swing Path',
  swing_path_inside_out: 'Inside-Out Swing Path',
  attack_angle_steep: 'Steep Angle of Attack',
  attack_angle_shallow: 'Shallow Angle of Attack',
  early_extension: 'Early Extension',
  over_the_top: 'Over-the-Top Transition',
  chicken_wing: 'Chicken Wing Through Impact',
  reverse_pivot: 'Reverse Pivot',
  none: 'No Clear Primary Issue',
};

export const ISSUE_CATEGORY: Record<CanonicalIssue, PrimaryIssue['category']> = {
  club_face_open: 'club_face',
  club_face_closed: 'club_face',
  swing_path_outside_in: 'swing_path',
  swing_path_inside_out: 'swing_path',
  attack_angle_steep: 'attack_angle',
  attack_angle_shallow: 'attack_angle',
  early_extension: 'setup',
  over_the_top: 'swing_path',
  chicken_wing: 'tempo',
  reverse_pivot: 'tempo',
  none: 'other',
};

/** Per-issue Coach voice. Mechanical breakdown reads in Kevin's voice — same
 *  character that authored the per-drill walkthroughs in Phase I. */
export const ISSUE_COACH_VOICE: Record<CanonicalIssue, { mechanical: string; feel: string }> = {
  club_face_open: {
    mechanical: "Your clubface is open at impact — the ball squirts right because the face never squares up. Grip and release timing are usually the cause.",
    feel: "Feel like the back of your lead hand points at the target through impact. Squares the face naturally.",
  },
  club_face_closed: {
    mechanical: "Your clubface is closed at impact — the ball pulls left because the face is shut at the moment of truth. Often a too-strong grip or early release.",
    feel: "Feel the toe of the club racing past your hands at impact. Wakes the face up.",
  },
  swing_path_outside_in: {
    mechanical: "Your club is approaching from outside the target line. The path comes across the ball, opening the face — that's the slice.",
    feel: "Think of swinging out toward right field. Feels exaggerated, but it's just neutral path.",
  },
  swing_path_inside_out: {
    mechanical: "Your club is coming from inside the target line and swinging out — that's the hook tendency. Path is too far in-to-out.",
    feel: "Feel like you're swinging toward left field. Brings the path back to neutral.",
  },
  attack_angle_steep: {
    mechanical: "You're chopping down on the ball — too steep an angle of attack. Big divots after the ball, ballooning trajectory.",
    feel: "Feel like you're sweeping the grass after the ball, not digging into it.",
  },
  attack_angle_shallow: {
    mechanical: "You're sweeping the ball — no compression, weak strike. Ball flight stays low and short of expected.",
    feel: "Feel like you're trapping the ball against the ground for an instant before the divot.",
  },
  early_extension: {
    mechanical: "Your hips are moving toward the ball at impact instead of rotating around. Spine angle stands up, club gets stuck.",
    feel: "Feel like your butt stays on the wall behind you through the swing. Hips rotate, not push forward.",
  },
  over_the_top: {
    mechanical: "Your club is coming over the plane on transition — shoulders fire before the lower body, club casts out. Classic slice ingredient.",
    feel: "Feel the lower body start the downswing. Hips lead, then arms follow. Slow it down to find it.",
  },
  chicken_wing: {
    mechanical: "Your lead arm is bending through impact — the elbow flies out instead of extending toward the target.",
    feel: "Feel both arms extending toward the target through impact. Long arms, tall finish.",
  },
  reverse_pivot: {
    mechanical: "Your weight is shifting backward on the downswing instead of forward. Robs power, exposes the swing to inconsistency.",
    feel: "Feel your front foot press into the ground as you start down. Weight goes forward, then rotates.",
  },
  none: { mechanical: '', feel: '' },
};

const SEVERITY_WEIGHT: Record<SwingAnalysis['severity'], number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  significant: 3,
};

// 2026-07-06 (Tim's range session — "No Clear Issue on five swings even though
// I have clear issues", while every card's own observation described an
// over-the-top pattern) — the analyzer returns TWO fault fields: the legacy,
// deliberately-conservative `detected_issue` (the prompt steers it to 'none')
// and `primary_fault`, the evidence-gated headline. This classifier only ever
// read detected_issue, so a session where the model called over_the_top five
// times with frame evidence still rolled up as "no clear fault." These maps +
// classifyByPrimaryFault() make primary_fault the fallback signal it was
// always meant to be. Four ids overlap the canonical taxonomy and reuse its
// display maps; the six pf-only ids get their own entries here.
type DiagnosticFault = Exclude<NonNullable<SwingAnalysis['primary_fault']>, 'no_dominant_fault' | 'inconclusive'>;

const PF_ONLY_DISPLAY: Record<string, { name: string; category: PrimaryIssue['category']; feel: string }> = {
  casting: {
    name: 'Casting (Early Release)',
    category: 'tempo',
    feel: 'Feel like you hold the hinge in your wrists until your hands reach your back pocket, then let it go.',
  },
  sway: {
    name: 'Hip Sway Off the Ball',
    category: 'setup',
    feel: 'Feel your trail hip turn BEHIND you on the backswing, not slide away from the target.',
  },
  plane_too_flat: {
    name: 'Swing Plane Too Flat',
    category: 'swing_path',
    feel: 'Feel your hands work more UP to the top, like reaching for a shelf just above your trail shoulder.',
  },
  plane_too_steep: {
    name: 'Swing Plane Too Steep',
    category: 'swing_path',
    feel: 'Feel your trail elbow stay closer to your side going back — swing more around you, less straight up.',
  },
  head_movement: {
    name: 'Head Movement Through the Swing',
    category: 'setup',
    feel: 'Feel like your head stays behind an imaginary pane of glass at the ball until after impact.',
  },
  spine_angle_loss: {
    name: 'Losing Spine Angle',
    category: 'setup',
    feel: 'Feel your chest stay DOWN over the ball through impact — stand up only in the finish.',
  },
};

function displayForPrimaryFault(pf: DiagnosticFault): { name: string; category: PrimaryIssue['category']; feel: string } {
  if (pf in ISSUE_DISPLAY_NAME) {
    const c = pf as CanonicalIssue;
    return { name: ISSUE_DISPLAY_NAME[c], category: ISSUE_CATEGORY[c], feel: ISSUE_COACH_VOICE[c].feel };
  }
  return PF_ONLY_DISPLAY[pf] ?? { name: pf.replace(/_/g, ' '), category: 'other', feel: '' };
}

function isDiagnosticFault(pf: SwingAnalysis['primary_fault']): pf is DiagnosticFault {
  return !!pf && pf !== 'no_dominant_fault' && pf !== 'inconclusive';
}

/**
 * 2026-07-06 — Roll up a session by primary_fault when the detected_issue
 * tally produced nothing. Confidence-weighted tally across swings with a
 * diagnostic primary_fault; the winning fault becomes the session headline
 * with the best matching swing's observation/cause/fix/drill/evidence.
 * Honesty: 2+ agreeing swings (or a single-swing session) keep the model's
 * own confidence; a lone diagnostic among many swings surfaces as 'low'.
 */
export function classifyByPrimaryFault(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
): PrimaryIssue | null {
  const diag = swingAnalyses.filter(s => s.swing_id && isDiagnosticFault(s.analysis.primary_fault));
  if (diag.length === 0) return null;

  const confRank: Record<SwingAnalysis['confidence'], number> = { high: 3, medium: 2, low: 1 };
  const tally = new Map<DiagnosticFault, { score: number; count: number; swing_ids: string[] }>();
  for (const s of diag) {
    const pf = s.analysis.primary_fault as DiagnosticFault;
    const slot = tally.get(pf) ?? { score: 0, count: 0, swing_ids: [] };
    slot.score += confRank[s.analysis.confidence];
    slot.count += 1;
    slot.swing_ids.push(s.swing_id);
    tally.set(pf, slot);
  }
  const [topFault, top] = Array.from(tally.entries()).sort((a, b) => b[1].score - a[1].score)[0];

  // Best source swing for the headline text: highest confidence among matches.
  const matches = diag
    .filter(s => s.analysis.primary_fault === topFault)
    .sort((a, b) => confRank[b.analysis.confidence] - confRank[a.analysis.confidence]);
  const best = matches[0].analysis;
  const display = displayForPrimaryFault(topFault);

  const agreeing = top.count >= 2 || swingAnalyses.length === 1;
  const rawConfidence: PrimaryIssue['confidence'] = agreeing ? best.confidence : 'low';
  // 2026-07-06 (SmartMotion audit) — a LONE swing must not headline 'high'. The
  // conservative detected_issue biases to 'none', so this primary_fault rollup can
  // fire off a single swing whose own detector declined to call anything; forcing
  // agreeing=true for length===1 then surfaced the model's own 'high'. Cap a
  // single-swing read at 'medium' so one swing never reads as a confident verdict.
  const confidence: PrimaryIssue['confidence'] =
    swingAnalyses.length === 1 && rawConfidence === 'high' ? 'medium' : rawConfidence;
  console.log('[classifier] primary_fault rollup: ' + topFault + ' count=' + top.count + '/' + swingAnalyses.length + ' conf=' + confidence);

  return {
    issue_id: topFault,
    name: display.name,
    category: display.category,
    // 2026-07-06 (SmartMotion audit) — carry the REAL max severity across the
    // matching swings, not a count heuristic. The old `count>=2 ? moderate : minor`
    // could NEVER reach 'significant', so a genuinely severe fault never lit the
    // skeleton region red (faultSevere = severity === 'significant').
    severity: (() => {
      const mx = matches.reduce(
        (m, s) => (SEVERITY_WEIGHT[s.analysis.severity] > SEVERITY_WEIGHT[m] ? s.analysis.severity : m),
        'none' as SwingAnalysis['severity'],
      );
      return mx === 'none' ? 'minor' : mx;
    })(),
    occurrence_count: top.count,
    visual_reference_path: null,
    mechanical_breakdown: (best.observation ?? '').trim() || (best.cause ?? '').trim() || display.name,
    feel_cue: (best.fix ?? '').trim() || display.feel,
    detected_in_shots: top.swing_ids,
    confidence,
    layman_explanation: (best.layman_explanation ?? '').trim() || undefined,
    primary_fault: topFault,
    cause: (best.cause ?? '').trim() || undefined,
    fix: (best.fix ?? '').trim() || undefined,
    drill: (best.drill ?? '').trim() || undefined,
    evidence: (best.evidence ?? '').trim() || undefined,
    strengths: cleanStrengths(best.strengths),
  };
}

// Phase J / live cage thresholds — tuned for multi-swing sessions where
// pattern consensus matters. Single-swing UPLOADS skip these and use the
// single-swing branch below.
const MIN_SESSION_SWINGS_FOR_PRIMARY = 3;
const MIN_OCCURRENCES_FOR_PRIMARY = 2;

/**
 * Roll up a session's per-swing analyses into one PrimaryIssue (or null).
 *
 * Phase V.6 — branched logic:
 *   - **Single-swing context** (upload flow, swingAnalyses.length === 1):
 *     surface a tentative result whenever the analysis isn't 'none'. Tag
 *     the resulting PrimaryIssue with the analysis's confidence so the
 *     consumer can prefix a 'tentative read' caveat for low-confidence.
 *     Fixes the upload bug where single uploads always returned null
 *     because MIN_SESSION_SWINGS=3 and MIN_OCCURRENCES=2 could never be
 *     met by a single swing.
 *   - **Multi-swing context** (live cage session): keep prior pattern
 *     consensus thresholds. If consensus fails, fall back to the highest-
 *     severity non-none swing as a 'low'-confidence primary issue rather
 *     than returning null — better than 'no clear issue' when we DO have
 *     a useful read. Honesty bar preserved via confidence='low'.
 */
export function classifySession(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
): PrimaryIssue | null {
  if (swingAnalyses.length === 0) return null;
  console.log('[classifier] enter, swings=' + swingAnalyses.length);

  // ── Single-swing branch (uploads). One read, one decision. ─────────
  if (swingAnalyses.length === 1) {
    const only = swingAnalyses[0];
    // 2026-06-15 (audit) — honest failure over bad data: without a swing_id,
    // detected_in_shots would be [undefined] and break downstream shot lookups.
    if (!only.swing_id) return null;
    console.log('[classifier] single: detected=' + only.analysis.detected_issue + ' conf=' + only.analysis.confidence);
    // 2026-07-06 — detected_issue 'none' no longer means "no read": the
    // evidence-gated primary_fault is the real headline. Fall through to it
    // before giving up (see classifyByPrimaryFault).
    if (only.analysis.detected_issue === 'none') return classifyByPrimaryFault(swingAnalyses);
    const voice = ISSUE_COACH_VOICE[only.analysis.detected_issue];
    const observationText = (only.analysis.observation ?? '').trim();
    return {
      issue_id: only.analysis.detected_issue,
      name: ISSUE_DISPLAY_NAME[only.analysis.detected_issue],
      category: ISSUE_CATEGORY[only.analysis.detected_issue],
      severity: only.analysis.severity === 'none' ? 'minor' : only.analysis.severity,
      occurrence_count: 1,
      visual_reference_path: null,
      // 2026-05-16 — per-swing observation if the LLM produced one;
      // canonical fallback only when it didn't.
      mechanical_breakdown: observationText || voice.mechanical,
      feel_cue: voice.feel,
      detected_in_shots: [only.swing_id],
      confidence: only.analysis.confidence,
      // 2026-05-24 — Carry the layman translation through unchanged.
      // Empty string when the server didn't produce one (none/invalid);
      // the card hides the "What does this mean?" affordance on falsy.
      layman_explanation: (only.analysis.layman_explanation ?? '').trim() || undefined,
      // 2026-05-24 — GolfFix #1 structured fields, threaded straight
      // through from the single Sonnet call. When the server returned
      // 'inconclusive', cause/fix/drill are empty strings and the card
      // renders the honest "not enough to read yet" state.
      primary_fault: only.analysis.primary_fault,
      cause: (only.analysis.cause ?? '').trim() || undefined,
      fix: (only.analysis.fix ?? '').trim() || undefined,
      drill: (only.analysis.drill ?? '').trim() || undefined,
      evidence: (only.analysis.evidence ?? '').trim() || undefined,
      strengths: cleanStrengths(only.analysis.strengths),
    };
  }

  // ── Multi-swing branch. Pattern consensus across non-low / non-none. ─
  const tally: Record<string, { score: number; count: number; severity: SwingAnalysis['severity']; swing_ids: string[] }> = {};
  for (const { swing_id, analysis } of swingAnalyses) {
    if (analysis.confidence === 'low') continue;
    if (analysis.detected_issue === 'none') continue;
    const issue = analysis.detected_issue;
    const slot = tally[issue] ?? { score: 0, count: 0, severity: 'minor' as const, swing_ids: [] };
    slot.score += SEVERITY_WEIGHT[analysis.severity];
    slot.count += 1;
    slot.swing_ids.push(swing_id);
    if (SEVERITY_WEIGHT[analysis.severity] > SEVERITY_WEIGHT[slot.severity]) {
      slot.severity = analysis.severity;
    }
    tally[issue] = slot;
  }

  const ranked = Object.entries(tally)
    .map(([issue, data]) => ({ issue: issue as CanonicalIssue, ...data }))
    .sort((a, b) => b.score - a.score);

  let top = ranked[0];
  console.log('[classifier] multi: consensus top=' + (top?.issue ?? 'none') + ' count=' + (top?.count ?? 0));

  // 2026-06-24 — Causal first-domino re-ranking. The frequency/severity tally
  // above is the INPUT SET; causality breaks the "which is the headline"
  // decision when 2+ DISTINCT mapped issues are present. We pass only the
  // honestly-mapped issue keys to rankFaults(); the primary (earliest-causal
  // ROOT) becomes the lead, the others are framed as downstream symptoms.
  //
  // NON-REGRESSION: a single distinct issue, or any case where <2 issues map to
  // a real causalEngine key (null-mapped), leaves `top` exactly as the
  // frequency tally chose it. Confidence gating already happened above (low-conf
  // swings never entered the tally), so this never resurrects a gated read.
  let causal: { rootCause: string; downstreamSymptoms: string[]; causalRationale: string } | null = null;
  if (ranked.length >= 2) {
    // Distinct issues that have an HONEST root key, paired with their tally entry.
    const mapped = ranked
      .map((r) => ({ r, key: CANONICAL_TO_FAULT[r.issue] }))
      .filter((x): x is { r: typeof ranked[number]; key: string } => x.key != null);
    const distinctKeys = Array.from(new Set(mapped.map((m) => m.key)));
    if (distinctKeys.length >= 2) {
      const ranking = rankFaults(distinctKeys);
      // Resolve the root key back to an issue that is ACTUALLY PRESENT in this
      // session's tally — a key can map from >1 canonical (e.g. 'over-the-top'
      // ← over_the_top AND swing_path_outside_in), so the static first-writer
      // reverse map could point at an absent issue. Prefer the present tally
      // entry; fall back to the static reverse map only if none is present.
      const rootEntry =
        mapped.find((m) => m.key === ranking.primary)?.r ??
        (FAULT_TO_CANONICAL[ranking.primary]
          ? ranked.find((r) => r.issue === FAULT_TO_CANONICAL[ranking.primary])
          : undefined);
      // Only override the headline when the causal root is a DIFFERENT, present
      // issue than the frequency top. If the root IS already the frequency top,
      // nothing changes (but we still surface the symptoms framing).
      if (rootEntry) {
        const downstreamIssues = ranked
          .filter((r) => r.issue !== rootEntry.issue && CANONICAL_TO_FAULT[r.issue] != null)
          .map((r) => ISSUE_DISPLAY_NAME[r.issue]);
        causal = {
          rootCause: ISSUE_DISPLAY_NAME[rootEntry.issue],
          downstreamSymptoms: downstreamIssues,
          causalRationale: ranking.rationale,
        };
        if (rootEntry.issue !== top.issue) {
          console.log('[classifier] causal root override: ' + top.issue + ' → ' + rootEntry.issue + ' (downstream: ' + downstreamIssues.join(', ') + ')');
          top = rootEntry;
        }
      }
    }
  }

  if (top && swingAnalyses.length >= MIN_SESSION_SWINGS_FOR_PRIMARY && top.count >= MIN_OCCURRENCES_FOR_PRIMARY) {
    const voice = ISSUE_COACH_VOICE[top.issue];
    // 2026-05-16 — pick the most diagnostic observation from the swings
    // that detected the consensus issue. Highest-confidence first; falls
    // back to canonical only if no swing produced a usable observation.
    const observation = pickBestObservation(swingAnalyses, top.issue);
    const layman = pickBestLayman(swingAnalyses, top.issue);
    // 2026-05-24 — GolfFix #1 multi-swing pickup. Use the consensus
    // issue's highest-confidence swing as the source of primary_fault /
    // cause / fix / drill. Falls back gracefully if none of the matching
    // swings produced the structured payload (legacy / inconclusive).
    const best = pickBestStructured(swingAnalyses, top.issue);
    return {
      issue_id: top.issue,
      name: ISSUE_DISPLAY_NAME[top.issue],
      category: ISSUE_CATEGORY[top.issue],
      severity: top.severity === 'none' ? 'minor' : top.severity,
      occurrence_count: top.count,
      visual_reference_path: null,
      mechanical_breakdown: observation || voice.mechanical,
      feel_cue: voice.feel,
      detected_in_shots: top.swing_ids,
      confidence: 'high',
      layman_explanation: layman || undefined,
      primary_fault: best?.primary_fault,
      cause: (best?.cause ?? '').trim() || undefined,
      fix: (best?.fix ?? '').trim() || undefined,
      drill: (best?.drill ?? '').trim() || undefined,
      evidence: (best?.evidence ?? '').trim() || undefined,
      strengths: cleanStrengths(best?.strengths),
      // 2026-06-24 — causal first-domino framing (only when 2+ distinct mapped
      // issues produced a root; undefined otherwise so single-issue / null-mapped
      // sessions render exactly as before).
      root_cause: causal?.rootCause,
      downstream_symptoms: (causal?.downstreamSymptoms?.length ?? 0) > 0 ? causal!.downstreamSymptoms : undefined,
      causal_rationale: causal?.causalRationale,
    };
  }

  // ── Fallback: consensus didn't hit thresholds, but at least one swing
  // had a usable read. Surface the most severe non-none swing as a
  // low-confidence primary so the user gets a tentative read instead of
  // 'no clear issue'.
  const usable = swingAnalyses
    .filter(s => s.analysis.detected_issue !== 'none')
    .sort((a, b) => SEVERITY_WEIGHT[b.analysis.severity] - SEVERITY_WEIGHT[a.analysis.severity]);
  if (usable.length === 0) {
    // 2026-07-06 — every detected_issue was 'none', but the model may still
    // have made evidence-gated primary_fault calls (Tim's five-swing session:
    // detected_issue 'none' ×5, primary_fault over_the_top ×5 → the old code
    // returned null here and the session read "No clear fault").
    const byFault = classifyByPrimaryFault(swingAnalyses);
    if (byFault) return byFault;
    console.log('[classifier] no usable swings — returning null');
    return null;
  }
  const fallback = usable[0];
  console.log('[classifier] tentative fallback: ' + fallback.analysis.detected_issue);
  const voice = ISSUE_COACH_VOICE[fallback.analysis.detected_issue];
  const fallbackObservation = (fallback.analysis.observation ?? '').trim();
  return {
    issue_id: fallback.analysis.detected_issue,
    name: ISSUE_DISPLAY_NAME[fallback.analysis.detected_issue],
    category: ISSUE_CATEGORY[fallback.analysis.detected_issue],
    severity: fallback.analysis.severity === 'none' ? 'minor' : fallback.analysis.severity,
    occurrence_count: 1,
    visual_reference_path: null,
    mechanical_breakdown: fallbackObservation || voice.mechanical,
    feel_cue: voice.feel,
    detected_in_shots: [fallback.swing_id],
    confidence: 'low',
    layman_explanation: (fallback.analysis.layman_explanation ?? '').trim() || undefined,
    primary_fault: fallback.analysis.primary_fault,
    cause: (fallback.analysis.cause ?? '').trim() || undefined,
    fix: (fallback.analysis.fix ?? '').trim() || undefined,
    drill: (fallback.analysis.drill ?? '').trim() || undefined,
    evidence: (fallback.analysis.evidence ?? '').trim() || undefined,
    strengths: cleanStrengths(fallback.analysis.strengths),
  };
}

// 2026-06-14 (Tim) — normalize the model's strengths list: trim, drop empties,
// cap at 2 (the card leads with the fault; strengths are a tight "what's
// working" line, not a paragraph). Returns undefined when nothing usable so the
// card hides the block cleanly (back-compat with pre-deploy servers).
function cleanStrengths(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, 2);
  return cleaned.length > 0 ? cleaned : undefined;
}

// 2026-05-24 — GolfFix #1 multi-swing helper. Find the highest-confidence
// per-swing analysis among the consensus issue's matches and return its
// structured payload (primary_fault / cause / fix / drill). Null when no
// match produced one (legacy server, or all matches were inconclusive).
function pickBestStructured(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
  consensusIssue: CanonicalIssue,
): { primary_fault?: SwingAnalysis['primary_fault']; cause?: string; fix?: string; drill?: string; evidence?: string; strengths?: string[] } | null {
  const matches = swingAnalyses
    .filter((s) => s.analysis.detected_issue === consensusIssue)
    .filter((s) => (s.analysis.fix ?? '').trim().length > 0)
    .sort((a, b) => {
      const w: Record<SwingAnalysis['confidence'], number> = { high: 3, medium: 2, low: 1 };
      return w[b.analysis.confidence] - w[a.analysis.confidence];
    });
  if (matches.length === 0) return null;
  const a = matches[0].analysis;
  return { primary_fault: a.primary_fault, cause: a.cause, fix: a.fix, drill: a.drill, evidence: a.evidence, strengths: a.strengths };
}

// 2026-05-16 — Pick the highest-confidence per-swing observation that
// matches the consensus issue. The user hears specific commentary on
// THEIR swing instead of canned per-issue text.
function pickBestObservation(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
  consensusIssue: CanonicalIssue,
): string {
  const matches = swingAnalyses
    .filter(s => s.analysis.detected_issue === consensusIssue)
    .filter(s => (s.analysis.observation ?? '').trim().length > 0);
  if (matches.length === 0) return '';
  // Higher confidence wins; ties broken by severity (more severe first).
  const confRank: Record<SwingAnalysis['confidence'], number> = { high: 3, medium: 2, low: 1 };
  const sevRank: Record<SwingAnalysis['severity'], number> = { significant: 3, moderate: 2, minor: 1, none: 0 };
  matches.sort((a, b) => {
    const c = confRank[b.analysis.confidence] - confRank[a.analysis.confidence];
    if (c !== 0) return c;
    return sevRank[b.analysis.severity] - sevRank[a.analysis.severity];
  });
  return (matches[0].analysis.observation ?? '').trim();
}

// 2026-05-24 — Mirror of pickBestObservation for the plain-language
// translation. When multiple swings detected the consensus issue, pick
// the highest-confidence translation so the layman line on the card
// matches the strongest read. Falls back to empty when no swing
// produced a layman_explanation (legacy server / 'none' issue).
function pickBestLayman(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
  consensusIssue: CanonicalIssue,
): string {
  const matches = swingAnalyses
    .filter(s => s.analysis.detected_issue === consensusIssue)
    .filter(s => (s.analysis.layman_explanation ?? '').trim().length > 0);
  if (matches.length === 0) return '';
  const confRank: Record<SwingAnalysis['confidence'], number> = { high: 3, medium: 2, low: 1 };
  const sevRank: Record<SwingAnalysis['severity'], number> = { significant: 3, moderate: 2, minor: 1, none: 0 };
  matches.sort((a, b) => {
    const c = confRank[b.analysis.confidence] - confRank[a.analysis.confidence];
    if (c !== 0) return c;
    return sevRank[b.analysis.severity] - sevRank[a.analysis.severity];
  });
  return (matches[0].analysis.layman_explanation ?? '').trim();
}
