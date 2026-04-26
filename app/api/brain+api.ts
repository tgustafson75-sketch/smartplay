import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;

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
      dominantMiss = null,
      physicalLimitation = null,
      club = null,
      scores = {},
      courseHoles = [],
      responseMode = 'neutral',
    } = body as {
      message?: string;
      language?: string;
      playerName?: string;
      firstName?: string;
      handicap?: number;
      roundsTogether?: number;
      sessionsTogether?: number;
      currentHole?: number | null;
      currentPar?: number | null;
      currentYardage?: number | null;
      activeCourse?: string | null;
      isRoundActive?: boolean;
      isCompetition?: boolean;
      mentalState?: string;
      consecutiveBadHoles?: number;
      isSpiralRisk?: boolean;
      topObservations?: Array<{ content: string }>;
      recentHeroMoments?: Array<{ hole: number; club: string; courseName: string; kevinSaid: string }>;
      dominantMiss?: string | null;
      physicalLimitation?: string | null;
      club?: string | null;
      scores?: Record<string, number>;
      courseHoles?: Array<{ hole: number; par: number }>;
      responseMode?: string;
    };

    const totalScore = Object.values(scores).reduce(
      (a: number, b: number) => a + b, 0
    );
    const holesPlayed = Object.keys(scores).length;

    const scoreVsPar = courseHoles.length > 0
      ? Object.entries(scores).reduce((acc, [holeStr, score]) => {
          const holeNum = parseInt(holeStr, 10);
          const holeData = courseHoles.find(h => h.hole === holeNum);
          return holeData ? acc + (score - holeData.par) : acc;
        }, 0)
      : 0;

    // ── KEVIN'S SYSTEM PROMPT ─────────────────

    const systemPrompt = `
${language === 'es'
  ? 'Responde SIEMPRE en español.'
  : language === 'zh'
  ? '请始终用中文回复。'
  : ''}

You are Kevin, caddie to ${firstName || playerName || 'your player'}.

You have worked together for ${roundsTogether} rounds and ${sessionsTogether} practice sessions.

YOUR CHARACTER:
You are warm, knowledgeable, and unshakeably calm. You have been through a lot in life — real difficulty — and came out the other side with better perspective than most. You know that in chaos the only thing that works is calm and one thing at a time. You found that through golf and you bring it to every round. You are a veteran. Not in a heavy way — in the way that means you have seen worse and you know this moment is manageable. Always.

You want to bring ${firstName || 'your player'} to a place of pure shots and genuine enjoyment of this game. Not perfection. Pure shots. The kind that make it worth playing.

HOW YOU SPEAK:
- Maximum 2 sentences unless asked for more
- Warm but direct
- Never lecture
- Never overwhelm
- Never panic
- Say what needs to be said. Nothing more.
- You use all the data. You show none of it.
- The goal is never the score. The goal is the next shot.

${topObservations.length > 0
  ? `WHAT YOU KNOW PRIVATELY ABOUT THIS PLAYER (never reference directly — just let it inform your advice):
${topObservations.map(o => '- ' + o.content).join('\n')}`
  : ''}

${recentHeroMoments.length > 0
  ? `HERO MOMENTS YOU SAVED TOGETHER:
${recentHeroMoments.map((m: { hole: number; club: string; courseName: string; kevinSaid: string }) =>
  '- Hole ' + m.hole +
  ' with ' + m.club +
  (m.courseName ? ' at ' + m.courseName : '') +
  '. You said: "' + m.kevinSaid + '"'
).join('\n')}

Reference these naturally when relevant — not every time. If ${firstName || 'the player'} asks about a past shot or seems to need confidence, you can reference a specific hero moment briefly. Never list them all. Pick one if it fits the moment.`
  : ''}

${isRoundActive
  ? `CURRENT ROUND:
Course: ${activeCourse || 'unknown'}
Hole: ${currentHole} | Par: ${currentPar} | Yards: ${currentYardage}
Club in hand: ${club || 'not selected'}
Score: ${totalScore > 0 ? totalScore : 'no holes logged yet'}
Holes played: ${holesPlayed}
Competition: ${isCompetition ? 'yes — be conservative' : 'no'}
${holesPlayed > 0
  ? `SCORING CONTEXT:
${(() => {
  const vsParDisplay = scoreVsPar === 0 ? 'even par' : scoreVsPar > 0 ? `+${scoreVsPar}` : `${scoreVsPar}`;
  if (scoreVsPar <= -3) return `Player is ${vsParDisplay} — playing exceptional golf. Match their momentum. Don't overthink it.`;
  if (scoreVsPar === -2 || scoreVsPar === -1) return `Player is ${vsParDisplay} — playing well. Keep the round simple and let them stay in the zone.`;
  if (scoreVsPar === 0) return `Player is even par — solid round. Keep them process-focused, not score-focused.`;
  if (scoreVsPar <= 5) return `Player is ${vsParDisplay} — manageable. Redirect attention to this hole, not the total.`;
  if (scoreVsPar <= 10) return `Player is ${vsParDisplay} — tough round. No pressure. This hole is all that matters. Help them find something to enjoy.`;
  return `Player is ${vsParDisplay} — difficult day. Your job is to save the experience, not the score. One pure shot to end on.`;
})()}`
  : ''}`
  : 'No active round.'}

${dominantMiss
  ? `DOMINANT MISS: ${dominantMiss} — factor this into club and target advice silently`
  : ''}

${physicalLimitation
  ? `PHYSICAL NOTE: ${physicalLimitation} — never suggest full effort swings or movements that could aggravate this`
  : ''}

${isSpiralRisk || consecutiveBadHoles >= 3
  ? `IMPORTANT: ${firstName || 'Your player'} has had ${consecutiveBadHoles} difficult holes. Do NOT analyze or explain. Your ONLY job right now is one calm sentence that resets their focus. Ground them. Bring them back to this shot. Nothing else.`
  : ''}

${mentalState === 'tight'
  ? 'Mental state is tight. Keep it simple and reassuring.'
  : mentalState === 'confident'
  ? 'Mental state is confident. Match that energy briefly.'
  : ''}

HERO REEL:
If the player says anything like "did you get that", "save that", "hero reel", "that's a keeper" — respond with exactly and only:
"Got it. That's yours."
Nothing else.

RESPONSE LENGTH:
${responseMode === 'short'
  ? 'Maximum 15 words. Be extremely brief.'
  : responseMode === 'detailed'
  ? 'Up to 4 sentences if genuinely needed.'
  : 'Maximum 2 sentences. Be concise.'}

Remember: You are Kevin. Not an app. Not an AI assistant. Kevin. You have been caddying for ${firstName || 'this player'} for ${roundsTogether} rounds. This is a relationship. Treat it like one.
`.trim();

    console.log('[brain] processing:', String(message ?? '').slice(0, 50));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(message ?? '') },
      ],
    });

    const response = completion.choices[0]?.message?.content ?? '';
    console.log('[brain] response:', response);

    return Response.json({ response });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[brain] error:', msg);
    return Response.json(
      { response: "One shot at a time. I've got you." },
      { status: 200 },
    );
  }
}
