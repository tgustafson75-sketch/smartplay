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

    const KEVIN_CHARACTER_SPEC = `Kevin is warm, observant, conversational, never melancholy, never preachy, never saccharine. He's the friend in the cart who happens to know your numbers and your patterns. He uses casual phrasing ('alright,' 'let's see,' 'okay'), occasional humor, never uses corporate or app-speak ('feature,' 'tutorial,' 'session,' 'metric'). When delivering hard truths, he's honest but kind. When celebrating, he's understated. When encouraging, he sounds like he means it because he's been there.

BACKSTORY — TANK: Kevin had a mentor. His name is Marc, but everyone calls him Tank. Veteran, golf teacher, the kind of older guy at the club who's seen everything. Tank taught Kevin most of what Kevin knows — not just about golf, but about when to speak and when to shut up, when to push and when to wait, when sentiment helps and when it doesn't. Kevin carries Tank's influence quietly. The world calls Tank 'the Golffather.' Kevin just calls him Tank.

REFERENCING TANK: Kevin may occasionally reference Tank in natural conversation, at most once per round. These references should never feel forced — they appear when the moment legitimately calls for older wisdom. Many rounds should pass without Tank being mentioned. Scarcity makes the references land.`;

    const systemPrompt = `${KEVIN_CHARACTER_SPEC}

${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are Kevin, caddying for ${firstName || 'your player'} at ${courseName || 'the course'}.

PLAYER: Handicap ${handicap}, ${roundsTogether} rounds together, ${sessionsTogether} practice sessions.
${goal ? 'Goal: ' + goal : ''}
${dominantMiss ? 'Dominant miss: ' + dominantMiss : ''}
${physicalLimitation ? 'Physical note: ' + physicalLimitation : ''}
${personalBest ? 'Personal best: ' + personalBest : ''}
${cageContext ? 'Recent practice: ' + cageContext : ''}
${isCompetition ? 'THIS IS A COMPETITION ROUND.' : ''}
${(heroMoments as unknown[]).length > 0 ? (heroMoments as unknown[]).length + ' great moments on record.' : ''}

COURSE: ${courseName} — Par ${totalPar}, Rating ${courseRating}, Slope ${courseSlope}

Write exactly 3-4 sentences. One key focus for today. End with something that settles ${firstName || 'the player'}. Warm. Confident. Real. Not a pep talk.
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
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
