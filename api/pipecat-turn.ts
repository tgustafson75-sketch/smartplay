/**
 * Pipecat Phase 2 — Claude turn endpoint (Vercel).
 *
 * Replaces the Python pipecat-server /turn route for Phase 2.
 * No Railway needed. Lives on the same Vercel deployment as all other API routes.
 *
 * Flow:
 *   POST /api/pipecat-turn
 *   ← { text, history, context, secret }
 *   → { response_text, tool_actions, updated_history }
 *
 * Claude runs via runAgenticLoop (Anthropic provider).
 * Lookup tools (lookup_course, lookup_hole) execute server-side.
 * All other tool calls are returned as tool_actions for the RN client to dispatch.
 *
 * Auth: shared secret in PIPECAT_SESSION_SECRET env var (set in Vercel dashboard).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAgenticLoop, type AiToolDef } from './_aiProvider';

const SESSION_SECRET = process.env.PIPECAT_SESSION_SECRET ?? '';
const MAX_HISTORY_PAIRS = 6;
const GOLFCOURSE_BASE = 'https://api.golfcourseapi.com';
const COURSE_TIMEOUT_MS = 8_000;

async function fetchCourse(path: string): Promise<unknown> {
  const apiKey = process.env.GOLFCOURSE_API_KEY;
  if (!apiKey) throw new Error('GOLFCOURSE_API_KEY not set');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), COURSE_TIMEOUT_MS);
  try {
    const res = await fetch(`${GOLFCOURSE_BASE}${path}`, {
      headers: { Authorization: `Key ${apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`golfcourseapi ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── UI tools dispatched to client; data tools executed server-side ─────────
const UI_TOOLS = new Set([
  'open_smartvision', 'open_smartfinder', 'open_swinglab',
  'record_swing', 'log_shot', 'log_score', 'log_emotional_state',
]);

// ── Kevin's tools (same definitions as api/kevin.ts AI_TOOLS) ─────────────
const KEVIN_TOOLS: AiToolDef[] = [
  {
    name: 'open_smartvision',
    description: 'Open the SmartVision hole-map overlay. Trigger when the player wants to see the hole layout, green, hazards, or yardage map.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_smartfinder',
    description: 'Open SmartFinder — the rangefinder / distance-lock tool. Trigger on "rangefinder", "lock the distance", "give me a precise distance".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_swinglab',
    description: 'Open SwingLab — swing analysis and practice drills. Trigger on "swinglab", "practice", "work on my swing", "swing analysis".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'log_score',
    description: 'Log the score for a hole. Pass hole only when the player names a specific hole number.',
    parameters: {
      type: 'object',
      properties: {
        hole:  { type: 'number', description: 'Hole number 1-18. Omit for current hole.' },
        score: { type: 'number', description: 'Strokes taken' },
      },
      required: ['score'],
    },
  },
  {
    name: 'log_shot',
    description: 'Log a shot the player just described. Pass only fields they actually mentioned.',
    parameters: {
      type: 'object',
      properties: {
        club:          { type: 'string', description: 'Club used' },
        direction:     { type: 'string', enum: ['left','straight','right','pull','push','hook','slice','fade','draw'] },
        contactQuality:{ type: 'string', enum: ['fat','thin','pure','toe','heel','topped'] },
        outcome:       { type: 'string', description: 'Where it ended up' },
        feel:          { type: 'string', description: 'How the swing felt' },
      },
    },
  },
  {
    name: 'log_emotional_state',
    description: "Note the player's emotional state when they voice a feeling.",
    parameters: {
      type: 'object',
      properties: {
        state:   { type: 'string' },
        valence: { type: 'string', enum: ['positive','neutral','negative'] },
      },
      required: ['state', 'valence'],
    },
  },
  {
    name: 'record_swing',
    description: 'Open SwingLab in record mode to film the next swing.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'lookup_course',
    description: 'Search for a golf course by name or location.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Course name or "name in city"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'configure_drill',
    description: 'Configure the SmartMotion drill session the player just described — set the club and number of swings. Call this whenever the player says what they want to work on in SmartMotion (e.g. "7 iron, 3 swings", "driver, 5 balls", "irons today").',
    parameters: {
      type: 'object',
      properties: {
        club:       { type: 'string', description: 'Club ID (e.g. "7I", "DR", "PW", "PT"). Omit if not mentioned.' },
        shot_count: { type: 'number', enum: [1, 3, 5], description: 'Number of swings. Default 3 if not specified.' },
      },
    },
  },
  {
    name: 'close_swinglab',
    description: 'Close SmartMotion / SwingLab and return to the caddie screen. Use when the player says "close", "done", "go back", or "that\'s enough".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'lookup_hole',
    description: 'Get hole details (par, yardage) for a known course.',
    parameters: {
      type: 'object',
      properties: {
        course_id:   { type: 'string' },
        hole_number: { type: 'number', minimum: 1, maximum: 18 },
        tee_name:    { type: 'string' },
      },
      required: ['course_id', 'hole_number'],
    },
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystem(context: Record<string, unknown>, history: HistoryMsg[]): string {
  const player = (context.player ?? {}) as Record<string, unknown>;
  const round  = (context.round  ?? {}) as Record<string, unknown>;
  const bag    = (context.bag    ?? {}) as Record<string, unknown>;
  const gps    = (context.gps    ?? {}) as Record<string, unknown>;
  const settings = (context.settings ?? {}) as Record<string, unknown>;

  const name = String(player.name ?? 'golfer');
  const caddie = String(player.caddiePersonality ?? 'kevin');
  const caddieName = { kevin: 'Kevin', serena: 'Serena', harry: 'Harry', tank: 'Tank' }[caddie] ?? 'Kevin';
  const trustLevel = Number(settings.trustLevel ?? player.trustLevel ?? 2);

  const hcp = player.handicap != null ? `Handicap: ${player.handicap}.` : '';
  const miss = player.dominantMiss ? `Dominant miss: ${player.dominantMiss}.` : '';

  const distances = bag.club_distances as Record<string, number> | undefined;
  const bagLine = distances && Object.keys(distances).length > 0
    ? 'Bag distances: ' + Object.entries(distances).slice(0, 10).map(([c, d]) => `${c}: ${d}y`).join(', ') + '.'
    : '';

  const roundSection = round.active
    ? [
        `ACTIVE ROUND`,
        round.courseName ? `Course: ${round.courseName}` : '',
        round.currentHole ? `Hole: ${round.currentHole}` : '',
        round.holePar ? `Par: ${round.holePar}` : '',
        round.holeYardage ? `Yardage: ${round.holeYardage}y` : '',
        round.mentalState ? `Mental state: ${round.mentalState}` : '',
        round.goal ? `Round goal: ${round.goal}` : '',
        gps.lat && gps.lng ? `GPS: ${gps.lat}, ${gps.lng}` : '',
      ].filter(Boolean).join('\n')
    : '';

  const historySection = history.length > 0
    ? 'RECENT CONVERSATION:\n' + history.map(m =>
        `${m.role === 'user' ? name : caddieName}: ${m.content}`
      ).join('\n')
    : '';

  return `You are ${caddieName}, an expert AI golf caddie in SmartPlay Caddie.
You are talking to ${name} through their earbuds. Be direct and concise — on-course caddie cadence, not a manual.
${hcp} ${miss}
${bagLine}

${roundSection}

${historySection}

Trust level: ${trustLevel}/4. ${trustLevel >= 3 ? 'Be proactive.' : 'Help when asked.'}

Keep every spoken response under 30 words unless they ask for detail. No markdown, no bullet lists.
When asked "what's the play" or "what should I hit" — give one direct recommendation: club, shape, target.
Use tools when the player describes a shot to log, names a score, or asks to open a tool.
For lookup_course and lookup_hole: use them when you need real yardage/par data you don't already have.`.trim();
}

// ── Handler ────────────────────────────────────────────────────────────────────

interface HistoryMsg { role: 'user' | 'assistant'; content: string }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — only enforce when BOTH sides have a secret configured.
  // EXPO_PUBLIC_PIPECAT_SECRET is not set in prod OTA builds, so client sends ''.
  // Requiring a match when the client has no secret would block all field calls.
  const incomingSecret = req.body?.secret ?? req.headers['x-pipecat-secret'] ?? '';
  if (SESSION_SECRET && incomingSecret && incomingSecret !== SESSION_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { text, history = [], context = {} } = req.body as {
    text: string;
    history: HistoryMsg[];
    context: Record<string, unknown>;
  };

  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

  // Collect tool_actions returned to the client
  const toolActions: Array<Record<string, unknown>> = [];

  try {
    const system = buildSystem(context, (history as HistoryMsg[]).slice(-MAX_HISTORY_PAIRS * 2));

    const result = await runAgenticLoop(
      'anthropic',
      'quality',       // claude-sonnet-4-6
      system,
      text,
      [],              // no images on the turn path
      KEVIN_TOOLS,
      async (toolName, toolInput) => {
        // Lookup tools execute server-side (need API keys, no expo deps)
        if (toolName === 'lookup_course') {
          try {
            const data = await fetchCourse(`/v1/search?search_query=${encodeURIComponent(String(toolInput.query ?? ''))}`);
            const raw = data as Record<string, unknown>;
            const list: unknown[] = (raw.courses as unknown[]) ?? (raw.data as unknown[]) ?? (Array.isArray(raw) ? raw : []);
            if (!list.length) return `No courses found matching "${toolInput.query}".`;
            return list.slice(0, 3).map((r) => {
              const c = r as Record<string, unknown>;
              return `${c.club_name ?? c.name} (${[c.city, c.state_code ?? c.state].filter(Boolean).join(', ')}) id:${c.id}`;
            }).join('; ');
          } catch (e) { return `Course lookup failed: ${e instanceof Error ? e.message : String(e)}`; }
        }

        if (toolName === 'lookup_hole') {
          try {
            const data = await fetchCourse(`/v1/courses/${encodeURIComponent(String(toolInput.course_id ?? ''))}`);
            const raw = data as Record<string, unknown>;
            const course = (raw.course ?? raw.data ?? raw) as Record<string, unknown>;
            type RawTee = { tee_name?: string; name?: string; holes?: Array<Record<string, unknown>> };
            let tees: RawTee[] = [];
            const teesRaw = course.tees;
            if (Array.isArray(teesRaw)) tees = teesRaw as RawTee[];
            else if (teesRaw && typeof teesRaw === 'object') {
              for (const arr of Object.values(teesRaw as Record<string, unknown>)) {
                if (Array.isArray(arr)) { tees = arr as RawTee[]; break; }
              }
            }
            const tee = typeof toolInput.tee_name === 'string'
              ? (tees.find(t => (t.tee_name ?? t.name ?? '').toLowerCase() === (toolInput.tee_name as string).toLowerCase()) ?? tees[0])
              : tees[0];
            if (!tee?.holes?.length) return `No tee data found.`;
            const hole = tee.holes.find(h => Number(h.hole_number ?? h.hole) === Number(toolInput.hole_number));
            if (!hole) return `Hole ${toolInput.hole_number} not found.`;
            return `Hole ${toolInput.hole_number}: par ${hole.par}, ${hole.yardage ?? hole.distance}y from ${tee.tee_name ?? tee.name}.`;
          } catch (e) { return `Hole lookup failed: ${e instanceof Error ? e.message : String(e)}`; }
        }

        if (toolName === 'configure_drill') {
          toolActions.push({ type: 'configure_drill', club: toolInput.club, shot_count: toolInput.shot_count ?? 3 });
          return `Drill configured: ${toolInput.club ?? 'current club'}, ${toolInput.shot_count ?? 3} swings.`;
        }

        if (toolName === 'close_swinglab') {
          toolActions.push({ type: 'close_swinglab' });
          return 'SwingLab closed.';
        }

        // All other tools: collect for client dispatch, return an acknowledgment
        if (UI_TOOLS.has(toolName)) {
          toolActions.push({ type: toolName, ...toolInput });
          return `${toolName} dispatched to device.`;
        }

        return 'Done.';
      },
      { maxTokens: 256, temperature: 0.7, maxRounds: 4 },
    );

    // Build updated history (cap to keep payload small)
    const updatedHistory: HistoryMsg[] = [
      ...(history as HistoryMsg[]),
      { role: 'user' as const, content: text },
      { role: 'assistant' as const, content: result.text },
    ].slice(-MAX_HISTORY_PAIRS * 2);

    return res.status(200).json({
      response_text: result.text,
      tool_actions: toolActions,
      updated_history: updatedHistory,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[pipecat-turn] error:', msg);
    return res.status(502).json({ error: msg });
  }
}
