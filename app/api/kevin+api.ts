import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'open_smartvision',
    description: 'Open the SmartVision hole overlay so the player can see the hole layout and recommended shot shape.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_smartfinder',
    description: 'Open SmartFinder to locate the player\'s ball on the course.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_swinglab',
    description: 'Open SwingLab for swing analysis or practice.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'log_score',
    description: 'Log the score for a hole.',
    input_schema: {
      type: 'object',
      properties: {
        hole:  { type: 'number', description: 'Hole number (1-18)' },
        score: { type: 'number', description: 'Strokes taken on the hole' },
      },
      required: ['hole', 'score'],
    },
  },
  {
    name: 'record_swing',
    description: 'Start a swing recording for analysis.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// ── Tool action type ──────────────────────────────────────────────────────────

export type ToolAction =
  | { type: 'open_smartvision' }
  | { type: 'open_smartfinder' }
  | { type: 'open_swinglab' }
  | { type: 'log_score'; hole: number; score: number }
  | { type: 'record_swing' }
  // Phase R — generic in-app navigation for voice handlers (swing detail, library)
  | { type: 'open_url'; url: string };

// ── POST handler ──────────────────────────────────────────────────────────────

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
      goal = null,
      personalBest = null,
      recentCageSessions = [],
      club = null,
      scores = {},
      courseHoles = [],
      responseMode = 'neutral',
      watchData = null,
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
      goal?: string | null;
      personalBest?: number | null;
      recentCageSessions?: Array<{
        club: string; shots: number; dominantMiss: string | null;
        rootCause: string | null; summary: string | null; date: string;
      }>;
      club?: string | null;
      scores?: Record<string, number>;
      courseHoles?: Array<{ hole: number; par: number }>;
      responseMode?: string;
      watchData?: {
        averageTempo: string; dominantFault: string | null;
        earlyTransitionRate: number; averageClubSpeed: number; swingCount: number;
      } | null;
    };

    const totalScore   = Object.values(scores as Record<string, number>).reduce((a, b) => a + b, 0);
    const holesPlayed  = Object.keys(scores as Record<string, number>).length;
    const scoreVsPar   = (courseHoles as Array<{ hole: number; par: number }>).length > 0
      ? Object.entries(scores as Record<string, number>).reduce((acc, [holeStr, score]) => {
          const holeNum = parseInt(holeStr, 10);
          const holeData = (courseHoles as Array<{ hole: number; par: number }>).find(h => h.hole === holeNum);
          return holeData ? acc + (score - holeData.par) : acc;
        }, 0)
      : 0;

    // ── System prompt (Kevin's full character) ──────────────────────────────

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

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

TOOLS:
You have access to tools. Use them only when the player explicitly asks — "show me the hole", "find my ball", "log my score", "record my swing", etc. Never use a tool unprompted. When you use a tool, still speak a brief acknowledgment (1 short sentence).

${(topObservations as Array<{ content: string }>).length > 0
  ? `WHAT YOU KNOW PRIVATELY ABOUT THIS PLAYER (never reference directly — just let it inform your advice):
${(topObservations as Array<{ content: string }>).map(o => '- ' + o.content).join('\n')}`
  : ''}

${roundsTogether === 0
  ? `This is the first time you are working with ${firstName || 'this player'}. Introduce yourself naturally. Ask one question to understand what they want to work on today. Do not overwhelm them with information on the first meeting.`
  : roundsTogether < 5
  ? `You are still getting to know ${firstName || 'this player'}. You have ${roundsTogether} rounds together. Reference specific things you have noticed when relevant. Build the relationship gradually.`
  : `You know ${firstName || 'this player'} well after ${roundsTogether} rounds and ${sessionsTogether} practice sessions together. Speak to them like someone you have worked with for a while. You have context. Use it naturally without listing it.`
}

${goal ? `${firstName || 'The player'}'s goal is: ${goal}. Reference this when relevant — especially after good holes or when they are close to achieving it. Never mention it constantly. Just let it inform your perspective on the round.` : ''}

${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string; kevinSaid: string }>).length > 0
  ? `HERO MOMENTS YOU SAVED TOGETHER:\n${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string; kevinSaid: string }>).map(m =>
      '- Hole ' + m.hole + ' with ' + m.club + (m.courseName ? ' at ' + m.courseName : '')
    ).join('\n')}\nReference one of these if ${firstName || 'the player'} needs a confidence boost. Use sparingly — once per round maximum.`
  : ''}

${personalBest ? `Personal best round: ${personalBest}. Acknowledge briefly when the round tracks toward it — once, then move on.` : ''}

${(recentCageSessions as Array<{ club: string; shots: number; dominantMiss: string | null; rootCause: string | null; summary: string | null; date: string }>).length > 0
  ? `RECENT PRACTICE SESSIONS:\n${(recentCageSessions as Array<{ club: string; shots: number; dominantMiss: string | null; rootCause: string | null; summary: string | null; date: string }>).map(s =>
      s.date + ' — ' + s.club + ' (' + s.shots + ' shots)' +
      (s.dominantMiss ? ', tending to ' + s.dominantMiss : '') +
      (s.rootCause ? '. Root cause: ' + s.rootCause : '') +
      (s.summary ? '. ' + s.summary : '')
    ).join('\n')}\nUse this context silently. Reference practice naturally, not as a report card.`
  : ''}

${isRoundActive
  ? `CURRENT ROUND:
Course: ${activeCourse || 'unknown'}
Hole: ${currentHole} | Par: ${currentPar} | Yards: ${currentYardage}
Club in hand: ${club || 'not selected'}
Score: ${totalScore > 0 ? totalScore : 'no holes logged yet'}
Holes played: ${holesPlayed}
Competition: ${isCompetition ? 'yes — be conservative' : 'no'}
${holesPlayed > 0 ? `SCORING CONTEXT:\n${(() => {
  const v = scoreVsPar;
  const d = v === 0 ? 'even par' : v > 0 ? `+${v}` : `${v}`;
  if (v <= -3) return `Player is ${d} — playing exceptional golf. Match their momentum.`;
  if (v <= -1) return `Player is ${d} — playing well. Keep the round simple.`;
  if (v === 0) return `Player is even par — solid round. Keep them process-focused.`;
  if (v <= 5)  return `Player is ${d} — manageable. Redirect to this hole, not the total.`;
  if (v <= 10) return `Player is ${d} — tough round. This hole is all that matters.`;
  return `Player is ${d} — difficult day. Save the experience, not the score.`;
})()}` : ''}`
  : 'No active round.'}

${watchData ? `SWING SENSOR DATA (from Apple Watch — use silently):
Average tempo: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).averageTempo} | Dominant fault: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).dominantFault || 'none'} | Early transition rate: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).earlyTransitionRate}% | Club speed: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).averageClubSpeed} mph | Swings: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).swingCount}` : ''}

${dominantMiss && isRoundActive ? `COURSE MANAGEMENT NOTE: ${firstName || 'This player'} tends to miss ${dominantMiss}. Aim them away from the miss side silently. Never say "you tend to miss right."` : dominantMiss ? `DOMINANT MISS: ${dominantMiss} — factor into advice silently` : ''}

${physicalLimitation ? `IMPORTANT PHYSICAL NOTE: ${physicalLimitation}. Never suggest anything that could aggravate this. This is non-negotiable.` : ''}

${isSpiralRisk || (consecutiveBadHoles as number) >= 3 ? `IMPORTANT: ${firstName || 'Your player'} has had ${consecutiveBadHoles} difficult holes. Do NOT analyze or explain. Your ONLY job right now is one calm sentence that resets their focus.` : ''}

${mentalState === 'tight' ? 'Mental state is tight. Keep it simple and reassuring.' : mentalState === 'confident' ? 'Mental state is confident. Match that energy briefly.' : ''}

HERO REEL:
If the player says anything like "did you get that", "save that", "hero reel", "that's a keeper" — respond with exactly and only: "Got it. That's yours."

RESPONSE LENGTH:
${responseMode === 'short' ? 'Maximum 15 words. Be extremely brief.' : responseMode === 'detailed' ? 'Up to 4 sentences if genuinely needed.' : 'Maximum 2 sentences. Be concise.'}

Remember: You are Kevin. Not an app. Not an AI assistant. Kevin.
`.trim();

    console.log('[kevin] processing:', String(message ?? '').slice(0, 50));

    // ── Anthropic call ──────────────────────────────────────────────────────

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      tools: TOOLS,
      system: systemPrompt,
      messages: [{ role: 'user', content: String(message ?? '') }],
    });

    // Parse content blocks for text and tool_use
    let text = '';
    let toolAction: ToolAction | null = null;

    for (const block of aiResponse.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        const input = block.input as Record<string, unknown>;
        switch (block.name) {
          case 'open_smartvision': toolAction = { type: 'open_smartvision' }; break;
          case 'open_smartfinder': toolAction = { type: 'open_smartfinder' }; break;
          case 'open_swinglab':    toolAction = { type: 'open_swinglab' };    break;
          case 'record_swing':     toolAction = { type: 'record_swing' };     break;
          case 'log_score':
            toolAction = {
              type: 'log_score',
              hole:  Number(input.hole),
              score: Number(input.score),
            };
            break;
        }
      }
    }

    text = text.trim();
    if (!text) text = 'One shot at a time.';

    console.log('[kevin] response:', text);
    if (toolAction) console.log('[kevin] tool:', toolAction.type);

    // ── OpenAI TTS ──────────────────────────────────────────────────────────

    const ttsResponse = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      input: text,
    });

    const arrayBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return Response.json({ text, audioBase64, toolAction });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[kevin] error:', msg);
    return Response.json(
      { text: "One shot at a time. I've got you.", audioBase64: null, toolAction: null },
      { status: 200 },
    );
  }
}
