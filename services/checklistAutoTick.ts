/**
 * 2026-09-12 (Tim) — "If I unknowingly do the item practicing, playing, etc, auto mark the item
 * completed. This is far more natural testing."
 *
 * He is right, and the reason is not convenience. A checklist you work through deliberately is a
 * different test from the one you want: you hold the phone differently, you wait for things, you
 * forgive a delay you would have sworn at on the 7th tee. The items worth trusting are the ones that
 * ticked themselves while he was just playing golf.
 *
 * WHAT THIS IS CAREFUL ABOUT
 *
 * An observation is weaker evidence than a tap, and this file never pretends otherwise. It records
 * `doneVia: 'observed'` and the checklist shows it differently, because several items ask him to
 * LOOK at something — "does the arc draw", "does the trace read as one sequence". The app can prove
 * the code path ran and returned something; it cannot prove he saw it and it was right.
 *
 * So the rule for adding an event below: the event must only be reachable when the item genuinely
 * passed. `watch:swing` qualifies — a swing cannot arrive from the watch unless the watch sensor is
 * running, which is the whole of `watch-record-button`. A "screen opened" event would NOT qualify
 * for "recap opens without crashing", because the crash it is checking for happens after the open.
 *
 * ONE-WAY. markObserved never un-ticks and never downgrades a manual tick.
 */
import { useOwnerChecklistStore } from '../store/ownerChecklistStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';

/**
 * The observable events, and the items each one actually proves.
 *
 * Keys are event names rather than item ids so one real-world moment can satisfy several items —
 * a watch swing landing proves both that the watch button was pressed and that output reaches the
 * phone, which are two separate items he would otherwise tick by hand twice.
 */
const PROVES: Record<string, string[]> = {
  /** A swing arrived from the watch. The sensor only runs after Record is pressed ON the watch. */
  'watch:swing': ['watch-record-button', 'watch-swing-output'],
  /** A club arc was computed for a session AND had points in it — the arc has something to draw. */
  'swing:club-arc': ['club-arc-visible'],
};

/**
 * DELIBERATELY NOT AUTO-TICKED, so the next person does not "finish the job" by adding them:
 *
 *   stage-trace       — asks him to READ the trace for locate → anchor → pose → club. Exporting one
 *                       proves it sent, not that the sequence is intact; the four stages are not
 *                       even traced under those tags today. A human-reading item.
 *   recap-and-drills  — the crashes it hunts ("Maximum update depth exceeded", the drill video
 *                       bouncing back to the dashboard) happen AFTER the screen opens, so a
 *                       screen-opened event would tick precisely when the bug fires.
 *   smartmotion-record— worth adding once there is a single event that fires only on a completed,
 *                       analysed, non-crashed recording. There is no such funnel yet, and a partial
 *                       one would tick on the recordings that crashed later.
 *   yardage-on-watch  — needs the NUMBER to have reached the watch face and updated as he walked;
 *                       the phone knows it sent, not that it landed and ticked over.
 *   confirm-ota-landed / the two ship items — not observable from inside a running app at all.
 */

/**
 * Record that something happened. Safe to call from anywhere, including hot paths: it is a cheap
 * map lookup for a non-owner and a no-op once the items are ticked. Never throws — a checklist is
 * a convenience and must not be able to break the feature it is observing.
 */
export function noteChecklistEvent(event: keyof typeof PROVES | string): void {
  try {
    const ids = PROVES[event];
    if (!ids) return;
    // The checklist is Tim's. Nobody else should be paying for this, even the map lookup's writes.
    if (!isOwnerEmail(usePlayerProfileStore.getState().email)) return;

    const store = useOwnerChecklistStore.getState();
    const newlyTicked = ids.filter((id) => !store.items.find((i) => i.id === id)?.done);
    if (newlyTicked.length === 0) return;
    for (const id of newlyTicked) store.markObserved(id);

    /**
     * Say so. A checklist that ticks itself silently is indistinguishable from one that is broken —
     * he would have no way to know whether the item passed or the observer never fired.
     */
    const titles = newlyTicked
      .map((id) => store.items.find((i) => i.id === id)?.title)
      .filter(Boolean);
    if (titles.length > 0) {
      const toast = require('../store/toastStore') as typeof import('../store/toastStore');
      toast.useToastStore.getState().show(`✓ Checked off: ${titles.join(' · ')}`);
    }
  } catch { /* a checklist must never break the thing it is watching */ }
}

/** Exposed for the guard, so the event→item map is asserted against the real seed ids. */
export const CHECKLIST_EVENT_MAP = PROVES;
