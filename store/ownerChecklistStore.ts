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
