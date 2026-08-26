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
   * 2026-08-24 — THE WORKING NUMBER. One yardage drives both the words and the arithmetic.
   *
   * The bug, reproduced live against production before the fix: card/GPS 180, player's rangefinder
   * 205. The caddie answered "Three iron — you've got comfortable margin, smooth swing, trust the
   * carry." The 3 iron carries 198. It gave the club for 180 and the confidence for a number the
   * player had explicitly corrected, seven yards short.
   *
   * Cause: `r.currentYardage` is the CARD/GPS number (roundStore sets it from holeData.distance on
   * every hole change), and it fed BOTH the computed club in api/kevin and the plays-like model
   * below. Meanwhile services/yardageResolver — "the single source of truth for the number" since
   * 2026-05-25, whose header says it exists so "Kevin's prompt can hedge correctly" — ranks a
   * user-stated number (rangefinder, Golfshot, spoken) ABOVE live GPS and the card. Its verdict rode
   * along in `yardageInsight` and shaped only the PROSE: the prompt said "This is THEIR number" in
   * one line while the computed-club line, stated as settled arithmetic that must not be
   * second-guessed, covered a different one.
   *
   * That asymmetry is the 08-24 lesson pointed the wrong way: arithmetic belongs in code — but the
   * code has to be given the number the player is actually hitting. And a computed fact stated
   * forcefully FLATTENS everything around it, so the wrong one wins.
   *
   * The resolver degrades to exactly the old value (its own cascade ends at the card), so this is a
   * strict improvement rather than a new source of truth. [[check-the-brain-has-the-information]]
   */
  const workingYards: number | null = safe(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildYardageInsight } = require('./yardageResolver') as typeof import('./yardageResolver');
    const resolved = buildYardageInsight()?.yardage;
    if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved > 0) return resolved;
    return r.currentYardage ?? null;
  }, safe(() => r.currentYardage ?? null, null));
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
    /**
     * 2026-08-26 — THE CUSTOM CADDIE'S VOICE CHANGED DEPENDING ON WHICH PATH ANSWERED.
     *
     * caddieVoiceMatch picks an OpenAI voice from the portrait the player generated, and voiceService
     * applies it — but only in speak(), the client TTS fallback. The primary path plays audio the
     * SERVER rendered, and the server was never told the matched voice, so it fell back to the base
     * persona's. Same custom caddie, two voices, switching on whether cloud TTS happened to be the
     * one that answered. That is Tim's original complaint about this feature almost word for word:
     * "the tone of the voice changes a little bit."
     */
    customCaddieVoice: safe(() => p.customCaddieVoice ?? null, null),
    cecilyMode: safe(() => st.cecilyMode ?? false, false),

    // ─── the round ──────────────────────────────────────────────────────────
    isRoundActive,
    isCompetition: safe(() => !!r.isCompetition, false),
    sim_round: safe(() => !!r.isSimRound, false),
    // The store calls it `mode`; every payload has always called it roundMode.
    roundMode: safe(() => r.mode ?? null, null),
    currentHole,
    // Derived by the round store's getter rather than stored as a field.
    currentPar: safe(() => (typeof r.getCurrentPar === 'function' ? r.getCurrentPar() : null), null),
    /** The RESOLVED number the player is hitting — stated > live GPS > card. See workingYards. */
    currentYardage: workingYards,
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
     * 2026-08-23 (Tim) — "we should know the player's gender as well."
     *
     * The app already does. `handicap_gender` has been in the profile with a setter and a Settings
     * control, and it drives tee and course-rating selection on both the play and course screens.
     * The CADDIE was the only one not told, so the one part of the app that actually talks to the
     * player was the part that could not address them correctly. Same field, not a new one — the
     * rest of the app already treats it as the answer to this question. 'x' means unspecified.
     */
    handicap_gender: safe(() => p.handicap_gender ?? 'x', 'x'),
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
    /**
     * The player's MEASURED carry numbers — club answers grounded in real data.
     *
     * 2026-08-26 — the comment here used to say "what they actually carry", and that is not what
     * this is. bagDistances() returns clubs we have a CARRY NUMBER for. Which clubs are in the bag
     * is a different fact, and it lives in clubBagStore — see bagClubs below.
     */
    clubDistances: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { bagDistances } = require('./shotStrategy') as typeof import('./shotStrategy');
      return bagDistances();
    }, {}),
    /**
     * 2026-08-26 — WHAT IS ACTUALLY IN THE BAG, which the caddie could not see.
     *
     * clubBagStore is the registered bag. Smart Motion's club scan writes to it every time it
     * recognises a club through the camera, Bag Vision writes the whole set, and the caddie's OWN
     * `register_bag` tool writes it too — so the caddie was registering a bag it could never read
     * back. Written, never read, at the brain layer.
     *
     * The store's own accessor is annotated "Bag as a driver→putter-sorted array (for display +
     * brain context)". It reached the dashboard and two services. It never reached a brain.
     *
     * Why it matters separately from clubDistances: those are the clubs with MEASURED carries, so a
     * club the player told us they carry but has not logged a shot with is invisible to the club
     * lookup — the caddie reads down a list that silently omits it. And nothing stopped it naming a
     * club they no longer carry but still have history for.
     */
    bagClubs: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useClubBagStore } = require('../store/clubBagStore') as typeof import('../store/clubBagStore');
      return useClubBagStore.getState().bagList().map((c) => c.club_id);
    }, []),
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
    /**
     * 2026-08-24 (orphan sweep) — THE PLAYER'S OWN HISTORY, which no brain had ever seen.
     *
     * services/caddieHistoryContext.historyPromptBlock() has existed since 07-04 — recent rounds
     * with scores and courses, every course played, and the practice focuses by session count. It
     * was even given a sim-contamination fix on 07-30 so a narrated demo round could never be
     * recited as real play. It had ZERO callers. Meanwhile `priorRoundsHere` (below) filters to the
     * CURRENT course only, so "how was my last round", "what courses have I played" and "what have I
     * been working on" were unanswerable by a caddie whose whole premise is that it knows you.
     *
     * store/practicePlanStore.practicePlanPromptBlock() is the same story: written 07-04, its own
     * docstring says it is "safe to call from services (buildPipecatContext, kevin)", and nothing
     * called it. It self-gates to '' until the player has actually engaged the plan.
     *
     * COST NOTE — both belong on the SYSTEM side, and kevin puts them there. They change at most
     * once a round (a round ending, a practice session logged), never shot to shot, so they ride the
     * cached block for ~$0.30/M on every turn after the first rather than full price every turn.
     * Putting them on the message side would have been the cousin of the 08-24 cache defect.
     */
    playerHistoryBlock: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const h = require('./caddieHistoryContext') as typeof import('./caddieHistoryContext');
      return h.historyPromptBlock() || null;
    }, null),
    /**
     * 2026-08-24 (Tim — "it would be great if the user knows if shots are verifiably better when
     * doing their routine") — THE ANSWER, so the caddie can just say it.
     *
     * services/practice/routineImpact contrasts the player's own slowest third over the ball against
     * their own quickest third, on clean-strike rate. Ask "does my routine actually help?" and the
     * caddie answers from their shots instead of repeating the coaching cliché every app repeats.
     *
     * COMPUTED FROM COMPLETED ROUNDS ONLY, and that is a cache decision as much as an honesty one.
     * Folding in the live round would change this string as shots accumulate, and it rides the
     * CACHED system prompt — a block that moves shot to shot is exactly the defect that cost $50 in
     * a day. From roundHistory alone it is constant for the whole round. It also happens to be the
     * more honest window: a finding drawn from finished rounds, not from the four shots so far today.
     */
    routineImpactBlock: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ri = require('./practice/routineImpact') as typeof import('./practice/routineImpact');
      const past = (r.roundHistory ?? []).flatMap((h: { shots?: unknown[] }) => h.shots ?? []);
      const out = ri.routineImpact(past as never);
      return out.status === 'ready'
        ? `THEIR PRE-SHOT ROUTINE, measured from their own completed rounds (association, not cause — say it as an observation, never as a promise): ${out.line}`
        : null;
    }, null),

    /** The stated weekly plan — goals, challenges, open reminders. Empty until they engage it. */
    practicePlanBlock: safe(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pp = require('../store/practicePlanStore') as typeof import('../store/practicePlanStore');
      return pp.practicePlanPromptBlock() || null;
    }, null),
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
    /**
     * 2026-08-24 — WHAT HE ACTUALLY SHOT HERE, not just how many times he has been.
     *
     * priorRoundsAtCourse sent a COUNT and nothing else, so asked "is that a good score for me at
     * this course?" the caddie answered "let me check what you've typically shot here" — promising
     * an action it cannot take, which is the empty-pleasantry failure in a new costume. It had the
     * number six and no way to use it. roundHistory has carried totalScore, scoreVsPar and
     * holesPlayed the whole time; the comparison was one filter away.
     *
     * Last five rounds here, newest first. Nine-hole and eighteen-hole rounds are not comparable, so
     * the hole count rides along and the brain is told to compare like with like.
     */
    priorRoundsHere: safe(() => {
      if (!activeCourseId) return [];
      type RH = { courseId?: string; simulated?: boolean; endedAt?: number; totalScore?: number | null; scoreVsPar?: number | null; holesPlayed?: number | null };
      return (r.roundHistory ?? [])
        .filter((h: RH) => h.courseId === activeCourseId && !h.simulated && typeof h.totalScore === 'number' && (h.totalScore ?? 0) > 0)
        .sort((a: RH, b: RH) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 5)
        .map((h: RH) => ({
          score: h.totalScore ?? null,
          vsPar: typeof h.scoreVsPar === 'number' ? h.scoreVsPar : null,
          holes: h.holesPlayed ?? null,
          daysAgo: h.endedAt ? Math.max(0, Math.round((Date.now() - h.endedAt) / 86_400_000)) : null,
        }));
    }, []),
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
      /**
       * 2026-08-23 — RELATIVE wind, not just a compass degree. "From 270°" is unusable without the
       * shot bearing, and the brain was never sent one, so it could only ignore the wind or guess
       * "into" and state the guess as fact. Three prompt rewrites tried to fix the club call in wind
       * before anyone checked whether the brain could answer at all.
       *
       * Same module the spoken wind answer uses, so the number the player HEARS and the number the
       * club is chosen FROM cannot drift apart. Null when the hole has no mapped geometry — an
       * unknown wind must stay unknown rather than defaulting to "into".
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { decomposeWind, shotBearingDeg } = require('./windRelative') as typeof import('./windRelative');
      const bearing = safe(() => shotBearingDeg(currentHole), null);
      const relative = safe(() => decomposeWind(w.wind_direction_deg, w.wind_speed_mph, bearing), null);
      /**
       * 2026-08-23 — THE PLAYING NUMBER, COMPUTED. Not left to the caddie to work out.
       *
       * utils/playsLike has modelled this properly for months — 1%/mph into the wind, 0.5% downwind,
       * air density by temperature, elevation — and answered the local "what does it play?" query.
       * The BRAIN was never given it, so the single most important adjustment in golf was model
       * arithmetic done from a prose description of the weather. That is precisely the thing that
       * comes out right two times in three, and two-in-three is not a caddie.
       *
       * Handed the number, there is nothing left to be flaky about: he matches a club to it.
       */
      const playsLike = safe(() => {
        // The working number, not the card — the club and the plays-like model must not start from
        // different yardages (that split gave a 3 iron for a 205-yard rangefinder read).
        const yds = workingYards;
        if (typeof yds !== 'number' || !Number.isFinite(yds) || yds <= 0) return null;
        /**
         * 2026-08-23 (Tim, Greenhill hole 2) — "230 yards DOWNHILL considerably; if I'd taken the
         * caddie's recommendation I'd have smoked it into the woods past the hole." Elevation is a
         * PARAMETER of playsLikeDistance that nothing was passing, while /api/elevation, the cache,
         * the UI hook and the plays-like query had all worked for months. Read from the cache (this
         * builder is synchronous, and elevation is static per point so the play screen has usually
         * already resolved these exact cells), and warm it for next turn when it has not.
         */
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const el = require('./elevationService') as typeof import('./elevationService');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getGreenCentroid } = require('./shotLocationService') as typeof import('./shotLocationService');
        const here = fix && fix.lat != null && fix.lng != null ? { lat: fix.lat, lng: fix.lng } : null;
        const green = safe(() => getGreenCentroid(currentHole), null);
        let elevFeet = 0;
        if (here && green) {
          const cached = el.getCachedPlaysLikeElevation(here, green);
          if (cached) elevFeet = cached.deltaFeet;
          else el.warmElevation([here, green]);
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { playsLikeDistance } = require('../utils/playsLike') as typeof import('../utils/playsLike');
        const b = playsLikeDistance(yds, w, bearing, elevFeet);
        return b.delta_yards === 0 ? null : {
          actualYds: b.actual_yards,
          playsLikeYds: b.plays_like_yards,
          deltaYds: b.delta_yards,
          fromWind: b.wind_component_yards,
          fromTemp: b.temp_component_yards,
          fromWet: b.wet_component_yards,
          fromElevation: b.elevation_component_yards,
        };
      }, null);
      return {
        relative,
        playsLike,
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
