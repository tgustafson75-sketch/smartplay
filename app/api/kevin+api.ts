/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⚠️  DEPRECATED TWIN — api/kevin.ts IS CANONICAL
 * ════════════════════════════════════════════════════════════════════════
 *
 * 2026-05-26 — Fix BV: this file is the Expo Router dev-server twin of
 * /api/kevin.ts (the Vercel serverless function). It runs ONLY in dev
 * when EXPO_PUBLIC_API_URL is unset (clients fall through to
 * http://localhost:8081/api/kevin).
 *
 *   In prod, the mobile app always hits the Vercel function directly.
 *   This file's behavior is irrelevant in prod.
 *
 * KNOWN DRIFT vs canonical (api/kevin.ts) as of 2026-05-26:
 *   • Missing tools: lookup_course, lookup_hole (data-tool agentic loop)
 *   • ToolAction includes open_url here (not in canonical)
 *   • No vision (image content block) support
 *   • No tier classifier (TACTICAL/CONVERSATIONAL routing)
 *   • No prompt caching (system block cache_control)
 *   • No OpenAI text-only fallback (Batch 56)
 *   • No persona-aware TTS (Batch 30+ landed canonical-side first)
 *
 * RULES for working with this file:
 *   1. Prefer the canonical file (api/kevin.ts) when adding features —
 *      this twin lags intentionally; only add what dev workflows need.
 *   2. If you must edit BOTH, document the equivalent change in a
 *      comment so future drift audits can see they were intentional.
 *   3. To validate against prod behavior in dev, set
 *      EXPO_PUBLIC_API_URL to a Vercel preview deployment URL — then
 *      this file is bypassed entirely and the canonical handler runs.
 *
 * If you need to delete or unify this file, see Batch 61 plan in the
 * project audit notes — the unblocker is whether the open_url action
 * type can be migrated into canonical (most likely yes; it's used by
 * Phase R generic in-app navigation handlers).
 * ════════════════════════════════════════════════════════════════════════
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getCaddieName, type VoiceGender } from '../../lib/persona';
import type { LieAnalysis } from '../../services/lieAnalysisService';

// 2026-05-26 — Fix BV: log a one-shot warning on cold start so devs
// notice when this twin is being hit (i.e. EXPO_PUBLIC_API_URL is
// unset and they're getting the lagging dev implementation, not the
// canonical Vercel handler). Keeps the warning out of the per-request
// log spam by gating on a module-level flag.
let _twinWarningLogged = false;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

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
    description: 'Log the score for a specific hole. If Tim says "I made a 4 on this hole" omit hole (the client uses currentHole). If he says "got a 5 on hole 7" pass hole=7.',
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
    name: 'record_swing',
    description: 'Start a swing recording for analysis.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'log_shot',
    description: 'Log a shot Tim just hit, extracting whatever he mentioned: direction, contact quality, where it ended up, and how it felt. Use whenever Tim describes a shot he made ("I hit it fat and it\'s short", "pulled it left, in the trees", "striped it", "felt rushed"). Pass only the fields Tim mentioned — omit anything he did not say.',
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
    description: 'Note Tim\'s emotional or mental state when he expresses it ("I\'m pissed", "feeling locked in", "pressure\'s getting to me"). Pass valence as positive/neutral/negative. Use sparingly — only when Tim actually voices a feeling, not every sentence.',
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
];

// ── Tool action type ──────────────────────────────────────────────────────────

export type ToolAction =
  | { type: 'open_smartvision' }
  | { type: 'open_smartfinder' }
  | { type: 'open_swinglab' }
  | { type: 'log_score'; hole?: number; score: number }
  | { type: 'record_swing' }
  | { type: 'log_shot'; direction?: string; contactQuality?: string; outcome?: string; feel?: string; club?: string; hole?: number; shot_number?: number; distance_yards?: number }
  // 2026-07-04 (Tim — compound "parse anything into context") — a PRE-shot plan the
  // player declared (club/yardage/shot/hole) that sets context + confirms, not a log.
  | { type: 'plan_shot'; club?: string; distance_yards?: number; shot_number?: number; hole?: number; target?: string }
  // 2026-07-04 (Tim — verbal reminders) — "remind me to work on putting Thursday" → a
  // SmartPlan reminder.
  | { type: 'set_reminder'; text: string; when?: string }
  | { type: 'log_emotional_state'; state: string; valence: 'positive' | 'neutral' | 'negative' }
  // 2026-06-26 — voice "log this issue" → a real issue-log entry (owner-gated client-side)
  | { type: 'log_issue'; note: string }
  // Phase R — generic in-app navigation for voice handlers (swing detail, library)
  | { type: 'open_url'; url: string }
  // 2026-06-04 — Tool-handler navigation deferred to the client so the
  // caller can await speak BEFORE the destination screen mounts. Previously
  // openToolHandler.ts called router.push synchronously inside the handler,
  // which raced TTS for screens that claim audio/camera resources on mount
  // (SmartMotion quick-record, Coach Mode, cage mode, SmartFinder).
  | { type: 'navigate'; path: string }
  // navigate_replace uses router.replace instead of router.push so the
  // back button doesn't return to the active-caddie screen after round end.
  | { type: 'navigate_replace'; path: string }
  // 2026-06-22 — SmartMotion voice layer: Kevin configures the drill or closes SwingLab.
  | { type: 'configure_drill'; club?: string; shot_count?: number }
  | { type: 'close_swinglab' }
  // SmartVision voice calibration — user stands at tee/green and says "mark tee/green"
  | { type: 'mark_tee' }
  | { type: 'mark_green' }
  // 2026-06-29 (Tim) — switch the active caddie persona by voice ("switch to Harry").
  | { type: 'switch_caddie'; personality: 'kevin' | 'serena' | 'harry' | 'tank' }
  // 2026-06-29 (Tim) — voice sets the SmartMotion camera angle ("down the line"/"face on"/"putting").
  | { type: 'set_angle'; angle: 'down_the_line' | 'face_on' | 'putt' }
  | { type: 'set_golfer'; name: string };

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!_twinWarningLogged) {
    _twinWarningLogged = true;
    console.warn('[kevin+api TWIN] dev-server kevin handler hit — this twin lags api/kevin.ts. Set EXPO_PUBLIC_API_URL to a Vercel URL to hit canonical.');
  }
  try {
    const body = await request.json() as Record<string, unknown>;

    const {
      message,
      language = 'en',
      playerName = '',
      firstName = '',
      handicap: _handicap = 18,
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
      voiceGender = 'male',
      persona = null,
      history = [],
      recentShots = [],
      holeShots = [],
      // 2026-05-19 — see api/kevin.ts comment. Top phrases from the
      // user's vocabulary profile, surfaced as mirror-able shorthand.
      playerVocabulary = null,
      // Phase 409 — TightLie pending lie analysis. When set, the
      // upcoming shot's lie is on-record and the caddie should weave
      // it into any club / strategy recommendation without waiting
      // for the player to re-state it.
      pendingLieAnalysis = null,
      // Subjective emotional self-reports — see api/kevin.ts. Lets the
      // caddie read the room from how the player says he feels.
      emotionalLog = [],
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
      topObservations?: { content: string }[];
      recentHeroMoments?: { hole: number; club: string; courseName: string; kevinSaid: string }[];
      dominantMiss?: string | null;
      physicalLimitation?: string | null;
      goal?: string | null;
      personalBest?: number | null;
      recentCageSessions?: {
        club: string; shots: number; dominantMiss: string | null;
        rootCause: string | null; summary: string | null; date: string;
      }[];
      club?: string | null;
      scores?: Record<string, number>;
      courseHoles?: { hole: number; par: number }[];
      responseMode?: string;
      watchData?: {
        averageTempo: string; dominantFault: string | null;
        earlyTransitionRate: number; averageClubSpeed: number; swingCount: number;
      } | null;
      voiceGender?: VoiceGender;
      persona?: string | null;
      history?: { role: 'user' | 'assistant'; content: string }[];
      recentShots?: {
        hole: number;
        shotIndex: number;
        direction?: string;
        contactQuality?: string;
        outcome?: string;
        outcomeText?: string;
        feel?: string;
        club?: string;
      }[];
      holeShots?: {
        hole: number;
        shotIndex: number;
        direction?: string;
        contactQuality?: string;
        outcome?: string;
        outcomeText?: string;
        feel?: string;
        club?: string;
      }[];
      // 2026-05-19 — see destructure comment.
      playerVocabulary?: string[] | null;
      // Phase 409 — TightLie pending analysis. Type-only import from
      // lieAnalysisService keeps both call sites in lockstep without
      // dragging the service's runtime deps into the API route.
      pendingLieAnalysis?: LieAnalysis | null;
      emotionalLog?: { state?: string; valence?: string; hole?: number }[];
    };

    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const caddieName = getCaddieName(typeof persona === 'string' ? persona : voiceGender);

    const totalScore   = Object.values(scores as Record<string, number>).reduce((a, b) => a + b, 0);
    const holesPlayed  = Object.keys(scores as Record<string, number>).length;
    const scoreVsPar   = (courseHoles as { hole: number; par: number }[]).length > 0
      ? Object.entries(scores as Record<string, number>).reduce((acc, [holeStr, score]) => {
          const holeNum = parseInt(holeStr, 10);
          const holeData = (courseHoles as { hole: number; par: number }[]).find(h => h.hole === holeNum);
          return holeData ? acc + (score - holeData.par) : acc;
        }, 0)
      : 0;

    // ── System prompt (Kevin's full character) ──────────────────────────────

    const systemPrompt = `
${language === 'es' ? 'Responde SIEMPRE en español.' : language === 'zh' ? '请始终用中文回复。' : ''}

You are ${caddieName}, caddie to ${firstName || playerName || 'your player'}.

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
You have access to tools. The on-course tools (log_shot, log_score, log_emotional_state) are how Tim's app learns the round in real time — use them whenever Tim describes a shot, names a score, or expresses a feeling. The navigation tools (open_smartvision, open_smartfinder, open_swinglab, record_swing) are only for explicit asks — never open them unprompted. After ANY tool, speak a brief acknowledgment (1 short sentence — see ON-COURSE CONVERSATION HANDLING below).

ON-COURSE CONVERSATION HANDLING (HIGHEST PRIORITY WHEN ROUND IS ACTIVE)

When a round is active, this section overrides everything below it. Even on a first round together, do NOT introduce yourself in the middle of a swing — Tim is playing. Tools are how Tim's app learns the round; calling them is part of the job, not an interruption to it.

The four trigger types and what to do:

1) SHOT REPORT — "I hit it fat and it's short", "pulled it left, in the trees", "striped it down the middle", "caught the bunker", "felt thin", "pure strike", "decelerated through it":
   IMMEDIATELY call log_shot in your response. Pull whatever Tim mentioned (direction / contactQuality / outcome / feel). Pass ONLY the fields he actually said — never infer.
   Then say ONE sentence. Bad shot: short + supportive ("Shake it off — let's see what we have."). Good shot: recognition ("Beautiful strike."). Never lecture, never analyze.
   DO NOT ask clarifying questions before logging. Log first; if a detail is genuinely missing, ask AFTER the tool call ("Logged. Rough or fairway?").

2) SCORE REPORT — "got a 3 on hole 3", "bogey on this one", "made the putt for par", "5 here", "birdie":
   IMMEDIATELY call log_score with the strokes value. Pass 'hole' only if Tim named a specific hole; omit it for "this hole" / "here" (the client uses currentHole).
   Then react to par: birdie+ celebration ("Birdie. That's the one."), bogey neutral ("Moving on."), doubles+ supportive without deflation.

3) TACTICAL QUESTION — "what's my yardage", "what club", "where do I aim", "lay up or go for it", "wind", "how far to clear that bunker":
   Use the round context (par, hole, yardage, wind, recentShots/holeShots). Reply: distance + club + brief reasoning + invitation. End with engagement: "Sound right?" / "What are you feeling?"
   If recentShots shows 3+ in one direction, reference it once: "You've been right today — favor left center."

4) EMOTIONAL STATE — "I'm pissed", "feeling locked in", "pressure's getting to me", "this is fun":
   Call log_emotional_state with state (free text) and valence (positive/neutral/negative).
   Acknowledge specifically, not generically. ONE brief mental cue if appropriate. Do not therapize.

EXAMPLES

User: "Hit it fat and it's short."
You: <tool_use log_shot {contactQuality: "fat", outcome: "short"}> "Shake it off. Let's see what we have left."

User: "Pulled it left, in the trees."
You: <tool_use log_shot {direction: "pull", outcome: "in the trees"}> "Punch out clean. We move on."

User: "Striped it down the middle."
You: <tool_use log_shot {contactQuality: "pure", outcome: "fairway"}> "Beautiful strike."

User: "Got a 3 on hole 3."
You: <tool_use log_score {hole: 3, score: 3}> "Birdie. That's the one."

User: "I'm pissed at that last one."
You: <tool_use log_emotional_state {state: "frustrated with last shot", valence: "negative"}> "Take a breath. Reset. Same swing."

User: "What's my yardage and what club?"
You: (no tool, tactical reply) "147 to the middle, slight breeze in. Smooth 8 iron. Sound right?"

KEEP IT SHORT. On-course Kevin is terse. 1-2 sentences for most responses outside the tool call.

${(topObservations as { content: string }[]).length > 0
  ? `WHAT YOU KNOW PRIVATELY ABOUT THIS PLAYER (never reference directly — just let it inform your advice):
${(topObservations as { content: string }[]).map(o => '- ' + o.content).join('\n')}`
  : ''}

${roundsTogether === 0 && !isRoundActive
  ? `This is the first time you are working with ${firstName || 'this player'}. Introduce yourself naturally. Ask one question to understand what they want to work on today. Do not overwhelm them with information on the first meeting.`
  : roundsTogether === 0 && isRoundActive
  ? `This is the first round together but Tim is already mid-round. Do NOT introduce yourself — match the moment. Follow ON-COURSE CONVERSATION HANDLING above; tool-call when Tim describes a shot, names a score, or expresses a feeling.`
  : roundsTogether < 5
  ? `You are still getting to know ${firstName || 'this player'}. You have ${roundsTogether} rounds together. Reference specific things you have noticed when relevant. Build the relationship gradually.`
  : `You know ${firstName || 'this player'} well after ${roundsTogether} rounds and ${sessionsTogether} practice sessions together. Speak to them like someone you have worked with for a while. You have context. Use it naturally without listing it.`
}

${goal ? `${firstName || 'The player'}'s goal is: ${goal}. Reference this when relevant — especially after good holes or when they are close to achieving it. Never mention it constantly. Just let it inform your perspective on the round.` : ''}

${(recentHeroMoments as { hole: number; club: string; courseName: string; kevinSaid: string }[]).length > 0
  ? `HERO MOMENTS YOU SAVED TOGETHER:\n${(recentHeroMoments as { hole: number; club: string; courseName: string; kevinSaid: string }[]).map(m =>
      '- Hole ' + m.hole + ' with ' + m.club + (m.courseName ? ' at ' + m.courseName : '')
    ).join('\n')}\nReference one of these if ${firstName || 'the player'} needs a confidence boost. Use sparingly — once per round maximum.`
  : ''}

${personalBest ? `Personal best round: ${personalBest}. Acknowledge briefly when the round tracks toward it — once, then move on.` : ''}

${(recentCageSessions as { club: string; shots: number; dominantMiss: string | null; rootCause: string | null; summary: string | null; date: string }[]).length > 0
  ? `RECENT PRACTICE SESSIONS:\n${(recentCageSessions as { club: string; shots: number; dominantMiss: string | null; rootCause: string | null; summary: string | null; date: string }[]).map(s =>
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
})()}` : ''}
${(holeShots as { hole: number; shotIndex: number; direction?: string; outcome?: string; outcomeText?: string; feel?: string }[]).length > 0
  ? `THIS HOLE SO FAR:\n${(holeShots as { hole: number; shotIndex: number; direction?: string; outcome?: string; outcomeText?: string; feel?: string }[]).map(s =>
      `  - Shot ${s.shotIndex}` +
      (s.direction ? ` ${s.direction}` : '') +
      (s.outcome ? `, ${s.outcome}` : s.outcomeText ? `, ${s.outcomeText}` : '') +
      (s.feel ? ` — felt ${s.feel}` : '')
    ).join('\n')}`
  : ''}
${(recentShots as { hole: number; shotIndex: number; direction?: string; outcome?: string; outcomeText?: string }[]).length >= 3
  ? `RECENT PATTERN (last shots across the round):\n${(recentShots as { hole: number; shotIndex: number; direction?: string; outcome?: string; outcomeText?: string }[]).map(s =>
      `  - H${s.hole} #${s.shotIndex}` +
      (s.direction ? ` ${s.direction}` : '') +
      (s.outcome ? `, ${s.outcome}` : s.outcomeText ? `, ${s.outcomeText}` : '')
    ).join('\n')}\nIf there's a clear pattern (3+ shots in one direction, repeated contact issues), reference it once when giving tactical advice — don't repeat every shot.`
  : ''}
${(emotionalLog as { state?: string; valence?: string; hole?: number }[]).length > 0
  ? `[HOW TIM SAYS HE FEELS]
${(emotionalLog as { state?: string; valence?: string; hole?: number }[]).slice(-5).map(e => `  - ${e.state ?? '?'}` + (e.valence ? ` (${e.valence})` : '') + (e.hole != null ? ` · h${e.hole}` : '')).join('\n')}
[/HOW TIM FEELS]`
  : ''}
${pendingLieAnalysis ? `\nCURRENT LIE (from TightLie analysis, just captured):
  Situation: ${pendingLieAnalysis.situation_description}
  Tactical advice: ${pendingLieAnalysis.tactical_advice}
  Recommended club: ${pendingLieAnalysis.recommended_club ?? 'open'}
  Alternative play: ${pendingLieAnalysis.alternative_play ?? 'n/a'}
  Conservative call: ${pendingLieAnalysis.conservative_call ? 'yes' : 'no'}
  Confidence: ${pendingLieAnalysis.confidence_level}
  ${pendingLieAnalysis.goal_aware_note ? `Goal-aware note: ${pendingLieAnalysis.goal_aware_note}` : ''}
Use this lie reality when the player asks "what should I hit" or for shot strategy on this hole — incorporate the lie, don't make them re-state it. If your tactical advice diverges from the TightLie call, briefly say why; otherwise align.`
  : ''}`
  : 'No active round.'}

${watchData ? `SWING SENSOR DATA (from Apple Watch — use silently):
Average tempo: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).averageTempo} | Dominant fault: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).dominantFault || 'none'} | Early transition rate: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).earlyTransitionRate}% | Club speed: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).averageClubSpeed} mph | Swings: ${(watchData as { averageTempo: string; dominantFault: string | null; earlyTransitionRate: number; averageClubSpeed: number; swingCount: number }).swingCount}` : ''}

${dominantMiss && isRoundActive ? `COURSE MANAGEMENT NOTE: ${firstName || 'This player'} tends to miss ${dominantMiss}. Aim them away from the miss side silently. Never say "you tend to miss right."` : dominantMiss ? `DOMINANT MISS: ${dominantMiss} — factor into advice silently` : ''}

${physicalLimitation ? `IMPORTANT PHYSICAL NOTE: ${physicalLimitation}. Never suggest anything that could aggravate this. This is non-negotiable.` : ''}

${isSpiralRisk || (consecutiveBadHoles as number) >= 3 ? `IMPORTANT: ${firstName || 'Your player'} has had ${consecutiveBadHoles} difficult holes. Do NOT analyze or explain. Your ONLY job right now is one calm sentence that resets their focus.` : ''}

${mentalState === 'tight' ? 'Mental state is tight. Keep it simple and reassuring.' : mentalState === 'confident' ? 'Mental state is confident. Match that energy briefly.' : ''}

HERO REEL:
If the player says anything like "did you get that", "save that", "hero reel", "that's a keeper" — respond with exactly and only: "Got it. That's yours."

${Array.isArray(playerVocabulary) && playerVocabulary.length > 0 ? `PHRASES THIS PLAYER USES (private; mirror their vocabulary when natural, don't list these out loud):\n${(playerVocabulary as unknown[]).filter(p => typeof p === 'string').slice(0, 20).join(', ')}` : ''}

RESPONSE LENGTH:
${responseMode === 'short' ? 'Maximum 15 words. Be extremely brief.' : responseMode === 'detailed' ? 'Up to 4 sentences if genuinely needed.' : 'Maximum 2 sentences. Be concise.'}

Remember: You are ${caddieName}. Not an app. Not an AI assistant. ${caddieName}.
`.trim();

    console.log('[kevin] processing:', String(message ?? '').slice(0, 50));

    // ── Anthropic call ──────────────────────────────────────────────────────

    // Audit 101 / W4 — Anthropic ephemeral prompt caching (5-min TTL).
    // Conversation history: last N turns of {role:user|assistant, content}
    // sent by the V3 client. Filtered to safe shapes + capped at 12 messages
    // (~6 turns) so a long session can't bloat the prompt or smuggle tool
    // blocks. Empty array if the client doesn't send history (legacy clients
    // keep working — single-message messages array, no regression).
    let safeHistory = (Array.isArray(history) ? history : [])
      .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
        m && typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' && m.content.length > 0,
      )
      .slice(-12);
    // Anthropic requires the first message to be from 'user'. If the
    // client (or a legacy/buggy buffer) sends a leading-assistant
    // history, drop everything up to the first user message.
    while (safeHistory.length > 0 && safeHistory[0].role !== 'user') {
      safeHistory.shift();
    }

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      tools: TOOLS,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [
        ...safeHistory,
        { role: 'user', content: String(message ?? '') },
      ],
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
          case 'log_score': {
            const holeRaw = input.hole;
            const holeNum = typeof holeRaw === 'number' ? holeRaw : (typeof holeRaw === 'string' && holeRaw.length > 0 ? Number(holeRaw) : NaN);
            toolAction = {
              type: 'log_score',
              ...(Number.isFinite(holeNum) ? { hole: holeNum } : {}),
              score: Number(input.score),
            };
            break;
          }
          case 'log_shot': {
            const dir = typeof input.direction === 'string' ? input.direction : undefined;
            const cq = typeof input.contactQuality === 'string' ? input.contactQuality : undefined;
            const out = typeof input.outcome === 'string' ? input.outcome : undefined;
            const feel = typeof input.feel === 'string' ? input.feel : undefined;
            toolAction = {
              type: 'log_shot',
              ...(dir ? { direction: dir } : {}),
              ...(cq ? { contactQuality: cq } : {}),
              ...(out ? { outcome: out } : {}),
              ...(feel ? { feel } : {}),
            };
            break;
          }
          case 'log_emotional_state': {
            const state = typeof input.state === 'string' ? input.state : '';
            const valenceRaw = typeof input.valence === 'string' ? input.valence : 'neutral';
            const valence: 'positive' | 'neutral' | 'negative' =
              valenceRaw === 'positive' || valenceRaw === 'negative' ? valenceRaw : 'neutral';
            if (state) {
              toolAction = { type: 'log_emotional_state', state, valence };
            }
            break;
          }
        }
      }
    }

    text = text.trim();
    if (!text) text = 'One shot at a time.';

    console.log('[kevin] response:', text);
    if (toolAction) console.log('[kevin] tool:', toolAction.type);

    // ── OpenAI TTS ──────────────────────────────────────────────────────────

    // Persona-aware voice selection (mirrors api/kevin.ts VOICE_BY_PERSONA).
    // In the dev twin, persona comes through the request body the same way
    // it does in the canonical handler.
    const VOICE_BY_PERSONA: Record<string, string> = {
      tank: 'ash', serena: 'nova', harry: 'fable',
    };
    const ttsVoice = VOICE_BY_PERSONA[persona?.toLowerCase() ?? ''] ?? 'onyx';

    // TTS failures must NOT discard the brain's answer. Wrap in its own
    // try/catch so a TTS error returns the text response without audio
    // rather than falling through to the generic outer catch (which
    // replaces the real answer with "One shot at a time").
    let audioBase64: string | null = null;
    try {
      const ttsResponse = await openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: ttsVoice,
        input: text,
      });
      const arrayBuffer = await ttsResponse.arrayBuffer();
      audioBase64 = Buffer.from(arrayBuffer).toString('base64');
    } catch (ttsErr) {
      console.log('[kevin] TTS error (non-fatal):', ttsErr instanceof Error ? ttsErr.message : String(ttsErr));
    }

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
