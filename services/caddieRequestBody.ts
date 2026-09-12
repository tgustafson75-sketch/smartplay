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

const roundStore = () => require('../store/roundStore').useRoundStore.getState();
const profileStore = () => require('../store/playerProfileStore').usePlayerProfileStore.getState();
const relationshipStore = () => require('../store/relationshipStore').useRelationshipStore.getState();
const settingsStore = () => require('../store/settingsStore').useSettingsStore.getState();

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
  /**
   * 2026-09-10 — the declared club EXPIRES, and the rule lives in one place.
   *
   * This read `r.club` raw. `club` is only cleared at round start, round end and by an explicit
   * change — never by a hole change and never by time — so a club named on hole 3 was still being
   * sent to the brain as the player's current club on hole 18. services/shotClubResolver has always
   * applied a 12-minute window to exactly this value when deciding what a SHOT was hit with; the
   * caddie's own prompt was the looser of the two owners. [[two-owners-is-the-root-cause]]
   */
  const club = safe(() => {
    const m = require('./shotClubResolver') as typeof import('./shotClubResolver');
    return m.declaredClubIfFresh();
  }, null);

  /**
   * The stroke he is ABOUT to play — strokesPlayedOnHole + 1, through the store helper that is now
   * the one owner of that count. Two answers to "which shot is he on" is how the caddie ends up
   * briefing a tee shot to a man in the fairway while the plan promises him a par he can no longer
   * make. [[two-owners-is-the-root-cause]]
   */
  /**
   * 2026-09-11 — THE CADDIE'S DECISION, COMPOSED ONCE PER TURN.
   *
   * Four blocks below each called decideShot({ rawYards: workingYards }) with identical arguments —
   * the shot read, the hole plan, the play profile and the round conditions — and every call built
   * the WHOLE decision again: the club pick, a depth-first walk of the bag for the plan, the
   * profile, the override, the cues, and a pass over the round history for the conditions. Four
   * identical answers computed four times, on every single caddie turn.
   *
   * It is composed here instead, and the blocks read from it. Still inside `safe`, so a failure
   * leaves every field null rather than taking the payload down — the same contract they had.
   */
  const decision = safe(() => {
    const { decideShot } = require('./caddieDecision') as typeof import('./caddieDecision');
    return decideShot({ rawYards: workingYards });
  }, null);

  const currentStroke: number = safe(() => {
    const { strokesPlayedOnHole } = require('../store/roundStore') as typeof import('../store/roundStore');
    return strokesPlayedOnHole(r as never, currentHole) + 1;
  }, 1);

  /**
   * The learned-memory slice merged with the caller's live block. This is also where the measured
   * "TROUBLE ON THIS SHOT" line enters (see caddieMemoryRetrieval.liveTroubleLine), so every path
   * gets the hole picture — not just whichever one happened to be wired.
   */
  const unified_context_block = safe(() => {
    const m = require('./caddieMemoryRetrieval') as typeof import('./caddieMemoryRetrieval');
    const merged = m.mergeMemoryIntoContext(
      extras.liveBlock ?? null,
      m.getCaddieContext({ courseId: activeCourseId, hole: currentHole, club }).promptBlock,
    );
    /**
     * 2026-08-30 (orphan sweep) — WHAT THE PLAYER SAID WITH NO SIGNAL, which no brain ever heard.
     *
     * voiceLogService has captured offline statements since 07-04 (useCaddieTabMic calls it when a
     * turn can't reach the brain) and roundStore marks them "ingested" at round end. Nothing ever
     * INGESTED them: peekOfflineNotesBlock — the function whose whole job is handing them to the
     * live caddie once signal returns — had zero callers. Notes were collected, carried all round,
     * and marked as consumed by a name that described something that never happened.
     *
     * So the player would say "I'm pulling everything left" on a dead cell, get nothing, and the
     * caddie would have no idea it was ever said. Capture with no read is not a loop.
     * [[close-the-loop-strategy]]
     *
     * HERE rather than as its own body field, deliberately, and it is what makes this OTA-safe:
     * this block is the one every caddie path already merges, so a note reaches kevin, pipecat and
     * the tactical routes without a new key, a schema change or a server deploy. It also belongs on
     * the live side rather than the cached system side — notes accumulate DURING a round, and a
     * block that moves shot to shot must never ride the cached prompt.
     */
    const offline = safe(() => {
      const vl = require('./voiceLogService') as typeof import('./voiceLogService');
      return vl.peekOfflineNotesBlock() || null;
    }, null);

    const suffix = extras.contextSuffix?.trim();
    const tail = [offline, suffix].filter((x): x is string => !!x && x.trim().length > 0).join('\n\n');
    if (!tail) return merged;
    return merged ? `${merged}\n\n${tail}` : tail;
  }, extras.liveBlock ?? null);

  const patternInsights = safe(() => {
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
      const { brainSettings } = require('./voice/brainSettings') as typeof import('./voice/brainSettings');
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
    currentStroke,
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
    /**
     * 2026-08-31 (Tim: "check if note input on play tab does the same thing") — IT DID, IN THE
     * MIDDLE.
     *
     * The pre-round note the player writes on the Play tab was wired at both ENDS and missing from
     * the whole round between them: api/briefing renders it as "Player's focus for today", and
     * api/recap renders it as "Pre-round focus (user wrote) — treat as a coaching contract". The
     * LIVE caddie never saw it. So a player writes "working on tempo today", hears nothing about it
     * for eighteen holes, and is then graded against it at the end. The one place a coaching
     * contract actually matters is while you are playing.
     *
     * Stable for a whole round by construction — set once at round start, and the only editor is the
     * round-notes field — which is why it is safe inside the cached prompt block. That stability is
     * stated here because the cache ratchet requires it to be.
     */
    roundNotes: safe(() => (r.roundNotes ?? '').trim().slice(0, 400) || null, null),
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
      const { buildYardageInsight } = require('./yardageResolver') as typeof import('./yardageResolver');
      return buildYardageInsight();
    }, null),
    smartFinderContext: safe(() => {
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
    /**
     * 2026-09-11 (Tim) — WHO THIS GOLFER IS, composed once, instead of inferred fresh every turn.
     *
     * The brain was handed handicap, dominantMiss and persistentPatterns and left to work the player
     * out on every single request. services/playProfile composes the whole picture — strengths,
     * weaknesses, the smart-bogey budget, and the in-play cues for their level — from signals that
     * were already being measured but had never been put in one place.
     *
     * Every finding carries its SOURCE, and that matters more here than anywhere: the brain must be
     * able to say "most players starting out lose shots to penalties" rather than "you lose shots to
     * penalties" when all it has is a prior about their level. Sending an unlabelled claim is how a
     * model states a guess as a fact about someone. [[illustration-data-points]]
     */
    playProfile: safe(() => {
      /**
       * 2026-09-11 — THROUGH THE BRAIN, like the plan and the shot read beside it.
       *
       * This block used to compose the profile itself, from the same inputs services/caddieDecision
       * composes it from. Two compositions of "who is this golfer" is two golfers, and the cheapest
       * way for the caddie's words to stop matching the screens is for each to work him out
       * separately. [[caddie-brain-lens]]
       *
       * The SOURCE LABELS matter more here than anywhere: a [seeded] finding is a prior about
       * players at this level, a [measured] one is an observation about THIS player, and stating the
       * first as the second is telling someone a guess about themselves as a fact.
       */
      const d = decision;
      const profile = d?.profile;
      if (!d || !profile) return null;
      return {
        level: profile.level,
        goal: profile.goal,
        targetScore: profile.targetScore,
        strokeBudget: profile.strokeBudget,
        confidence: profile.confidence,
        strengths: profile.strengths,
        weaknesses: profile.weaknesses,
        /**
         * Already decayed by what has been said this round — a cue the caddie has spoken twice is
         * filtered out before the brain sees it, rather than left to a model's discretion. The decay
         * lives in the brain so a chip and a spoken line cannot nag independently.
         */
        cues: d.cues,
        bogeyBudget: d.budget,
      };
    }, null),

    clubCall: safe(() => {
      const { pendingAdviceIfFresh } = require('./shotClubResolver') as typeof import('./shotClubResolver');
      const standing = pendingAdviceIfFresh();
      if (!standing) return null;
      const { readOverride } = require('./overrideLoop') as typeof import('./overrideLoop');
      const { normalizeClub } = require('./clubNormalize') as typeof import('./clubNormalize');
      const { bagDistances } = require('./shotStrategy') as typeof import('./shotStrategy');
      const bag = safe(() => bagDistances() as Record<string, number>, {});
      const chosenYds = safe(() => {
        const k = club ? normalizeClub(club) : null;
        return k ? (bag[k] ?? null) : null;
      }, null);
      return {
        advised: standing.club,
        advisedShape: standing.shape,
        advisedAgoSec: standing.agoSec,
        /** The club the player has declared since, within the same freshness window. */
        playerClub: club,
        /**
         * Null on the turn the player FIRST says it — club_change has not dispatched yet — which is
         * exactly why `advised` above is sent unconditionally rather than only alongside a detected
         * override. The structured read covers the turns after that, and the tap-driven club change
         * that never passes through the brain at all.
         */
        override: club
          ? readOverride({
              advisedClub: standing.club,
              chosenClub: club,
              bag,
              normalize: normalizeClub,
              yardsToTarget: workingYards,
              distanceControl: (p.distanceControl ?? null) as never,
              /**
               * Green geometry — the half the app could SEE and never told the read. Room behind the
               * pin is what decides whether taking more club is fine or is the whole problem.
               */
              roomBehindYards: safe(() => {
                const yr = require('./yardageResolver') as typeof import('./yardageResolver');
                const fmb = yr.resolvedToFmb(yr.resolveYardage(currentHole ?? undefined));
                const back = fmb?.back ?? null;
                return typeof back === 'number' && workingYards != null && back > workingYards
                  ? back - workingYards
                  : null;
              }, null),
              /**
               * What THEIR club has to carry — not the caddie's. The question an override raises is
               * whether the club they picked gets over the trouble.
               */
              carryNeededYards: safe(() => {
                if (!activeCourseId || currentHole == null || chosenYds == null) return null;
                const cg = require('./courseGeometryService') as typeof import('./courseGeometryService');
                const hz = require('./hazardIntelligence') as typeof import('./hazardIntelligence');
                const wr = require('./windRelative') as typeof import('./windRelative');
                const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
                const fix = getLastFix();
                if (!fix || fix.lat == null || fix.lng == null) return null;
                const geom = cg.getHoleGeometry(activeCourseId, currentHole);
                const intel = hz.computeHazardIntelligence(
                  { lat: fix.lat, lng: fix.lng }, geom, chosenYds, wr.shotBearingDeg(currentHole),
                );
                const c = intel?.carryToClear ?? null;
                return typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : null;
              }, null),
            })
          : null,
      };
    }, null),

    /**
     * 2026-09-11 (Tim) — THE HOLE, PLANNED BACKWARDS. "We're gonna start with the three wood here.
     * It's gonna leave us this… avoid hazards and play smart bogey."
     *
     * Nothing in the app has ever planned a hole. cnsShotRead answers THIS shot and answers it well;
     * the question of what the next one should be left to is one nobody was asking, which is how a
     * player ends up 47 yards out holding a wedge they have never practised.
     *
     * It is computed rather than prompted for the reason club match, wind and plays-like are all
     * computed: three subtractions asserted by a language model come out right about two times in
     * three, and the sentence "3 wood, because it leaves 145, and 145 is your 8 iron" is worth
     * nothing at all if the 145 is wrong. [[arithmetic-belongs-in-code-not-the-model]]
     */
    /**
     * 2026-09-11 (Tim) — THE BRAIN IS TOLD THE DECISION, NOT ASKED TO RE-DERIVE IT.
     *
     * The local engine already chose the club, the plays-like number, the room on the green and —
     * now — what the lie allows. None of it was sent. The brain got bag, yardage and wind and worked
     * the club out again in prose, which is the arithmetic-in-the-model problem this codebase has
     * lost to repeatedly, and it meant the caddie could SAY a different club from the one the screen
     * was showing.
     *
     * `lieOffer` is the half that only exists here. Tim: "Caddie can offer — we could go with an iron
     * here to get out, or if you feel we have a good lie, let's go with hybrid. That way no computer
     * vision is needed. Could offer user to open TightLie for a full analysis."
     * [[arithmetic-belongs-in-code-not-the-model]]
     */
    /**
     * 2026-09-11 (Tim) — THE POST-ROUND ANSWERS, FINALLY WORTH SOMETHING.
     *
     * "It asks feel, weather, mindset etc but I have a suspicion that does not feed information for
     * future rounds and situations and data." It did not: the four questions asked after every round
     * were read once, by the recap of that same round, and never again.
     *
     * `conditions` is what has repeated enough to mean something across rounds. `todayMatches` is the
     * subset that describes the round being played right now, which is the "and SITUATIONS" half —
     * a finding about wind is worth far more standing on a windy tee than in a season summary.
     */
    roundConditions: safe(() => {
      const d = decision;
      if (!d || (!d.conditions && !d.todayMatches && !d.conditionPlay && !d.warmup?.line)) return null;
      return {
        pattern: d.conditions, today: d.todayMatches, play: d.conditionPlay,
        /**
         * 2026-09-11 (Tim — "same way we are handling pre round stretch and warmup drills data") —
         * the warm-up had the SAME gap the post-round answers had: measured by
         * services/practice/warmupPerformance, shown on the dashboard, and absent from the one
         * moment it could change anything — the first tee.
         */
        warmup: d.warmup?.line ?? null,
      };
    }, null),

    shotRead: safe(() => {
      const r0 = decision?.shot;
      if (!r0) return null;
      return {
        club: r0.club,
        rawYards: r0.rawYards,
        playsLikeYards: r0.playsLikeYards,
        why: r0.why,
        greenRoomNote: r0.greenRoomNote,
        tendencyNote: r0.tendencyNote,
        lieOffer: r0.lieOffer,
      };
    }, null),

    holePlan: safe(() => {
      /**
       * Composed by services/holePlanLive, NOT here — because components/HolePlanChip shows the
       * same plan on screen, and two hand-built compositions of one plan is how the rangefinder
       * said 205 while the card clubbed him to 180. A plan the player can SEE differing from the
       * plan the caddie SAYS would be the worst instance of that yet: both confidently wrong at
       * each other in the same moment. [[two-owners-is-the-root-cause]]
       */
      return decision?.plan ?? null;
    }, null),

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
      return require('../store/ghostStore').useGhostStore.getState().getSummaryText();
    }, null),
    topObservations: safe(() => rel.getTopObservations?.() ?? null, null),
    recentHeroMoments: safe(() => rel.getRecentHeroMoments?.(2) ?? null, null),
    /**
     * 2026-09-10 (Tim, Hemet: "there's no fucking long term actual caddie type memory going on
     * here") — THE BREAKTHROUGHS REACHED THE DASHBOARD AND NOT THE CADDIE.
     *
     * `breakthroughs` is recorded (a new personal best) and rendered on the dashboard's card, and
     * was the one part of the relationship record the brain never saw — so the caddie could hold
     * your hero moments and your observations and still not know you had just played the best round
     * of your life. Newest three, description + when only; the payload does not need the ids.
     *
     * Kept small on purpose: this rides on EVERY turn, and a long list of past glories crowds out
     * the shot in front of the player. [[state-what-you-measured-not-what-you-intended]]
     */
    recentBreakthroughs: safe(() => {
      const list = (rel.breakthroughs ?? []) as { description?: string; timestamp?: number }[];
      return list.slice(-3).reverse().map(b => ({
        description: String(b.description ?? '').slice(0, 80),
        at: typeof b.timestamp === 'number' ? b.timestamp : null,
      }));
    }, []),
    recentCageSessions: safe(() => {
      const c = require('../store/swingSessionStore').useSwingSessionStore.getState();
      // 2026-08-26 — Array.isArray, not `?? []`. A malformed persisted session whose `shots` is a
      // string or an object does not throw on `.length`; it silently reports a character count or
      // undefined, and the caddie is told a number that means nothing. This is the shape check the
      // hook carried before this derivation moved here, and it moved with it. safe() below makes
      // this throw-proof; only Array.isArray makes it SHAPE-proof, and those are different claims.
      return (Array.isArray(c.sessionHistory) ? c.sessionHistory : []).slice(-3)
        .map((s: { date: number; club: string; shots?: unknown }) => ({
          date: s.date, club: s.club, shots: Array.isArray(s.shots) ? s.shots.length : 0,
        }));
    }, []),
    recent_analyses_snippet: safe(() => {
      const eng = require('./smartAnalysisEngine') as { getRecentAnalyses?: (n: number) => { kind: string; voice_summary: string }[] };
      const recent = eng.getRecentAnalyses?.(8) ?? [];
      return recent.length ? recent.map((a) => `[${a.kind}] ${a.voice_summary}`).join('\n') : null;
    }, null),
    /**
     * 2026-08-26 — DERIVED HERE, not merely accepted. This read the caller's override and nothing
     * else, so a surface that didn't hand it over sent null and the caddie forgot the drill the
     * player was standing in the middle of. buildFullPracticeContext reads the practice stores
     * directly, so every path can have it; an override still wins for a caller holding something
     * better.
     */
    practice_context: safe(() => {
      const supplied = extras.overrides?.practice_context;
      if (typeof supplied === 'string' && supplied.trim()) return supplied;
      const { buildFullPracticeContext } = require('./tutorialContext') as typeof import('./tutorialContext');
      return buildFullPracticeContext() || null;
    }, null),
    coachKnowledgeContext: safe(() => {
      const { getCoachKnowledgeForMessage } = require('../store/coachKnowledgeStore') as { getCoachKnowledgeForMessage: (m: string) => string };
      return getCoachKnowledgeForMessage(extras.message);
    }, ''),
    watchData: safe(() => {
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
     * join the other two: the caddie-tab voice hook (useCaddieTabMic) and the earbud/watch path
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
      const { useClubBagStore } = require('../store/clubBagStore') as typeof import('../store/clubBagStore');
      return useClubBagStore.getState().bagList().map((c) => c.club_id);
    }, []),
    /** Per-club character (shape + miss + carry), evidence-barred by clubTendency itself. */
    club_tendencies: safe(() => {
      const ct = require('./clubTendency') as typeof import('./clubTendency');
      const cn = require('./clubNormalize') as typeof import('./clubNormalize');
      const cs = require('../store/clubStatsStore').useClubStatsStore.getState();
      const history = (r.roundHistory ?? []).flatMap((h: { shots?: unknown[] }) => h.shots ?? []);
      const all = [...history, ...(r.shots ?? [])].slice(-300);
      const carryFor = (c: string) => {
        try { return cs.hasDistance(c) ? cs.carryFor(c) : null; } catch { return null; }
      };
      return ct.describeBagTendencies(ct.clubTendencies(all as never, carryFor, cn.normalizeClub));
    }, []),
    /**
     * 2026-09-11 (Tim) — WHICH CLUBS NEED WORK, which is a different question from what they do.
     *
     * "Each club, part of its characteristics is if you need to do work on that club. If it's a
     * strong club or something you're consistently making errors [with], you need to kinda
     * specifically work around your mindset and approach to that club."
     *
     * club_tendencies above says a club draws. It cannot say the club is struck fat half the time,
     * or that it is the one putting him in the trees — those live in the shot log's `feel` and
     * `outcome`, which no brain had ever been shown. Composed by services/caddieDecision so the
     * sentence the caddie says and the line on the Fit Profile row are the same read.
     *
     * COST NOTE — cached side, beside club_tendencies. It moves on the scale of a round, never shot
     * to shot, so it must not ride the message. [[arithmetic-belongs-in-code-not-the-model]]
     */
    club_work: safe(() => decision?.clubWork ?? null, null),
    /**
     * 2026-09-11 (Tim) — "add a cover recommendations by course if the user would like to say, what
     * should I bring for this course?"
     *
     * He could not ask. services/bagRecommendation answers the backward-looking half and its only
     * caller is the scorecard, for the course already being played — which is the case where he
     * could just remember. Nothing answered it for a course he has not teed off on yet.
     *
     * SENT ONLY BEFORE THE ROUND, and on the first hole. Packing the bag is a car-park decision; by
     * the fourth green the clubs he has are the clubs he has, and shipping the answer to a question
     * nobody can act on any more is the "call nobody asked should exist" shape. It also keeps this
     * off the wire for all but a couple of turns a round. [[a-call-nobody-asked-should-exist]]
     */
    bag_pack: safe(() => {
      const hole = safe(() => r.currentHole ?? null, null);
      if (isRoundActive && typeof hole === 'number' && hole > 1) return null;
      const { liveBagPack } = require('./bagPackLive') as typeof import('./bagPackLive');
      const { pack } = liveBagPack();
      if (!pack || pack.carry.length === 0) return null;
      return { headline: pack.headline, carry: pack.carry, leave: pack.leave, why: pack.reasons };
    }, null),
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
      const ri = require('./practice/routineImpact') as typeof import('./practice/routineImpact');
      const past = (r.roundHistory ?? []).flatMap((h: { shots?: unknown[] }) => h.shots ?? []);
      const out = ri.routineImpact(past as never);
      return out.status === 'ready'
        ? `THEIR PRE-SHOT ROUTINE, measured from their own completed rounds (association, not cause — say it as an observation, never as a promise): ${out.line}`
        : null;
    }, null),

    /** The stated weekly plan — goals, challenges, open reminders. Empty until they engage it. */
    practicePlanBlock: safe(() => {
      const pp = require('../store/practicePlanStore') as typeof import('../store/practicePlanStore');
      return pp.practicePlanPromptBlock() || null;
    }, null),
    /** Phrases this player actually uses — the difference between his caddie and a generic one. */
    playerVocabulary: safe(() => {
      const v = require('../store/vocabularyProfileStore').useVocabularyProfileStore.getState();
      const top = v.getTopPhrases?.(20);
      return Array.isArray(top) && top.length > 0 ? top : null;
    }, null),
    recentCageInsights: safe(() => {
      return (require('../store/swingSessionStore').useSwingSessionStore.getState().recentInsights ?? []).slice(-3);
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
      const { getActiveSurface } = require('./activeSurfaceRegistry') as { getActiveSurface: () => string };
      const s = getActiveSurface();
      if (s === 'cage' || s === 'swing_library' || s === 'swing_detail') return 'coach';
      if (s === 'arena' || s === 'recap') return 'psychologist';
      return 'caddie';
    }, 'caddie'),
    /** The screen/drill he is looking at right now, so a question asked inside a drill is about it. */
    screen_context: safe(() => {
      const { screenContextForPrompt } = require('./screenContext') as typeof import('./screenContext');
      return screenContextForPrompt();
    }, null),
    /**
     * ONE conversation, whichever mic. Every path already writes to services/voice/conversationHistory;
     * only the pipecat paths ever READ it back into a request, so a turn taken on the earbud was
     * invisible to the next turn typed — the caddie forgot mid-conversation when he changed surface.
     */
    conversationTurns: safe(() => {
      /**
       * 2026-08-23 — THE UNION OF BOTH HISTORIES, because there are two.
       *
       * `services/voice/conversationHistory` is written by every turn that goes through caddieBrain (the
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
      const { getConversationHistory } = require('./voice/conversationHistory') as typeof import('./voice/conversationHistory');
      const { getRecentTurns } = require('./conversationState') as typeof import('./conversationState');

      const fromPipecat = (getConversationHistory() ?? []).map(
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
      return require('../store/trustLevelStore').useTrustLevelStore.getState().level ?? null;
    }, null),
    /**
     * A green read the player SAVED on a PRIOR visit to this hole — honest recall of a real read,
     * never a same-round replay dressed up as memory.
     */
    priorGreenRead: safe(() => {
      if (!isRoundActive || currentHole == null) return null;
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
      const { resolveYardage } = require('./yardageResolver') as typeof import('./yardageResolver');
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
      return resolveYardage(currentHole).value == null && getLastFix() == null;
    }, false),
    /** How far he just hit it — so the caddie can confirm the drive before it is even logged. */
    distanceFromTeeYds: safe(() => {
      const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
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
      const { getCachedWeatherEvenIfStale } = require('./weatherService') as typeof import('./weatherService');
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
        const el = require('./elevationService') as typeof import('./elevationService');
        const { getGreenCentroid } = require('./shotLocationService') as typeof import('./shotLocationService');
        const here = fix && fix.lat != null && fix.lng != null ? { lat: fix.lat, lng: fix.lng } : null;
        const green = safe(() => getGreenCentroid(currentHole), null);
        let elevFeet = 0;
        if (here && green) {
          const cached = el.getCachedPlaysLikeElevation(here, green);
          if (cached) elevFeet = cached.deltaFeet;
          else el.warmElevation([here, green]);
        }
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
       
      // 2026-09-10 — one owner. The brain must reason over the SAME number the screens show.
      const { resolveYardage, resolvedToFmb } = require('./yardageResolver') as typeof import('./yardageResolver');
      const y = resolvedToFmb(resolveYardage(currentHole)) ?? { front: null, middle: null, back: null, reason: 'no_hole' as const };
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
    // 2026-08-26 — `undefined` is never a caller SAYING anything; it is a value that wasn't there.
    // Assigning it clobbered a real value the builder had already resolved, which made
    // `overrides: { x: maybeX }` quietly destructive whenever maybeX happened to be absent. An
    // explicit null still wins — that is a caller saying "none", and it is a different statement.
    if (k in body && v !== undefined) body[k] = v;
  }
  return body;
}

/** The exact key set every caddie request carries. Exported so parity is testable, not assumed. */
export const CADDIE_REQUEST_KEYS = Object.freeze(
  Object.keys(buildCaddieRequestBody({ message: '', language: 'en' })).sort(),
);
