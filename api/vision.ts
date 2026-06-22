import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { getCaddieName } from '../lib/persona';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      mode,
      image,
      hole,
      par,
      distance,
      courseName,
      dominantMiss = null,
      voiceGender = 'male',
      persona = null,
    } = req.body;
    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const caddieName = getCaddieName(typeof persona === 'string' ? persona : voiceGender);

    console.log('[vision] received:', { mode, hasImage: !!image, hole, par, distance });

    if (!image) {
      return res.status(200).json({ message: 'No image provided.' });
    }
    if (typeof image === 'string' && image.length > 7_000_000) {
      return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });
    }

    if (mode === 'hole') {
      const missContext = dominantMiss
        ? ' Player tends to miss ' + dominantMiss + '.'
        : '';

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,' + image,
                detail: 'low',
              },
            },
            {
              type: 'text',
              text:
                'You are ' + caddieName + ', an experienced golf caddie. ' +
                'This is an overhead satellite view of hole ' +
                (hole ?? '?') + ', par ' + (par ?? '?') + ', ' +
                (distance ?? '?') + ' yards' +
                (courseName ? ' at ' + courseName : '') + '.' +
                missContext +
                ' In exactly 2 sentences as ' + caddieName + ': identify the main hazard ' +
                'and recommend an aim point, then give one specific swing thought ' +
                'or club choice. Be direct and warm. Use yards not meters. ' +
                'Do not start with "I can see". Do not describe the image. ' +
                "Just give " + caddieName + "'s read.",
            },
          ],
        }],
      });

      const message = completion.choices[0]?.message?.content ?? '';
      console.log('[vision] response:', message);
      return res.status(200).json({ message });
    }

    return res.status(200).json({
      message: 'Take a look at the layout and pick your target.',
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[vision] error:', msg);
    return res.status(200).json({
      message: 'Take a look at the layout and pick your target.',
    });
  }
}
