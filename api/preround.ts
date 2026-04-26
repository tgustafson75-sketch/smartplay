import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      firstName = '',
      courseName = '',
      courseRating = '',
      courseSlope = '',
      totalPar = 72,
      roundsTogether = 0,
      sessionsTogether = 0,
      handicap = 18,
      goal = null,
      dominantMiss = null,
      physicalLimitation = null,
      personalBest = null,
      recentCageSessions = [],
      heroMoments = [],
      isCompetition = false,
      language = 'en',
    } = req.body;

    const cageContext = (recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null }>).length > 0
      ? (recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null }>)
          .slice(0, 2)
          .map(s =>
            s.club + ': ' +
            (s.dominantMiss ? 'tending ' + s.dominantMiss : 'solid') +
            (s.rootCause ? ' (' + s.rootCause + ')' : '')
          ).join('. ')
      : null;

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are Kevin, experienced golf caddie.
Brief ${firstName || 'your player'} before their round at ${courseName || 'the course'}.

PLAYER: Handicap ${handicap}, ${roundsTogether} rounds together, ${sessionsTogether} practice sessions.
${goal ? 'Goal: ' + goal : ''}
${dominantMiss ? 'Dominant miss: ' + dominantMiss : ''}
${physicalLimitation ? 'Physical note: ' + physicalLimitation : ''}
${personalBest ? 'Personal best: ' + personalBest : ''}
${cageContext ? 'Recent practice: ' + cageContext : ''}
${isCompetition ? 'THIS IS A COMPETITION ROUND.' : ''}
${(heroMoments as unknown[]).length > 0 ? (heroMoments as unknown[]).length + ' hero moments saved.' : ''}

COURSE: ${courseName} — Par ${totalPar}, Rating ${courseRating}, Slope ${courseSlope}

Write exactly 3-4 sentences.
One key focus for today. Natural caddie voice.
End with something that settles ${firstName || 'the player'}.
Warm. Confident. Real. Not a pep talk.
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 120,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Pre-round brief now.' },
      ],
    });

    const brief = completion.choices[0]?.message?.content ?? '';
    return res.status(200).json({ brief });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[preround] error:', msg);
    return res.status(200).json({
      brief: 'Course is set up. You know what to do. One shot at a time.',
    });
  }
}
