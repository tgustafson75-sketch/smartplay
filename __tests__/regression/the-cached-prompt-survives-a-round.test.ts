/**
 * 2026-10-28 (Brain review F4) — THE CACHED SYSTEM PROMPT MUST NOT MOVE INSIDE A ROUND.
 *
 * _aiProvider caches the whole system prompt as ONE 1-hour block. The 08-24/08-25 fixes moved the
 * shot's live facts to the message, but a dozen per-turn values were still interpolated into the
 * cached block: the memory slice's GPS-fed "TROUBLE ON THIS SHOT … Ny to carry" line
 * (unified_context_block), PLAYER PATTERNS' "(shots analyzed: N)", the private observations that
 * rotate by novelty every send, the hole block, the SmartFinder lock, the per-question coaching
 * refinements, the proactive flag, hero moments, the phrase list, club tendencies. Any one byte of
 * them moving made an in-round turn a full ~19.5K-token cache WRITE at 2x instead of a read.
 *
 * scripts/probe-cache-in-round.ts "verified" the cache with a hand-built body carrying none of
 * those — the 08-24 false positive again. So this runs the REAL api/kevin handler (model stubbed at
 * the provider boundary, no network) on bodies from the REAL buildCaddieRequestBody, moved between
 * turns the way a round moves them, and asserts:
 *   1. the system prompt handed to runAgenticLoop is byte-identical turn to turn, and
 *   2. every moving value still REACHES the model — on the message side — so nothing was dropped.
 */
import handler from '../../api/kevin';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { getKnownCoursesBlock } from '../../services/holeContextResolver';
import { buildGolferModel } from '../../services/golferModel';
import { useRoundStore } from '../../store/roundStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useSwingSessionStore } from '../../store/swingSessionStore';

jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
/**
 * 2026-10-29 (Brain recheck r13) — the golfer model prints its feel and miss shares only once it is
 * confident (30 data points: rounds + sessions + analyses), and the analyses history is not a fixture a
 * guard can fill honestly. Only the COUNT of recent analyses reaches the model's confidence, so this
 * gives it twenty swing entries and nothing else.
 */
jest.mock('../../services/smartAnalysisEngine', () => {
  const actual = jest.requireActual('../../services/smartAnalysisEngine');
  return {
    ...actual,
    getRecentAnalyses: () => Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, kind: 'swing', voice_summary: `Swing ${i} was on line.`, timestamp: Date.now() - i })),
  };
});

const seen: Array<{ system: string; user: string }> = [];
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.push({ system, user });
      return { text: 'Seven iron, middle of the green.', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
  chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
})));
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

jest.setTimeout(60_000);

function callKevin(body: Record<string, unknown>): Promise<number> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json() { resolve(status); return res; },
      end() { resolve(status); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}

/** A bundled course, so the in-round LIVE-HOLE DATA block really renders. */
const COURSE_ID = /\(id: ([^,]+),/.exec(getKnownCoursesBlock())![1];

const now = Date.now();
const obs = (id: string, content: string, type: string, usedInAdvice = 0) =>
  ({ id, content, type, timestamp: now - 60_000, usedInAdvice });

/** One turn of a round, as the phone builds it. `t` is how far the round has moved. */
function turnBody(t: {
  message: string; hole: number; carry: number; shots: number; lock: number | null;
  coach: string; proactive: boolean; heroes: number; phrases: string[]; tendencies: string[];
}): Record<string, unknown> {
  const body = buildCaddieRequestBody({
    message: t.message,
    language: 'en',
    skipTts: true,
    // The mic follow-up's live geometry and the memory slice's GPS-fed trouble line ride liveBlock
    // through the builder's real merge into unified_context_block.
    liveBlock: `TROUBLE ON THIS SHOT: bunker front-left, ${t.carry - 12}y to reach, ${t.carry}y to carry.\n[GEOMETRY] front ${t.carry - 8} / middle ${t.carry} / back ${t.carry + 9}`,
    overrides: {
      activeCourseId: COURSE_ID,
      currentHole: t.hole,
      isRoundActive: true,
      patternInsights: { shot_count_analyzed: t.shots, insights: [`Missing right on ${t.shots} of the last shots`] },
      smartFinderContext: t.lock == null ? null : `SMARTFINDER ACTIVE: User has locked distance of ${t.lock} yards at compass heading 212°.`,
      coachKnowledgeContext: t.coach,
      is_proactive: t.proactive,
      recentHeroMoments: Array.from({ length: t.heroes }, (_, i) => ({ hole: i + 2, club: '7 iron', courseName: 'Test' })),
      playerVocabulary: t.phrases,
      club_tendencies: t.tendencies,
    },
  } as never) as Record<string, unknown>;
  return body;
}

describe('F4 — the cached system prompt survives an in-round turn', () => {
  beforeEach(() => {
    seen.length = 0;
    useRoundStore.setState({ isRoundActive: true, currentHole: 4, shots: [], putts: {}, scores: {}, activeCourse: 'Test Course' } as never);
    useSwingSessionStore.setState({ sessionHistory: [] } as never);
    useRelationshipStore.setState({
      observations: [
        obs('a', 'Grips it tighter after a bogey', 'mental'),
        obs('b', 'Early extension with long irons', 'technical'),
        obs('c', 'Hip mobility limits the turn', 'strength'),
        obs('d', 'Rushes the transition when the group behind waits', 'mental'),
        obs('e', 'Open face at the top with the driver', 'technical'),
      ],
    } as never);
  });
  afterEach(() => { useRoundStore.setState({ isRoundActive: false } as never); });

  it('THE BUG: two turns on the same hole — he moved, logged a shot, the observations rotated, a new question — the cached block is byte-identical', async () => {
    const t1 = turnBody({
      message: 'what should I hit from here', hole: 4, carry: 152, shots: 9, lock: null,
      coach: 'COACH NOTE (club selection): take one more club into a front pin.', proactive: false,
      heroes: 1, phrases: ['flushed it'], tendencies: ['7 iron: 148y, misses right'],
    });
    await callKevin(t1);
    // What useVoiceCaddie does every send: the observations it showed are marked used, so the
    // novelty ranking hands the NEXT turn a different three.
    const rel = useRelationshipStore.getState();
    rel.markObservationsUsed((t1.topObservations as Array<{ id: string }>).map((o) => o.id));
    useRoundStore.setState({ shots: [{ id: 's1' }] } as never);

    const t2 = turnBody({
      message: 'how do I play this bunker shot', hole: 4, carry: 141, shots: 10, lock: 139,
      coach: 'COACH NOTE (bunker): open the face before you take the grip.', proactive: true,
      heroes: 2, phrases: ['flushed it', 'chunked'], tendencies: ['7 iron: 146y, misses right', 'PW: 118y'],
    });
    // The fixture must actually move every value the finding names, or the assertion proves nothing.
    expect(t2.topObservations).not.toEqual(t1.topObservations);
    expect(t2.unified_context_block).not.toEqual(t1.unified_context_block);
    expect(String(t2.unified_context_block)).toContain('141y to carry');
    await callKevin(t2);

    expect(seen.length).toBe(2);
    const [a, b] = seen;
    if (a.system !== b.system) {
      let i = 0; while (i < a.system.length && a.system[i] === b.system[i]) i++;
      throw new Error(`cached system prompt moved between in-round turns at char ${i}:\n  turn 1: …${JSON.stringify(a.system.slice(Math.max(0, i - 80), i + 120))}\n  turn 2: …${JSON.stringify(b.system.slice(Math.max(0, i - 80), i + 120))}`);
    }
    expect(a.system).toBe(b.system);
  });

  it('a logged shot and a holed putt move the derived tendencies and the putting record, and the cached block still does not move', async () => {
    const shotsOf = (n: number, feel: string) => Array.from({ length: n }, (_, i) =>
      ({ id: `${feel}${i}`, timestamp: now - 60_000 * (i + 1), feel, direction: 'right', club: '7 iron' }));
    const holes = (n: number, per: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, per]));
    useSwingSessionStore.setState({ sessionHistory: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, shots: [], startedAt: now - i })) } as never);
    useRoundStore.setState({ shots: shotsOf(30, 'flush'), putts: holes(9, 2), scores: holes(9, 4) } as never);
    // The 5-minute memo is what rebuilds the derived model; forcing it here is that rebuild.
    buildGolferModel(true);
    const t1 = turnBody({
      message: 'what should I hit from here', hole: 4, carry: 152, shots: 30, lock: null,
      coach: '', proactive: false, heroes: 0, phrases: [], tendencies: [],
    });
    await callKevin(t1);

    // The phone logs a fat shot and holes a putt on the tenth: the round moves, and the next rebuild sees it.
    useRoundStore.setState({ shots: [...shotsOf(30, 'flush'), ...shotsOf(15, 'fat')], putts: { ...holes(9, 2), 10: 1 }, scores: { ...holes(9, 4), 10: 3 } } as never);
    buildGolferModel(true);
    const t2 = turnBody({
      message: 'how do I play this bunker shot', hole: 4, carry: 141, shots: 45, lock: null,
      coach: '', proactive: false, heroes: 0, phrases: [], tendencies: [],
    });
    // The fixture must move both values, or the assertion below proves nothing.
    expect(String(t1.golfer_model_snippet)).toContain('Most-common contact feel: flush');
    expect(String(t2.golfer_model_snippet)).toContain('Most-common contact feel: flush');
    expect(t2.golfer_model_snippet).not.toEqual(t1.golfer_model_snippet);
    expect(String(t1.puttingRecordBlock)).toContain('Overall 2.00 putts per hole across 9 scored holes');
    expect(t2.puttingRecordBlock).not.toEqual(t1.puttingRecordBlock);
    await callKevin(t2);

    expect(seen.length).toBe(2);
    const [a, b] = seen;
    if (a.system !== b.system) {
      let i = 0; while (i < a.system.length && a.system[i] === b.system[i]) i++;
      throw new Error(`cached system prompt moved when a shot and a putt were logged, at char ${i}:\n  turn 1: …${JSON.stringify(a.system.slice(Math.max(0, i - 80), i + 120))}\n  turn 2: …${JSON.stringify(b.system.slice(Math.max(0, i - 80), i + 120))}`);
    }
    expect(a.system).toBe(b.system);
    // Nothing dropped: the derived tendencies and the putting record reach the model on the message side.
    expect(b.user).toContain('DERIVED TENDENCIES');
    expect(b.user).toContain('Overall 1.90 putts per hole across 10 scored holes');
    expect(b.system).not.toContain('DERIVED TENDENCIES');
    expect(b.system).not.toContain('putts per hole across');
  });

  it('a new hole does not move it either (the hole block rides the message)', async () => {
    const base = {
      message: 'what is the play', carry: 160, shots: 12, lock: null, coach: '', proactive: false,
      heroes: 0, phrases: [], tendencies: [],
    };
    await callKevin(turnBody({ ...base, hole: 4 }));
    useRoundStore.setState({ currentHole: 5 } as never);
    await callKevin(turnBody({ ...base, hole: 5 }));
    expect(seen.length).toBe(2);
    expect(seen[0].system).toBe(seen[1].system);
    expect(seen[0].user).toContain('HOLE 4 on');
    expect(seen[1].user).toContain('HOLE 5 on');
  });

  it('nothing was dropped: every moving value still reaches the model, on the message side', async () => {
    const t = turnBody({
      message: 'how do I play this bunker shot', hole: 4, carry: 141, shots: 10, lock: 139,
      coach: 'COACH NOTE (bunker): open the face before you take the grip.', proactive: true,
      heroes: 1, phrases: ['chunked'], tendencies: ['PW: 118y'],
    });
    await callKevin(t);
    const { system, user } = seen[0];
    const moving = [
      '141y to carry',                       // GPS-fed trouble line (unified_context_block)
      '[GEOMETRY] front 133',                 // mic follow-up live geometry
      '(shots analyzed: 10)',                 // PLAYER PATTERNS
      'WHAT YOU KNOW PRIVATELY',              // rotating observations
      'LIVE-HOLE DATA',                       // hole block
      'locked distance of 139 yards',         // SmartFinder lock
      'open the face before you take the grip', // per-question coaching refinement
      'PROACTIVE CONTEXT',                    // proactive flag
      'HERO MOMENTS: Hole 2',                 // hero moments
      'PHRASES THIS PLAYER USES',             // vocabulary
      'PW: 118y',                             // club tendencies
    ];
    for (const m of moving) {
      expect({ m, inUser: user.includes(m) }).toEqual({ m, inUser: true });
      expect({ m, inSystem: system.includes(m) }).toEqual({ m, inSystem: false });
    }
  });
});
