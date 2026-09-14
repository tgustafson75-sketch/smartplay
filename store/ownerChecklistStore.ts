/**
 * store/ownerChecklistStore.ts — TIM'S TO-DO LIST, ON THE PHONE.
 *
 * 2026-09-09 (Tim: "put my checklists of to dos on the phone in owners tool with a reminder when I
 * open. We should have done that months ago").
 *
 * Every field test this year has been run off a list that lived in a chat window, a sprint log, or
 * nowhere. The list is needed in exactly the place the laptop is not: standing on a first tee with a
 * phone and a glove. So it lives in the app, owner-only, and it survives a relaunch.
 *
 * ── WHY THE SEED MERGES RATHER THAN REPLACES ────────────────────────────────────────────────────
 *
 * The list is persisted (so a tick survives a round) AND shipped in code (so a new session can add
 * items). Those two facts fight: a naive persisted store keeps the FIRST seed forever and silently
 * ignores every item added later — a checklist that cannot receive new work is worse than no
 * checklist, because it looks complete. So the seed is merged by id on hydration: new ids appear,
 * ticks on existing ids are kept, and an item dropped from the seed disappears. That is the same
 * class as every stale-cache bug this sprint, headed off rather than discovered.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ChecklistGroup = 'field' | 'ship' | 'watch';

export interface ChecklistItem {
  id: string;
  group: ChecklistGroup;
  title: string;
  /** What to actually look at, and what a pass looks like. Written to be read one-handed. */
  detail: string;
  done: boolean;
  doneAt: number | null;
  /**
   * HOW it got ticked. 'manual' means Tim tapped it and is vouching for it; 'observed' means the app
   * saw the thing happen while he was just using it.
   *
   * These are NOT the same claim and the UI must not pretend they are. An observed tick says "the
   * code path ran and succeeded", which is real evidence but is not "I looked at it and it was
   * right" — several items ask him to LOOK at something (does the arc draw, does the trace read as
   * one sequence). Keeping the distinction is what stops the checklist quietly turning into a list
   * of things nobody actually checked.
   */
  doneVia?: 'manual' | 'observed';
}

export const GROUP_LABEL: Record<ChecklistGroup, string> = {
  field: 'On the course',
  watch: 'Watch',
  ship: 'Before shipping',
};

/**
 * The seed. Edit here; it merges into whatever is already on the device.
 *
 * Ordered by what answers the most questions per minute standing on a tee, not by code area.
 */
const SEED: Omit<ChecklistItem, 'done' | 'doneAt'>[] = [
  {
    /**
     * 2026-09-12 — the four coaches got their evidence this sweep, and every one of those blocks is
     * SILENT until there is enough to be honest. That is correct behaviour and it is also how a
     * working feature looks broken: ask the caddie about your practice with two rounds logged and he
     * says nothing, which reads as "it did not ship". The thresholds are stated here so the first
     * test does not produce a false negative.
     */
    id: 'four-coaches-can-speak',
    group: 'field',
    title: 'Check the four coaches can actually answer',
    detail: 'Ask Kevin: "is my practice showing up in my scores", "it feels like I am coming over the top", "is my training worth it", and something about how a round felt. Each answers from measured data — but only once there is enough, and each stays quiet rather than guessing. Needs, inside the last 6 weeks and from REAL (not simulated) rounds: practice→score 3 sessions + 4 rounds · training→score 3 workouts + 4 rounds · measured swing 4 weeks with graded swings · mental pattern 3 rounds carrying reports + 6 logged moments. Silence with less than that is the honesty gate working, not a bug.',
  },
  {
    id: 'yardage-on-watch',
    group: 'field',
    title: 'Pin yardage reaches the watch',
    detail: 'Open the SmartPlay watch app, then start a round. Numbers should appear within ~18s and update as you walk. If blank, check Settings → Devices & Health: it now says outright whether a watch is reachable.',
  },
  {
    id: 'club-arc-visible',
    group: 'field',
    title: 'Club arc draws in SmartMotion',
    detail: 'Record a swing, open review. The arc used to be computed before the pose read, so it searched a downscaled full frame and found nothing. It now waits for pose and zooms to you.',
  },
  {
    id: 'stage-trace',
    group: 'field',
    title: 'Round trace reads as one sequence',
    detail: 'After a swing, export the round trace. Look for locate → anchor → pose → club. Any stage marked empty is the answer; club:empty with rejected:too_few means the camera, cluster or scatter means the model.',
  },
  {
    id: 'smartmotion-record',
    group: 'field',
    title: 'SmartMotion records without crashing',
    detail: 'Record, stop, let it analyse. The stop handoff used to run a dozen unserialised native reads on the file the player was looping — an uncatchable crash.',
  },
  {
    id: 'recap-and-drills',
    group: 'field',
    title: 'Recap opens; drill videos play',
    detail: 'Open a round recap (used to hit "Maximum update depth exceeded") and play a drill video (used to bounce straight back to the dashboard).',
  },
  {
    id: 'watch-record-button',
    group: 'watch',
    title: 'Press "Record swings" ON THE WATCH',
    detail: 'The 30-second check. The watch sensor only runs after this button is pressed on the watch itself — the phone toggle alone does nothing. This may be the whole reason swing capture has never produced output.',
  },
  {
    id: 'watch-swing-output',
    group: 'watch',
    title: 'A watch swing reaches the phone',
    detail: 'With capture running on the watch, take a swing. It should appear tagged to the hole in View Hole and the round recap.',
  },
  {
    id: 'confirm-ota-landed',
    group: 'field',
    title: 'Confirm the OTA actually landed',
    detail: 'This reminder appearing IS the proof — it only exists in the update published 09-09 (group d0527ffc). If you are reading it, build 26 is running the new JS. Tick and move on.',
  },
  {
    id: 'watch-native-branch',
    group: 'ship',
    title: 'Merge native/watch-command-and-capability at the next build',
    detail: 'The watch Record→SmartMotion command and the reachability query are native. They cannot ride an OTA; they go in the next store build. The Wear OS APK needs rebuilding too for the long-press.',
  },
  {
    id: 'whats-new-at-launch',
    group: 'ship',
    title: "Turn WHAT'S NEW back on at launch",
    detail: 'Entries are suspended pre-launch (testers should read the refinement wave as the app simply being good, not as a list of what used to be wrong). At launch add ONE line for the whole wave, and nest the camera tip in it: swing reads are sharper at 60fps+, with a howTo pointing at the phone\u2019s own camera setting. The draft sits in services/knowledgeBase/whatsNew.ts.',
  },
  {
    id: 'ota-baseline',
    group: 'ship',
    title: 'Run npm run ota:baseline after any store build',
    detail: 'That re-records the native fingerprint. Skip it and the preflight keeps refusing OTAs, because as far as it knows the shell is still the older one.',
  },

  /**
   * 2026-09-13 — the 09-13 OTA (update group b8ef990d). Six items, ordered by how likely the fix is to
   * be wrong in the field rather than by code area.
   *
   * Two of them tick themselves; the other four ask him to LOOK or LISTEN, and an observation cannot
   * stand in for that. The distinction is the whole discipline of services/checklistAutoTick: the app
   * can prove a code path ran, not that the number it produced was right.
   */
  {
    /**
     * The highest-risk fix of the day, because it is the one that has to survive a real accent through
     * Deepgram rather than a string in a test. The bug: the LAST 2-3 digit integer won, so a named hole
     * of 10-18 was read as the yardage — "I'm 140 out on hole 12" parsed as 12, and the caddie then
     * announced GPS drift, force-refreshed, and clubbed a 140-yard shot as a 12-yard one.
     */
    id: 'yardage-not-hole-number',
    group: 'field',
    title: 'Say "I\u2019m 140 out on hole 12" and check he hears 140',
    detail: 'Say it out loud, in that order, with a hole number of 10 or higher — that is the case that was broken. A pass is him confirming the DISTANCE (140) on hole 12. A fail is any answer built on 12 yards: "GPS is 130 yards off", an instant refresh, or a wedge suggestion for a full iron. Try the other order too ("hole 12, 140 out") — that one always worked, so if it passes and the first fails, the mask is the problem and not your microphone. Ticks itself when a two-digit hole is named and the parsed distance is not that number.',
  },
  {
    /**
     * WHS allocates strokes by the scorecard's HCP column, and the handler passed the hole number.
     * The column arrives from golfcourseapi and was being dropped on the way into CourseHole, so this
     * item is really asking whether the plumbing reached THIS course.
     */
    id: 'handicap-stroke-index',
    group: 'field',
    title: 'Ask for your max for handicap on a hole',
    detail: 'Ask "what\u2019s my max for handicap here". Two honest answers, and you have to read which one you got. WITH the scorecard\u2019s handicap column loaded: "Your max for handicap is 7 (par 4 plus 2 plus 1 stroke)" — and the stroke should only appear on holes that are genuinely among your hardest, not on hole 1 because it is hole 1. WITHOUT it: "at least 6 — par plus two … I don\u2019t have this scorecard\u2019s handicap column", which is the correct refusal, not a bug. A FAIL is a confident stroke on an easy hole. Left manual on purpose: the app can prove it answered, not that the number is right.',
  },
  {
    id: 'putts-always-in-feet',
    group: 'field',
    title: 'Log a putt and check every surface says feet',
    detail: 'Quick Log a shot with PUTTER. The distance label must read "Distance (feet, optional)" — type 25 for a 25-footer. Then check three places agree: the shot row (25 ft, not 25 yds and not 8), the round recap\u2019s shot detail, and Settings → Longest Putt, which now says (feet). Your stored longest putt will read 66 ft after this update — that is your old 22 converted at the rate the old "(yards)" label promised. If you meant 22 FEET, retype it; the field says feet now.',
  },
  {
    /**
     * The mental register existed, was authored, and could not be selected: both branches that choose
     * it gated on surfaces nothing registered. 'arena' is parked for 3.0, so the recap is its one live
     * route — which is also exactly where the conversation belongs.
     */
    id: 'recap-talks-about-the-round',
    group: 'field',
    title: 'Open a round recap and talk to him about how it went',
    detail: 'Say something like "that one got away from me". He should answer like someone reviewing a round WITH you — acknowledging it before any tip, allowing space. A fail is the on-course tactical voice: clipped, club-and-number, present-tense, as if you were standing over a shot. That register had never once been reachable before this update, so this is a first run rather than a regression check. Ask him about your putting here too — he can now read your record by whether you reached the green in regulation, once you have 9 scored holes with putts logged.',
  },
  {
    id: 'how-do-i-reaches-the-caddie',
    group: 'field',
    title: 'Ask "how do I\u2026?" about the app itself',
    detail: 'Try "how do I change my handicap", "how do I import my old scores", "how do I add a course". You should get the actual STEPS, spoken. Fails to watch for, all of which happened before this update: being told your current handicap instead of how to change it, or being yanked straight to a screen with no explanation. Measurement questions must still answer locally and instantly — "how far do I hit my 7 iron" is not a how-to and should not go to the brain.',
  },
  {
    id: 'mental-words-are-heard',
    group: 'field',
    title: 'Use your own words for a bad patch',
    detail: 'Say "I choked", "I\u2019m tilted", "I lost my confidence", or "I have the yips". Before this update "choke" existed in the knowledge base only as "choke down" (a grip) and "yips" appeared nowhere, so these retrieved nothing or, worse, swing-mechanics noise — "I need to calm down" returned over-the-top and wedge bounce. A pass is a mental answer: routine, breathing, reset, expectations. A fail is a mechanics lecture.',
  },
];

interface ChecklistState {
  items: ChecklistItem[];
  /** Bumped when the reminder has been shown, so it nags once per launch, not once per render. */
  lastRemindedAt: number | null;
  toggle: (id: string) => void;
  /**
   * 2026-09-12 (Tim) — "if I unknowingly do the item practicing, playing, etc, auto mark the item
   * completed. This is far more natural testing."
   *
   * Idempotent and one-way: it can tick an item but never un-tick one, so a later run of the same
   * code path cannot undo a manual tick, and a manual tick always outranks an observation.
   */
  markObserved: (id: string) => void;
  resetAll: () => void;
  markReminded: () => void;
  remaining: () => ChecklistItem[];
}

/** New ids in, ticks preserved, removed ids gone. */
function mergeSeed(existing: ChecklistItem[]): ChecklistItem[] {
  const byId = new Map(existing.map((i) => [i.id, i]));
  return SEED.map((s) => {
    const prev = byId.get(s.id);
    return {
      ...s,
      done: prev?.done ?? false,
      doneAt: prev?.doneAt ?? null,
      doneVia: prev?.doneVia,
    };
  });
}

export const useOwnerChecklistStore = create<ChecklistState>()(
  persist(
    (set, get) => ({
      items: mergeSeed([]),
      lastRemindedAt: null,
      toggle: (id) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id
              ? { ...i, done: !i.done, doneAt: !i.done ? Date.now() : null, doneVia: !i.done ? 'manual' as const : undefined }
              : i,
          ),
        })),
      markObserved: (id) =>
        set((s) => {
          const item = s.items.find((i) => i.id === id);
          // Already ticked — by hand or by an earlier observation. Never rewrite it: a manual tick
          // is a stronger claim than an observation and must not be downgraded to 'observed'.
          if (!item || item.done) return s;
          return {
            items: s.items.map((i) =>
              i.id === id ? { ...i, done: true, doneAt: Date.now(), doneVia: 'observed' as const } : i,
            ),
          };
        }),
      resetAll: () => set((s) => ({ items: s.items.map((i) => ({ ...i, done: false, doneAt: null, doneVia: undefined })) })),
      markReminded: () => set({ lastRemindedAt: Date.now() }),
      remaining: () => get().items.filter((i) => !i.done),
    }),
    {
      name: 'owner-checklist-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items, lastRemindedAt: s.lastRemindedAt } as never),
      /**
       * Merge the shipped seed into whatever was stored. Without this the device keeps the list it
       * first saw and every item added later is invisible — the failure mode that makes a checklist
       * actively misleading rather than merely stale.
       */
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        try { state.items = mergeSeed(state.items ?? []); } catch { /* seed stands */ }
      },
    },
  ),
);
