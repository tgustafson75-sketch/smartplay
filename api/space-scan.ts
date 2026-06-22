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
 *   500 — no AI provider configured / vision call failed
 *   502 — model returned non-JSON
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCaddieName, getCharacterSpec, type VoiceGender, type Persona } from '../lib/persona';
import { completeVision, providerFromHeader, type StructuredSchema } from './_aiProvider';

const SPACE_ASSESSMENT_SCHEMA: StructuredSchema = {
  name: 'space_assessment',
  openai: {
    type: 'object',
    properties: {
      space_type: { type: 'string', enum: ['cage', 'range_bay', 'backyard', 'basement', 'garage', 'other'] },
      summary: { type: 'string' },
      recommended_setup: {
        type: 'object',
        properties: {
          mat_position: { type: 'string' },
          aim_direction: { type: 'string' },
        },
        required: ['mat_position', 'aim_direction'],
        additionalProperties: false,
      },
      camera_position: {
        type: 'object',
        properties: {
          dtl_placement: { type: ['string', 'null'] },
          face_on_placement: { type: ['string', 'null'] },
        },
        required: ['dtl_placement', 'face_on_placement'],
        additionalProperties: false,
      },
      recommended_drills: { type: 'array', items: { type: 'string' } },
      avoid_drills: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            drill_id: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['drill_id', 'reason'],
          additionalProperties: false,
        },
      },
      safety_notes: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
    required: ['space_type', 'summary', 'recommended_setup', 'camera_position', 'recommended_drills', 'avoid_drills', 'safety_notes', 'limitations'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      space_type: { type: 'STRING', enum: ['cage', 'range_bay', 'backyard', 'basement', 'garage', 'other'] },
      summary: { type: 'STRING' },
      recommended_setup: {
        type: 'OBJECT',
        properties: {
          mat_position: { type: 'STRING' },
          aim_direction: { type: 'STRING' },
        },
      },
      camera_position: {
        type: 'OBJECT',
        properties: {
          dtl_placement: { type: 'STRING', nullable: true },
          face_on_placement: { type: 'STRING', nullable: true },
        },
      },
      recommended_drills: { type: 'ARRAY', items: { type: 'STRING' } },
      avoid_drills: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            drill_id: { type: 'STRING' },
            reason: { type: 'STRING' },
          },
        },
      },
      safety_notes: { type: 'ARRAY', items: { type: 'STRING' } },
      limitations: { type: 'ARRAY', items: { type: 'STRING' } },
    },
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: {
        space_type: { type: 'string', enum: ['cage', 'range_bay', 'backyard', 'basement', 'garage', 'other'] },
        summary: { type: 'string' },
        recommended_setup: {
          type: 'object',
          properties: {
            mat_position: { type: 'string' },
            aim_direction: { type: 'string' },
          },
          required: ['mat_position', 'aim_direction'],
        },
        camera_position: {
          type: 'object',
          properties: {
            dtl_placement: { type: ['string', 'null'] },
            face_on_placement: { type: ['string', 'null'] },
          },
          required: ['dtl_placement', 'face_on_placement'],
        },
        recommended_drills: { type: 'array', items: { type: 'string' } },
        avoid_drills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              drill_id: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['drill_id', 'reason'],
          },
        },
        safety_notes: { type: 'array', items: { type: 'string' } },
        limitations: { type: 'array', items: { type: 'string' } },
      },
      required: ['space_type', 'summary', 'recommended_setup', 'camera_position', 'recommended_drills', 'avoid_drills', 'safety_notes', 'limitations'],
    },
  },
};

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildSystemPrompt = (g: Persona | VoiceGender) => `${getCharacterSpec(g)}

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
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
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
    // Audit 101 / B4 — prefer body.persona; fall back to voiceGender.
    const personaInput: Persona | VoiceGender =
      (typeof body.persona === 'string' ? (body.persona as string) : voiceGender) as Persona | VoiceGender;

    const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeVision(provider, 'quality', buildSystemPrompt(personaInput),
      'Read this practice space and tell me how to use it.',
      [{ b64: image_b64, mimeType: image_media_type }],
      { maxTokens: 800, temperature: 0.4, schema: SPACE_ASSESSMENT_SCHEMA },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response' });

    let parsed: SpaceAssessment;
    try {
      parsed = JSON.parse(text) as SpaceAssessment;
    } catch {
      console.error('[space-scan] JSON parse failed:', text.slice(0, 300));
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    // Enforce list-length caps the system prompt requests.
    parsed.recommended_drills = parsed.recommended_drills.slice(0, 4);
    parsed.avoid_drills = parsed.avoid_drills.slice(0, 3);
    parsed.safety_notes = parsed.safety_notes.slice(0, 3);
    parsed.limitations = parsed.limitations.slice(0, 3);

    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[space-scan] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
