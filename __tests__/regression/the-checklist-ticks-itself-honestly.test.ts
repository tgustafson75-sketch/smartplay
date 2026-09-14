/**
 * 2026-09-12 (Tim) — "If I unknowingly do the item practicing, playing, etc, auto mark the item
 * completed. This is far more natural testing."
 *
 * The value is real: a checklist worked through deliberately is a different test from the one you
 * want, because you hold the phone differently and forgive delays you would have sworn at on the
 * 7th tee. But an auto-tick makes a WEAKER claim than a tap — "the code path ran and succeeded",
 * not "I looked at it and it was right" — and several items ask him to look. So the tick records
 * how it happened, the UI marks it, and a manual tick can never be downgraded by an observation.
 */
import fs from 'fs';
import path from 'path';
import { CHECKLIST_EVENT_MAP } from '../../services/checklistAutoTick';
import { useOwnerChecklistStore } from '../../store/ownerChecklistStore';

const root = path.resolve(__dirname, '../..');
const idsOf = () => useOwnerChecklistStore.getState().items.map((i) => i.id);

describe('the event map points at items that exist', () => {
  it('every id it claims to prove is a real seed id', () => {
    const real = new Set(idsOf());
    const claimed = Object.values(CHECKLIST_EVENT_MAP).flat();
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed.filter((id) => !real.has(id))).toEqual([]);
  });

  it('one real-world moment can satisfy several items', () => {
    // A watch swing landing proves the watch button was pressed AND that output reaches the phone.
    expect(CHECKLIST_EVENT_MAP['watch:swing']).toEqual(
      expect.arrayContaining(['watch-record-button', 'watch-swing-output']),
    );
  });

  it('does NOT claim the items that need a human to read them', () => {
    const claimed = new Set(Object.values(CHECKLIST_EVENT_MAP).flat());
    // Each of these fails AFTER the event a naive observer would hang off. See the file's own list.
    for (const id of ['stage-trace', 'recap-and-drills', 'smartmotion-record', 'yardage-on-watch']) {
      expect(`${id}:${claimed.has(id)}`).toBe(`${id}:false`);
    }
  });
});

describe('markObserved is one-way and never overrides a tap', () => {
  beforeEach(() => useOwnerChecklistStore.getState().resetAll());

  it('ticks an open item and records that it was observed', () => {
    const { markObserved } = useOwnerChecklistStore.getState();
    markObserved('watch-swing-output');
    const item = useOwnerChecklistStore.getState().items.find((i) => i.id === 'watch-swing-output');
    expect(item?.done).toBe(true);
    expect(item?.doneVia).toBe('observed');
    expect(item?.doneAt).toBeGreaterThan(0);
  });

  it('does not downgrade a manual tick to observed', () => {
    const s = useOwnerChecklistStore.getState();
    s.toggle('watch-swing-output');
    expect(useOwnerChecklistStore.getState().items.find((i) => i.id === 'watch-swing-output')?.doneVia).toBe('manual');
    useOwnerChecklistStore.getState().markObserved('watch-swing-output');
    // still manual — the stronger claim survives
    expect(useOwnerChecklistStore.getState().items.find((i) => i.id === 'watch-swing-output')?.doneVia).toBe('manual');
  });

  it('never un-ticks — calling it twice is a no-op, not a toggle', () => {
    const store = () => useOwnerChecklistStore.getState();
    store().markObserved('watch-swing-output');
    const first = store().items.find((i) => i.id === 'watch-swing-output')?.doneAt;
    store().markObserved('watch-swing-output');
    const item = store().items.find((i) => i.id === 'watch-swing-output');
    expect(item?.done).toBe(true);
    expect(item?.doneAt).toBe(first);
  });

  it('ignores an unknown id rather than throwing', () => {
    expect(() => useOwnerChecklistStore.getState().markObserved('no-such-item')).not.toThrow();
  });

  it('resetAll clears the provenance too, so a fresh pass starts honest', () => {
    useOwnerChecklistStore.getState().markObserved('watch-swing-output');
    useOwnerChecklistStore.getState().resetAll();
    const item = useOwnerChecklistStore.getState().items.find((i) => i.id === 'watch-swing-output');
    expect(item?.done).toBe(false);
    expect(item?.doneVia).toBeUndefined();
  });
});

describe('the UI distinguishes the two', () => {
  it('marks an observed tick so a screen of ticks is not ambiguous', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/owner-checklist.tsx'), 'utf8');
    expect(src).toMatch(/item\.doneVia === 'observed'/);
    expect(src).toContain('AUTO');
  });

  /**
   * 2026-09-13 — the six items added for the 09-13 OTA, and the two of them that may tick themselves.
   *
   * The rule this file exists to hold: an event must be UNREACHABLE unless the item genuinely passed.
   * Both new events clear it, and the four items that ask Tim to LOOK or LISTEN are deliberately absent
   * from the map — the app can prove a code path ran, not that the number it produced was right.
   */
  it('the 09-13 items exist and are grouped where they will be read', () => {
    const ids = idsOf();
    for (const id of [
      'yardage-not-hole-number', 'handicap-stroke-index', 'putts-always-in-feet',
      'recap-talks-about-the-round', 'how-do-i-reaches-the-caddie', 'mental-words-are-heard',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('only the two provable ones are auto-tickable', () => {
    const observed = new Set(Object.values(CHECKLIST_EVENT_MAP).flat());
    expect(observed.has('yardage-not-hole-number')).toBe(true);
    expect(observed.has('putts-always-in-feet')).toBe(true);
    // these need a human to look or listen — an observation must not stand in for that
    for (const manual of ['handicap-stroke-index', 'recap-talks-about-the-round', 'how-do-i-reaches-the-caddie', 'mental-words-are-heard']) {
      expect(observed.has(manual)).toBe(false);
    }
  });

  it('the yardage event only fires when the hole was NAMED and is not the distance', () => {
    const h = fs.readFileSync(path.join(root, 'services/intents/confirmPositionHandler.ts'), 'utf8');
    expect(h).toMatch(/namedHole != null && namedHole >= 10 && distance !== namedHole/);
    expect(h).toMatch(/noteChecklistEvent\('position:distance-not-hole'\)/);
  });

  it('the longest-putt event fires on the NUMBER, never on the unset answer', () => {
    const q = fs.readFileSync(path.join(root, 'services/intents/queryStatusHandler.ts'), 'utf8');
    const unsetAt = q.indexOf("query:longest_putt:unset");
    const eventAt = q.indexOf("noteChecklistEvent('caddie:longest-putt-answered')");
    expect(eventAt).toBeGreaterThan(-1);
    expect(eventAt).toBeGreaterThan(unsetAt);   // it sits in the numeric branch, which comes second
  });

  it('every emitter is best-effort — the checklist can never break an answer', () => {
    for (const f of ['services/intents/confirmPositionHandler.ts', 'services/intents/queryStatusHandler.ts']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      const at = src.indexOf('noteChecklistEvent');
      expect(src.slice(Math.max(0, at - 400), at)).toMatch(/try \{/);
    }
  });
});
