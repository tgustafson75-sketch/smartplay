/**
 * Phase W — Practice Space Assessment (Level 1).
 *
 * Sonnet vision endpoint that takes a single photo of the player's
 * practice space and returns a structured 30-second setup assessment
 * — space type, mat/aim/camera positioning, drills that work, drills
 * to avoid, safety notes, honest limitations, and a Kevin coach-voice
 * summary.
 *
 * Failure modes mirror /api/lie-analysis:
 *   400 — missing image
 *   413 — image too large (>5MB after base64 decode)
 *   500 — Anthropic key not configured / vision call failed
 *   502 — model returned non-JSON
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, getCharacterSpec, type VoiceGender } from '../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const buildSystemPrompt = (g: VoiceGender) => `${getCharacterSpec(g)}

You are ${getCaddieName(g)} in Coach voice, looking at a photo of the player's practice
space. They want a 30-second read on the setup before they start hitting.

Your job: read the room honestly and tell them how to use it. Tactical,
specific to what's in the photo, no generic platitudes.

What to read:
- Space type (cage / range_bay / backyard / basement / garage / other)
- Effective hitting distance (net distance, room length)
- Ceiling clearance for full swings
- Floor surface (mat / turf / concrete / carpet)
- Safety hazards (breakable objects, fixtures, low ceilings, lights)
- Audio considerations (echo, fans, household noise)
- What the camera angle reveals about ideal phone placement for DTL or face-on capture
- What this space CAN'T tell the player (e.g., ball flight in a tight cage)

Recommend drills BY NAME from this canonical SwingLab set when they fit:
  alignment, gate, tempo, hand_path, impact_position, takeaway, balance,
  full_finish, weight_transfer, lag, rhythm

If a drill won't work in this space, say so plainly and put it on the avoid list.

Output ONLY a JSON object with this exact shape:
{
  "space_type": "cage" | "range_bay" | "backyard" | "basement" | "garage" | "other",
  "summary": "<two or three short Coach-voice sentences naming what you see and how to use it. Example: 'Decent garage cage. Net's a foot too close for honest ball-flight feedback. Phone on that shelf gives you DTL, fan won't bother full swings but kills your audio if you record.'>",
  "recommended_setup": {
    "mat_position": "<one short sentence on where to put the mat>",
    "aim_direction": "<one short sentence on which way to aim and why>"
  },
  "camera_position": {
    "dtl_placement": "<one short sentence on where to put the phone for down-the-line view, or null if not feasible>",
    "face_on_placement": "<one short sentence on where to put the phone for face-on view, or null if not feasible>"
  },
  "recommended_drills": ["<drill_id>", "<drill_id>", ...],
  "avoid_drills": [{ "drill_id": "<id>", "reason": "<one short sentence>" }, ...],
  "safety_notes": ["<one short note>", ...],
  "limitations": ["<one short honest limitation about what this space won't tell you>", ...]
}

Rules:
- Coach voice — present-tense, specific, no jargon ('engage your core', 'commit to the swing path').
- No app-speak ('feature', 'session', 'metric').
- Keep recommended_drills to at most 4 items; avoid_drills at most 3 items.
- safety_notes and limitations both at most 3 items each. Skip a list (return []) if there's nothing real to say — don't pad.
- camera_position fields can be null when the angle doesn't show a workable phone spot.
- Output ONLY valid JSON. No code fences, no preamble, no commentary.`;

export interface SpaceAssessment {
  space_type: 'cage' | 'range_bay' | 'backyard' | 'basement' | 'garage' | 'other';
  summary: string;
  recommended_setup: {
    mat_position: string;
    aim_direction: string;
  };
  camera_position: {
    dtl_placement: string | null;
    face_on_placement: string | null;
  };
  recommended_drills: string[];
  avoid_drills: { drill_id: string; reason: string }[];
  safety_notes: string[];
  limitations: string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const image_b64 = String(body.image_b64 ?? '').trim();
    const image_media_type = String(body.image_media_type ?? 'image/jpeg');
    if (!image_b64) {
      return res.status(400).json({ error: 'image_b64 (base64-encoded JPEG/PNG) required' });
    }
    if (image_b64.length > 7_000_000) {
      return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });
    }
    const voiceGender: VoiceGender = (body.voiceGender as VoiceGender | undefined) ?? 'male';

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      temperature: 0.4,
      system: buildSystemPrompt(voiceGender),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image_media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: image_b64 } },
            { type: 'text', text: 'Read this practice space and tell me how to use it.' },
          ],
        },
      ],
    });

    const block = completion.content.find(c => c.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text) return res.status(502).json({ error: 'Empty model response' });

    let parsed: SpaceAssessment;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(cleaned) as SpaceAssessment;
    } catch {
      console.error('[space-scan] JSON parse failed:', text.slice(0, 300));
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    // Defensive normalization
    const validTypes = ['cage', 'range_bay', 'backyard', 'basement', 'garage', 'other'] as const;
    if (!validTypes.includes(parsed.space_type)) parsed.space_type = 'other';
    if (typeof parsed.summary !== 'string') parsed.summary = '';
    parsed.recommended_setup = parsed.recommended_setup ?? { mat_position: '', aim_direction: '' };
    parsed.camera_position = parsed.camera_position ?? { dtl_placement: null, face_on_placement: null };
    parsed.recommended_drills = Array.isArray(parsed.recommended_drills) ? parsed.recommended_drills.slice(0, 4) : [];
    parsed.avoid_drills = Array.isArray(parsed.avoid_drills) ? parsed.avoid_drills.slice(0, 3) : [];
    parsed.safety_notes = Array.isArray(parsed.safety_notes) ? parsed.safety_notes.slice(0, 3) : [];
    parsed.limitations = Array.isArray(parsed.limitations) ? parsed.limitations.slice(0, 3) : [];

    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[space-scan] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
