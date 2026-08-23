/**
 * 2026-08-22 (Tim, after 18 holes at Greenhill) — "we can't have two fucking brain paths and two
 * fucking voice paths… I can feel it going back and forth, and you know it's generic, and then the
 * tone of the voice changes a little bit, and the information's more accurate."
 *
 * THE ONE PLACE THAT DECIDES WHAT THE CADDIE KNOWS.
 *
 * He was not describing a flaky model. He was describing two payloads. `useVoiceCaddie` (the mic)
 * and `useKevin` (the text box) both POST to the SAME endpoint, /api/kevin, and each assembled its
 * own body by hand:
 *
 *     voice sent 45 fields · text sent 34 · only 20 were shared
 *
 *     only the mic sent : courseIntelligence, yardageInsight, dominantMiss, physicalLimitation,
 *                         goal, patternInsights, mentalState, isSpiralRisk, ghostContext,
 *                         penaltyContext, watchData, recentHeroMoments, topObservations …
 *     only the text box : persona, personaIntensity, customCaddieName, golfer_model_snippet,
 *                         holeNotes, practice_context, recent_analyses_snippet, pendingLieAnalysis …
 *
 * Read those two lists against his sentence. The TONE changes because the mic never sent `persona`
 * or `personaIntensity`, so the server fell back to a default voice. The INFORMATION gets more
 * accurate because only one path ever sent the course intelligence and the resolved yardage. Same
 * brain, same prompt, different inputs — so the caddie really did keep changing character mid-round,
 * and which half you got depended on whether you tapped the mic or typed.
 *
 * Two hand-maintained payloads to one endpoint could only ever drift: every field added since has
 * landed on one side. So this is not a third builder — it is the only one. It emits the UNION, and
 * it always emits EVERY key (null when a value genuinely is not available) so that "this path forgot
 * to send X" stops being expressible.
 *
 * Reading the stores here rather than making each caller remember 59 fields is the whole point: a
 * caller cannot omit what it does not have to assemble. Pure, sync, never-throwing — every read is
 * individually guarded, because a brain turn must never die over a missing optional.
 * [[unconnected-halves-not-broken-code]] [[no-half-fixes-enforce-every-surface]]
 */

/** Values only the calling surface can know. Everything else is read from the stores below. */
export interface CaddieRequestExtras {
  message: string;
  language: string;
  /** The live context block the caller composed (GPS + hole + geometry + recent shots). */
  liveBlock?: string | null;
  /** SmartVision lives in a React context, not a store, so only a component can hand it over. */
  smartVisionContext?: unknown;
  /** Vision frame — the text box can attach a photo; the mic cannot. */
  image_base64?: string | null;
  image_media_type?: string | null;
  image_caption?: string | null;
  responseMode?: string | null;
  pendingLieAnalysis?: unknown;
  /** Overrides for anything a caller has already computed and does not want recomputed. */
  overrides?: Record<string, unknown>;
}

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

/* eslint-disable @typescript-eslint/no-require-imports */
const roundStore = () => require('../store/roundStore').useRoundStore.getState();
const profileStore = () => require('../store/playerProfileStore').usePlayerProfileStore.getState();
const relationshipStore = () => require('../store/relationshipStore').useRelationshipStore.getState();
const settingsStore = () => require('../store/settingsStore').useSettingsStore.getState();
/* eslint-enable @typescript-eslint/no-require-imports */

export function buildCaddieRequestBody(extras: CaddieRequestExtras): Record<string, unknown> {
  const r = safe(() => roundStore(), {} as ReturnType<typeof roundStore>);
  const p = safe(() => profileStore(), {} as ReturnType<typeof profileStore>);
  const rel = safe(() => relationshipStore(), {} as ReturnType<typeof relationshipStore>);
  const st = safe(() => settingsStore(), {} as ReturnType<typeof settingsStore>);

  const currentHole = safe(() => r.currentHole ?? null, null);
  const activeCourseId = safe(() => r.activeCourseId ?? null, null);
  const club = safe(() => r.club ?? null, null);
  const isRoundActive = safe(() => !!r.isRoundActive, false);

  /**
   * The learned-memory slice merged with the caller's live block. This is also where the measured
   * "TROUBLE ON THIS SHOT" line enters (see caddieMemoryRetrieval.liveTroubleLine), so every path
   * gets the hole picture — not just whichever one happened to be wired.
   */
  const unified_context_block = safe(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./caddieMemoryRetrieval') as typeof import('./caddieMemoryRetrieval');
    return m.mergeMemoryIntoContext(
      extras.liveBlock ?? null,
      m.getCaddieContext({ courseId: activeCourseId, hole: currentHole, club }).promptBlock,
    );
  }, extras.liveBlock ?? null);

  const patternInsights = safe(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generatePatternInsights } = require('./patternDetection') as typeof import('./patternDetection');
    return generatePatternInsights(safe(() => r.shots ?? [], []), {
      currentRoundMode: safe(() => r.mode ?? null, null),
      scores: safe(() => r.scores ?? {}, {}),
      courseHoles: safe(() => r.courseHoles ?? [], []),
      handicap: safe(() => p.handicap ?? null, null),
      dominantMiss: safe(() => p.dominantMiss ?? null, null),
    });
  }, null);

  const body: Record<string, unknown> = {
    // ─── the ask ────────────────────────────────────────────────────────────
    message: extras.message,
    language: extras.language,
    responseMode: extras.responseMode ?? null,
    clientHour: safe(() => new Date().getHours(), 0),

    // ─── who the player is ──────────────────────────────────────────────────
    playerName: safe(() => p.name ?? null, null),
    firstName: safe(() => (p.name ?? '').trim().split(/\s+/)[0] || null, null),
    handicap: safe(() => p.handicap ?? null, null),
    ghinNumber: safe(() => p.ghin_number ?? null, null),
    dominantMiss: safe(() => p.dominantMiss ?? null, null),
    physicalLimitation: safe(() => p.physicalLimitation ?? null, null),
    goal: safe(() => p.goal ?? null, null),
    personalBest: safe(() => p.personalBest ?? null, null),
    kevinContext: safe(() => p.kevinContext ?? null, null),
    persistentPatterns: safe(() => p.persistentPatterns ?? null, null),
    golfer_model_snippet: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const g = require('./golferModel') as typeof import('./golferModel');
      return g.describeForPrompt(g.buildGolferModel()) || null;
    }, null),

    // ─── the relationship ───────────────────────────────────────────────────
    roundsTogether: safe(() => rel.roundsTogether ?? 0, 0),
    sessionsTogether: safe(() => rel.sessionsTogether ?? 0, 0),
    mentalState: safe(() => rel.currentMentalState ?? null, null),
    consecutiveBadHoles: safe(() => rel.consecutiveBadHoles ?? 0, 0),
    isSpiralRisk: safe(() => (typeof rel.isSpiralRisk === 'function' ? rel.isSpiralRisk() : false), false),

    // ─── the caddie's own voice (the mic never sent ANY of this) ────────────
    persona: safe(() => st.caddiePersonality ?? null, null),
    personaIntensity: safe(() => st.personaIntensity ?? null, null),
    // Not on settingsStore — the text box resolves these from the custom-caddie profile, so they
    // arrive as overrides. The KEY is always present either way, which is the parity that matters.
    customCaddieName: null,
    customCaddieBasePersona: null,
    cecilyMode: safe(() => st.cecilyMode ?? false, false),
    tankSoftIntro: safe(() => st.tankSoftIntro ?? false, false),

    // ─── the round ──────────────────────────────────────────────────────────
    isRoundActive,
    isCompetition: safe(() => !!r.isCompetition, false),
    sim_round: safe(() => !!r.isSimRound, false),
    // The store calls it `mode`; every payload has always called it roundMode.
    roundMode: safe(() => r.mode ?? null, null),
    currentHole,
    // Derived by the round store's getter rather than stored as a field.
    currentPar: safe(() => (typeof r.getCurrentPar === 'function' ? r.getCurrentPar() : null), null),
    currentYardage: safe(() => r.currentYardage ?? null, null),
    activeCourse: safe(() => r.activeCourse ?? null, null),
    activeCourseId,
    club,
    /**
     * 2026-08-22 (from Tim's screenshot, Greenhill hole 9) — WHICH SHOT HE IS ON.
     *
     * The brain was never told. On stroke 2 from 422 yards it answered "for hole 9, a par 5 at 450
     * yards, I'd suggest starting with your driver" — a TEE briefing, off the scorecard, to a man
     * standing in the fairway. Without this the model cannot know he has already hit, so it defaults
     * to the start of the hole every time.
     *
     * Same definition the on-screen strip uses: the stroke he is ABOUT to play (shots + penalties + 1).
     */
    currentStroke: safe(() => {
      const shots = (r.shots ?? []).filter((sh: { hole: number }) => sh.hole === currentHole);
      if (!shots.length) return 1;
      return shots.length + 1 + shots.reduce((a: number, sh: { penalty_strokes?: number }) => a + (sh.penalty_strokes ?? 0), 0);
    }, 1),
    /**
     * 2026-08-22 — walking or riding. Set on the Play tab, persisted on the round since 2026-06-13,
     * and read by NOTHING on the caddie side: zero matches in either old payload. The store's own
     * comment says it exists for "walking fatigue/pace awareness", which is exactly the thing that
     * never got wired. Late in a walked round it should temper club choice; in a cart it should not.
     */
    transportMode: safe(() => r.transportMode ?? 'walking', 'walking'),
    /**
     * 2026-08-22 — WHERE ON THE HOLE HE IS STANDING. Derived from every GPS fix since 2026-05-24 and
     * never sent. On the green it is the difference between a club recommendation and a putt read —
     * Tim: "caddy has no context when you're doing a putt read." On the tee it is the difference
     * between briefing the hole and answering the shot.
     */
    currentLocationType: safe(() => r.currentLocationType ?? 'unknown', 'unknown'),
    /**
     * 2026-08-22 — the caddie's RISK POSTURE. It was wired on 08-12 ("don't delete what adds value
     * wired") but only into the ON-DEVICE shot read (cnsShotRead, used by SmartFinder, SmartVision
     * and the local responder). The cloud brain — the thing the player actually talks to — never got
     * it. So safe/aggressive changed the phone's answer and not the caddie's: the same split-brain
     * inconsistency in miniature.
     */
    riskMode: safe(() => r.riskMode ?? 'normal', 'normal'),
    /** Which tee he is actually playing, so advice matches the card he is on. */
    currentTeeBox: safe(() => r.currentTeeBox ?? null, null),
    /** A 9-hole round is a different shape of round; "you're halfway" is wrong at hole 5 of 9. */
    nineHoleMode: safe(() => !!r.nineHoleMode, false),
    scores: safe(() => r.scores ?? {}, {}),
    // Current hole +/- 1 only: the full 18 added 5-15KB to every call.
    courseHoles: safe(() => {
      const all = r.courseHoles ?? [];
      if (currentHole == null) return all.slice(0, 1);
      return all.filter((h: { hole: number }) => Math.abs(h.hole - currentHole) <= 1);
    }, []),

    // ─── what we know about this course, right now ──────────────────────────
    // `activeCourse` is the course NAME, not a record, so there is nothing to summarise here — the
    // caller that holds the loaded course passes this in. Key always present.
    courseContext: null,
    courseIntelligence: safe(() => {
      if (!isRoundActive || !activeCourseId) return null;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const intel = require('./courseIntelligenceService') as typeof import('./courseIntelligenceService');
      return intel.getCachedCourseIntelligenceSync(activeCourseId);
    }, null),
    holeNotes: null,
    yardageInsight: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildYardageInsight } = require('./yardageResolver') as typeof import('./yardageResolver');
      return buildYardageInsight();
    }, null),
    smartFinderContext: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sf = require('../store/smartFinderStore').useSmartFinderStore.getState();
      const lock = sf.currentLock;
      if (!lock) return null;
      return `SMARTFINDER ACTIVE: User has locked distance of ${lock.distance_yards} yards at compass heading ${Math.round(lock.compass_heading)}°. Treat the locked distance as the working number.`;
    }, null),

    /**
     * 2026-08-22 (Tim — "your information is still generic related to the user. Bogey is good for me,
     * but you keep telling me to move on" / "caddy has no context when you're doing a putt read").
     *
     * HOW THIS ROUND IS ACTUALLY GOING. The round store computes putts, penalties, fairways and GIR
     * per hole and keeps them — and none of it was ever sent to the brain. Not one reference in
     * either old payload. So the caddie could see the SCORE and nothing about how it happened: no way
     * to know he three-putted the last two, no way to know he is hitting greens and losing it on the
     * putting surface, and nothing to ground a putt read in. "Everything is everything" -- this is
     * the half that never joined.
     */
    roundStats: safe(() => {
      const stats = typeof r.getHoleStats === 'function' ? (r.getHoleStats() ?? []) : [];
      if (!stats.length) return null;
      const played = stats.length;
      const putts = stats.reduce((a: number, h: { putts?: number }) => a + (h.putts ?? 0), 0);
      const threePutts = stats.filter((h: { putts?: number }) => (h.putts ?? 0) >= 3).length;
      const girs = stats.filter((h: { girHit?: boolean | null }) => h.girHit === true).length;
      const girKnown = stats.filter((h: { girHit?: boolean | null }) => h.girHit != null).length;
      const fairways = stats.filter((h: { fairwayHit?: boolean | null }) => h.fairwayHit === true).length;
      const fwKnown = stats.filter((h: { fairwayHit?: boolean | null }) => h.fairwayHit != null).length;
      const penalties = stats.reduce((a: number, h: { penalties?: number }) => a + (h.penalties ?? 0), 0);
      return {
        holesPlayed: played,
        putts,
        puttsPerHole: Math.round((putts / played) * 10) / 10,
        threePutts,
        // Only reported when we actually know — a null GIR is not a missed green.
        gir: girKnown ? `${girs}/${girKnown}` : null,
        fairways: fwKnown ? `${fairways}/${fwKnown}` : null,
        penalties,
        lastThreeHoles: stats.slice(-3).map((h: { hole: number; score: number; putts?: number }) =>
          ({ hole: h.hole, score: h.score, putts: h.putts ?? null })),
      };
    }, null),

    // ─── how they've been playing ───────────────────────────────────────────
    patternInsights,
    penaltyContext: safe(() => extras.overrides?.penaltyContext ?? null, null),
    ghostContext: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../store/ghostStore').useGhostStore.getState().getSummaryText();
    }, null),
    topObservations: safe(() => rel.getTopObservations?.() ?? null, null),
    recentHeroMoments: safe(() => rel.getRecentHeroMoments?.(2) ?? null, null),
    recentCageSessions: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const c = require('../store/cageStore').useCageStore.getState();
      return (c.sessionHistory ?? []).slice(-3).map((s: { date: number; club: string; shots?: unknown[] }) => ({
        date: s.date, club: s.club, shots: (s.shots ?? []).length,
      }));
    }, []),
    recent_analyses_snippet: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const eng = require('./smartAnalysisEngine') as { getRecentAnalyses?: (n: number) => { kind: string; voice_summary: string }[] };
      const recent = eng.getRecentAnalyses?.(8) ?? [];
      return recent.length ? recent.map((a) => `[${a.kind}] ${a.voice_summary}`).join('\n') : null;
    }, null),
    practice_context: safe(() => extras.overrides?.practice_context ?? null, null),
    coachKnowledgeContext: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCoachKnowledgeForMessage } = require('../store/coachKnowledgeStore') as { getCoachKnowledgeForMessage: (m: string) => string };
      return getCoachKnowledgeForMessage(extras.message);
    }, ''),
    watchData: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const w = require('../store/watchStore').useWatchStore.getState();
      if (!w.isConnected) return null;
      const s = w.getSessionSummary?.();
      if (!s) return null;
      return {
        averageTempo: s.averageTempo.toFixed(1),
        dominantFault: s.dominantTempoFault,
        earlyTransitionRate: Math.round(s.earlyTransitionRate * 100),
        averageClubSpeed: Math.round(s.averageClubSpeed),
        swingCount: s.swings.length,
      };
    }, null),

    // ─── the merged brain context ───────────────────────────────────────────
    unified_context_block,

    // ─── caller-only ────────────────────────────────────────────────────────
    smartVisionContext: extras.smartVisionContext ?? null,
    pendingLieAnalysis: extras.pendingLieAnalysis ?? null,
    image_base64: extras.image_base64 ?? null,
    image_media_type: extras.image_media_type ?? null,
    image_caption: extras.image_caption ?? null,
  };

  // A caller that has already computed something better wins — but it can only REPLACE a key that
  // already exists, never introduce one this builder doesn't know about. That keeps the union here.
  for (const [k, v] of Object.entries(extras.overrides ?? {})) {
    if (k in body) body[k] = v;
  }
  return body;
}

/** The exact key set every caddie request carries. Exported so parity is testable, not assumed. */
export const CADDIE_REQUEST_KEYS = Object.freeze(
  Object.keys(buildCaddieRequestBody({ message: '', language: 'en' })).sort(),
);
