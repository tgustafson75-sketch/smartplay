import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

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
      currentMentalState = 'neutral',
      isCompetition = false,
      weather = null,
      language = 'en',
    } = body as {
      firstName?: string;
      courseName?: string;
      courseRating?: string;
      courseSlope?: string;
      totalPar?: number;
      roundsTogether?: number;
      sessionsTogether?: number;
      handicap?: number;
      goal?: string | null;
      dominantMiss?: string | null;
      physicalLimitation?: string | null;
      personalBest?: number | null;
      recentCageSessions?: Array<{
        club: string;
        dominantMiss: string | null;
        rootCause: string | null;
      }>;
      heroMoments?: Array<unknown>;
      currentMentalState?: string;
      isCompetition?: boolean;
      weather?: string | null;
      language?: string;
    };

    const cageContext =
      recentCageSessions.length > 0
        ? recentCageSessions
            .slice(0, 2)
            .map(s =>
              s.club +
              ' session: ' +
              (s.dominantMiss ? 'tending ' + s.dominantMiss : 'solid') +
              (s.rootCause ? ' (' + s.rootCause + ')' : '')
            )
            .join('. ')
        : null;

    const heroContext =
      heroMoments.length > 0
        ? 'Has ' +
          heroMoments.length +
          ' hero moment' +
          (heroMoments.length > 1 ? 's' : '') +
          ' saved.'
        : null;

    const systemPrompt = `
${language === 'es'
  ? 'Responde SIEMPRE en español.'
  : language === 'zh'
  ? '请始终用中文回复。'
  : ''}

You are Kevin, experienced golf caddie.
You are about to brief ${firstName || 'your player'} before their round at ${courseName || 'the course'}.

PLAYER CONTEXT:
Handicap: ${handicap}
Rounds together: ${roundsTogether}
Practice sessions: ${sessionsTogether}
${goal ? 'Goal: ' + goal : ''}
${dominantMiss ? 'Dominant miss: ' + dominantMiss : ''}
${physicalLimitation ? 'Physical note: ' + physicalLimitation : ''}
${personalBest ? 'Personal best: ' + personalBest : ''}

${cageContext ? 'RECENT PRACTICE: ' + cageContext : ''}
${heroContext ?? ''}
${isCompetition ? 'THIS IS A COMPETITION ROUND.' : ''}

${weather ? 'WEATHER: ' + weather : ''}

COURSE: ${courseName}
Par ${totalPar}
Rating ${courseRating} / Slope ${courseSlope}

YOUR BRIEF MUST:
- Be exactly 3-4 sentences total
- Cover: one key focus for today
- Reference practice if relevant
- Mention weather only if significant
- End with something that settles ${firstName || 'the player'} and gets them focused on hole 1
- Sound like a real caddie — not a pep talk, not a lecture
- If competition: mention it once briefly with one strategic note
- If goal is close to being achieved: mention it once naturally

DO NOT:
- Use bullet points
- List multiple swing thoughts
- Mention statistics
- Start with "I"
- Sound like an AI assistant

TONE:
Warm. Settled. Confident.
Kevin has seen worse.
Kevin believes in this player.
This is just another round.
One shot at a time.
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 120,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            'Give me the pre-round brief for ' +
            (firstName || 'my player') +
            ' right now.',
        },
      ],
    });

    const brief = completion.choices[0]?.message?.content ?? '';
    return Response.json({ brief });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[preround] error:', msg);
    return Response.json({
      brief: 'Course is set up. You know what to do. One shot at a time.',
    });
  }
}
