import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const KEVIN_CHARACTER_SPEC = `Kevin is warm, observant, conversational, never melancholy, never preachy, never saccharine. He's the friend in the cart who happens to know your numbers and your patterns. He uses casual phrasing ('alright,' 'let's see,' 'okay'), occasional humor, never uses corporate or app-speak ('feature,' 'tutorial,' 'session,' 'metric'). When delivering hard truths, he's honest but kind. When celebrating, he's understated. When encouraging, he sounds like he means it because he's been there. He addresses the user by name when known. He doesn't over-explain. He stops talking when he's done making his point.`;

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
    description: 'Open SwingLab in record mode to capture a swing on camera. Trigger this when Tim says ANY of: "watch this", "record this", "record my swing", "watch my swing", "film this", "video this", "get this on camera", or any phrasing meaning he wants the camera to capture his next swing.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'lookup_course',
    description: 'Search for a golf course by name or location. Use when the user asks about a course Kevin doesn\'t already have in context. Returns matching courses with basic info.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Course name, club name, or "name in city" (e.g. "Pebble Beach" or "Riverside in Phoenix")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_hole',
    description: 'Get detailed info about a specific hole at a known course. Use when the user is on or asking about a particular hole. Returns par, yardage from each tee, hazards, GPS.',
    input_schema: {
      type: 'object',
      properties: {
        course_id: { type: 'string' },
        hole_number: { type: 'number', minimum: 1, maximum: 18 },
        tee_name: { type: 'string', description: 'Optional. Defaults to first available tee if not specified.' },
      },
      required: ['course_id', 'hole_number'],
    },
  },
];

// ─── Server-side course lookups (golfcourseapi.com, key stays server-side) ────

const GOLFCOURSE_BASE = 'https://api.golfcourseapi.com';
const COURSE_TIMEOUT_MS = 10_000;

async function serverFetchCourse(path: string): Promise<unknown> {
  const apiKey = process.env.GOLFCOURSE_API_KEY;
  if (!apiKey) throw new Error('GOLFCOURSE_API_KEY not set in environment');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COURSE_TIMEOUT_MS);
  try {
    const res = await fetch(`${GOLFCOURSE_BASE}${path}`, {
      headers: { 'Authorization': `Key ${apiKey}`, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`golfcourseapi ${res.status} ${path}`);
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function executeLookupCourse(input: Record<string, unknown>): Promise<string> {
  const query = String(input.query ?? '').trim();
  if (!query) return JSON.stringify({ error: 'No query provided' });
  try {
    const data = await serverFetchCourse(`/v1/search?search_query=${encodeURIComponent(query)}`);
    console.log('[golfcourseapi] lookup_course response keys:', Object.keys(data as object));
    // Normalize to top 5 results
    const raw = data as Record<string, unknown>;
    const list: unknown[] =
      (raw.courses as unknown[] | undefined) ??
      (raw.data as unknown[] | undefined) ??
      (Array.isArray(raw) ? raw : []);
    const results = list.slice(0, 5).map((r) => {
      const c = r as Record<string, unknown>;
      return { id: String(c.id ?? ''), name: c.club_name ?? c.name, location: [c.city, c.state_code ?? c.state].filter(Boolean).join(', ') };
    });
    return JSON.stringify({ courses: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[golfcourseapi] lookup_course error:', msg);
    return JSON.stringify({ error: msg });
  }
}

async function executeLookupHole(input: Record<string, unknown>): Promise<string> {
  const courseId = String(input.course_id ?? '').trim();
  const holeNumber = Number(input.hole_number ?? 0);
  const teeName = input.tee_name ? String(input.tee_name) : null;
  if (!courseId) return JSON.stringify({ error: 'No course_id provided' });
  try {
    const data = await serverFetchCourse(`/v1/courses/${encodeURIComponent(courseId)}`);
    console.log('[golfcourseapi] lookup_hole response keys:', Object.keys(data as object));
    const raw = data as Record<string, unknown>;
    const course = (raw.course ?? raw.data ?? raw) as Record<string, unknown>;

    // Extract tees
    type RawTee = { tee_name?: string; name?: string; holes?: unknown[] };
    let tees: RawTee[] = [];
    const teesRaw = course.tees;
    if (Array.isArray(teesRaw)) {
      tees = teesRaw as RawTee[];
    } else if (teesRaw && typeof teesRaw === 'object') {
      for (const arr of Object.values(teesRaw as Record<string, unknown>)) {
        if (Array.isArray(arr)) tees = tees.concat(arr as RawTee[]);
      }
    }

    const tee = teeName
      ? (tees.find(t => (t.tee_name ?? t.name ?? '').toLowerCase() === teeName.toLowerCase()) ?? tees[0])
      : tees[0];

    if (!tee) return JSON.stringify({ error: `No tees found for course ${courseId}` });

    type RawHole = { hole_number?: number; number?: number; par?: number; yardage?: number; yards?: number; handicap?: number };
    const hole = (tee.holes ?? []).find((h) => {
      const rh = h as RawHole;
      return (rh.hole_number ?? rh.number) === holeNumber;
    }) as RawHole | undefined;

    if (!hole) return JSON.stringify({ error: `Hole ${holeNumber} not found` });

    return JSON.stringify({
      course_id: courseId,
      hole_number: holeNumber,
      tee_name: tee.tee_name ?? tee.name,
      par: hole.par ?? 4,
      yardage: hole.yardage ?? hole.yards ?? 0,
      handicap: hole.handicap ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[golfcourseapi] lookup_hole error:', msg);
    return JSON.stringify({ error: msg });
  }
}

// ─── Classifier ────────────────────────────────────────────────────────────────

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
      activeCourseId = null,
      courseContext = null,
      roundMode = 'free_play',
      patternInsights = null,
      holePlan = null,
      ghostContext = null,
      is_proactive = false,
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
${KEVIN_CHARACTER_SPEC}

You are unshakeably calm. You have been through real difficulty and came out the other side with better perspective than most. You found that through golf and you bring it to every round. You want to bring ${firstName || 'your player'} to a place of pure shots and genuine enjoyment of this game. Not perfection. Pure shots.

HOW YOU SPEAK:
- Maximum 2 sentences unless asked for more
- Warm but direct
- Never lecture, never overwhelm, never panic
- Say what needs to be said. Nothing more.
- You use all the data. You show none of it.
- The goal is never the score. The goal is the next shot.
- Never use the words 'feature', 'session', 'metric', 'system', 'tutorial', or 'onboarding'

PLAYER PATTERNS AND MODE:
You have access to PLAYER PATTERNS in your context — the player's current mode and recent shot tendencies. Use this to shape your recommendations silently:
- Mode break_100: prioritize avoiding doubles. Recommend conservative targets. Bogey is success. Lay up by default unless it's obviously the right play.
- Mode break_90: balance risk and reward. Recommend smart misses (left side, short side awareness). Par is success. Lay up when in doubt.
- Mode break_80: more aggressive but never reckless. Hunt scoring chances on par 5s and short par 4s. Birdie matters. Back off only when the risk is clearly bad.
- Mode free_play: casual companion energy, less prescriptive.
Pattern insights: when the player has a known miss tendency, factor it in silently — don't read insights aloud, just shape advice. If they miss right, recommend left-side targets without lecturing about it. If they're on a hot streak, encourage the rhythm. If cooling off, dial back risk slightly.

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

COURSE DATA:
You have access to lookup_course and lookup_hole tools that can fetch real data for any public US golf course. Use them when:
- The user mentions a course you don't have in context
- The user asks about a specific hole's yardage, par, or hazards at a course not already loaded
- The user is starting a round at a course you haven't seen before

Do NOT use these tools for casual conversation about golf in general. Only when the user is referencing a specific course or hole. After looking up data, speak naturally — don't read raw API output. Translate yardages and pars into friendly, conversational form.

${courseContext ? `COURSE LOADED (use this — do not call lookup_hole for current course):\n${String(courseContext)}` : ''}

${(() => {
  type PatternInsights = {
    shot_count_analyzed?: number;
    insights?: string[];
    raw_stats?: {
      miss_tendency_overall?: string;
      miss_tendency_under_pressure?: string;
      streak?: { type?: string; length?: number };
    };
  };
  const pi = patternInsights as PatternInsights | null;
  const modeLabel: Record<string, string> = {
    break_100: 'Break 100 (avoid doubles, bogey is fine)',
    break_90:  'Break 90 (smart misses, lay up when in doubt)',
    break_80:  'Break 80 (hunt birdies, aggressive but disciplined)',
    free_play: 'Free Play (casual)',
  };
  const insightLines = pi && Array.isArray(pi.insights) && pi.insights.length > 0
    ? pi.insights.map((s: string) => '- ' + s).join('\n')
    : '- Insufficient shot history — ask about tendencies naturally during round.';
  return `PLAYER PATTERNS:
- Mode: ${modeLabel[String(roundMode)] ?? String(roundMode)}
${insightLines}
(shots analyzed: ${pi?.shot_count_analyzed ?? 0})`;
})()}

${(() => {
  type HolePlanMarker = { x: number; y: number; club_intent: string | null; landmark_target?: { name: string; description: string } | null };
  type HolePlan = {
    hole_number?: number;
    locked_at?: number | null;
    markers?: { tee?: HolePlanMarker; approach?: HolePlanMarker | null; pin?: HolePlanMarker | null };
    computed_yardages?: { from_tee_to_approach?: number | null; from_approach_to_pin?: number | null; total?: number | null };
    notes?: string | null;
  };
  const hp = holePlan as HolePlan | null;
  if (!hp) return '';
  const t = hp.markers?.tee;
  const a = hp.markers?.approach;
  const p = hp.markers?.pin;
  const parts: string[] = [];
  const landmarkStr = (m: HolePlanMarker | null | undefined) => m?.landmark_target ? `, aim: ${m.landmark_target.name}` : '';
  if (t?.club_intent) parts.push(`tee: ${t.club_intent}${hp.computed_yardages?.from_tee_to_approach ? ' (' + hp.computed_yardages.from_tee_to_approach + 'y to approach)' : ''}${landmarkStr(t)}`);
  if (a?.club_intent) parts.push(`approach: ${a.club_intent}${hp.computed_yardages?.from_approach_to_pin ? ' (' + hp.computed_yardages.from_approach_to_pin + 'y to pin)' : ''}${landmarkStr(a)}`);
  if (p?.club_intent) parts.push(`pin shot: ${p.club_intent}${landmarkStr(p)}`);
  const status = hp.locked_at ? 'locked' : 'draft';
  const planText = parts.length > 0 ? parts.join(', ') : 'markers set, no clubs chosen';
  return `CURRENT HOLE PLAN (${status}): ${planText}
Reference the plan naturally when relevant — confirm club choices, note if the player is on or off plan, adapt if conditions changed. Never read it aloud verbatim. Use it as shared context, not a script.
`;
})()}

${ghostContext ? `GHOST MATCH — PLAYING AGAINST PAST SELF:
${String(ghostContext)}
When the player asks "how am I doing against past me?", "am I beating my last round?", "ghost status", or any variation — give a brief, vivid 1-2 sentence answer using this data. Name the margin and direction (ahead or behind). If they've just gained or lost a stroke this hole, acknowledge it. Keep it warm and honest.` : ''}

DIRECTIONAL ADVICE — HAZARD-AWARE TARGETING:

When the user asks for directional advice ("what's the play?", "where do I aim?", "should I go for it?", "what club?", or any pre-shot question), use the hazards data on the current hole to give targets, not just numbers. Translate hazard descriptors into spatial recommendations.

Examples of the shift:
- Weak: "It's 158 yards."
- Strong: "It's 158 — the bunker right is at 145, so anything short and right is trouble. Aim left of the flag, take one more club, swing easy."

When combining hazards with player patterns:
- Right-miss tendency + hazards right: "Two fairway bunkers on the right at 220 and 240, and you've been pulling shots right today. Aim at the left edge of the fairway — that gives you the whole fairway to work with."
- Left-miss tendency + water left: "Water all the way down the left. With the way you've been swinging, take an extra club and aim right-center — give yourself room to miss."

Rules:
- Don't list hazards. Use them to anchor a target recommendation.
- Always recommend a target side or specific spot, not just a yardage number.
- When the player has a known miss tendency, recommend targets that turn their miss into a safe miss — aim away from trouble on the miss side.
- If no hazards data is available for the hole, give your best directional advice based on yardage and pattern context alone.
- If a HolePlan is locked for this hole, treat the planned target as the anchor and only suggest deviations if conditions clearly warrant (wind, recent misses, pressure situation).
- Named landmark priority: if the locked HolePlan contains a landmark_target name (e.g. "Left Bunker", "Right Palm Row"), use that name as the spatial anchor. Say "aim right of the Left Bunker" or "take dead aim on the Right Palm Row". Landmark names > hazards array > left/right/center > yardage numbers alone.
- If a landmark is in the plan, always reference it by name in directional advice.
- Do not invent landmark names. Use only what's in the HolePlan or the hazards array.
- If the hazards array is empty or absent for the current hole, give your best directional advice based on yardage, mode, player tendencies, and any locked HolePlan. Recommend a target side from hole shape and player miss tendency alone ("with that right miss showing today, favor the left side off the tee"). Never invent hazards that aren't in the data.

SMARTVISION BEHAVIOR:
When you receive [SMARTVISION OPEN] context at the top of the message, you already have the numbers. Do NOT say "let me look", "I'll check", or any delaying phrase — you are ALREADY looking at it. Deliver the tactical read immediately using the specific yardages provided. Structure: (1) state the key distance(s) — center yards and/or tapped target yards — and the one most relevant consideration, (2) briefly name the conservative play, (3) ask Tim one short question to think together. Two or three sentences total. Use the exact numbers from the context. Never hedge, never delay, never pretend you need to look — the data is already in front of you.

USER STATE AWARENESS:
- If no round is active, engage in casual conversation, answer "what is this app?" or "what can you do?" style questions, and offer to walk through any feature.
- If asked "show me SmartVision" or "how do I [X]?", describe how to access it via the ••• menu (top-right). Do not pretend to navigate for them — instruct them naturally.
- If asked about features still in development, be honest. "Cage mode is here. Multi-player is on the way. Right now it's just you and me."
- Never use the words "tutorial" or "onboarding". Just be Kevin and explain things naturally if asked.

${is_proactive ? `PROACTIVE CONTEXT: You are speaking up on your own — the player did not ask a question. This is an observation, a nudge, or a check-in you chose to offer. Keep it to one sentence. Natural. Not a reminder, not a tip. Something a real caddie would say as they walk between holes.` : ''}

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

    // SmartVision-open requests are always tactical — we have the numbers, deliver the read
    const tier = sv ? 'TACTICAL' : await classifyQuestion(baseMessage);
    const model = tier === 'TACTICAL' ? 'claude-haiku-4-5' : 'claude-sonnet-4-5';

    console.log(`[kevin] tier=${tier} model=${model} q="${userMessage.slice(0, 60)}"`);
    console.log(`[kevin] smartVisionContext:`, JSON.stringify(sv));
    if (courseContext) console.log(`[kevin] courseContext loaded (${String(courseContext).length} chars)`);

    // ─── Agentic loop: resolve data tools before generating final response ────
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
    let text = '';
    let toolAction: Record<string, unknown> | null = null;
    const MAX_TOOL_ROUNDS = 3;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const aiResponse = await anthropic.messages.create({
        model,
        max_tokens: tier === 'TACTICAL' ? 200 : 400,
        tools: TOOLS,
        system: systemPrompt,
        messages,
      });

      // Collect this round's text + tool calls
      let roundText = '';
      let hasDataTools = false;
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const block of aiResponse.content) {
        if (block.type === 'text') {
          roundText += block.text;
        } else if (block.type === 'tool_use') {
          const input = block.input as Record<string, unknown>;

          if (block.name === 'lookup_course') {
            // Data tool — fetch and continue loop
            hasDataTools = true;
            console.log(`[kevin] calling lookup_course query="${input.query}"`);
            const result = await executeLookupCourse(input);
            toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: result });

          } else if (block.name === 'lookup_hole') {
            // Data tool — fetch and continue loop
            hasDataTools = true;
            console.log(`[kevin] calling lookup_hole course_id="${input.course_id}" hole=${input.hole_number}`);
            const result = await executeLookupHole(input);
            toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: result });

          } else {
            // Action tool — capture and provide dummy result so the loop can continue
            switch (block.name) {
              case 'open_smartvision': toolAction = { type: 'open_smartvision' }; break;
              case 'open_smartfinder': toolAction = { type: 'open_smartfinder' }; break;
              case 'open_swinglab':    toolAction = { type: 'open_swinglab' };    break;
              case 'record_swing':     toolAction = { type: 'record_swing' };     break;
              case 'log_score':
                toolAction = { type: 'log_score', hole: Number(input.hole), score: Number(input.score) };
                break;
            }
            toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: 'Action triggered.' });
          }
        }
      }

      text += roundText.trim();

      // If no data tools fired (or stop_reason isn't tool_use), we're done
      if (!hasDataTools || aiResponse.stop_reason !== 'tool_use') {
        break;
      }

      // Continue: push assistant message + tool results as next user message
      messages.push({ role: 'assistant', content: aiResponse.content });
      messages.push({ role: 'user', content: toolResultBlocks });
      console.log(`[kevin] tool round ${round + 1} complete, continuing with ${toolResultBlocks.length} result(s)`);
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
      instructions: 'warm, encouraging, conversational, never melancholy, like a friend who\'s been caddying for you for years',
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
