import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

// 2026-05-23 — maxRetries 1 → 3 to absorb Anthropic 529 overloaded_error spikes.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 3 });
// 2026-05-26 — Fix AR Phase 2: OpenAI gpt-4o fallback. Lower timeout
// than Anthropic — by the time we fall back, the user has already been
// waiting; we'd rather degrade to honest-failure than burn another 25s.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
// 2026-05-26 — Fix AT: Gemini 2.5 Flash as a third resilience layer.
// Bryson DeChambeau's ad used Gemini for swing analysis Q&A — adding
// it here means we match (and exceed) that capability with our own
// structured pipeline. Constructed lazily inside the handler so the
// process boots even when GOOGLE_API_KEY isn't configured.
const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;

/**
 * Phase K — Swing analysis endpoint.
 *
 * Cloud-based pose-aware swing fault detection via Anthropic Claude Sonnet
 * vision. Input: 1-5 base64-encoded JPEGs sampled from a swing video clip
 * (address, top of backswing, transition, impact, follow-through ideally).
 * Plus context (club, swing number, prior issues if any). Output: structured
 * canonical-issue classification with confidence.
 *
 * Per the Phase K spec, this is option (a) cloud-based pose detection.
 * Privacy implication: swing video frames go to Anthropic. The future swap
 * to local TFJS pose detection is a one-file change in
 * services/poseDetection.ts (this endpoint becomes optional).
 *
 * Canonical issue catalog matches services/swingIssueClassifier.ts and
 * the per-issue Coach voice in coachTemplates.ts. New issues drop in by
 * adding to all three places.
 */

const CANONICAL_ISSUES = [
  'club_face_open',
  'club_face_closed',
  'swing_path_outside_in',
  'swing_path_inside_out',
  'attack_angle_steep',
  'attack_angle_shallow',
  'early_extension',
  'over_the_top',
  'chicken_wing',
  'reverse_pivot',
  'none',
] as const;

type CanonicalIssue = typeof CANONICAL_ISSUES[number];

// 2026-05-24 — Structured primary-fault catalog (GolfFix #1 step). Faults
// genuinely visible in 2D phone video (no 3D, no launch monitor). The
// model picks ONE from this list per analysis and ALSO returns a paired
// cause / fix / drill. Distinct from CANONICAL_ISSUES (which includes
// ball-flight inferences like club_face_open / swing_path_*); those
// stay on detected_issue for back-compat with the existing classifier
// pipeline. primary_fault is the new headline surface.
const PRIMARY_FAULTS = [
  'over_the_top',
  'early_extension',
  'casting',           // loss of lag / early release
  'sway',              // lateral hip slide off the ball during backswing
  'reverse_pivot',
  'chicken_wing',
  'plane_too_flat',
  'plane_too_steep',
  'head_movement',     // significant lateral / vertical head shift
  'spine_angle_loss',  // standing up / changing posture during downswing
  // 2026-05-24 S1.1 — "No dominant fault" is a legitimate outcome.
  // Distinct from 'inconclusive': frames are READABLE but no single
  // fault dominates — possibly multiple minor tendencies, possibly a
  // clean swing with a single area to refine, possibly a genuine
  // strength worth naming. cause/fix/drill in this branch describe
  // the strongest area to work on OR a strength to keep building on.
  'no_dominant_fault',
  'inconclusive',      // unreadable footage / model can't read the frames
] as const;
type PrimaryFault = typeof PRIMARY_FAULTS[number];

type SwingAnalysisResponse = {
  detected_issue: CanonicalIssue;
  severity: 'minor' | 'moderate' | 'significant' | 'none';
  confidence: 'high' | 'medium' | 'low';
  observation: string;          // 1-sentence what was visible in the frames
  follow_up_question?: string | null;  // when frames were too poor to read
  // 2026-05-24 — GolfFix #1 structured payload. Same single Sonnet call
  // produces ALL fields. primary_fault is the headline; cause/fix/drill
  // expand it into something actionable. evidence cites the specific
  // frame + visible cue (S1.1 — calibration against the default-bias
  // problem where every player got 'early_extension'). When the read
  // isn't clean, primary_fault is 'inconclusive' (footage unreadable)
  // or 'no_dominant_fault' (frames readable but nothing dominates);
  // cause/fix/drill stay populated for no_dominant_fault (describe
  // strongest area to refine OR a genuine strength), empty for
  // inconclusive.
  primary_fault?: PrimaryFault;
  cause?: string;
  fix?: string;
  drill?: string;
  // 2026-05-24 S1.1 — Frame-specific evidence string. "Frame N: <what
  // is visible that supports the fault call>". Empty for inconclusive;
  // populated for every diagnostic primary_fault including
  // no_dominant_fault (the latter cites the strongest tendency observed
  // even when it doesn't rise to a dominant fault). Surfaced under the
  // fault headline so the player can see WHY the call was made.
  evidence?: string;
  // Phase 403b — 0-based index into the submitted frames identifying the
  // most diagnostic frame for the detected issue. Used downstream to
  // persist that exact frame as a JPEG so the review UI can show the
  // user the moment of the fault. -1 = no specific frame stood out
  // (e.g. detected_issue='none' or the tendency was uniform across all
  // frames). Required when detected_issue != 'none'.
  fault_frame_index?: number;
  // Phase 418 — unified swing validation gate. Set to FALSE when the
  // frames contain no analyzable swing (no person, camera pointed at
  // floor, footage too dark, person fully out of frame). Downstream
  // consumers (pose overlay, metrics, insight card) gate fabrication
  // on this single signal. When false, validity_reason carries the
  // human-readable reason ("no player in frame", "camera pointed at
  // floor", etc.). Defaults true on missing/legacy fields for
  // backward compatibility — the client also runs a heuristic
  // fallback on observation text.
  valid_swing?: boolean;
  validity_reason?: string | null;
  // 2026-05-24 — Layman translation. Plain-language explanation of the
  // detected_issue produced in the SAME call so the result card can
  // surface a progressive-disclosure "What does this mean?" toggle
  // without a re-run. Optional so legacy clients ignore it gracefully;
  // the new client hides the affordance entirely when this is absent
  // or empty. Quality bar enforced by the SYSTEM_PROMPT below.
  layman_explanation?: string;
};

// Phase BL/U1 — Tentative observation mode. Used by the upload pipeline
// fallback path when the primary 5-frame full-analysis call returns no
// usable results (no_frames / no_network / error / classifier null).
// The relaxed prompt asks for general descriptive observation only —
// tempo, balance, contact appearance — without claiming specific
// biomechanical faults. Always returns confidence: 'low' and
// detected_issue: 'none' (the client treats this distinctly and
// surfaces it as a tentative read with retry suggestion).
const TENTATIVE_PROMPT = `You are looking at 1-2 frames from a golf swing video that was uploaded for analysis. The full-analysis pipeline could not produce a confident swing-fault read for these frames (lighting, angle, blur, or partial visibility). Your job is to give the player ONE useful tentative observation about what you can see — without claiming a specific biomechanical fault.

Output ONLY a JSON object:
{
  "detected_issue": "none",
  "severity": "none",
  "confidence": "low",
  "observation": "<one short sentence describing what is visible — tempo, balance, contact appearance, posture — written conversationally as the caddie would say it>",
  "follow_up_question": "<short suggestion for a clearer recording, e.g. 'Try a wider angle from the front so I can see your hips' OR null when the frames are workable enough that a clearer recording isn't the priority>"
}

Rules:
- detected_issue must be "none". Do NOT pick a canonical issue. The full pipeline already failed to confirm one — naming a specific fault here would be a false read.
- severity must be "none". Same reason.
- confidence must be "low". Surfaces the tentative-read prefix in the UI.
- observation: a single helpful sentence about what IS visible. Examples: "Your tempo looks smooth through the back, but I lost you at the top." / "Balance looks centered at address, hard to tell at impact." / "I can see contact, but the angle's clipping your hands."
- follow_up_question: when the recording is plainly fixable (bad angle, darkness), suggest the fix. Otherwise null.
- Never fabricate specifics. Only what's actually observable.
- Output ONLY valid JSON. No code fences, no preamble.`;

// Phase 502 — putt/chip-specific analysis prompt. Triggered when the
// client passes context.swing_tag === 'putt' or 'chip'. The canonical
// full-swing fault catalog doesn't apply to short-game motions — head
// stability, shoulder rock, tempo, and contact location are the
// load-bearing reads instead. Returns the same JSON shape so the
// downstream pipeline doesn't fork.
const PUTT_SYSTEM_PROMPT = `You are a short-game analyst looking at 1-5 frames from a putt or chip recorded by the player. Full-swing fault language ("over the top", "early extension") does NOT apply here — putts and chips are pendulum motions with different load-bearing reads.

For PUTTS, focus on (in priority order):
1. Head stability — eyes/head should stay still through impact. Movement = loss of strike point.
2. Shoulder rock — arc shape and symmetry; back-stroke and through-stroke proportions roughly equal.
3. Lower-body quiet — hips should not rotate; leg movement = scoop tendency.
4. Putter-face squareness at address vs at impact (when visible).
5. Length of stroke matched to distance (only if you can see follow-through length relative to back-stroke).

For CHIPS, focus on:
1. Ball-position consistency — back foot vs middle of stance.
2. Wrist hinge — minimal for bump-and-run, more hinge for higher landing.
3. Sternum stays over or slightly ahead of ball at impact (no scoop).
4. Lower body quiet, weight on lead side.
5. Follow-through length relative to back-stroke (controlled tempo).

Output ONLY a JSON object using the SAME schema as full-swing analysis so the downstream pipeline doesn't fork:
{
  "detected_issue": "none" | "early_extension" | "reverse_pivot" | "chicken_wing" | "<one of the canonical full-swing issues that ALSO maps to short game, otherwise 'none'>",
  "severity": "minor" | "moderate" | "significant" | "none",
  "confidence": "high" | "medium" | "low",
  "observation": "<one short sentence in the caddie's voice describing the most actionable read — short-game language, NOT full-swing jargon. e.g. 'Your head moves with the stroke — that's pulling your strike point off the sweet spot.' or 'Lovely arc, tempo's a beat slow on the back — try matching back and through.' >",
  "fault_frame_index": <integer index or -1>,
  "follow_up_question": null
}

Rules:
- detected_issue: prefer 'none' for putts/chips unless a full-swing issue is genuinely visible. The observation field is where the real value lives.
- observation MUST be in short-game language. Never say "swing path outside-in" on a putt — that's a tee shot read.
- Voice: when caddie_name is provided, use that cadence (Tank clipped, Kevin neutral, Serena precise, Harry warm).
- Output ONLY valid JSON. No code fences, no preamble.`;

const SYSTEM_PROMPT = `You are a swing analyst looking at golf-swing frames captured during a Cage Session. The player wants honest swing-fault classification, not encouragement.

You will see 1-5 frames from a single swing. Identify the most prominent tendency you can see and return it with appropriate confidence. Use the confidence scale to express uncertainty — a low-confidence tendency is more useful than 'none', because the player can confirm or rule it out.

TEMPORAL ANALYSIS — CRITICAL. Read this block carefully; previous outputs anchored on the first frame and missed the actual swing.

- The frames you are given are sampled in CHRONOLOGICAL ORDER across ONE golf swing. Frame 1 (index 0) is the EARLIEST in time; the last frame is the LATEST. The intended sampling is roughly address → takeaway → top / transition → impact → follow-through, in that order.
- You MUST analyze the swing as MOTION, not as a single still. Describe what CHANGES from frame to frame: where the club starts vs. where it ends, how the hips/shoulders/weight shift across the sequence, what happens at transition, what impact looks like, where the follow-through finishes. Your fault diagnosis MUST be supported by what changes across the later frames — not by the appearance of frame 1 alone.
- Frame 1 is frequently the LEAST informative frame. It may show only the player at address with no swing motion yet, OR — in a POV / glasses-down recording or a botched camera angle — it may show the GROUND, the player's feet, the cart path, the tee box surface, or empty turf with no body visible. NEVER base your diagnosis on frame 1 alone. If frame 1 is uninformative (ground, feet, empty scenery, address-only with no other reads available from it), say so briefly in the observation and base your read on the frames that actually show the swing.
- When a fault is visible (over-the-top transition, early extension at impact, hip slide on the downswing, reverse pivot, etc.), name WHICH frame index(es) show the fault clearly. The fault_frame_index field below should point to the single most diagnostic frame; if the fault progresses across multiple frames, pick the one where it is most visually obvious so the player has a clean visual anchor.
- If only the address frame is informative because the later frames are blurry/cropped/unreadable, the correct response is LOW confidence with an observation that says so honestly — not a confident fault claim built from address alone.

FIRST — VALIDITY GATE (Phase 418). Before classifying any fault, decide whether the frames actually contain an analyzable swing. **Default to valid_swing=true when in any doubt.** The user just intentionally recorded a swing — false-negatives ("no swing detected" on a real swing) are a HARSH bug. False-positives (analyzing a non-swing) are recoverable. Lean permissive.
- valid_swing: true if a person is visible in AT LEAST ONE frame AND the footage plausibly shows ANY part of a golf swing — address stance, takeaway, top of backswing, transition, downswing, impact, or follow-through. ONE clear swing frame is enough (e.g. a person at the top of the backswing holding a club). Practice-net / driving-range / hitting-cage settings are FULLY VALID even with netting partially in front of the player, no visible ball flight, harsh outdoor lighting, or a target panel behind the player. Any camera angle (down-the-line, face-on, behind, three-quarter) is valid. Players wearing dark clothing against busy backgrounds are valid. A single mid-swing frame with the club above shoulder height + visible body = valid.
- valid_swing: false ONLY when there is genuinely zero usable read: NO person in ANY frame, OR the camera is pointed entirely elsewhere (floor / sky / wall / inside of pocket), OR footage is so dark / blurred / motion-smeared that no human shape is recognizable in ANY frame. Do NOT mark false because: netting is in front of the subject, no ball is visible, the swing is at a non-standard angle, only the player's torso/arms are in frame, or only one frame catches the actual swing motion. None of those are reasons.
- When valid_swing is false: set detected_issue='none', severity='none', confidence='low', fault_frame_index=-1, and write a brief validity_reason describing what's missing ("No player visible in any frame", "Camera pointed at the floor", "Footage too dark to read", etc.). The observation field should match the validity_reason in the caddie's voice.
- Never fabricate a fault when valid_swing is false. Downstream UI will skip the pose overlay and metrics entirely.

When you identify a fault, also identify WHICH of the submitted frames most clearly shows it. The frames are submitted in time order from address through follow-through — index 0 is the earliest frame, the last index is the latest. The user will see the frame at that index as visual evidence of the diagnosis, so pick the frame that most clearly displays the named tendency.

Canonical issues (pick the one that best matches what you see):
- club_face_open: clubface looks open at or near impact
- club_face_closed: clubface looks closed at or near impact
- swing_path_outside_in: club approaches from outside the target line (slice tendency)
- swing_path_inside_out: club approaches from inside the target line (hook tendency)
- attack_angle_steep: descending angle into the ball (chopping down)
- attack_angle_shallow: sweeping or ascending angle (no compression)
- early_extension: hips moving toward ball at impact (loss of posture)
- over_the_top: club drops over plane on transition
- chicken_wing: lead arm bends through impact
- reverse_pivot: weight shifts backward on downswing
- none: ONLY use this when frames are unreadable (player not visible, blur, occlusion) AND no other tendency is even partially visible

Severity scale:
- minor: tendency present but not consistent
- moderate: clear pattern, contributing to misses
- significant: dominant fault driving the swing

Confidence scale (pick honestly — low-confidence is fine and useful):
- high: frames are clear, fault is obvious across multiple frames
- medium: pattern visible but partially obscured, or visible in only one frame
- low: tendency is suggested but evidence is thin (still name it; explain in observation)

PRIMARY FAULT — structured GolfFix-style output, EVIDENCE-GATED (CRITICAL — S1.1 calibration pass).

Before naming any primary_fault, you MUST follow this procedure. Faults named without following it are a false read.

STEP 1 — PHASE-BY-PHASE OBSERVATION (do this in your reasoning before the JSON).
For the frames you can see, describe what is OBSERVABLE at each phase. Skip a phase if it isn't captured. Be concrete — what's visible, not what you'd expect:
- Address: posture / weight distribution / grip if visible
- Backswing or top of swing: shoulder turn, hip turn, weight shift, shaft position
- Transition / downswing start: where does the club move FIRST — out, under, or steep?
- Impact: spine angle vs. address (maintained? lost? extended?), hip position relative to address, lead-arm extension, head position
- Follow-through / finish: balance, weight transfer, finish position
This phase pass is your evidence base. The fault you name must be supported by what you observed — NOT by prior expectation of what's common.

STEP 2 — DIFFERENTIAL.
From the phase observation, identify the TOP 2 faults from the allowlist below that the observed evidence could support. Note WHICH frame each candidate would be visible in. Then pick the one with the STRONGEST frame-specific evidence — the candidate where you can point at a specific frame and say "you can see X happening here."

STEP 3 — EVIDENCE-GATED SELECTION.
A fault name is EARNED, not defaulted. Every fault — including early_extension — requires concrete, named, frame-specific evidence:
- early_extension requires visible spine-angle loss (player is more upright at impact than at address) OR visible hip thrust toward the ball at impact. NOT a default. If you cannot point to spine-angle loss or hip thrust in a specific frame, do NOT name early_extension.
- over_the_top requires the club traveling OUT and OVER on transition — visible in a frame between top and downswing.
- casting requires the lead wrist hinge releasing early — wrist angle in transition frame vs. impact frame.
- (Same evidence bar for every other entry below.)
If no fault has clean frame-specific evidence, return primary_fault = "no_dominant_fault" — see STEP 5.

STEP 4 — ALLOWED PRIMARY_FAULT VALUES.
- over_the_top: the club moves OUT and OVER the swing plane on transition from the top
- early_extension: hips/spine push toward the ball during the downswing (loss of posture at impact) — EVIDENCE REQUIRED, not default
- casting: lead wrist hinge releases early in the downswing (loss of lag)
- sway: lateral hip slide AWAY from the target during the backswing (vs. centered rotation)
- reverse_pivot: weight stays on lead foot at top, shifts to trail foot through impact
- chicken_wing: lead arm bends/folds through impact instead of extending
- plane_too_flat: shaft tracks well below the ideal plane through transition and downswing
- plane_too_steep: shaft tracks well above the ideal plane through transition and downswing
- head_movement: notable lateral or vertical head shift across the sequence
- spine_angle_loss: posture / spine angle straightens during the downswing
- no_dominant_fault: frames are READABLE, but NO single fault has strong frame-specific evidence. Use this when you saw the swing but nothing dominates — possibly a clean swing with one area to refine, possibly multiple minor tendencies none dominant, possibly a genuine strength worth naming. NOT a cop-out — a legitimate outcome.
- inconclusive: footage genuinely cannot be read (validity_reason already triggered, frames blur/dark/cropped, no person visible at the critical phases).

STEP 5 — STRUCTURED OUTPUT.
For diagnostic primary_fault values (anything other than 'inconclusive'):
- cause: ONE sentence — WHY this player is doing this fault based on what you see. Specific to THIS swing, not a textbook definition. For no_dominant_fault, cause names the strongest tendency observed OR a genuine strength to keep building on.
- fix: ONE concrete swing-cue change. Imperative. Specific. Avoid jargon. For no_dominant_fault, fix names the strongest area to work on next.
- drill: ONE specific drill the player can do at the range or mirror to groove the fix. For no_dominant_fault, drill names a maintenance / consistency drill OR a drill targeting the named tendency.
- evidence: REQUIRED — string in the format "Frame N: <what's visible>" citing the specific frame and the visible cue that earned the call. E.g. "Frame 3: spine angle is noticeably more upright than at frame 0; hips have moved toward the ball." For no_dominant_fault, evidence cites the strongest tendency observed even though it didn't rise to a dominant fault.

When primary_fault is 'inconclusive': cause/fix/drill/evidence MUST be empty strings "". The honest read is "I'm not sure yet — record a clearer angle / another swing and I'll have more to say." That message goes in observation, NOT in fix/drill.

EXPLICIT ANTI-DEFAULT GUARDRAIL: early_extension is the most common fault in golf instruction content and tempting as a safe pick. Do NOT name it without explicit evidence of spine-angle loss OR hip thrust toward the ball in a SPECIFIC FRAME. If the only visible evidence is "swing looks like an amateur swing," return no_dominant_fault. The player gets more value from "no dominant fault, work on tempo" than from a fabricated early_extension call.

Output ONLY a JSON object:
{
  "valid_swing": true | false,
  "validity_reason": "<null when valid_swing is true; otherwise a short reason string e.g. 'No player visible in any frame' or 'Camera pointed at the floor'>",
  "detected_issue": "<one of the canonical issues>",
  "severity": "minor" | "moderate" | "significant" | "none",
  "confidence": "high" | "medium" | "low",
  "observation": "<one short sentence describing what was actually visible — no advice, just observation>",
  "fault_frame_index": <0-based integer index into the submitted frames identifying the single most diagnostic frame for the detected issue, or -1 if no specific frame stood out>,
  "follow_up_question": "<short retake suggestion ONLY when frames are genuinely unreadable; else null>",
  "layman_explanation": "<plain-language translation of the detected_issue per the EXPLAIN rules below — see quality bar. Empty string '' when detected_issue is 'none'.>",
  "primary_fault": "<one of the PRIMARY_FAULTS values; use 'no_dominant_fault' for readable-but-no-dominant; use 'inconclusive' only when footage is genuinely unreadable>",
  "cause": "<one sentence specific to THIS swing. For no_dominant_fault: strongest tendency observed or a genuine strength. Empty string '' only when primary_fault is 'inconclusive'.>",
  "fix": "<one concrete imperative swing cue. For no_dominant_fault: strongest area to work on next. Empty string '' only when primary_fault is 'inconclusive'.>",
  "drill": "<one specific actionable drill. For no_dominant_fault: maintenance/consistency drill or one targeting the named tendency. Empty string '' only when primary_fault is 'inconclusive'.>",
  "evidence": "<string in the format 'Frame N: <what is visible that earned the call>'. REQUIRED for every diagnostic primary_fault including no_dominant_fault. Empty string '' only when primary_fault is 'inconclusive'.>"
}

EXPLAIN — layman_explanation quality bar (CRITICAL).
Most of this app's users are higher-handicap golfers. "Early extension" lands as noise to them and the diagnosis gets lost. The expert term stays the headline of the card (kept for trust); your job in layman_explanation is to TRANSLATE the term into something a beginner reads once and understands. Rules:

- 1-2 sentences. Second person ("you"). Encouraging cadence, never condescending.
- Stay in the active caddie's voice (Kevin / Serena / Tank / Harry per Caddie voice context). Default Kevin neutral when no voice is set.
- MUST contain BOTH (a) what the fault FEELS or LOOKS like in plain body terms, AND (b) the common MISS it causes — the bad shot the golfer already knows (thin, fat, slice, pull, push, lost distance, weak contact, etc.).
- NO biomechanical jargon. Do NOT define or rephrase the technical term using its own words.
- FORBIDDEN (circular and useless): "Early extension means your hips and spine extend early." That just repeats the term — it teaches nothing.
- TARGET shape: "You're standing up out of your posture coming into the ball — that's what's behind your thin shots and the distance you're leaving out there."
- Stay consistent with the paired detected_issue + observation. Same fault, plain words.
- When detected_issue is 'none' OR valid_swing is false, return an empty string "" — there's nothing to translate.
- When confidence is 'low' the translation should still land, but soften slightly ("You might be ...", "It looks like you may be ..."). Do not abandon the field on low confidence.

EXAMPLES (use these as the bar — do NOT copy verbatim):
- early_extension → "You're standing up out of your posture coming into the ball. That's the thin shots and the lost distance you're feeling."
- over_the_top → "Your club is coming around your body from outside the line before it drops in — that's the slice or the pull you keep fighting."
- club_face_open → "Your clubface is pointing right of where you're aiming at impact — that's the high weak slice that costs you yards."
- chicken_wing → "Your lead arm is folding through impact instead of extending — that's the thin contact and the loss of compression on your irons."
- reverse_pivot → "Your weight stays on your front foot at the top and finishes on your back foot — that's the inconsistent contact and the lost power."

Rules:
- Default to NAMING what you see at low confidence rather than returning 'none'. The player can rule out a low-confidence read; they cannot act on silence.
- 'none' is reserved for: unreadable frames OR a swing that genuinely looks clean across all 5 frames (no recognizable tendency at all).
- The observation field is the single sentence the user will hear ("Your hips are moving toward the ball through impact"). Specific, factual, no jargon.
- fault_frame_index: when detected_issue is anything other than 'none', return the integer index of the frame that most clearly shows the tendency. When detected_issue is 'none', return -1.
- Voice / cadence: when a caddie name is provided in the user context, write the observation in that caddie's voice. Tank = clipped imperative, military cadence ("Weight's hanging back at impact. Not acceptable."). Kevin = neutral conversational technical ("Your weight is still on your back foot at impact"). Serena = precise instructor ("At impact your weight has not transferred forward — about 60 percent still on the trail side"). Harry = warm encouraging ("I can see you're hanging back a bit at impact — that's a common one"). Default (no caddie_name) = neutral technical.
- Personalization: when player_context is provided, tailor the read. Higher handicap (≥20) — favor plain language, biggest single fault; do NOT pile on. Lower handicap (≤10) — get technical, name secondary tendencies. When dominant_miss is named (e.g. "slice"), bias your priority toward the fault most consistent with that miss pattern. When experience signals beginner, skip jargon. Default (no player_context) = neutral technical.
- Output ONLY valid JSON. No code fences, no preamble.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const frames = (body.frames ?? []) as { b64: string; media_type?: string }[];
    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'frames[] (1-5 base64 images) required' });
    }
    if (frames.length > 5) {
      return res.status(400).json({ error: 'maximum 5 frames per swing' });
    }
    const totalSize = frames.reduce((acc, f) => acc + (f.b64?.length ?? 0), 0);
    if (totalSize > 9_000_000) {
      return res.status(413).json({ error: 'frames too large; resize each to ~1024px on long edge' });
    }

    const ctx = (body.context ?? {}) as Record<string, unknown>;
    const mode = (body.mode === 'tentative' ? 'tentative' : 'analysis') as 'analysis' | 'tentative';
    const ctxLines: string[] = [];
    if (ctx.club) ctxLines.push(`Club: ${ctx.club}`);
    if (ctx.swing_number != null) ctxLines.push(`Swing ${ctx.swing_number} of session`);
    if (ctx.prior_issues && Array.isArray(ctx.prior_issues) && ctx.prior_issues.length > 0) {
      ctxLines.push(`Prior swings showed: ${(ctx.prior_issues as string[]).join(', ')}`);
    }
    // 2026-05-24 — Reanalyze "look for something else" directive. Set
    // by services/videoUpload.ts when the user re-fires analysis on a
    // clip that already produced a primary_fault. Confirm the prior
    // call honestly if the evidence is still there, but actively
    // consider non-matching faults this pass — a recurring call should
    // not become a default if the evidence is thin or the picture has
    // more than one story to tell.
    if (typeof ctx.prior_analyzed_fault === 'string' && ctx.prior_analyzed_fault.length > 0) {
      ctxLines.push(
        `REANALYZE PASS — The user re-fired analysis on this same clip. The prior call was: ${ctx.prior_analyzed_fault}. ` +
        `Confirm it ONLY if the frame-specific evidence is still clearly present this pass. Otherwise actively consider non-${ctx.prior_analyzed_fault} candidates from the allowlist — the player asked for a fresh read, so prioritize broadening the picture over repeating the prior name. Never name ${ctx.prior_analyzed_fault} again without clean evidence.`,
      );
    }
    if (typeof ctx.caddie_name === 'string' && ctx.caddie_name.trim().length > 0) {
      ctxLines.push(`Caddie voice: ${ctx.caddie_name.trim()}`);
    }
    // 2026-05-21 — Fix E: thread the player's selected language into
    // the swing-analysis prompt so the observation text comes back in
    // the right language. Previously the analyst always wrote
    // English regardless of settings. Same hard-enforcement pattern
    // /api/kevin uses.
    const language = typeof ctx.language === 'string' ? ctx.language.toLowerCase() : 'en';
    if (language === 'es') {
      ctxLines.push('CRITICAL: Write the `observation` and `follow_up_question` fields in Spanish (español). The detected_issue / severity / confidence enum values stay in English (they are machine identifiers).');
    } else if (language === 'zh') {
      ctxLines.push('CRITICAL: Write the `observation` and `follow_up_question` fields in Chinese (中文). The detected_issue / severity / confidence enum values stay in English (they are machine identifiers).');
    }
    // Phase 502 — player_context. When the client passes profile fields
    // (handicap, dominant_miss, experience), the analyst tailors the
    // read. This was Tim's "every golfer gets the same analysis" finding.
    if (ctx.player_context && typeof ctx.player_context === 'object') {
      const pc = ctx.player_context as Record<string, unknown>;
      if (typeof pc.handicap === 'number' && Number.isFinite(pc.handicap)) {
        ctxLines.push(`Player handicap: ${pc.handicap}`);
      }
      if (typeof pc.dominant_miss === 'string' && pc.dominant_miss.trim().length > 0) {
        ctxLines.push(`Known dominant miss: ${pc.dominant_miss.trim()}`);
      }
      if (typeof pc.experience === 'string' && pc.experience.trim().length > 0) {
        ctxLines.push(`Player experience: ${pc.experience.trim()}`);
      }
      if (typeof pc.first_name === 'string' && pc.first_name.trim().length > 0) {
        ctxLines.push(`Player first name: ${pc.first_name.trim()}`);
      }
    }
    // Phase 502 — swing_tag routes putt/chip uploads to PUTT_SYSTEM_PROMPT
    // (short-game-specific reads) instead of full-swing fault classification.
    const swingTag = typeof ctx.swing_tag === 'string' ? ctx.swing_tag.toLowerCase() : '';
    const isShortGame = swingTag === 'putt' || swingTag === 'chip';
    if (isShortGame) {
      ctxLines.push(`Shot type: ${swingTag}`);
    }
    // 2026-05-21 — Fix B: camera angle is chosen BEFORE recording and
    // routed in so biomechanical reads use the correct orientation.
    // Down-the-line view = camera behind the player looking down the
    // target line (clearest for path / plane / over-the-top / early
    // extension). Face-on view = camera in front of the player
    // perpendicular to the target line (clearest for weight shift /
    // hip rotation / reverse pivot / sway). The two angles expose
    // different fault patterns; reading the wrong angle gives the
    // wrong diagnosis. Defaults to down-the-line when omitted (the
    // most common swing-analysis convention).
    const angleRaw = typeof ctx.angle === 'string' ? ctx.angle.toLowerCase() : '';
    // 2026-05-22 audit refinement — accept 'glasses_pov' for Meta-glasses
    // first-person down-look (the player is wearing the camera; no torso
    // visible). The constraint set is totally different: we can read
    // grip, takeaway path, impact-zone contact, and follow-through arc,
    // but body-rotation diagnostics (hip turn, weight shift, spine
    // angle) are impossible without the torso in frame. The prompt
    // calls that out explicitly so the analyst leans on the reads it
    // CAN make and doesn't hallucinate body-pattern faults.
    const angle: 'down_the_line' | 'face_on' | 'glasses_pov' =
      angleRaw === 'face_on' || angleRaw === 'face-on' || angleRaw === 'faceon'
        ? 'face_on'
      : angleRaw === 'glasses_pov' || angleRaw === 'glasses-pov' || angleRaw === 'pov'
        ? 'glasses_pov'
        : 'down_the_line';
    const angleLabel =
      angle === 'down_the_line' ? 'down-the-line'
      : angle === 'face_on'     ? 'face-on'
      :                           'first-person (glasses POV)';
    ctxLines.push(
      `Camera angle: ${angleLabel}. ` +
      (angle === 'down_the_line'
        ? 'Camera is behind the player on the target line. Best reads from this angle: swing path, plane, over-the-top, early extension, attack angle, club position at the top. Do NOT confidently diagnose weight-shift / reverse-pivot / hip-sway from this angle — those need face-on.'
        : angle === 'face_on'
        ? 'Camera is in front of the player, perpendicular to the target line. Best reads from this angle: weight shift, hip rotation, reverse pivot, sway, head movement, posture maintenance. Do NOT confidently diagnose swing path / plane / over-the-top from this angle — those need down-the-line.'
        : 'Camera is on the player\'s head (Meta-glasses first-person POV). No torso is visible. Best reads from this angle: grip, takeaway path direction, impact-zone contact, follow-through arc, and ball-flight start direction if visible. Do NOT diagnose body-rotation patterns (hip turn, weight shift, spine angle, shoulder coil) from this angle — the torso is out of frame and any body-pattern claim would be a guess. When the visible cues do not support a confident fault read, return mode="tentative" with a useful observation.')
    );
    const userText = mode === 'tentative'
      ? (ctxLines.length > 0 ? ctxLines.join('\n') + '\n\n' : '') +
        `These ${frames.length} frame${frames.length === 1 ? '' : 's'} are from a swing where the full-analysis pipeline could not confirm a fault. Give a tentative observation only — no canonical fault claim. Return JSON per the schema.`
      : (ctxLines.length > 0 ? ctxLines.join('\n') + '\n\n' : '') +
        `Look at the ${frames.length} frame${frames.length === 1 ? '' : 's'} from this swing. Classify the primary fault, return JSON.`;

    const userContent = [
      ...frames.map(f => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (f.media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: f.b64,
        },
      })),
      { type: 'text' as const, text: userText },
    ];

    // 2026-05-24 (BUG #1 fix) — Telemetry: surface the real count of
    // image blocks Sonnet receives, alongside the text-block count.
    // Pairs with the client-side V6 log at poseDetection.ts:299 so the
    // pipeline is self-verifying on every real run: if a future
    // regression collapses multi-frame input at this boundary, the
    // mismatch (client posted 5, server saw 1) will be visible without
    // any synthetic test. Additive, zero behavior change.
    const imageBlocks = userContent.filter(b => b.type === 'image').length;
    const textBlocks = userContent.filter(b => b.type === 'text').length;
    console.log('[swing-analysis] image blocks ->',
      imageBlocks,
      '· text blocks ->',
      textBlocks,
      '· mode ->', mode,
      '· short_game ->', isShortGame);

    const systemPrompt = mode === 'tentative'
      ? TENTATIVE_PROMPT
      : isShortGame
        ? PUTT_SYSTEM_PROMPT
        : SYSTEM_PROMPT;

    // 2026-05-26 — Fix AR Phase 2: Anthropic primary, OpenAI gpt-4o
    // fallback. Tim's complaint: "we have Anthropic and OpenAI behind
    // it — no reason it should one, not work, and number two, take
    // this long." The 60s Vercel timeout (Phase 1, Batch 21) was the
    // headline relief; this is the resilience layer that keeps the
    // analysis answering on Anthropic 5xx / overloaded / network /
    // empty / non-JSON. Both providers route through the SAME
    // normalizer + safety gates below so the response contract is
    // identical regardless of which model produced it.
    let text = '';
    let providerUsed: 'anthropic' | 'openai' | 'gemini' = 'anthropic';
    let anthropicError: string | null = null;
    try {
      const completion = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
      const block = completion.content.find(c => c.type === 'text');
      text = block && block.type === 'text' ? block.text.trim() : '';
      if (!text) {
        anthropicError = 'empty_response';
      }
    } catch (e) {
      anthropicError = e instanceof Error ? e.message : 'unknown';
      console.warn('[swing-analysis] anthropic primary failed:', anthropicError);
    }

    // OpenAI fallback when Anthropic threw OR returned empty. Only
    // attempted when OPENAI_API_KEY is configured — otherwise the
    // upstream failure surfaces as a real 502 like before.
    let openaiError: string | null = null;
    if (!text && process.env.OPENAI_API_KEY) {
      try {
        const openaiContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          ...frames.map(f => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${f.media_type ?? 'image/jpeg'};base64,${f.b64}`,
              // 2026-05-26 — `high` detail is closer to Anthropic
              // Sonnet's default fidelity for body / club reads. The
              // marginal cost is worth it; we only hit this path when
              // the primary already failed.
              detail: 'high' as const,
            },
          })),
          { type: 'text' as const, text: userText },
        ];
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 600,
          temperature: 0.2,
          // gpt-4o honors response_format json_object when "json" is
          // present in the system prompt — our SYSTEM/PUTT/TENTATIVE
          // prompts all explicitly say "Output ONLY valid JSON".
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: openaiContent },
          ],
        });
        text = (oai.choices[0]?.message?.content ?? '').trim();
        providerUsed = 'openai';
        console.log('[swing-analysis] openai fallback succeeded after anthropic:', anthropicError);
      } catch (oaiErr) {
        openaiError = oaiErr instanceof Error ? oaiErr.message : 'unknown';
        console.warn('[swing-analysis] openai fallback failed:', openaiError);
      }
    }

    // 2026-05-26 — Fix AT: Gemini 2.5 Flash as third resilience layer.
    // Tried when both Anthropic AND OpenAI returned empty / threw, but
    // only when GOOGLE_API_KEY is configured. The Bryson-DeChambeau-ad
    // model — having it in the chain means the pipeline survives
    // simultaneous OpenAI + Anthropic incidents (real risk: both
    // share underlying GPU capacity at peak).
    let geminiError: string | null = null;
    if (!text && gemini) {
      try {
        const geminiContent = [
          { text: systemPrompt + '\n\n' + userText },
          ...frames.map(f => ({
            inlineData: {
              mimeType: f.media_type ?? 'image/jpeg',
              data: f.b64,
            },
          })),
        ];
        const gem = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: geminiContent }],
          config: {
            temperature: 0.2,
            maxOutputTokens: 600,
            responseMimeType: 'application/json',
          },
        });
        text = (gem.text ?? '').trim();
        providerUsed = 'gemini';
        console.log('[swing-analysis] gemini fallback succeeded after anthropic+openai:',
          { anthropic: anthropicError, openai: openaiError });
      } catch (gemErr) {
        geminiError = gemErr instanceof Error ? gemErr.message : 'unknown';
        console.error('[swing-analysis] gemini fallback also failed:', geminiError);
      }
    }

    if (!text) {
      // All configured providers failed. Surface every reason so the
      // client toast and ops can see exactly what happened.
      return res.status(502).json({
        error: 'All providers failed',
        anthropic_error: anthropicError,
        openai_error: openaiError,
        gemini_error: geminiError,
      });
    }

    let parsed: SwingAnalysisResponse;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(cleaned) as SwingAnalysisResponse;
    } catch {
      return res.status(502).json({
        error: 'Model returned non-JSON',
        provider: providerUsed,
        raw: text.slice(0, 300),
      });
    }

    if (!CANONICAL_ISSUES.includes(parsed.detected_issue)) {
      parsed.detected_issue = 'none';
    }
    if (!['minor', 'moderate', 'significant', 'none'].includes(parsed.severity)) {
      parsed.severity = 'none';
    }
    if (!['high', 'medium', 'low'].includes(parsed.confidence)) {
      parsed.confidence = 'low';
    }
    if (typeof parsed.observation !== 'string') parsed.observation = '';
    // Phase 418 — validity gate normalisation. Default to true (legacy
    // responses without the field assume valid). When valid_swing is
    // false, force detected_issue/severity/fault_frame so downstream
    // consumers can't accidentally render a fault diagnosis on
    // no-swing footage.
    if (typeof parsed.valid_swing !== 'boolean') {
      parsed.valid_swing = true;
    }
    if (parsed.valid_swing === false) {
      parsed.detected_issue = 'none';
      parsed.severity = 'none';
      parsed.fault_frame_index = -1;
      if (typeof parsed.validity_reason !== 'string' || parsed.validity_reason.length === 0) {
        parsed.validity_reason = 'No analyzable swing detected in the frames.';
      }
    } else {
      parsed.validity_reason = null;
    }
    // Phase 403b — normalise fault_frame_index. Must be an integer in
    // [0, frames.length-1] or -1 (no specific frame stood out). Any
    // out-of-range value falls back to -1.
    if (typeof parsed.fault_frame_index !== 'number' || !Number.isInteger(parsed.fault_frame_index)) {
      parsed.fault_frame_index = -1;
    } else if (parsed.fault_frame_index < -1 || parsed.fault_frame_index >= frames.length) {
      parsed.fault_frame_index = -1;
    }

    // Phase BL/U1 — tentative mode forcibly normalises detected_issue and
    // severity so a creative model response can't accidentally produce a
    // canonical-fault claim from the relaxed prompt.
    if (mode === 'tentative') {
      parsed.detected_issue = 'none';
      parsed.severity = 'none';
      parsed.confidence = 'low';
      parsed.fault_frame_index = -1;
    }

    // 2026-05-24 — Layman explanation normalisation. Coerce missing /
    // non-string to empty string so the client-side "hide affordance
    // when absent" rule has a single contract to check. Force empty
    // when there's no fault to translate.
    if (typeof parsed.layman_explanation !== 'string') {
      parsed.layman_explanation = '';
    }
    if (parsed.detected_issue === 'none' || parsed.valid_swing === false) {
      parsed.layman_explanation = '';
    }

    // 2026-05-24 — GolfFix #1 + S1.1 normalisation. primary_fault must be
    // in the PRIMARY_FAULTS allowlist; anything else → 'inconclusive'.
    // cause/fix/drill/evidence must be non-empty strings for any
    // diagnostic primary_fault (including no_dominant_fault); force
    // empty for inconclusive. valid_swing=false → inconclusive
    // unconditionally. The evidence field is the S1.1 calibration gate
    // — diagnostic faults must cite a frame-specific cue or the read
    // collapses to no_dominant_fault (not inconclusive — the frames
    // were readable, the model just didn't pin a dominant pattern).
    if (typeof parsed.primary_fault !== 'string' || !PRIMARY_FAULTS.includes(parsed.primary_fault as PrimaryFault)) {
      parsed.primary_fault = 'inconclusive';
    }
    if (parsed.valid_swing === false) {
      parsed.primary_fault = 'inconclusive';
    }
    // Coerce strings; trim and bail on accidental whitespace-only.
    const coerceStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    parsed.cause = coerceStr(parsed.cause);
    parsed.fix = coerceStr(parsed.fix);
    parsed.drill = coerceStr(parsed.drill);
    parsed.evidence = coerceStr(parsed.evidence);
    if (parsed.primary_fault === 'inconclusive') {
      parsed.cause = '';
      parsed.fix = '';
      parsed.drill = '';
      parsed.evidence = '';
    }
    // Defensive: if model named a diagnostic fault (including
    // no_dominant_fault) but didn't cite evidence OR didn't fill
    // cause/fix/drill, downgrade to no_dominant_fault (frames were
    // readable but the structured payload is incomplete) — preserves
    // honesty without collapsing all the way to inconclusive. If
    // cause/fix/drill are also missing, collapse to inconclusive.
    if (parsed.primary_fault !== 'inconclusive' && parsed.primary_fault !== 'no_dominant_fault') {
      const missingEvidence = parsed.evidence.length === 0;
      const missingPayload = parsed.cause.length === 0 || parsed.fix.length === 0 || parsed.drill.length === 0;
      if (missingEvidence && missingPayload) {
        parsed.primary_fault = 'inconclusive';
        parsed.cause = '';
        parsed.fix = '';
        parsed.drill = '';
        parsed.evidence = '';
      } else if (missingEvidence || missingPayload) {
        // Demote to no_dominant_fault but keep whatever the model did
        // produce so the card still surfaces useful information.
        parsed.primary_fault = 'no_dominant_fault';
      }
    }
    // no_dominant_fault still needs cause/fix/drill — if missing,
    // collapse to inconclusive (a no-dominant call with no actionable
    // payload is just inconclusive in disguise).
    if (parsed.primary_fault === 'no_dominant_fault' &&
        (parsed.cause.length === 0 || parsed.fix.length === 0 || parsed.drill.length === 0)) {
      parsed.primary_fault = 'inconclusive';
      parsed.cause = '';
      parsed.fix = '';
      parsed.drill = '';
      parsed.evidence = '';
    }

    // 2026-05-24 — Owner-tool telemetry echo. The server returns the
    // REAL count of image / text blocks it just sent to Sonnet so the
    // in-app debug screen can prove the whole pipe end-to-end
    // (frames sent client-side === blocks server saw). Same values
    // already logged at the messages.create call above. Existing
    // consumers ignore unknown fields; no schema change to the
    // analysis itself.
    return res.status(200).json({
      ...parsed,
      _debug: {
        imageBlocks,
        textBlocks,
        mode,
        shortGame: isShortGame,
        // 2026-05-26 — Fix AR Phase 2 telemetry. Surface which model
        // produced the answer + the Anthropic failure reason when we
        // fell back, so the in-app debug screen can show resilience
        // events in the wild without server-log access.
        provider: providerUsed,
        fallback_reason: providerUsed === 'openai' ? anthropicError : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[swing-analysis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
