import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

// 2026-05-23 — maxRetries 1 → 3 to absorb Anthropic 529 overloaded_error spikes.
// 2026-05-26 — Fix AW: cut back to maxRetries: 1 now that we have
// OpenAI + Gemini fallbacks. 25s × 3 = 75s blew Vercel's 60s budget
// before the fallback chain could fire. 22s × 1 + OpenAI 20s + Gemini
// ~10s fits comfortably under 60s with grace.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 22_000, maxRetries: 1 });
// 2026-05-27 — Fix EK: dedicated Haiku client with a tighter timeout.
// Haiku 4.5 vision typically responds in 2-5s; capping at 10s catches
// pathological slow responses early and lets us escalate to OpenAI
// before the user notices a hang. Same API key, same SDK — only
// model + timeout differ vs the Sonnet client above.
const anthropicHaiku = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 10_000, maxRetries: 1 });
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

CAGE-AWARE CONTEXT (2026-05-26 — Tier 1). If the frames clearly show a CAGE practice environment — characteristic cues include a net backdrop (mesh visible behind/around the player), a bullseye target panel (concentric rings on a stretched canvas), indoor/garage lighting, ball flight that obviously stops within ~5 feet of the player, or a hitting mat with a tee — RECALIBRATE your read for that environment:
  - DOWN-WEIGHT ball-flight observations. You will not see a real shot shape (the net catches the ball) — do NOT diagnose slice/hook/push/pull from ball trajectory because there isn't one. Diagnose from BODY/CLUB mechanics only.
  - UP-WEIGHT contact-quality observations. In a cage you have a clearer view of the strike moment, the divot pattern (if a mat), and the immediate ball-off-club direction relative to the cage walls or the bullseye center.
  - When the bullseye is visible in any frame, you MAY note where the ball appears to strike relative to the bullseye center (e.g. "high-left of the bullseye dot" or "well outside the rings") as a strike-quality cue — but ONLY if you can SEE the strike clearly; do not invent.
  - The cage context does NOT change which faults are possible. Every canonical issue still applies (over-the-top, early extension, sway, etc.) — only the EVIDENCE you can draw from differs.
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

/**
 * 2026-05-26 — Fix AX: Gemini-first speed-with-escalation orchestration.
 *
 * Architecture: speed is the default, accuracy is the safety net.
 *
 *   1. Call Gemini 2.5 Flash first (typical p50 ~3-6s vs 8-15s on Sonnet)
 *   2. Parse + normalize through the same safety gates as before
 *   3. If the result MEETS the confidence bar — return immediately.
 *      This is the speed path. Most reads (clean clip, person in frame,
 *      common faults) land here.
 *   4. If the result DOESN'T meet the bar — escalate to OpenAI gpt-4o
 *      for a second opinion. Pick whichever provider produced the
 *      higher-confidence diagnostic read.
 *   5. If OpenAI also doesn't pass the bar — escalate to Anthropic
 *      Sonnet 4.6 (slowest, deepest reasoning). Sonnet's temporal
 *      analysis is the strongest backstop when the faster models
 *      can't pin a dominant fault.
 *   6. Among providers that ran, return the BEST result. Best = highest
 *      confidence + diagnostic primary_fault + non-empty evidence.
 *
 * Tradeoff: cost goes UP on hard reads (we may run 2-3 providers vs 1)
 * but DOWN on easy ones (Gemini is cheapest AND we stop after the first
 * good answer). p50 latency cut roughly in half on the common case.
 */

interface AttemptResult {
  // 2026-05-27 — Fix EK: 'anthropic_haiku' is the new speed-path
  // provider. Same Anthropic SDK, different model (claude-haiku-4-5)
  // with a tighter timeout. The chain order is now Haiku → OpenAI →
  // Sonnet, with Haiku catching ~70% of common-case reads (clean
  // contact, clear pose, obvious fault) in 2-4s instead of gpt-4o's
  // 10-20s. Sonnet still backstops the hard reads.
  provider: 'gemini' | 'openai' | 'anthropic' | 'anthropic_haiku';
  parsed: SwingAnalysisResponse | null;
  rawText: string;
  error: string | null;
  /** Wall-clock ms spent on this provider call. */
  elapsedMs: number;
}

/**
 * Parse raw model text into a normalized SwingAnalysisResponse,
 * applying every safety gate (validity, primary_fault allowlist,
 * cause/fix/drill/evidence requirements, tentative-mode forced
 * normalization, etc.). Returns null when the text isn't valid
 * JSON or doesn't have the required shape.
 *
 * Single contract: every provider's output flows through this
 * function so the response shape is identical regardless of which
 * model produced it.
 */
function normalizeAnalysis(
  rawText: string,
  framesLength: number,
  mode: 'analysis' | 'tentative',
): SwingAnalysisResponse | null {
  if (!rawText) return null;
  let parsed: SwingAnalysisResponse;
  // 2026-05-26 — Fix DC: robust JSON extraction. OpenAI's
  // response_format:json_object guarantees clean JSON, but Anthropic
  // (prompt-instructed only) sometimes prepends prose ("Looking at
  // this swing, I see...") before the JSON. The prior approach only
  // stripped ``` code fences, so prose-prefixed valid JSON was
  // silently dropped → forced unnecessary re-escalation. Try the
  // greedy match for the outermost {...} block first; fall back to
  // fence-strip if no braces found.
  try {
    let cleaned = rawText.trim();
    const braceMatch = cleaned.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      cleaned = braceMatch[0];
    } else {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
    }
    parsed = JSON.parse(cleaned) as SwingAnalysisResponse;
  } catch {
    return null;
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
  if (typeof parsed.fault_frame_index !== 'number' || !Number.isInteger(parsed.fault_frame_index)) {
    parsed.fault_frame_index = -1;
  } else if (parsed.fault_frame_index < -1 || parsed.fault_frame_index >= framesLength) {
    parsed.fault_frame_index = -1;
  }
  if (mode === 'tentative') {
    parsed.detected_issue = 'none';
    parsed.severity = 'none';
    parsed.confidence = 'low';
    parsed.fault_frame_index = -1;
  }
  if (typeof parsed.layman_explanation !== 'string') {
    parsed.layman_explanation = '';
  }
  if (parsed.detected_issue === 'none' || parsed.valid_swing === false) {
    parsed.layman_explanation = '';
  }
  if (typeof parsed.primary_fault !== 'string' || !PRIMARY_FAULTS.includes(parsed.primary_fault as PrimaryFault)) {
    parsed.primary_fault = 'inconclusive';
  }
  if (parsed.valid_swing === false) {
    parsed.primary_fault = 'inconclusive';
  }
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
      parsed.primary_fault = 'no_dominant_fault';
    }
  }
  if (parsed.primary_fault === 'no_dominant_fault' &&
      (parsed.cause.length === 0 || parsed.fix.length === 0 || parsed.drill.length === 0)) {
    parsed.primary_fault = 'inconclusive';
    parsed.cause = '';
    parsed.fix = '';
    parsed.drill = '';
    parsed.evidence = '';
  }
  return parsed;
}

/**
 * Score how trustworthy a parsed read is. Higher = more trustworthy.
 * Used to pick the winner when multiple providers ran.
 *
 *   high-confidence diagnostic with evidence:        100
 *   high-confidence valid no_dominant_fault:          80
 *   medium-confidence diagnostic with evidence:       70
 *   medium-confidence no_dominant_fault:              55
 *   low-confidence diagnostic with evidence:          40
 *   low-confidence no_dominant_fault:                 30
 *   valid_swing=false (camera at floor, etc.):        25
 *   inconclusive (frames unreadable):                  5
 *   parse fail / null:                                 0
 */
function scoreAttempt(parsed: SwingAnalysisResponse | null): number {
  if (!parsed) return 0;
  if (parsed.primary_fault === 'inconclusive') return 5;
  if (parsed.valid_swing === false) return 25;
  const c = parsed.confidence;
  const hasEvidence = typeof parsed.evidence === 'string' && parsed.evidence.length > 0;
  const isDiagnostic = parsed.primary_fault !== 'no_dominant_fault';
  if (c === 'high') return isDiagnostic && hasEvidence ? 100 : 80;
  if (c === 'medium') return isDiagnostic && hasEvidence ? 70 : 55;
  return isDiagnostic && hasEvidence ? 40 : 30;
}

/**
 * Does this read meet the SPEED-PATH confidence bar? When true, we
 * can return early without escalating to a second opinion.
 *
 * Bar:
 *   - valid_swing === true (or false WITH validity_reason — that's
 *     a definitive "no analyzable swing" call worth shipping)
 *   - confidence === 'high'
 *   - primary_fault !== 'inconclusive'
 *   - evidence string non-empty (frame-specific citation present)
 *
 * Anything below that — we escalate. The bar is intentionally
 * conservative; we'd rather burn a second provider call than ship
 * a wobbly diagnosis to the player.
 */
function meetsSpeedBar(parsed: SwingAnalysisResponse | null): boolean {
  if (!parsed) return false;
  // valid_swing=false is a definitive "no swing" call — ship it as-is.
  if (parsed.valid_swing === false) return true;
  // 2026-05-26 — Fix CV: accept HIGH or MEDIUM confidence as passing.
  if (parsed.confidence !== 'high' && parsed.confidence !== 'medium') return false;
  // 'inconclusive' = unreadable footage, escalate to deeper provider.
  if (parsed.primary_fault === 'inconclusive') return false;
  // 2026-05-26 — Fix DK: evidence required ONLY when a NAMED fault is
  // returned. 'no_dominant_fault' (balanced swing with no clear single
  // tendency) is a valid, useful read that doesn't need frame-specific
  // evidence — the prompt explicitly produces it when no fault stands
  // out. Prior code rejected it for empty evidence → forced escalation
  // to OpenAI + Anthropic on ~20% of clean swings (per audit). Now
  // those return immediately as a passing read with the honest "no
  // dominant fault" verdict instead of timing out into tentative.
  // primary_fault type is the union of canonical fault IDs +
  // 'inconclusive' + 'no_dominant_fault'. Already excluded
  // 'inconclusive' above; only 'no_dominant_fault' is the
  // evidence-optional case.
  const namedFault =
    parsed.primary_fault &&
    parsed.primary_fault !== 'no_dominant_fault';
  if (namedFault && (typeof parsed.evidence !== 'string' || parsed.evidence.length === 0)) {
    return false;
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    // 2026-05-27 — Fix EK: pre-warm short-circuit. Client hits this
    // endpoint with { mode: 'warmup' } the moment a user opens
    // SmartMotion / Cage Mode / Library upload — that warms the
    // Vercel Lambda's runtime + provider SDK clients so the FIRST
    // real swing analysis a few seconds later doesn't pay cold-start.
    // Returns 200 in <50ms without doing AI work; ideal for fire-and-
    // forget client calls.
    if (body.mode === 'warmup') {
      return res.status(200).json({
        warmed: true,
        timestamp: Date.now(),
        providers_configured: {
          anthropic: !!process.env.ANTHROPIC_API_KEY,
          openai: !!process.env.OPENAI_API_KEY,
          gemini: !!process.env.GOOGLE_API_KEY,
        },
      });
    }
    // 2026-05-27 — Fix EO Phase 2: ball-position detection. Client
    // sends a single address frame (`frames[0]`) + `mode: 'detect_ball'`.
    // Server asks Anthropic Haiku 4.5 to locate the golf ball in the
    // frame and return normalized x/y/r coords. Lightweight prompt,
    // tight JSON contract, ~2s typical roundtrip on Haiku. Used by
    // the CageTargetingCard's "Auto-detect ball" button to prefill
    // the ball area marker without the user having to tap-place it.
    if (body.mode === 'detect_ball') {
      const detectFrames = (body.frames ?? []) as { b64: string; media_type?: string }[];
      if (!Array.isArray(detectFrames) || detectFrames.length === 0 || !detectFrames[0]?.b64) {
        return res.status(400).json({ error: 'frames[0] (single address-frame image) required' });
      }
      try {
        const completion = await anthropicHaiku.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          temperature: 0.0,
          system: `You are a precise image-coordinate detector. You will be shown one image from a golf swing setup. Find the golf ball (a small white sphere sitting on the ground, mat, tee, or grass). Return ONLY a JSON object with the ball's normalized coordinates relative to the image: { "found": true, "x": <0-1 from left>, "y": <0-1 from top>, "r": <0.01-0.2 normalized radius> }. If you can't see a golf ball with high confidence, return { "found": false }. No prose, no markdown, just the JSON.`,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: (detectFrames[0].media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: detectFrames[0].b64 } },
              { type: 'text', text: 'Locate the golf ball.' },
            ],
          }],
        });
        const block = completion.content.find(c => c.type === 'text');
        const raw = block && block.type === 'text' ? block.text.trim() : '';
        let parsed: { found?: boolean; x?: number; y?: number; r?: number } = {};
        try {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) parsed = JSON.parse(m[0]);
        } catch { /* fallthrough returns not_found */ }
        if (!parsed.found || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
          return res.status(200).json({ found: false });
        }
        return res.status(200).json({
          found: true,
          x: Math.max(0, Math.min(1, parsed.x)),
          y: Math.max(0, Math.min(1, parsed.y)),
          r: Math.max(0.02, Math.min(0.2, typeof parsed.r === 'number' ? parsed.r : 0.06)),
        });
      } catch (e) {
        console.error('[swing-analysis] detect_ball failed', e);
        return res.status(500).json({ found: false, error: e instanceof Error ? e.message : 'detection failed' });
      }
    }
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

    // 2026-05-27 — Fix ES (Phase 2.5): cage targeting anchor. When
    // the user has marked the ball position + target in the app, we
    // pass those normalized coords so the model has a strong prior
    // for the impact moment ("ball at (x,y) ±r in early frames;
    // ball gone = impact happened"). This tightens fault-frame
    // selection vs guessing from pose alone, and gives the prompt
    // a real reference for "what swing direction was attempted."
    const ballArea = (ctx as Record<string, unknown>).ball_area_norm as { x: number; y: number; r: number } | null | undefined;
    const targetPt = (ctx as Record<string, unknown>).target_norm as { x: number; y: number } | null | undefined;
    if (ballArea && typeof ballArea.x === 'number' && typeof ballArea.y === 'number') {
      const r = typeof ballArea.r === 'number' ? ballArea.r : 0.06;
      ctxLines.push(
        `Ball setup anchor: the player has marked the ball at normalized (x=${ballArea.x.toFixed(2)}, y=${ballArea.y.toFixed(2)}) within radius ${r.toFixed(2)} of the frame. Use this as a prior: address-frame should show the ball there; the frame where the ball is no longer in that area is impact or just-after-impact. Anchor your fault-frame selection accordingly. If your visual read of the frames contradicts this anchor, trust your visual read and note the disagreement in your observation.`
      );
    }
    if (targetPt && typeof targetPt.x === 'number' && typeof targetPt.y === 'number') {
      ctxLines.push(
        `Target anchor: player aimed at normalized (x=${targetPt.x.toFixed(2)}, y=${targetPt.y.toFixed(2)}). When ball-flight is visible, deviation from the line ball→target is a real fault signal (push / pull / start-direction off). Don't invent ball-flight observations if not visible.`
      );
    }
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

    // 2026-05-26 — Fix AX: Gemini-first speed-with-escalation chain.
    // See doc-comment on `meetsSpeedBar` + `scoreAttempt` helpers above
    // for the architecture. Order: Gemini (fast) → OpenAI (mid) →
    // Anthropic (deepest); each provider's output runs through the
    // shared normalizer; early-exit when the speed bar is met.

    const attempts: AttemptResult[] = [];

    // ── PROVIDER HELPERS — each returns raw text + error string, no
    //                       state mutation, no normalization. The
    //                       outer orchestrator runs the bar check.

    const tryGemini = async (): Promise<AttemptResult> => {
      const t0 = Date.now();
      if (!gemini) {
        return { provider: 'gemini', parsed: null, rawText: '', error: 'GOOGLE_API_KEY not configured', elapsedMs: 0 };
      }
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
            maxOutputTokens: 800,
            responseMimeType: 'application/json',
          },
        });
        const rawText = (gem.text ?? '').trim();
        const parsed = normalizeAnalysis(rawText, frames.length, mode);
        return {
          provider: 'gemini',
          parsed,
          rawText,
          error: parsed ? null : (rawText ? 'non_json_response' : 'empty_response'),
          elapsedMs: Date.now() - t0,
        };
      } catch (e) {
        return {
          provider: 'gemini',
          parsed: null,
          rawText: '',
          error: e instanceof Error ? e.message : 'unknown',
          elapsedMs: Date.now() - t0,
        };
      }
    };

    const tryOpenAI = async (): Promise<AttemptResult> => {
      const t0 = Date.now();
      if (!process.env.OPENAI_API_KEY) {
        return { provider: 'openai', parsed: null, rawText: '', error: 'OPENAI_API_KEY not configured', elapsedMs: 0 };
      }
      try {
        const openaiContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          ...frames.map(f => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${f.media_type ?? 'image/jpeg'};base64,${f.b64}`,
              detail: 'high' as const,
            },
          })),
          { type: 'text' as const, text: userText },
        ];
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 800,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: openaiContent },
          ],
        });
        const rawText = (oai.choices[0]?.message?.content ?? '').trim();
        const parsed = normalizeAnalysis(rawText, frames.length, mode);
        return {
          provider: 'openai',
          parsed,
          rawText,
          error: parsed ? null : (rawText ? 'non_json_response' : 'empty_response'),
          elapsedMs: Date.now() - t0,
        };
      } catch (e) {
        return {
          provider: 'openai',
          parsed: null,
          rawText: '',
          error: e instanceof Error ? e.message : 'unknown',
          elapsedMs: Date.now() - t0,
        };
      }
    };

    const tryAnthropic = async (): Promise<AttemptResult> => {
      const t0 = Date.now();
      try {
        const completion = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });
        const block = completion.content.find(c => c.type === 'text');
        const rawText = block && block.type === 'text' ? block.text.trim() : '';
        const parsed = normalizeAnalysis(rawText, frames.length, mode);
        return {
          provider: 'anthropic',
          parsed,
          rawText,
          error: parsed ? null : (rawText ? 'non_json_response' : 'empty_response'),
          elapsedMs: Date.now() - t0,
        };
      } catch (e) {
        return {
          provider: 'anthropic',
          parsed: null,
          rawText: '',
          error: e instanceof Error ? e.message : 'unknown',
          elapsedMs: Date.now() - t0,
        };
      }
    };

    // 2026-05-27 — Fix EK: Haiku 4.5 speed-path. Same SDK as the Sonnet
    // helper above but uses claude-haiku-4-5 (vision-capable, much
    // faster — typically 2-5s vs Sonnet's 8-15s on the same frames).
    // Output flows through the SAME normalizer + scoreAttempt + speed-
    // bar checks; any low-confidence / inconclusive Haiku read
    // automatically escalates to OpenAI then Sonnet.
    const tryHaiku = async (): Promise<AttemptResult> => {
      const t0 = Date.now();
      try {
        const completion = await anthropicHaiku.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });
        const block = completion.content.find(c => c.type === 'text');
        const rawText = block && block.type === 'text' ? block.text.trim() : '';
        const parsed = normalizeAnalysis(rawText, frames.length, mode);
        return {
          provider: 'anthropic_haiku',
          parsed,
          rawText,
          error: parsed ? null : (rawText ? 'non_json_response' : 'empty_response'),
          elapsedMs: Date.now() - t0,
        };
      } catch (e) {
        return {
          provider: 'anthropic_haiku',
          parsed: null,
          rawText: '',
          error: e instanceof Error ? e.message : 'unknown',
          elapsedMs: Date.now() - t0,
        };
      }
    };

    // ── ORCHESTRATION ────────────────────────────────────────────

    // ── ORCHESTRATION TOTAL DEADLINE ─────────────────────────────
    // 2026-05-26 — Fix CU: hard cap on total orchestration time.
    // Vercel function maxDuration = 60s; client AbortSignal = 55s.
    // If sequential providers (Gemini 30s + OpenAI 20s + Anthropic
    // 22s) overflow either, the server response never arrives →
    // client sees 'Lost connection' even though earlier providers
    // produced valid output. Tim's repro: 14s 8i clip, 3 attempts,
    // all fail. Cap total at 42s so we always have time to return
    // SOMETHING before client/Vercel timeouts. Also: if Gemini
    // returns ANY parsed result (even low-confidence), use it as
    // the fallback — better than "Couldn't analyze." Escalation
    // only happens when there's budget left.
    const orchestrationStart = Date.now();
    // 2026-05-26 — Fix DM: 42_000 → 48_000 now that Gemini is bypassed.
    // The 42s budget was sized for the 3-provider chain (Gemini 6s +
    // OpenAI 20s + Anthropic 22s = ~48s worst case, capped at 42s
    // for safety). With Gemini bypassed (Fix CY), the chain is now
    // OpenAI (~12s) + Anthropic (~18s) = ~30s typical — we have room
    // to extend budget to 48s. Still 7s under client's 55s abort
    // (Fix CO) and 12s under Vercel's 60s function maxDuration. The
    // extra budget makes Anthropic less likely to be skipped on slow-
    // OpenAI runs, raising successful-completion rate.
    const ORCHESTRATION_TOTAL_MS = 48_000;
    const budgetRemaining = () => ORCHESTRATION_TOTAL_MS - (Date.now() - orchestrationStart);

    // 2026-05-26 — Fix CY: BYPASS Gemini. Tim's project hit 429
    // "prepayment credits depleted" → every Gemini call wasted ~200ms
    // before falling through, AND when Gemini WAS up it sometimes
    // returned medium-confidence reads that forced unnecessary
    // escalation. Until billing is restored, start straight at
    // OpenAI (which is fast + reliable per /api/health). Flip
    // USE_GEMINI back to true once Google billing is paid.
    const USE_GEMINI = false;

    let winner: AttemptResult = { provider: 'gemini', parsed: null, rawText: '', error: 'bypassed', elapsedMs: 0 };
    let escalationReason: string | null = null;

    if (USE_GEMINI) {
      // Stage 1 — Gemini (speed path)
      const geminiAttempt = await tryGemini();
      attempts.push(geminiAttempt);
      winner = geminiAttempt;

      if (meetsSpeedBar(geminiAttempt.parsed)) {
        console.log('[swing-analysis] gemini speed-path hit', {
          elapsedMs: geminiAttempt.elapsedMs,
          confidence: geminiAttempt.parsed?.confidence,
          primary_fault: geminiAttempt.parsed?.primary_fault,
        });
      } else {
        if (!geminiAttempt.parsed) {
          escalationReason = `gemini_${geminiAttempt.error ?? 'unknown_failure'}`;
        } else if (geminiAttempt.parsed.primary_fault === 'inconclusive') {
          escalationReason = 'gemini_inconclusive';
        } else if (geminiAttempt.parsed.confidence !== 'high') {
          escalationReason = `gemini_low_confidence:${geminiAttempt.parsed.confidence}`;
        } else {
          escalationReason = 'gemini_missing_evidence';
        }
      }
    } else {
      escalationReason = 'gemini_bypassed_via_feature_flag';
    }

    // 2026-05-27 — Fix EK: Stage 1 (NEW) — Anthropic Haiku 4.5.
    // Haiku has vision, runs in ~2-5s vs gpt-4o's 10-20s, and catches
    // the common-case clean reads (obvious contact, clear pose, single
    // unambiguous fault). High-confidence Haiku reads bypass the rest
    // of the chain entirely. Low-confidence / inconclusive results
    // escalate normally to OpenAI then Sonnet.
    //
    // Budget gate: need ≥12s remaining (10s Haiku timeout + 2s headroom).
    // If the budget is somehow already drained at this point in the
    // orchestration, skip straight to OpenAI.
    if (!meetsSpeedBar(winner.parsed) && budgetRemaining() >= 12_000) {
      console.log('[swing-analysis] running Anthropic Haiku speed-path; budget_ms:', budgetRemaining());
      const haikuAttempt = await tryHaiku();
      attempts.push(haikuAttempt);
      if (scoreAttempt(haikuAttempt.parsed) > scoreAttempt(winner.parsed)) {
        winner = haikuAttempt;
      }
      if (meetsSpeedBar(haikuAttempt.parsed)) {
        console.log('[swing-analysis] haiku speed-path hit', {
          elapsedMs: haikuAttempt.elapsedMs,
          confidence: haikuAttempt.parsed?.confidence,
          primary_fault: haikuAttempt.parsed?.primary_fault,
        });
      } else if (haikuAttempt.parsed) {
        escalationReason = (escalationReason ?? '') + (
          haikuAttempt.parsed.primary_fault === 'inconclusive'
            ? '_haiku_inconclusive'
            : haikuAttempt.parsed.confidence !== 'high'
              ? `_haiku_low_confidence:${haikuAttempt.parsed.confidence}`
              : '_haiku_missing_evidence'
        );
      } else {
        escalationReason = (escalationReason ?? '') + `_haiku_${haikuAttempt.error ?? 'unknown_failure'}`;
      }
    }

    // Stage 2 — OpenAI gpt-4o (mid-tier escalation)
    if (!meetsSpeedBar(winner.parsed) && budgetRemaining() >= 22_000) {
      console.log('[swing-analysis] running OpenAI escalation; budget_ms:', budgetRemaining());
      const openaiAttempt = await tryOpenAI();
      attempts.push(openaiAttempt);
      if (scoreAttempt(openaiAttempt.parsed) > scoreAttempt(winner.parsed)) {
        winner = openaiAttempt;
      }

      // Stage 3 — Anthropic Sonnet only if STILL no pass AND budget left.
      if (!meetsSpeedBar(winner.parsed) && budgetRemaining() >= 18_000) {
        console.log('[swing-analysis] OpenAI did not pass bar — escalating to Anthropic Sonnet; budget_ms:', budgetRemaining());
        const anthropicAttempt = await tryAnthropic();
        attempts.push(anthropicAttempt);
        if (scoreAttempt(anthropicAttempt.parsed) > scoreAttempt(winner.parsed)) {
          winner = anthropicAttempt;
        }
      } else if (!meetsSpeedBar(winner.parsed)) {
        escalationReason = (escalationReason ?? '') + '_anthropic_skipped_budget';
      }
    } else if (!meetsSpeedBar(winner.parsed)) {
      escalationReason = (escalationReason ?? '') + '_openai_skipped_budget';
    }

    // No provider produced parseable output → 502 with full diagnostics
    if (!winner.parsed) {
      const errs: Record<string, string | null> = {};
      for (const a of attempts) errs[`${a.provider}_error`] = a.error;
      console.error('[swing-analysis] all attempted providers failed', errs);
      return res.status(502).json({
        error: 'All providers failed',
        ...errs,
      });
    }

    // 2026-05-26 — Telemetry: provider used + escalation reason +
    // every provider attempted with elapsed ms. Owner debug screen
    // can render this to spot patterns (e.g. "Gemini's hitting
    // inconclusive on POV clips 3x more than face-on").
    console.log('[swing-analysis] returning result', {
      provider: winner.provider,
      attempts: attempts.map(a => ({ p: a.provider, ms: a.elapsedMs, ok: !!a.parsed, err: a.error })),
      escalation: escalationReason,
      confidence: winner.parsed.confidence,
      primary_fault: winner.parsed.primary_fault,
    });

    // 2026-05-26 — Fix CW: BETA policy — "medium IS high until we get
    // past beta." Tim's call: during beta, treat medium-confidence reads
    // as if they were high so the client UI renders without the
    // "you might be..." hedging, no ~ tilde on metrics, no tentative
    // badge. The fallback chain still picked the BEST score across
    // attempts; this is just the surface-level relabel. Flip
    // BETA_MEDIUM_IS_HIGH to false post-beta to restore strict labels.
    const BETA_MEDIUM_IS_HIGH = true;
    const finalConfidence =
      BETA_MEDIUM_IS_HIGH && winner.parsed.confidence === 'medium'
        ? 'high'
        : winner.parsed.confidence;
    return res.status(200).json({
      ...winner.parsed,
      confidence: finalConfidence,
      _debug: {
        imageBlocks,
        textBlocks,
        mode,
        shortGame: isShortGame,
        provider: winner.provider,
        escalation_reason: escalationReason,
        beta_medium_coerced: BETA_MEDIUM_IS_HIGH && winner.parsed.confidence === 'medium',
        original_confidence: winner.parsed.confidence,
        attempts: attempts.map(a => ({
          provider: a.provider,
          elapsed_ms: a.elapsedMs,
          ok: a.parsed != null,
          error: a.error,
          score: scoreAttempt(a.parsed),
        })),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[swing-analysis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
