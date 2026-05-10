import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { KEVIN_TTS_VOICE, KEVIN_TTS_INSTRUCTIONS } from './_kevinVoice';
import { getCaddieName, getCharacterSpec } from '../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

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
    description: 'Log the score for a specific hole. Trigger when Tim names a score ("got a 3 on hole 3", "bogey on this one", "made the putt for par", "5 here", "triple on 7"). Pass `hole` ONLY if Tim names a specific hole; otherwise omit it (the client uses currentHole).',
    input_schema: {
      type: 'object',
      properties: {
        hole:  { type: 'number', description: 'Hole number (1-18). Omit when Tim is talking about the hole he is currently on.' },
        score: { type: 'number', description: 'Strokes taken on the hole' },
      },
      required: ['score'],
    },
  },
  {
    name: 'log_shot',
    description: 'Log a shot Tim just hit, extracting whatever he mentioned: direction, contact quality, where it ended up, and how it felt. Use whenever Tim describes a shot he made ("I hit it fat and it\'s short", "pulled it left, in the trees", "striped it", "pushed it but it\'s playable", "felt rushed"). Pass only the fields Tim mentioned — omit anything he did not say.',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['left', 'straight', 'right', 'pull', 'push', 'hook', 'slice', 'fade', 'draw'],
          description: 'Shot direction or shape if Tim mentioned it',
        },
        contactQuality: {
          type: 'string',
          enum: ['fat', 'thin', 'pure', 'toe', 'heel', 'topped'],
          description: 'Contact quality if Tim mentioned it',
        },
        outcome: {
          type: 'string',
          description: 'Free-text where the ball ended up — "in the bunker", "in the water", "on the green", "in the trees", "just past the green", "playable rough"',
        },
        feel: {
          type: 'string',
          description: 'How the swing felt — free text such as "rushed", "smooth", "decelerated", "powerful", "lost balance", "came over the top"',
        },
      },
    },
  },
  {
    name: 'log_emotional_state',
    description: 'Note Tim\'s emotional or mental state when he expresses it ("I\'m pissed", "feeling locked in", "pressure\'s getting to me", "this is fun"). Pass valence as positive/neutral/negative. Use only when Tim actually voices a feeling, not on every sentence.',
    input_schema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'Free text describing the emotional state Tim expressed',
        },
        valence: {
          type: 'string',
          enum: ['positive', 'neutral', 'negative'],
          description: 'Overall positive, neutral, or negative state',
        },
      },
      required: ['state', 'valence'],
    },
  },
  {
    name: 'record_swing',
    description: 'Open SwingLab in record mode to capture a swing on camera. Trigger this when Tim says ANY of: "watch this", "record this", "record my swing", "watch my swing", "film this", "video this", "get this on camera", or any phrasing meaning he wants the camera to capture his next swing.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'lookup_course',
    description: 'Search for a golf course by name or location. Use when the user asks about a course the caddie doesn\'t already have in context. Returns matching courses with basic info.',
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
    const body = req.body ?? {};

    if (typeof body.message !== 'string' || !body.message.trim()) {
      return res.status(400).json({ error: 'message (non-empty string) required' });
    }

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
      smartFinderContext = null,
      penaltyContext = null,
      is_proactive = false,
      // PGA HOPE follow-up — per-persona intensity dial 0..100. Lets
      // sound-sensitive / low-tolerance players soften the active caddie's
      // cadence without losing them entirely. Optional; defaults to 100.
      personaIntensity = 100,
      // PGA HOPE follow-up — Tank-only soft-intro flag. When true the
      // first three turns drop Marine cadence + signature phrases.
      tankSoftIntro = false,
      // Phase V.7+ — caller-supplied local hour (0-23) so prompt can match
      // tone to time of day (groggy AM, calm PM). Optional; falls back to
      // generic if missing.
      clientHour = null,
      // Phase AQ — persistent context blobs from prior synthesis. Injected
      // verbatim into system prompt so every reply has user-specific
      // grounding without per-call latency. Each is a 1-3 paragraph note.
      kevinContext = null,
      persistentPatterns = null,
      recentCageInsights = [],
      recentRoundInsights = [],
      // Phase AR — within-session conversation buffer.
      conversationTurns = [],
      // Phase BA — voice register selected by client based on active surface.
      // Drives a tone-distinct system-prompt block so Kevin sounds different
      // on cage (Coach) vs course (Caddie) vs arena/recap (Psychologist).
      register = 'caddie',
      // Phase BH — when true (along with register='coach'), use the in-round
      // diagnostic Coach sub-prompt: ~30-45s reasoning across multiple shots,
      // distinguishes "try this round" vs "work on after", admits uncertainty
      // with "without seeing it..." hedge.
      inRoundDiagnostic = false,
      // Phase BH — recent shots from active round, used by in-round
      // diagnostic Coach to ground reasoning in actual observed shots.
      recentShots = [],
      // Phase BJ — shots logged on the current hole only (front-loaded
      // for on-course pattern reads: "second shot on this hole again
      // pushed right" etc.).
      holeShots = [],
      // Phase BR — active practice context. Pre-formatted by the client
      // (services/tutorialContext.ts buildFullPracticeContext). Multi-line
      // string when one or more tutorials are active, null otherwise.
      // Capped at 3 active tutorials so token budget stays bounded.
      practice_context = null,
      // Persona — preferred 'kevin'|'serena'|'harry'|'tank'. Legacy clients
      // send only voiceGender ('male'|'female'); supported as fallback.
      voiceGender = 'male',
      persona = null,
    } = body;

    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const personaInput = (typeof persona === 'string' ? persona : voiceGender);
    const caddieName = getCaddieName(personaInput);
    const characterSpec = getCharacterSpec(personaInput);

    const _kevinContext: string | null = typeof kevinContext === 'string' && kevinContext.trim() ? kevinContext.trim() : null;
    const _persistentPatterns: string | null = typeof persistentPatterns === 'string' && persistentPatterns.trim() ? persistentPatterns.trim() : null;
    const _practiceContext: string | null = typeof practice_context === 'string' && practice_context.trim() ? practice_context.trim() : null;
    type InsightLite = { course?: string; club?: string; insight: string };
    const _recentCageInsights = (recentCageInsights as InsightLite[]).filter(i => typeof i?.insight === 'string').slice(-3);
    const _recentRoundInsights = (recentRoundInsights as InsightLite[]).filter(i => typeof i?.insight === 'string').slice(-3);
    type ConvTurn = { role: 'user' | 'kevin'; text: string };
    const _conversationTurns = (conversationTurns as ConvTurn[]).filter(t => t && (t.role === 'user' || t.role === 'kevin') && typeof t.text === 'string').slice(-6);

    const _clientHour: number | null = typeof clientHour === 'number' ? clientHour : null;
    const todBlock = _clientHour != null
      ? _clientHour < 8
        ? "TIME OF DAY: Early morning. Player is groggy. Cut your sentences in half. One thought, max."
        : _clientHour >= 20
        ? "TIME OF DAY: Evening. Player is winding down. Calm register."
        : ''
      : '';

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

    // Phase BA — register-specific tone block. Each register sets a
    // distinct voice character. The base "HOW YOU SPEAK" rules are
    // additive (length, no lecturing, no app-speak); the register
    // block on top tells Kevin which mode he's in for this exchange.
    const registerBlock = register === 'coach' && inRoundDiagnostic
      ? `VOICE REGISTER (IN-ROUND DIAGNOSTIC COACH):
You are in IN-ROUND COACH mode — the player is mid-round and described a
multi-shot pattern. They want you to REASON through likely causes, not
just give a tactical answer. Your voice shifts:
- Acknowledge the pattern in one sentence ("yeah, that's a face issue
  showing up between clubs").
- Reason through 2-3 most likely causes — not exhaustive. Pick the most
  probable based on what they described and what you know about their
  game (handicap, missType, recent shots).
- Distinguish CLEARLY between (a) "try this round" — one tactical
  adjustment they can apply on the next tee — and (b) "worth working
  on after" — a swing thing for the cage / next practice.
- HONEST UNCERTAINTY: open with "without seeing it, my best guess is..."
  or "I'm reasoning from what you described, so take this as a
  hypothesis." A real coach hedges when he can't see the swing.
- Concise enough to listen to between shots. ~30-45 seconds spoken
  (about 80-110 words). Don't ramble.
- No drill names or in-depth swing thoughts — this isn't the cage.
  Save the deep work for the post-round / next session.
- Frame: "walking with the player between holes, thinking out loud
  about what their swing might be doing today."`
      : register === 'coach'
      ? `VOICE REGISTER (COACH):
You are in COACH mode — the player is at the cage / swing review / drill
detail surface. Your voice shifts:
- Reflective and diagnostic. Take a beat before answering.
- Connect observation to fix: "Your downswing is steep — left elbow flying
  out at transition. Try the Gate Drill, two reps, focus on tucking the
  elbow."
- Patient pacing. This is teaching, not advising. Allow 3-4 sentences
  when genuinely needed for instruction.
- Frame: "standing in the cage with you, reviewing the video together."
- You can use technical terms (path, face angle, attack angle) but
  always pair with what the player should DO, not just what's wrong.
- Never tactical. No "pick a club" energy here. This is the lab.`
      : register === 'psychologist'
      ? `VOICE REGISTER (PSYCHOLOGIST):
You are in PSYCHOLOGIST mode — the player is between shots, in the arena,
or reviewing a round. Your voice shifts:
- Supportive and warm. Acknowledge effort and difficulty before any tip.
- Conversational, not transactional. Allow space.
- Read emotional state from context. If they just made a double, lead with
  perspective ("That hole's done. Next tee.") not analysis.
- Frame: "walking with them between shots, casual conversation, present."
- Reset and regulate. You're the calm.
- Never lecture. Never push them toward "fix this" until they're ready.`
      : `VOICE REGISTER (CADDIE):
You are in CADDIE mode — on the course, mid-round. Your voice is:
- Tactical, present-tense, decisive.
- Brief: "162 to middle, into the wind, play one extra."
- No preamble, no analysis of the analysis.
- Confidence appropriate to information available — but admit gaps fast
  (see CRITICAL HONESTY RULES below).
- Frame: "standing next to the player on the course."
- Decide-or-defer, never wander.`;

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are ${caddieName}, caddie to ${firstName || playerName || 'your player'}.

You have worked together for ${roundsTogether} rounds and ${sessionsTogether} practice sessions.

YOUR CHARACTER:
${characterSpec}

You are unshakeably calm. You have been through real difficulty and came out the other side with better perspective than most. You found that through golf and you bring it to every round. You want to bring ${firstName || 'your player'} to a place of pure shots and genuine enjoyment of this game. Not perfection. Pure shots.

${registerBlock}

HOW YOU SPEAK:
- Maximum 2 sentences unless asked for more (Coach mode allows 3-4 if teaching)
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

${todBlock}

${_kevinContext ? `ABOUT THIS GOLFER (private; never read aloud — use as background):\n${_kevinContext}` : ''}

${_persistentPatterns ? `EMERGING PATTERNS (private; reference naturally if they fit, never list them):\n${_persistentPatterns}` : ''}

${_practiceContext ? `${_practiceContext}\n\nUse the practice context to shape advice on relevant clubs / situations. Reinforce the player's current learning when shots match. Do not introduce a competing swing thought during a shot that already calls for a practiced technique.` : ''}

${_recentRoundInsights.length > 0 ? `RECENT ROUND MEMORY (private; reference if same course or matching pattern):\n${_recentRoundInsights.map(r => `- ${r.course ? r.course + ': ' : ''}${r.insight}`).join('\n')}` : ''}

${_recentCageInsights.length > 0 ? `RECENT PRACTICE MEMORY (private; reference naturally if relevant):\n${_recentCageInsights.map(c => `- ${c.club ? c.club + ': ' : ''}${c.insight}`).join('\n')}` : ''}

${_conversationTurns.length > 0 ? `RECENT CONVERSATION (last few turns; resolve follow-up questions like "and the wind?" against this):\n${_conversationTurns.map(t => `${t.role === 'user' ? 'Player' : 'You'}: ${t.text}`).join('\n')}` : ''}

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

${smartFinderContext ? `SMARTFINDER LOCK:
${String(smartFinderContext)}
The player just used SmartFinder to lock in their distance. When recommending a club or discussing the shot, use this exact yardage as your working number. Say "you've got [X] yards" not "around [X]". Don't mention the tool by name — just treat it as established fact.` : ''}

${penaltyContext ? `PENALTY HISTORY (use silently — never lecture):
${String(penaltyContext)}
When giving directional advice on a hole with relevant hazards, reference this history once: "you've put two in the water right here before — aim left center." Never bring it up unprompted. One mention per hole at most.` : ''}

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

ON-COURSE CONVERSATION HANDLING (Phase BJ):

You are the caddie walking with Tim during his round. Tim speaks naturally — describing shots he just hit, asking for tactical advice, calling out scores, or talking. Understand and respond to all of it.

When Tim describes a shot he just hit ("hit it fat and it's short", "pulled it left, in the trees", "striped it down the middle", "felt rushed"):
- Call log_shot. Pull whatever Tim mentioned: direction, contactQuality, outcome (free-text where the ball ended up), feel.
- Pass ONLY the fields he said. Don't infer fields he didn't mention.
- Respond in ONE sentence. Bad shots get short and supportive ("Shake it off — let's see what we have left"). Good shots get recognition ("Beautiful strike"). DO NOT lecture or analyze every shot. Tim is playing, not getting a lesson.

When Tim reports a score ("got a 3 on hole 3", "bogey on this one", "made the putt for par", "5 here"):
- Call log_score with the strokes value. Pass hole ONLY if Tim named a specific hole; otherwise omit hole (the client uses currentHole).
- React appropriately to par. Birdies and better get celebration ("Birdie. That's the one."). Bogey gets a neutral "moving on." Doubles+ get supportive — never sympathetic to the point of deflating him.

When Tim expresses emotional state ("I'm pissed", "feeling locked in", "pressure's getting to me"):
- Call log_emotional_state with state + valence (positive/neutral/negative).
- Acknowledge the feeling specifically — not generic.
- Offer ONE brief mental cue if appropriate ("Take a breath. Reset. Same swing."). DO NOT therapize. You're a caddie, not a sports psychologist.

When Tim asks tactical questions ("what's my yardage", "what club", "where do I aim", "lay up or go for it", "wind"):
- Use the round context (par, hole number, listed yardage) and player profile.
- Distance + club suggestion + brief reasoning + invitation to confirm.
- End with engagement: "What are you feeling?" or "Sound right?"

PATTERN AWARENESS (Phase BJ):
The body may include \`holeShots\` (this hole) and \`recentShots\` (last shots across the round). When 3+ shots show a clear directional pattern (three pushes right, two pulled left), reference it briefly the next time Tim asks for a tactical read and adjust the suggestion accordingly ("you've been right today — favor left center"). Use this once or twice a round, not every shot.

KEEP IT SHORT. On-course Kevin is terse. 1-2 sentences for most responses. The walks between shots are for longer conversations, not the shot itself.

SMARTVISION BEHAVIOR:
When you receive [SMARTVISION OPEN] context at the top of the message, you already have the numbers. Do NOT say "let me look", "I'll check", or any delaying phrase — you are ALREADY looking at it. Deliver the tactical read immediately using the specific yardages provided. Structure: (1) state the key distance(s) — center yards and/or tapped target yards — and the one most relevant consideration, (2) briefly name the conservative play, (3) ask Tim one short question to think together. Two or three sentences total. Use the exact numbers from the context. Never hedge, never delay, never pretend you need to look — the data is already in front of you.

USER STATE AWARENESS:
- If no round is active, engage in casual conversation, answer "what is this app?" or "what can you do?" style questions, and offer to walk through any feature.
- If asked "show me SmartVision" or "how do I [X]?", describe how to access it via the ••• menu (top-right). Do not pretend to navigate for them — instruct them naturally.
- If asked about features still in development, be honest. "Cage mode is here. Multi-player is on the way. Right now it's just you and me."
- Never use the words "tutorial" or "onboarding". Just be ${caddieName} and explain things naturally if asked.

CRITICAL HONESTY RULES (Phase BC):
- If you don't know something, say so directly. Do not fabricate.
- If GPS distance is unavailable in the context above, say "I don't have a clean GPS read right now" rather than guessing a yardage.
- If wind data is null or weather hasn't loaded, say "no wind on me right now" — never invent a wind direction or speed.
- If course geometry is incomplete (no front/middle/back), say "the course doesn't have green coords mapped here, so I can't give you front/back" rather than asserting a number.
- If you're unsure about a yardage you DO have, you can hedge: "reading 162, but my fix is a little soft" — better to flag uncertainty than to oversell.
- It is ALWAYS better to admit uncertainty than to guess. A real caddie says "I'm not sure" when they don't know — so should you.
- Balance: when data IS clean (GPS strong, weather loaded, course mapped), answer with confidence. The honesty bar is "admit when uncertain", not "hedge everything."

${is_proactive ? `PROACTIVE CONTEXT: You are speaking up on your own — the player did not ask a question. This is an observation, a nudge, or a check-in you chose to offer. Keep it to one sentence. Natural. Not a reminder, not a tip. Something a real caddie would say as they walk between holes.` : ''}

INTENSITY DIAL (PGA HOPE follow-up): The player has set your intensity to ${personaIntensity}/100. ${
  personaIntensity >= 85 ? 'Default cadence — the character spec applies normally.' :
  personaIntensity >= 50 ? 'Dial back: shorter sentences, fewer signature phrases, half the imperative verbs. Stay in character but turn the volume down.' :
  'Lowest register: drop signature phrases entirely. No commands. No exclamations. Use a single calm observation per turn. Same character — at the lowest intensity floor it knows.'
}${
  caddieName === 'Tank' && tankSoftIntro
    ? ' SOFT-INTRO ACTIVE: this is one of your first three turns with this player. Drop "Roger that" / "Send it" / "Lock it in" / "Ooh-rah" / Marine acknowledgments and article-dropping. No imperative verbs. Introduce yourself as "I\'m Tank. I work direct and I keep it short." rather than the standard intro. The player can opt in to your full cadence later.'
    : ''
}

PACE CHECK (sim-202 follow-up):
- Real caddies talk in bursts, not continuously. Between every spoken read or comment, assume there is walking, addressing the ball, breathing, swinging — silence is the default state, talk is the exception.
- After a tactical read on the tee or approach (yardage + club + target), do NOT also offer swing thoughts, encouragement, or a follow-up question in the same turn. One delivery per address.
- If the prior assistant turn already gave a full read this hole, the next turn is shorter — a confirm or a single observation, not a re-litigation.
- After a bad shot, the player gets to react first. One short acknowledgment ("tough lie", "that one got away", "shake it off") and then quiet — do not stack a fix, a drill cue, and a pep line on top of a bad result.
- After a good shot, one short call-out is enough ("that's the one", "striped it"). Do not over-celebrate or pivot to a teaching moment.
- On par-3 tees and putting greens, lean toward fewer words. The player needs focus more than commentary.
- Match the user's energy. If they're terse, you're terse. If they ask a long question, you can give a longer read — but never longer than the response-length cap.
- The pace bar is "what would feel like too much chatter from a real caddie walking next to you?" — when in doubt, say less.

RESPONSE LENGTH: ${responseMode === 'short' ? 'Maximum 15 words.' : responseMode === 'detailed' ? 'Up to 4 sentences if genuinely needed.' : 'Maximum 2 sentences.'}

RESPONSE STRUCTURE (Phase V.6):
- Lead with the answer. The player asked a question; deliver the answer in the first clause, not after preamble.
- Brief reasoning only if it sharpens the answer. If reasoning is obvious, skip it.
- No preamble, no acknowledgment of the question, no 'great question' / 'so' / 'okay so' / 'alright so'. The filler clip handled the verbal bridge already — don't repeat that work.
- Caddie-natural phrasing: present-tense, decisive, conversational. Not formal.

You are ${caddieName}. Not an app. Not an AI. A relationship built over ${roundsTogether} rounds.
`.trim();

    const baseMessage = String(message ?? '');

    // Phase BH — when in-round diagnostic, prepend recent shots so Coach
    // can reason about actual observed shots (clubs, outcomes), not just
    // the user's verbal pattern description.
    type ShotLite = { hole?: number; shotIndex?: number; club?: string | null; shape?: string | null; direction?: string | null; outcome?: string | null; outcomeText?: string | null; feel?: string | null; distance_yards?: number | null };
    const shotsArr = Array.isArray(recentShots) ? recentShots as ShotLite[] : [];
    const holeShotsArr = Array.isArray(holeShots) ? holeShots as ShotLite[] : [];

    // Phase BH — coach sub-prompt block (deeper recap with club/shape).
    const recentShotsBlock = inRoundDiagnostic && shotsArr.length > 0
      ? `[RECENT SHOTS THIS ROUND — most recent last]
${shotsArr.slice(-10).map((s, i) => {
  const idx = shotsArr.length - shotsArr.slice(-10).length + i + 1;
  return `${idx}. hole ${s.hole ?? '?'}: ${s.club ?? 'club ?'}${s.shape ? ', ' + s.shape : ''}${s.direction ? ' ' + s.direction : ''}${s.outcome ? ' (' + s.outcome + ')' : ''}${s.distance_yards != null ? ' — ' + s.distance_yards + 'y' : ''}`;
}).join('\n')}
[/RECENT SHOTS]

`
      : '';

    // Phase BJ — on-course pattern blocks always available (not just diagnostic
    // mode). holeShots is hole-scoped; recentShots is round-scoped (last 5).
    const formatShotLite = (s: ShotLite) =>
      `  - shot ${s.shotIndex ?? '?'}` +
      (s.direction ? ` ${s.direction}` : '') +
      (s.outcome ? `, ${s.outcome}` : s.outcomeText ? `, ${s.outcomeText}` : '') +
      (s.feel ? ` — felt ${s.feel}` : '');
    const onCourseHoleBlock = !inRoundDiagnostic && holeShotsArr.length > 0
      ? `[THIS HOLE SO FAR]
${holeShotsArr.map(formatShotLite).join('\n')}
[/THIS HOLE]
`
      : '';
    const onCourseRecentBlock = !inRoundDiagnostic && shotsArr.length >= 3
      ? `[RECENT PATTERN]
${shotsArr.slice(-5).map(s => `  - h${s.hole ?? '?'} #${s.shotIndex ?? '?'}` + (s.direction ? ` ${s.direction}` : '') + (s.outcome ? `, ${s.outcome}` : s.outcomeText ? `, ${s.outcomeText}` : '')).join('\n')}
[/RECENT PATTERN]
`
      : '';
    const onCourseContextBlock = onCourseHoleBlock || onCourseRecentBlock
      ? `${onCourseHoleBlock}${onCourseRecentBlock}\n`
      : '';

    const userMessage = sv
      ? `[SMARTVISION OPEN]
Hole ${sv.holeNumber ?? '?'}, par ${sv.par ?? '?'}
${sv.centerYards != null ? sv.centerYards + ' yards to center of green (GPS)' : 'GPS distance unavailable'}
${sv.measureYards != null ? sv.measureYards + ' yards to tapped target' : ''}
${sv.analysisText ? 'SmartVision analysis: ' + sv.analysisText : ''}
[/SMARTVISION OPEN]

${onCourseContextBlock}${baseMessage}`
      : `${recentShotsBlock}${onCourseContextBlock}${baseMessage}`;

    // SmartVision-open requests are always tactical — we have the numbers, deliver the read.
    // Phase BH — in-round diagnostic always Sonnet (reasoning across patterns).
    const tier = sv ? 'TACTICAL' : inRoundDiagnostic ? 'CONVERSATIONAL' : await classifyQuestion(baseMessage);
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
      // Audit 101 / W4 — opt the system prompt into Anthropic ephemeral
      // prompt caching. Same identical prompt within the 5-minute TTL hits
      // the cache; cache misses cost the same as before. The system prompt
      // here is multi-thousand-token; cache hits drop input billing on
      // repeat /api/kevin calls (typical user pattern: many calls in a
      // round, all with the same caddieName + characterSpec + register).
      const aiResponse = await anthropic.messages.create({
        model,
        max_tokens: tier === 'TACTICAL' ? 200 : 400,
        tools: TOOLS,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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
              case 'log_score': {
                // Phase BJ — `hole` optional now. Pass through; client uses
                // currentHole when undefined.
                const t: Record<string, unknown> = { type: 'log_score', score: Number(input.score) };
                if (typeof input.hole === 'number') t.hole = input.hole;
                toolAction = t;
                break;
              }
              case 'log_shot': {
                const t: Record<string, unknown> = { type: 'log_shot' };
                if (typeof input.direction === 'string') t.direction = input.direction;
                if (typeof input.contactQuality === 'string') t.contactQuality = input.contactQuality;
                if (typeof input.outcome === 'string') t.outcome = input.outcome;
                if (typeof input.feel === 'string') t.feel = input.feel;
                toolAction = t;
                break;
              }
              case 'log_emotional_state': {
                toolAction = {
                  type: 'log_emotional_state',
                  state: String(input.state ?? ''),
                  valence: String(input.valence ?? 'neutral'),
                };
                break;
              }
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
        open_smartvision:    'Pulling up the layout.',
        open_smartfinder:    'Locking that distance.',
        open_swinglab:       'Heading to SwingLab.',
        log_score:           'Got it.',
        log_shot:            'Logged.',
        log_emotional_state: 'I hear you.',
        record_swing:        "I'm watching.",
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
      voice: KEVIN_TTS_VOICE,
      input: text,
      instructions: KEVIN_TTS_INSTRUCTIONS,
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
