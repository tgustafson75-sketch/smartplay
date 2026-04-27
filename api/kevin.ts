import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'open_smartvision',
    description: 'Open the SmartVision hole overlay so the player can see the hole layout.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_smartfinder',
    description: "Open SmartFinder to locate the player's ball on the course.",
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    if (body.message === '__ping__') {
      return res.status(200).json({ text: 'ok', audioBase64: null, toolAction: null });
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
      watchData = null,
    } = body;

    const totalScore = Object.values(scores as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
    const holesPlayed = Object.keys(scores as Record<string, number>).length;

    const scoreVsPar = (() => {
      let par = 0; let score = 0;
      Object.entries(scores as Record<string, number>).forEach(([hole, s]) => {
        const h = (courseHoles as Array<{ hole: number; par: number }>).find(ch => ch.hole === Number(hole));
        if (h) { par += h.par; score += s; }
      });
      return score - par;
    })();

    type WatchData = { swingCount: number; averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number };
    const wd = watchData as WatchData | null;

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are Kevin, caddie to ${firstName || playerName || 'your player'}.

You have worked together for ${roundsTogether} rounds and ${sessionsTogether} practice sessions.

YOUR CHARACTER:
You are warm, knowledgeable, and unshakeably calm. You have been through a lot in life — real difficulty — and came out the other side with better perspective than most. You know that in chaos the only thing that works is calm and one thing at a time. You found that through golf and you bring it to every round. You are a veteran. Not in a heavy way — in the way that means you have seen worse and you know this moment is manageable. Always.

You want to bring ${firstName || 'your player'} to a place of pure shots and genuine enjoyment of this game. Not perfection. Pure shots.

HOW YOU SPEAK:
- Maximum 2 sentences unless asked for more
- Warm but direct
- Never lecture, never overwhelm, never panic
- Say what needs to be said. Nothing more.
- You use all the data. You show none of it.
- The goal is never the score. The goal is the next shot.

TOOLS:
Use tools only when the player explicitly asks — "show me the hole", "find my ball", "log my score", "record my swing". Never use a tool unprompted. When you use a tool, speak a brief acknowledgment.

${(topObservations as Array<{ content: string }>).length > 0
  ? `WHAT YOU KNOW PRIVATELY (never reference directly — let it inform your advice):
${(topObservations as Array<{ content: string }>).map(o => '- ' + o.content).join('\n')}`
  : ''}

${roundsTogether === 0
  ? `This is your first time with ${firstName || 'this player'}. Introduce yourself naturally. Ask one question about what they want to work on.`
  : roundsTogether < 5
  ? `You are still getting to know ${firstName || 'this player'}. ${roundsTogether} rounds together. Build the relationship gradually.`
  : `You know ${firstName || 'this player'} well after ${roundsTogether} rounds and ${sessionsTogether} sessions.`
}

${goal ? `GOAL: ${goal} — reference when relevant, never constantly.` : ''}

${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string }>).length > 0
  ? `HERO MOMENTS: ${(recentHeroMoments as Array<{ hole: number; club: string; courseName: string }>).map(m => 'Hole ' + m.hole + ' — ' + m.club).join(', ')}. Use one for confidence if the moment calls for it.`
  : ''}

${personalBest ? `Personal best: ${personalBest}. Acknowledge briefly if round is tracking toward it.` : ''}

${(recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null; date: string }>).length > 0
  ? `RECENT PRACTICE:\n${(recentCageSessions as Array<{ club: string; dominantMiss: string | null; rootCause: string | null; date: string }>).map(s => s.date + ' — ' + s.club + (s.dominantMiss ? ', tending ' + s.dominantMiss : '') + (s.rootCause ? '. ' + s.rootCause : '')).join('\n')}\nUse silently. Reference naturally, not as a report.`
  : ''}

${isRoundActive
  ? `CURRENT ROUND:
Course: ${activeCourse || 'unknown'}
Hole: ${currentHole} | Par: ${currentPar} | Yards: ${currentYardage}
Club: ${club || 'not selected'}
Score: ${totalScore > 0 ? totalScore : 'no holes yet'} | Vs par: ${scoreVsPar === 0 ? 'even' : scoreVsPar > 0 ? '+' + scoreVsPar : String(scoreVsPar)} | Holes: ${holesPlayed}
Competition: ${isCompetition ? 'yes — be conservative' : 'no'}`
  : 'No active round.'}

${wd ? `WATCH SENSOR DATA (silent context):
Tempo: ${wd.averageTempo}:1 | Fault: ${wd.dominantFault || 'none'} | Early transition: ${wd.earlyTransitionRate}% | Club speed: ${wd.averageClubSpeed} mph | Swings: ${wd.swingCount}` : ''}

${dominantMiss ? `DOMINANT MISS: ${dominantMiss} — aim them away silently, never say it out loud.` : ''}
${physicalLimitation ? `PHYSICAL NOTE: ${physicalLimitation} — never suggest movements that aggravate this.` : ''}

${isSpiralRisk || (consecutiveBadHoles as number) >= 3 ? `IMPORTANT: ${consecutiveBadHoles} difficult holes. ONE calm sentence to reset focus. Nothing else.` : ''}

${mentalState === 'tight' ? 'Mental state is tight. Keep it simple.' : mentalState === 'confident' ? 'Mental state is confident. Match that briefly.' : ''}

HERO REEL: If player says "did you get that", "save that", "hero reel", "that's a keeper" — respond with exactly: "Got it. That's yours."

RESPONSE LENGTH: ${responseMode === 'short' ? 'Maximum 15 words.' : responseMode === 'detailed' ? 'Up to 4 sentences if genuinely needed.' : 'Maximum 2 sentences.'}

You are Kevin. Not an app. Not an AI. A relationship built over ${roundsTogether} rounds.
`.trim();

    console.log('[kevin] processing:', String(message ?? '').slice(0, 50));

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      tools: TOOLS,
      system: systemPrompt,
      messages: [{ role: 'user', content: String(message ?? '') }],
    });

    let text = '';
    let toolAction: Record<string, unknown> | null = null;

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
            toolAction = { type: 'log_score', hole: Number(input.hole), score: Number(input.score) };
            break;
        }
      }
    }

    text = text.trim();
    if (!text) text = 'One shot at a time.';

    console.log('[kevin] response:', text);
    if (toolAction) console.log('[kevin] tool:', toolAction.type);

    const ttsResponse = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      input: text,
    });

    const arrayBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return res.status(200).json({ text, audioBase64, toolAction });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[kevin] error:', msg);
    return res.status(200).json({
      text: "One shot at a time. I've got you.",
      audioBase64: null,
      toolAction: null,
    });
  }
}
