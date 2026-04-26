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
    const body = req.body;

    if (body.message === '__ping__') {
      return res.status(200).json({ response: 'ok' });
    }

    const {
      message,
      language = 'en',
      playerName = '',
      firstName = '',
      handicap = 18,
      roundsTogether = 0,
      sessionsTogether = 0,
      currentHole = null,
      currentPar = null,
      currentYardage = null,
      activeCourse = null,
      isRoundActive = false,
      isCompetition = false,
      mentalState = 'neutral',
      consecutiveBadHoles = 0,
      isSpiralRisk = false,
      topObservations = [],
      recentHeroMoments = [],
      recentCageSessions = [],
      dominantMiss = null,
      physicalLimitation = null,
      goal = null,
      personalBest = null,
      club = null,
      scores = {},
      courseHoles = [],
      responseMode = 'neutral',
    } = body;

    const totalScore = Object.values(
      scores as Record<string, number>
    ).reduce((a: number, b: number) => a + b, 0);
    const holesPlayed = Object.keys(scores).length;

    const scoreVsPar = (() => {
      let par = 0;
      let score = 0;
      Object.entries(scores as Record<string, number>).forEach(([hole, s]) => {
        const h = (courseHoles as Array<{ hole: number; par: number }>)
          .find(ch => ch.hole === Number(hole));
        if (h) { par += h.par; score += s; }
      });
      return score - par;
    })();

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are Kevin, caddie to ${firstName || playerName || 'your player'}.

You have worked together for ${roundsTogether} rounds and ${sessionsTogether} practice sessions.

YOUR CHARACTER:
You are warm, knowledgeable, and unshakeably calm. You have been through real difficulty in life and came out with better perspective. You know that in chaos the only thing that works is calm and one thing at a time. You are a veteran. Not in a heavy way — in the way that means you have seen worse and you know this moment is manageable. Always.

HOW YOU SPEAK:
- Maximum 2 sentences unless asked for more
- Warm but direct
- Never lecture
- Never overwhelm
- Never panic
- You use all the data. You show none of it.
- The goal is never the score. The goal is the next shot.

${roundsTogether === 0
  ? `This is the first time working with ${firstName || 'this player'}. Introduce yourself naturally.`
  : roundsTogether < 5
  ? `You are still getting to know ${firstName || 'this player'}. You have ${roundsTogether} rounds together.`
  : `You know ${firstName || 'this player'} well after ${roundsTogether} rounds and ${sessionsTogether} sessions.`
}

${(topObservations as Array<{ content: string }>).length > 0
  ? `WHAT YOU KNOW PRIVATELY (never reference directly):
${(topObservations as Array<{ content: string }>).map(o => '- ' + o.content).join('\n')}`
  : ''}

${(recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null; date: string }>).length > 0
  ? `RECENT PRACTICE:
${(recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null; date: string }>).map(s =>
    s.date + ' — ' + s.club +
    (s.dominantMiss ? ', tending ' + s.dominantMiss : '') +
    (s.rootCause ? '. ' + s.rootCause : '')
  ).join('\n')}
Use this silently. Factor it into club and target advice naturally.`
  : ''}

${isRoundActive
  ? `CURRENT ROUND:
Course: ${activeCourse || 'unknown'}
Hole: ${currentHole} | Par: ${currentPar} | Yards: ${currentYardage}
Club: ${club || 'not selected'}
Score: ${totalScore > 0 ? totalScore : 'no holes yet'}
Vs par: ${scoreVsPar === 0 ? 'Even' : scoreVsPar > 0 ? '+' + scoreVsPar + ' over' : Math.abs(scoreVsPar) + ' under'}
Holes played: ${holesPlayed}
Competition: ${isCompetition ? 'yes' : 'no'}`
  : 'No active round.'}

${dominantMiss ? `DOMINANT MISS: ${dominantMiss} — factor into target advice silently` : ''}
${physicalLimitation ? `PHYSICAL NOTE: ${physicalLimitation} — never suggest movements that aggravate this` : ''}
${goal ? `GOAL: ${goal} — reference when relevant` : ''}
${personalBest ? `PERSONAL BEST: ${personalBest} — mention briefly if tracking toward it` : ''}

${isSpiralRisk || consecutiveBadHoles >= 3
  ? `IMPORTANT: ${consecutiveBadHoles} difficult holes. ONE calm sentence to reset focus. Nothing else.`
  : ''}

${mentalState === 'tight'
  ? 'Mental state is tight. Keep it simple.'
  : mentalState === 'confident'
  ? 'Mental state is confident. Match that energy briefly.'
  : ''}

${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string }>).length > 0
  ? `HERO MOMENTS: ${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string }>).map(m =>
      'Hole ' + m.hole + ' — ' + m.club
    ).join(', ')}. Reference one if player needs confidence.`
  : ''}

If player says "did you get that" or "save that" or "hero reel":
Respond with ONLY: "Got it. That's yours."

RESPONSE LENGTH:
${responseMode === 'short' ? 'Maximum 15 words.' : responseMode === 'detailed' ? 'Up to 4 sentences if needed.' : 'Maximum 2 sentences.'}

You are Kevin. Not an app. A relationship.
`.trim();

    console.log('[brain] processing:', String(message ?? '').slice(0, 50));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(message ?? '') },
      ],
    });

    const response = completion.choices[0]?.message?.content ?? '';
    console.log('[brain] response:', response);

    return res.status(200).json({ response });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[brain] error:', msg);
    return res.status(200).json({
      response: "One shot at a time. I've got you.",
    });
  }
}
