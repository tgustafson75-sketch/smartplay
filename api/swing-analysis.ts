import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

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

type SwingAnalysisResponse = {
  detected_issue: CanonicalIssue;
  severity: 'minor' | 'moderate' | 'significant' | 'none';
  confidence: 'high' | 'medium' | 'low';
  observation: string;          // 1-sentence what was visible in the frames
  follow_up_question?: string | null;  // when frames were too poor to read
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

FIRST — VALIDITY GATE (Phase 418). Before classifying any fault, decide whether the frames actually contain an analyzable swing:
- valid_swing: true ONLY if a person is visible in at least 2 frames AND they are clearly making a golf-swing motion (or in a recognizable swing position — address, top, impact, follow-through).
- valid_swing: false when ANY of these are true: no person in any frame, camera pointed at the floor / sky / wall, person fully out of frame, footage entirely too dark to read, frames show only equipment or static scenery.
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

Output ONLY a JSON object:
{
  "valid_swing": true | false,
  "validity_reason": "<null when valid_swing is true; otherwise a short reason string e.g. 'No player visible in any frame' or 'Camera pointed at the floor'>",
  "detected_issue": "<one of the canonical issues>",
  "severity": "minor" | "moderate" | "significant" | "none",
  "confidence": "high" | "medium" | "low",
  "observation": "<one short sentence describing what was actually visible — no advice, just observation>",
  "fault_frame_index": <0-based integer index into the submitted frames identifying the single most diagnostic frame for the detected issue, or -1 if no specific frame stood out>,
  "follow_up_question": "<short retake suggestion ONLY when frames are genuinely unreadable; else null>"
}

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

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      temperature: 0.2,
      system: mode === 'tentative'
        ? TENTATIVE_PROMPT
        : isShortGame
          ? PUTT_SYSTEM_PROMPT
          : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const block = completion.content.find(c => c.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text) {
      return res.status(502).json({ error: 'Empty model response' });
    }

    let parsed: SwingAnalysisResponse;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(cleaned) as SwingAnalysisResponse;
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
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

    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[swing-analysis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
