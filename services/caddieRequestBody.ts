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
  /**
   * Appended to the END of the composed context block. For a caller that needs the brain to reason
   * in a specific ORDER (the in-round diagnostic threads its evidence-order doctrine this way) —
   * a directive, not data, so it must land after the facts rather than among them.
   */
  contextSuffix?: string | null;
  /** Overrides for anything a caller has already computed and does not want recomputed. */
  overrides?: Record<string, unknown>;
}

/** The subset of a logged shot the brain prompt reads. Local so this file stays store-agnostic. */
type ShotRow = {
  hole: number;
  shot_in_hole_index?: number;
  club?: string | null;
  shape?: string | null;
  direction?: string | null;
  outcome?: string | null;
  outcome_text?: string | null;
  swing_feel?: string | null;
  distance_yards?: number | null;
};

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

  const isRoundActive = safe(() => !!r.isRoundActive, false);
  /**
   * NOT gated on isRoundActive, deliberately (checked 2026-08-23). Three of the hand-built payloads
   * wrote `round.isRoundActive ? round.currentHole : null` and three did not, so it looked like a
   * split worth closing — but both endRound() and discardRound() reset currentHole to 1 alongside
   * the flag, so there is no stale hole to guard against, and `isRoundActive` is sent right beside
   * it either way. Gating here only breaks the stroke count for any caller that sets up a hole
   * without the flag. Left as the store reports it. [[run-the-second-pass-yourself]]
   */
  const currentHole = safe(() => r.currentHole ?? null, null);
  const activeCourseId = safe(() => r.activeCourseId ?? null, null);
  const club = safe(() => r.club ?? null, null);

  /**
   * The learned-memory slice merged with the caller's live block. This is also where the measured
   * "TROUBLE ON THIS SHOT" line enters (see caddieMemoryRetrieval.liveTroubleLine), so every path
   * gets the hole picture — not just whichever one happened to be wired.
   */
  const unified_context_block = safe(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./caddieMemoryRetrieval') as typeof import('./caddieMemoryRetrieval');
    const merged = m.mergeMemoryIntoContext(
      extras.liveBlock ?? null,
      m.getCaddieContext({ courseId: activeCourseId, hole: currentHole, club }).promptBlock,
    );
    const suffix = extras.contextSuffix?.trim();
    if (!suffix) return merged;
    return merged ? `${merged}\n\n${suffix}` : suffix;
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
    /**
     * 2026-08-23 — WHERE THEY ARE IN THEIR GOLF (starting / improving / returning / competitive).
     *
     * One payload sent this and the brain destructured nothing by that name, so it was sent and
     * ignored — while services/coachingAdaptation uses the same field to decide whether an
     * explanation should be simple or advanced. A player just starting and a competitive player
     * were getting the same answer at the same depth. That is a generic, and it is fixable with a
     * field the app already collects.
     */
    experienceContext: safe(() => p.experienceContext ?? null, null),
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
    /**
     * 2026-08-23 — the ACTIVE per-pillar caddie, not the raw global setting.
     *
     * A player can set the Round pillar to Serena while the global pick is Kevin. Sending the global
     * made the brain speak and sound as Kevin while the whole app attributed it to Serena — the same
     * per-pillar bleed that was fixed on the two hand-built payloads in August and never fixed here,
     * because this builder read the store field directly.
     */
    persona: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getActiveCaddie } = require('./caddieResolver') as typeof import('./caddieResolver');
      return getActiveCaddie();
    }, safe(() => st.caddiePersonality ?? null, null)),
    /**
     * 2026-08-23 — RESOLVED to the active persona's 0-100 number.
     *
     * `settingsStore.personaIntensity` is a MAP ({ kevin: 100, tank: 70 }). kevin.ts destructures
     * `personaIntensity = 100` and scales cadence off it as a NUMBER, so shipping the map put an
     * object where a number belongs — every comparison against it is false and the dial silently
     * does nothing. The two hand-built payloads each resolved it inline; this builder inherited
     * neither. brainSettings() is the tested owner of that resolution, so it does it here too
     * rather than a third copy of the lookup.
     */
    ...safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { brainSettings } = require('./voice/brainSettings') as typeof import('./voice/brainSettings');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getActiveCaddie } = require('./caddieResolver') as typeof import('./caddieResolver');
      const bs = brainSettings({ ...st, caddiePersonality: getActiveCaddie() });
      // Only personaIntensity: the brain has no use for continuousConversationMode (it decides
      // whether the CLIENT re-opens the mic), and a key the server never destructures is the
      // sent-and-ignored shape this file exists to prevent.
      return { personaIntensity: bs.personaIntensity };
    }, { personaIntensity: 100 }),
    /**
     * 2026-08-23 — READ HERE, not left for a caller to override.
     *
     * These were `null` with a note that the text box supplies them as overrides. That was true of
     * the two callers that existed at the time and false the moment a third arrived: the hands-free
     * paths pass no overrides, so a player with a custom caddie would have had it answer under
     * Kevin's name in Kevin's voice on the earbud — the exact revert this pair was added to stop.
     * A field only one caller remembers to fill is the bug this file exists to make impossible.
     */
    customCaddieName: safe(() => p.customCaddieName ?? null, null),
    customCaddieBasePersona: safe(() => p.customCaddieBasePersona ?? 'kevin', 'kevin'),
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
     * 2026-08-23 — His saved pre-round routine (the warm-up he told the caddie to remember). Stored
     * with a setter since June and read by exactly ONE place — localStatusResponder, the demoted
     * fallback — so it reached no brain at all. Round-independent: he saves and recalls it off the
     * course, and the caddie should be able to run him through it in his own voice.
     */
    preRoundRoutine: safe(() => p.preRoundRoutine ?? null, null),
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
    /**
     * 2026-08-23 — read here rather than left to the caller. Every hand-built payload remembered
     * `round.holeNotes` and this builder shipped null, so the two paths that relied on it (and had
     * no literal of their own to fall back on) lost the player's own notes on the hole they were
     * standing on.
     */
    holeNotes: safe(() => r.holeNotes ?? {}, {}),
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

    /**
     * ─── THE PIPECAT HALF (2026-08-23) ──────────────────────────────────────
     *
     * Tim, mid-sprint: "we need a single source of truth, a single path, a total present caddie…
     * getting all the generics out."
     *
     * The 08-22 unification joined the mic (useVoiceCaddie) and the text box (useKevin). It did NOT
     * join the other two: the caddie-tab voice hook (usePipecatVoice) and the earbud/watch path
     * (listeningSession → conversationalBrain) both built a SECOND payload — services/pipecatContext
     * — and posted it to a SECOND brain. So the split he could hear was still live on the two
     * surfaces he actually uses hands-free.
     *
     * Everything below is a field one of those four paths sent and the others did not. Emitting the
     * union HERE is what makes the four paths one path: whichever way he asks, the caddie knows the
     * same things.
     */
    // ── shot context (useVoiceCaddie sent these; useKevin never did) ────────
    holeShots: safe(() => {
      const all = r.shots ?? [];
      if (currentHole == null) return [];
      return all
        .filter((s: { hole: number }) => s.hole === currentHole)
        .map((s: ShotRow) => ({
          hole: s.hole,
          shotIndex: s.shot_in_hole_index ?? null,
          direction: s.direction ?? null,
          outcome: s.outcome ?? null,
          outcomeText: s.outcome_text ?? null,
          feel: s.swing_feel ?? null,
        }));
    }, []),
    recentShots: safe(() => (r.shots ?? []).slice(-5).map((s: ShotRow) => ({
      hole: s.hole,
      shotIndex: s.shot_in_hole_index ?? null,
      club: s.club ?? null,
      shape: s.shape ?? null,
      direction: s.direction ?? null,
      outcome: s.outcome ?? null,
      outcomeText: s.outcome_text ?? null,
      feel: s.swing_feel ?? null,
      distance_yards: s.distance_yards ?? null,
    })), []),
    /** Subjective self-reports, so the caddie reads the room instead of only the scorecard. */
    emotionalLog: safe(() => (r.emotionalLog ?? []).slice(-5).map(
      (e: { state: string; valence?: string; hole?: number }) => ({ state: e.state, valence: e.valence, hole: e.hole }),
    ), []),
    /** The player's REAL bag numbers — club answers grounded in what they actually carry. */
    clubDistances: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { bagDistances } = require('./shotStrategy') as typeof import('./shotStrategy');
      return bagDistances();
    }, {}),
    /** Per-club character (shape + miss + carry), evidence-barred by clubTendency itself. */
    club_tendencies: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ct = require('./clubTendency') as typeof import('./clubTendency');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cn = require('./clubNormalize') as typeof import('./clubNormalize');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cs = require('../store/clubStatsStore').useClubStatsStore.getState();
      const history = (r.roundHistory ?? []).flatMap((h: { shots?: unknown[] }) => h.shots ?? []);
      const all = [...history, ...(r.shots ?? [])].slice(-300);
      const carryFor = (c: string) => {
        try { return cs.hasDistance(c) ? cs.carryFor(c) : null; } catch { return null; }
      };
      return ct.describeBagTendencies(ct.clubTendencies(all as never, carryFor, cn.normalizeClub));
    }, []),
    /** Phrases this player actually uses — the difference between his caddie and a generic one. */
    playerVocabulary: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const v = require('../store/vocabularyProfileStore').useVocabularyProfileStore.getState();
      const top = v.getTopPhrases?.(20);
      return Array.isArray(top) && top.length > 0 ? top : null;
    }, null),
    recentCageInsights: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require('../store/cageStore').useCageStore.getState().recentInsights ?? []).slice(-3);
    }, []),
    recentRoundInsights: safe(() => (r.recentInsights ?? []).slice(-3), []),

    // ── who is speaking, and in what role ───────────────────────────────────
    /** Legacy voice fallback kevin still reads when `persona` is absent. */
    voiceGender: safe(() => st.voiceGender ?? 'male', 'male'),
    /**
     * Which ROLE the caddie is in — on-course tactical (caddie), swing review (coach), or
     * between-shots/recap (psychologist). useKevin derived this and no other path did, so the same
     * question asked by voice in the cage got the on-course voice.
     */
    register: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getActiveSurface } = require('./activeSurfaceRegistry') as { getActiveSurface: () => string };
      const s = getActiveSurface();
      if (s === 'cage' || s === 'swing_library' || s === 'swing_detail') return 'coach';
      if (s === 'arena' || s === 'recap') return 'psychologist';
      return 'caddie';
    }, 'caddie'),
    /** The screen/drill he is looking at right now, so a question asked inside a drill is about it. */
    screen_context: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { screenContextForPrompt } = require('./screenContext') as typeof import('./screenContext');
      return screenContextForPrompt();
    }, null),
    /**
     * ONE conversation, whichever mic. Every path already writes to services/voice/pipecatHistory;
     * only the pipecat paths ever READ it back into a request, so a turn taken on the earbud was
     * invisible to the next turn typed — the caddie forgot mid-conversation when he changed surface.
     */
    conversationTurns: safe(() => {
      /**
       * 2026-08-23 — THE UNION OF BOTH HISTORIES, because there are two.
       *
       * `services/voice/pipecatHistory` is written by every turn that goes through caddieBrain (the
       * earbud, the caddie-tab mic, the diagnostic). `services/conversationState` is written by
       * useVoiceCaddie — SIXTEEN call sites — and by nothing else. Neither can see the other's
       * turns, so the caddie's memory of the conversation depended on which surface you last used:
       * talk on the tab mic, then through the earbuds, and the first half was gone.
       *
       * That is the same split as the payloads, one layer down, and it is why this reads BOTH and
       * merges by timestamp order. conversationState is deliberately left in place — it also drives
       * follow-up detection (isAwaitingFollowUp) on a 3-minute decay window, which is a different
       * job from feeding the prompt.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getPipecatHistory } = require('./voice/pipecatHistory') as typeof import('./voice/pipecatHistory');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getRecentTurns } = require('./conversationState') as typeof import('./conversationState');

      const fromPipecat = (getPipecatHistory() ?? []).map(
        (m: { role: string; content: string }) => ({ role: m.role === 'assistant' ? 'kevin' : 'user', text: m.content }),
      );
      const fromBuffer = (getRecentTurns() ?? []).map((t) => ({ role: t.role as 'user' | 'kevin', text: t.text }));

      // Same turn can land in both (a mic turn writes conversationState AND caddieBrain writes
      // pipecatHistory), so drop exact role+text repeats rather than telling the caddie twice.
      const seen = new Set<string>();
      const merged: { role: string; text: string }[] = [];
      for (const t of [...fromPipecat, ...fromBuffer]) {
        const key = `${t.role}:${t.text}`;
        if (!t.text?.trim() || seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
      }
      return merged.slice(-12);
    }, []),

    // ── the facts that reached NO brain at all ──────────────────────────────
    /**
     * 2026-08-23 — HANDEDNESS. Every directional word the caddie says — aim left, miss right, favour
     * the left edge, the bunker is short right — is INVERTED for a left-handed player. It is set in
     * Settings, threaded through the whole swing-analysis stack since June, and reached NO brain:
     * zero references in api/kevin.ts, and on the pipecat path only as a string smuggled inside
     * screen_context by a shim that is OFF by default. So a lefty has been getting advice that is
     * precisely wrong, which is worse than advice that is vague.
     */
    handedness: safe(() => p.handedness ?? 'right', 'right'),
    /** WHICH WAY it goes wrong (slice/hook/pull), not merely which side. */
    missType: safe(() => p.missType ?? null, null),
    /** How much the player has earned the caddie's directness. */
    trustLevel: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../store/trustLevelStore').useTrustLevelStore.getState().level ?? null;
    }, null),
    /**
     * A green read the player SAVED on a PRIOR visit to this hole — honest recall of a real read,
     * never a same-round replay dressed up as memory.
     */
    priorGreenRead: safe(() => {
      if (!isRoundActive || currentHole == null) return null;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('../store/greenReadStore').useGreenReadStore.getState();
      type GR = { at: number; feetEst: number | null; slopePct: number | null; text: string } | null;
      const startMs = r.roundStartTime ?? 0;
      const isPriorRound = (g: GR) => !!g && !(startMs > 0 && g.at >= startMs);
      const direct = store.lastForHole(activeCourseId, currentHole) as GR;
      const twin = r.twiceAround === true && currentHole >= 10
        ? (store.lastForHole(activeCourseId, currentHole - 9) as GR)
        : null;
      const gr = isPriorRound(direct) ? direct : twin;
      if (!gr || (gr.feetEst == null && gr.slopePct == null && !gr.text)) return null;
      return { feet: gr.feetEst ?? null, slopePct: gr.slopePct ?? null, note: gr.text || null };
    }, null),
    /** 0 = first time here → frame it as a baseline, never "your best score yet". */
    priorRoundsAtCourse: safe(() => {
      if (!activeCourseId) return 0;
      return (r.roundHistory ?? []).filter(
        (h: { courseId?: string; simulated?: boolean }) => h.courseId === activeCourseId && !h.simulated,
      ).length;
    }, 0),
    /** Say "I'm reacquiring GPS" rather than asking the golfer for the number — the backwards ask. */
    gpsLost: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGreenYardagesSync } = require('./smartFinderService') as typeof import('./smartFinderService');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      return getGreenYardagesSync(currentHole).middle == null && getLastFix() == null;
    }, false),
    /** How far he just hit it — so the caddie can confirm the drive before it is even logged. */
    distanceFromTeeYds: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { haversineYards } = require('../utils/geoDistance') as typeof import('../utils/geoDistance');
      const fix = getLastFix();
      const tee = (r.courseHoles ?? []).find((x: { hole: number }) => x.hole === currentHole) as
        { teeLat?: number; teeLng?: number } | undefined;
      if (!fix || fix.lat == null || fix.lng == null || !tee?.teeLat || !tee?.teeLng) return null;
      const d = haversineYards({ lat: fix.lat, lng: fix.lng }, { lat: tee.teeLat, lng: tee.teeLng });
      return d >= 20 && d <= 700 ? Math.round(d) : null;
    }, null),
    /**
     * 2026-08-23 (Tim) — "When I'm on the course, it needs to be real. It was raining yesterday. We
     * have a weather API. That plays into the round, especially for a mid to high handicapper."
     *
     * WEATHER REACHED NO BRAIN. Not one key in this payload, and nothing kevin destructured.
     * services/weatherService feeds the offline responder, SmartFinder's scene read, TightLie, the
     * dashboard and the direct "what's the wind" query — every surface EXCEPT the caddie the player
     * actually talks to. `getCachedWeatherEvenIfStale` even documents itself as being for
     * "brain/prompt builders", and no brain builder called it.
     *
     * Worse than absent: the prompt already carries an honesty rule about it — "if wind data is
     * null or weather hasn't loaded, say 'no wind on me right now'". Written to stop the caddie
     * inventing wind, it instead guaranteed the caddie reported none, in every round, in every
     * condition. The same shape as the presence caddie: a prompt reasoning about context the
     * request never carried.
     *
     * Stale-tolerant on purpose — 30-minute-old weather beats no weather, and conditions do not
     * turn over in a hole. [[unconnected-halves-not-broken-code]]
     */
    weather: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCachedWeatherEvenIfStale } = require('./weatherService') as typeof import('./weatherService');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      const fix = getLastFix();
      if (!fix || fix.lat == null || fix.lng == null) return null;
      const w = getCachedWeatherEvenIfStale({ lat: fix.lat, lng: fix.lng });
      if (!w) return null;
      return {
        tempF: w.temp_f,
        windMph: w.wind_speed_mph,
        windFromDeg: w.wind_direction_deg,
        gustMph: w.wind_gust_mph,
        conditions: w.conditions,
        description: w.description,
        ageMin: Math.round((Date.now() - w.timestamp) / 60000),
      };
    }, null),

    /** Front / middle / back to the green, the three numbers a caddie is actually asked for. */
    greenYardages: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGreenYardagesSync } = require('./smartFinderService') as typeof import('./smartFinderService');
      const y = getGreenYardagesSync(currentHole);
      return y.middle != null ? { front: y.front ?? null, middle: y.middle, back: y.back ?? null } : null;
    }, null),

    // ─── the merged brain context ───────────────────────────────────────────
    unified_context_block,

    /**
     * 2026-08-23 — a PROACTIVE turn: the caddie is speaking first, the player did not ask. The
     * opener path passes this as an override, and an override can only REPLACE a key this builder
     * already emits — so without the key here it would have been silently dropped and the caddie's
     * first words would have been generated as if the player had said that directive out loud.
     * Exactly the half-fix shape this file exists to make impossible.
     */
    is_proactive: false,
    /** Coach's in-round diagnostic mode — a longer, multi-shot read. Caller-selected. */
    inRoundDiagnostic: false,

    // ─── caller-only ────────────────────────────────────────────────────────
    smartVisionContext: extras.smartVisionContext ?? null,
    /**
     * 2026-08-23 — sourced from the round store when the caller does not hand one over, so the MIC
     * path gets it too. It was previously supplied only by the text box, and read by nobody.
     */
    pendingLieAnalysis: extras.pendingLieAnalysis ?? safe(() => r.pendingLieAnalysis ?? null, null),
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
