import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { getCaddieName } from '../lib/persona';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      frameBase64,
      club = '7 iron',
      feel = null,
      shape = null,
      dominantMiss = null,
      physicalLimitation = null,
      sessionFaults = [],
      swingView = 'face-on',
      language = 'en',
      voiceGender = 'male',
      persona = null,
    } = req.body;
    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const caddieName = getCaddieName(typeof persona === 'string' ? persona : voiceGender);

    if (!frameBase64) {
      return res.status(200).json({
        fix: 'Set up the camera and try again.',
        fault: null,
      });
    }
    if (typeof frameBase64 === 'string' && frameBase64.length > 7_000_000) {
      return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });
    }

    const missContext = dominantMiss
      ? ' This player tends to miss ' + dominantMiss + '.'
      : '';

    const feelContext = feel && feel !== 'flush'
      ? ' Player reported feeling: ' + feel + '.'
      : '';

    const physContext = physicalLimitation
      ? ' Note: ' + physicalLimitation + ' — do not suggest movements that could aggravate this.'
      : '';

    const sessionContext = (sessionFaults as string[]).length > 0
      ? ' Previously identified faults this session: ' + (sessionFaults as string[]).join(', ') + '.'
      : '';

    const viewContext = swingView === 'down-the-line'
      ? 'down-the-line camera angle'
      : 'face-on camera angle';

    const systemPrompt = `
You are ${caddieName}, an experienced golf instructor and caddie.

You are looking at a single frame from a golf swing captured from a ${viewContext}.

The player is hitting a ${club}.
${missContext}
${feelContext}
${physContext}
${sessionContext}

YOUR TASK:
Identify the SINGLE most important fault visible in this frame.

Focus on these in priority order:
  1. Setup and posture at address
  2. Club path and face angle
  3. Body position at key positions
  4. Balance and weight transfer

YOUR RESPONSE MUST:
  - Be exactly 2 sentences
  - Sentence 1: name the fault you see specifically
  - Sentence 2: give one physical feel or thought to fix it
  - Be direct and warm
  - Sound like ${caddieName} — not a manual
  - Use simple language
  - Reference what you actually see in the image

DO NOT:
  - Give multiple tips
  - Say "I can see" or "I notice"
  - Be vague — be specific
  - List things
  - Start with "Great swing"

${language === 'es' ? 'Respond in Spanish.' : language === 'zh' ? 'Respond in Chinese.' : ''}
`.trim();

    console.log('[smartmotion] analyzing:', club, swingView, 'frame size:', frameBase64.length);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 80,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,' + frameBase64,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: 'What is the one thing you see that I should fix?',
            },
          ],
        },
      ],
    });

    const fix = completion.choices[0]?.message?.content ?? '';
    console.log('[smartmotion] fix:', fix);

    return res.status(200).json({ fix, fault: null });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[smartmotion] error:', msg);
    return res.status(200).json({
      fix: 'Camera angle was off. Set up again and try.',
      fault: null,
    });
  }
}
