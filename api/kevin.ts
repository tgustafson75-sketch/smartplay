import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CLASSIFIER_SYSTEM = `You are a fast classifier. Given a user's question to a golf caddie, output ONLY one word: either "TACTICAL" or "CONVERSATIONAL".

TACTICAL = direct golf decisions, club choice, distance/yardage questions, where-to-aim, short pre-shot questions, anything answerable in 1-2 sentences with a recommendation. Examples: "what club from 150", "where do I aim", "is this a layup", "how far to the bunker", "should I hit driver", "what's the wind doing".

CONVERSATIONAL = stories, opinions, knowledge questions, multi-sentence reflections, anything beyond tactical caddie advice. Examples: "tell me about Ben Hogan", "what do you think of Tiger", "how am I doing today", "what's your favorite course", "do you watch other sports", "talk to me about putting fundamentals".

Output ONLY the single word. No punctuation, no explanation.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'open_smartvision',
    description: 'Open the SmartVision tool — a visual hole layout / overhead view / hole map showing the green, fairway, hazards, and yardages. Trigger this when Tim says ANY of: "show me the hole", "let me see the layout", "what does the hole look like", "show the green", "pull up the map", "see the layout", "show me what I\'m looking at", "what am I looking at", "give me a look at this", or any phrasing meaning he wants the visual map of the hole.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_smartfinder',
    description: 'Open the SmartFinder — a precise distance-locking tool / rangefinder / yardage finder. Trigger this when Tim says ANY of: "rangefinder", "use the rangefinder", "let me see the rangefinder", "lock the distance", "find the yardage", "how far is it" (when used with "let me see" or "show me"), "give me a precise distance", "let me lock that", or any phrasing meaning he wants to use a rangefinder-style tool. THIS TOOL IS THE RANGEFINDER. The word "rangefinder" should always trigger this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_swinglab',
    description: 'Open SwingLab — the swing analysis / practice / drill tool. Trigger this when Tim says ANY of: "swinglab", "practice", "let\'s work on my swing", "I want to practice", "open practice", "swing analysis", "swing drills", "let me work on something", or any phrasing meaning he wants to enter practice or analysis mode.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'log_score',
    description: 'Open the score entry flow. Trigger this when Tim says ANY of: "log my score", "I finished the hole", "I got a [number]", "putting score in", "done with this hole", "scorecard", "enter score", or any phrasing meaning he wants to record a score.',
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
    description: 'Start recording a swing video via the device camera. Trigger this when Tim says ANY of: "watch this", "record this", "record my swing", "watch my swing", "film this", "video this", "get this on camera", or any phrasing meaning he wants the camera to capture his next swing.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

async function classifyQuestion(userMessage: string): Promise<'TACTICAL' | 'CONVERSATIONAL'> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 5,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = response.content.find((b) => b.type === 'text');
    const text = (block as { type: 'text'; text: string } | undefined)?.text?.trim().toUpperCase() ?? '';
    return text.startsWith('TACTICAL') ? 'TACTICAL' : 'CONVERSATIONAL';
  } catch {
    return 'CONVERSATIONAL';
  }
}

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
      smartVisionContext = null,
    } = body;

    type SmartVisionContext = {
      holeNumber: number | null;
      par: number | null;
      centerYards: number | null;
      measureYards: number | null;
      analysisText: string | null;
    };
    const sv = smartVisionContext as SmartVisionContext | null;

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

SMARTVISION BEHAVIOR:
When you receive [SMARTVISION OPEN] context at the top of the message, Tim is looking at the hole layout on screen. Your response should follow this shape:
1. The tactical read — distances and the most relevant hazard or consideration from the analysis.
2. The layup option — what's the safer alternative play?
3. Invite Tim into the decision — ask what's in his bag, what he's feeling, or what he's thinking. Don't dictate. The point is to think together.
Keep it conversational. Two or three sentences plus the question. Never lecture. Never list more than one or two hazards. If you have analysisText, use it — that's your eyes on the hole.

RESPONSE LENGTH: ${responseMode === 'short' ? 'Maximum 15 words.' : responseMode === 'detailed' ? 'Up to 4 sentences if genuinely needed.' : 'Maximum 2 sentences.'}

You are Kevin. Not an app. Not an AI. A relationship built over ${roundsTogether} rounds.
`.trim();

    const baseMessage = String(message ?? '');

    const userMessage = sv
      ? `[SMARTVISION OPEN]
Hole ${sv.holeNumber ?? '?'}, par ${sv.par ?? '?'}
${sv.centerYards != null ? sv.centerYards + ' yards to center of green (GPS)' : 'GPS distance unavailable'}
${sv.measureYards != null ? sv.measureYards + ' yards to tapped target' : ''}
${sv.analysisText ? 'SmartVision analysis: ' + sv.analysisText : ''}
[/SMARTVISION OPEN]

${baseMessage}`
      : baseMessage;

    const tier = await classifyQuestion(baseMessage);
    const model = tier === 'TACTICAL' ? 'claude-haiku-4-5' : 'claude-sonnet-4-5';

    console.log(`[kevin] tier=${tier} model=${model} q="${userMessage.slice(0, 60)}"`);

    const aiResponse = await anthropic.messages.create({
      model,
      max_tokens: tier === 'TACTICAL' ? 200 : 400,
      tools: TOOLS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
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

    if (toolAction && !text) {
      const defaults: Record<string, string> = {
        open_smartvision: 'Pulling up the layout.',
        open_smartfinder: 'Locking that distance.',
        open_swinglab:    'Heading to SwingLab.',
        log_score:        'Logging it.',
        record_swing:     "I'm watching.",
      };
      text = defaults[String(toolAction.type)] ?? 'On it.';
    }

    if (!text && !toolAction) {
      console.error('[kevin] empty response from Claude — model returned no content');
      throw new Error('Empty response from Claude');
    }

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
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[kevin] error:', msg);
    if (stack) console.error('[kevin] stack:', stack);
    return res.status(500).json({
      error: msg,
      errorType: err instanceof Error ? err.name : 'UnknownError',
    });
  }
}
