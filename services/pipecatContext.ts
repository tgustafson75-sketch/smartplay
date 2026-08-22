/**
 * 2026-07-01 (whole-app audit — mic convergence) — the SINGLE source of truth for the pipecat
 * brain's context, extracted from usePipecatVoice so BOTH the caddie-tab mic (the hook) AND the
 * universal badge / earbud / hands-free path (services/listeningSession via conversationalBrain)
 * build the exact same rich context. This is what makes every mic reach ONE unified, fully-informed
 * brain. Pure — reads stores via getState(); no React, safe to call from a service.
 */

import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { brainSettings } from './voice/brainSettings';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { getLastFix } from './gpsManager';
import { haversineYards } from '../utils/geoDistance';
import { bagDistances } from './shotStrategy';
import { getGreenYardagesSync } from './smartFinderService';
import { getCaddieContext } from './caddieMemoryRetrieval';
import { getActiveCaddie } from './caddieResolver';

export function buildPipecatContext() {
  const round = useRoundStore.getState();
  const settings = useSettingsStore.getState();
  const profile = usePlayerProfileStore.getState();
  const trustLevel = useTrustLevelStore.getState().level;
  const relationship = useRelationshipStore.getState();

  return {
    player: {
      name: profile.name ?? 'golfer',
      handicap: profile.handicap ?? undefined,
      dominantMiss: profile.dominantMiss ?? undefined,
      // 2026-07-04 (clean-audit) — so the server prompt can speak AS the user's
      // custom caddie by its real name instead of defaulting to "Kevin".
      customCaddieName: profile.customCaddieName ?? undefined,
      // 2026-07-30 (Tim — "tie my persona to Tank/Kevin/Serena") — so the server can give the custom
      // caddie the CHOSEN persona's character spec (was hardcoded to Kevin's) while keeping its name.
      customCaddieBasePersona: profile.customCaddieBasePersona ?? 'kevin',
      // 2026-07-30 (audit C1 — per-pillar persona bleed). Send the ACTIVE caddie for the current surface
      // (per-pillar override), not the raw global — else setting the Round pillar to Serena while global is
      // Kevin made the brain speak/sound as Kevin while the app attributed everything to Serena. Global
      // selection sets all pillars to the same persona, so the common case is unchanged.
      caddiePersonality: getActiveCaddie(),
      trustLevel,
      /**
       * 2026-08-21 (Tim) — "handicap? No. Doesn't play an overall swing with physical limitation.
       * Absolutely does. And it plays into: if I say I'm tight, then that's gonna play."
       *
       * He is right and I had dismissed it. A 5-handicap can have a bad back and a 25 can be
       * athletic — deriving how to advise someone from their HANDICAP conflates skill with what
       * their body can actually do. And these were the same unconnected-halves shape as the hazards:
       * kevin has accepted every one of these fields for months, and the on-screen path filled them,
       * while THIS path — the brain answering most turns — sent none of them.
       *
       * What the primary brain was advising without:
       *   physicalLimitation — a bad back changes the club, not just the encouragement
       *   missType           — slice vs hook vs pull: WHICH way it goes wrong, not just which side
       *   handedness         — "aim left" means the opposite for a lefty. It reached NO brain at all.
       *   persistentPatterns — the long-run reads earned across rounds
       *   personalBest       — what he has actually shot
       */
      physicalLimitation: profile.physicalLimitation ?? undefined,
      missType: profile.missType ?? undefined,
      handedness: profile.handedness ?? undefined,
      persistentPatterns: profile.persistentPatterns ?? undefined,
      personalBest: profile.personalBest ?? undefined,
    },
    round: {
      active: round.isRoundActive,
      currentHole: round.currentHole ?? undefined,
      courseId: round.activeCourseId ?? undefined,
      courseName: round.activeCourse ?? undefined,
      mentalState: relationship.currentMentalState ?? round.mentalState ?? undefined,
      consecutiveBadHoles: relationship.consecutiveBadHoles ?? 0,
      isSpiralRisk: (() => { try { return relationship.isSpiralRisk(); } catch { return false; } })(),
      emotionalLog: (() => { try { return (round.emotionalLog ?? []).slice(-5).map((e) => ({ state: e.state, valence: e.valence, hole: e.hole })); } catch { return []; } })(),
      goal: round.goal ?? undefined,
      holePar: round.courseHoles.find((h) => h.hole === round.currentHole)?.par ?? undefined,
      holeYardage: round.courseHoles.find((h) => h.hole === round.currentHole)?.distance ?? undefined,
      yardage: (() => {
        try {
          const y = getGreenYardagesSync(round.currentHole);
          return y.middle != null ? { front: y.front, middle: y.middle, back: y.back } : undefined;
        } catch { return undefined; }
      })(),
      // 2026-08-07 (Tim — "if I ask for remaining yardage, confirm my drive: 'you just hit 275, you've
      // got 135 remaining, here's the play'"). Live distance from the CURRENT hole's tee to the player's
      // position — the drive estimate, so the caddie can confirm the shot they just hit even before it's
      // logged. Paired with the green yardages above (the remaining), the caddie has BOTH halves without
      // needing a logged shot. Guards out the at-tee case (<20y) and absurd reads (>700y).
      distanceFromTeeYds: (() => {
        try {
          const fix = getLastFix();
          const tee = round.courseHoles.find((x) => x.hole === round.currentHole);
          if (!fix || fix.lat == null || fix.lng == null || !tee || !tee.teeLat || !tee.teeLng) return undefined;
          const d = haversineYards({ lat: fix.lat, lng: fix.lng }, { lat: tee.teeLat, lng: tee.teeLng });
          return d >= 20 && d <= 700 ? Math.round(d) : undefined;
        } catch { return undefined; }
      })(),
      // 2026-07-08 (Tim — Green Hill: "why won't it tell me the yardage") — when we have
      // no live green distance AND no GPS fix at all, flag it so the caddie SAYS it's
      // reacquiring GPS rather than asking the golfer for the number (the backwards ask).
      gpsLost: (() => {
        try {
          const y = getGreenYardagesSync(round.currentHole);
          return y.middle == null && getLastFix() == null;
        } catch { return false; }
      })(),
      score: (() => {
        const scores = round.scores ?? {};
        const holesPlayed = Object.values(scores).filter((v) => typeof v === 'number' && v > 0).length;
        if (holesPlayed === 0) return undefined;
        const total = Object.values(scores).reduce((s: number, v) => s + (typeof v === 'number' ? v : 0), 0);
        const parPlayed = Object.keys(scores).reduce((s, k) => {
          const h = round.courseHoles.find((x) => x.hole === Number(k));
          return s + (h?.par ?? 0);
        }, 0);
        return { total, holesPlayed, vsPar: parPlayed ? total - parPlayed : undefined };
      })(),
      mode: round.mode ?? undefined,
      // 2026-08-07 (Tim — "if I end a round the FIRST time I play it, it says 'that's your best score yet'.
      // It's the first time — of course it is. Set a BASELINE, not make-believe congratulations"). How many
      // rounds the player has FINISHED at this course before today. 0 = first time → the caddie frames it as
      // a baseline and never claims a "best".
      priorRoundsAtCourse: (() => {
        try {
          const cid = round.activeCourseId;
          if (!cid) return 0;
          // 2026-08-09 (verification-wave minor) — sim rounds aren't real visits: counting them made a
          // first REAL round at a course read as a repeat (over-suppressing the baseline framing).
          return (round.roundHistory ?? []).filter((r) => r.courseId === cid && !r.simulated).length;
        } catch { return 0; }
      })(),
      // 2026-07-05 — sim awareness: the brain nudges for yardages so the sim moves.
      simRound: round.isSimRound || undefined,
      isCompetition: round.isCompetition ?? undefined,
      holeNote: (round.holeNotes ?? {})[round.currentHole] ?? undefined,
      // 2026-08-07 (Tim — "the caddie learns your miss but ignores it"; green-read recall) — a green read
      // the player SAVED on a PRIOR visit to this hole, so on a revisit the caddie can recall "last time
      // this putt played downhill, died left" instead of reading blind. Honest — replays a real prior read.
      priorGreenRead: (() => {
        try {
          if (!round.isRoundActive || round.currentHole == null) return undefined;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const store = require('../store/greenReadStore').useGreenReadStore.getState();
          // 2026-08-09 (deferred-minor fix, two halves):
          // (1) "prior visit" must mean a PRIOR ROUND — a read saved minutes ago in THIS round was
          //     replayed as "last time this putt played…": robotic make-believe recall. Same-round
          //     reads are excluded.
          // (2) EXCEPT the twice-around second loop: hole N is physically hole N-9, and its loop-1
          //     read (logged under N-9, THIS round) is a genuine "earlier today" recall — query the
          //     twin and allow it.
          type GR = { at: number; feetEst: number | null; slopePct: number | null; text: string } | null;
          const startMs = round.roundStartTime ?? 0;
          const isPriorRound = (g: GR) => !!g && !(startMs > 0 && g.at >= startMs);
          const direct = store.lastForHole(round.activeCourseId ?? null, round.currentHole) as GR;
          const twin = round.twiceAround === true && round.currentHole >= 10
            ? store.lastForHole(round.activeCourseId ?? null, round.currentHole - 9) as GR
            : null;
          // twin reads are valid from ANY round (loop-1 earlier today included); direct only from prior rounds
          const gr = isPriorRound(direct) ? direct : twin;
          if (!gr || (gr.feetEst == null && gr.slopePct == null && !gr.text)) return undefined;
          return {
            feet: gr.feetEst ?? undefined,
            slopePct: gr.slopePct ?? undefined,
            note: gr.text || undefined,
          };
        } catch { return undefined; }
      })(),
      recentShots: (round.shots ?? []).slice(-5).map((s) => ({
        club: s.club ?? null, hole: s.hole ?? null, distance: s.distance_yards ?? null, outcome: s.outcome_text ?? null,
      })),
    },
    bag: {
      club_distances: bagDistances() as Record<string, number>,
      registered_clubs: (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return (require('../store/clubBagStore').useClubBagStore.getState().bagList() as { club_id: string }[]).map((c) => c.club_id);
        } catch { return []; }
      })(),
      /**
       * 2026-08-17 (Tim — "this driving iron gets two hundred and fifteen yards and a baby fade
       * every single time. And I'd like to see that before even looking").
       *
       * PER-CLUB tendency, so the caddie knows a club's character without being told. Shape and
       * direction were only ever aggregated across the WHOLE BAG (patternDetection.ts:60), so a
       * hooked driver and a pulled wedge pooled into one number and no individual club had a
       * character. Distances were per-club; shape was not. Now both are.
       *
       * Established tendencies only — clubTendency's own evidence bars decide what qualifies, so a
       * club hit twice contributes nothing rather than a confident sentence about two shots.
       * Reads the current round PLUS history, because a club's character is not a per-round fact.
       */
      tendencies: (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ct = require('./clubTendency') as typeof import('./clubTendency');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const cn = require('./clubNormalize') as typeof import('./clubNormalize');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const cs = require('../store/clubStatsStore').useClubStatsStore.getState();
          const history = (round.roundHistory ?? []).flatMap((r) => r.shots ?? []);
          const all = [...history, ...(round.shots ?? [])].slice(-300);
          const carryFor = (c: string) => {
            try { return cs.hasDistance(c) ? cs.carryFor(c) : null; } catch { return null; }
          };
          return ct.describeBagTendencies(ct.clubTendencies(all, carryFor, cn.normalizeClub));
        } catch { return []; }
      })(),
    },
    // Every brain-bound setting flows through the pure brainSettings() map (tested). trustLevel is
    // computed from its own store so it stays separate.
    settings: {
      trustLevel,
      // 2026-08-09 (voice audit C1 — completing the persona-intensity fix). The two kevin fallback paths
      // (conversationalBrain) already key intensity off the ACTIVE per-pillar caddie; this PRIMARY pipecat
      // path was left keyed off the GLOBAL pick, so a per-pillar user (Round=Serena, global=Kevin) got
      // Serena's voice scaled by Kevin's dial. Override caddiePersonality with getActiveCaddie() so
      // brainSettings resolves personaIntensity[activePersona] — matching the persona actually spoken.
      ...brainSettings({ ...settings, caddiePersonality: getActiveCaddie() }),
    },
    /**
     * 2026-08-21 (context audit, before Tim's round) — THE NUMBER HE JUST MEASURED.
     *
     * The SmartFinder lock reached kevin (`smartFinderContext`) and NOT this path. So a player who
     * ranged the pin at 152 and then asked "what should I hit" got an answer built from the GPS
     * green-middle instead of the number they had just taken — on the DEFAULT conversational brain.
     * The rangefinder is the number players trust most, and the caddie was ignoring it.
     *
     * Same unconnected-halves shape as everything else this week: the lock existed, the brain
     * already accepted a field for it, and nothing joined them on this route.
     *
     * Confidence comes from the lock itself rather than being re-derived here — SmartFinder's bands
     * were corrected today, and a second copy of that logic would be the next thing to drift.
     */
    smartFinderLock: (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sf = require('../store/smartFinderStore').useSmartFinderStore.getState();
        const lock = sf.currentLock;
        if (!lock) return undefined;
        return {
          distance_yards: lock.distance_yards,
          compass_heading: Math.round(lock.compass_heading),
          confidence: lock.confidence ?? null,
        };
      } catch { return undefined; }
    })(),
    /**
     * 2026-08-21 (Tim) — "we know the course. If there's hazards, and what the club distance puts
     * you in relation to the hazard if you swing pure — and if you swing your tendency, where it
     * could end up. In a brief, useful way."
     *
     * That answer was IMPOSSIBLE on this path. kevin carries detailed hazard-aware targeting
     * instructions ("the bunker right is at 145, so anything short and right is trouble"), and they
     * run on `courseIntelligence` — which the on-screen kevin path sends and THIS path never did.
     * So the primary conversational brain had the instructions and nothing to apply them to, and
     * answered with a bare number.
     *
     * Cached client-side and read synchronously, so it costs the turn nothing. The hazards were
     * already fetched for the round briefing; they simply never reached the brain that answers.
     */
    courseIntelligence: (() => {
      try {
        const id = round.activeCourseId;
        if (!id) return undefined;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ci = require('./courseIntelligenceService') as typeof import('./courseIntelligenceService');
        return ci.getCachedCourseIntelligenceSync(id) ?? undefined;
      } catch { return undefined; }
    })(),
    /**
     * 2026-08-21 (Tim) — "fuck plays-like… what is my shot gonna do in relation to water or a bunker
     * or fescue?" and "we need to use calculation in computer vision to find those hazards" and
     * "SmartFinder and SmartVision are supposed to be unified as part of the central nervous system."
     *
     * They are now. Computer vision (api/hole-scan) finds the bunkers and water; geometry turns them
     * into real distances — where each one starts, the carry needed to CLEAR it, which side it sits.
     * Until today that arrived on the rangefinder screen and nowhere else, so the caddie answered
     * with a yardage while the app already knew the bunker starts at 141 and needs 152 to carry.
     *
     * Sent COMPACT and pre-digested: the three that matter, as facts the caddie can speak. A raw
     * hazard list would be a data dump the model has to interpret mid-turn, and the whole point is
     * that it should be able to say "clears the bunker" without doing arithmetic.
     */
    hazards: (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const hz = require('./hazardIntelligence') as typeof import('./hazardIntelligence');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const geo = require('./courseGeometryService') as typeof import('./courseGeometryService');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fix = require('./gpsManager').getLastFix?.();
        if (!fix || !round.isRoundActive || round.currentHole == null) return undefined;
        const g = geo.getHoleGeometry?.(round.activeCourseId ?? '', round.currentHole);
        if (!g) return undefined;
        const list = hz.computeHazardIntelligence({ lat: fix.lat, lng: fix.lng }, g, null, null);
        if (!list || !Array.isArray(list) || list.length === 0) return undefined;
        return list.slice(0, 3).map((h: { label: string; kind: string; side: string; front: number; carryToClear: number }) => ({
          what: h.label, kind: h.kind, side: h.side,
          startsAt: Math.round(h.front), carryToClear: Math.round(h.carryToClear),
        }));
      } catch { return undefined; }
    })(),
    /**
     * 2026-08-21 (whole-app wiring audit) — THE PLAYER MODEL ITSELF, which the primary brain had
     * never seen.
     *
     * services/golferModel.ts exists to answer "who is this golfer": dominant miss DIRECTION and
     * TYPE, most-common contact feel with its share, average vs par, putting. It even ships
     * describeForPrompt() — a function written for no purpose other than feeding a prompt.
     *
     * The ON-SCREEN kevin path sends it as golfer_model_snippet. This path never did, and the shim
     * did not map it. So the brain answering most turns was reasoning without the model of the man
     * it was advising, while a function called describeForPrompt sat unused on the device.
     *
     * That is the ethos's core promise — "it should know YOU hit your 7-iron 142, your miss is
     * generally right" — and the answer was going out without it. Same unconnected-halves shape as
     * the hazards and the SmartFinder lock, found the same way: by asking which computed
     * intelligence never reaches the CNS.
     */
    golferModel: (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const gm = require('./golferModel') as typeof import('./golferModel');
        const model = gm.buildGolferModel();
        if (!model) return undefined;
        const text = gm.describeForPrompt(model);
        return text && text.trim() ? text.slice(0, 700) : undefined;
      } catch { return undefined; }
    })(),
    gps: {
      lat: getLastFix()?.lat ?? undefined,
      lng: getLastFix()?.lng ?? undefined,
    },
    memory: (() => {
      try {
        const base = getCaddieContext({
          courseId: round.activeCourseId ?? undefined,
          hole: round.currentHole ?? undefined,
          club: round.club ?? undefined,
        }).promptBlock;
        // 2026-07-04 (Tim — offline log "ingested later") — fold in anything the player
        // said while offline this round so the caddie acknowledges + uses it once signal
        // is back. Peek only (stays pending until round end); best-effort.
        let offline = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          offline = require('./voiceLogService').peekOfflineNotesBlock() as string;
        } catch { /* voice-log is additive */ }
        // 2026-07-04 (Tim — "SmartPlan should guide the week in terms of Caddie guidance")
        // — fold in the persisted weekly plan + the player's goals/challenges narrative so
        // the caddie steers coaching toward them all week.
        let plan = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          plan = require('../store/practicePlanStore').practicePlanPromptBlock() as string;
        } catch { /* plan block is additive */ }
        // 2026-07-04 (Tim — comprehensive coverage) — recent rounds + courses played +
        // practice focus, so the caddie can converse about history from real data.
        let history = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          history = require('./caddieHistoryContext').historyPromptBlock() as string;
        } catch { /* history block is additive */ }
        // 2026-07-29 (audit — BRAIN-F4) — the server lookup_course tool queries golfcourseapi ONLY, so
        // the brain couldn't resolve locally-authored/OSM courses (the new Coyote Creek/Pruneridge + the
        // tester home courses) for OFF-round questions ("what courses do I have", "tell me about
        // Pruneridge", "the par-3 course near me"). Fold a compact bundled catalog into context OFF-round
        // (skipped on-course, where the round context already carries the active course) so the brain
        // KNOWS they exist and can open/discuss them by name instead of "I can't find that course".
        let bundled = '';
        try {
          if (!round.isRoundActive) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { COURSES } = require('../data/courses') as typeof import('../data/courses');
            const list = COURSES.map((c) => `${c.name} (${c.holes?.length ?? 18}h par ${c.par})`).join('; ');
            if (list) bundled = `BUNDLED COURSES the player can open or play by name (say "open <name>" / "play <name>"): ${list}. Coyote Creek has TWO separate 18s — Tournament and Valley. You KNOW every course in this list — open or discuss it by name; never claim you can't find one of these.`;
          }
        } catch { /* bundled catalog is additive */ }
        return [base, plan, history, offline, bundled].filter((b) => b && b.trim()).join('\n\n');
      } catch { return ''; }
    })(),
  };
}
