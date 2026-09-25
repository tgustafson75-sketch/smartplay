/**
 * 2026-09-13 (Tim) — "Finish that please, I want to test it next round. Pin position shows me all the
 * logic working together." Option A: declared once per ROUND, on the Play tab.
 *
 * It does show the logic working together, and that is the point of doing it this way: the pin is applied
 * in ONE place — services/yardageResolver, the single owner thirteen surfaces already read — so a single
 * tap moves the caddie payload, the watch bridge, SmartFinder, the cockpit, queryStatusHandler and voice
 * readback together. Applying it per-surface is the exact defect that resolver was written to end.
 *
 * AND THE RULE IS A REAL ONE. Tim: "but aren't there general pin position rules that give a good
 * estimate?" There are, and they replaced what I had scoped. My version used a FRACTION of green depth
 * (two-thirds from centre to the edge) — a number I picked. The convention is an INSET FROM THE EDGE:
 * greenkeepers cut holes a minimum distance inside any edge (USGA guidance ≥4 paces; ordinary practice
 * 5+). That self-corrects for green size the way pin setting actually does — a 44-yard green has a
 * genuinely deep back pin, a 12-yard green has nowhere to put one — and a fraction does not.
 *
 * WHAT IT REFUSES TO DO is the half that matters. A wrong pin makes every yardage on the hole wrong,
 * which is worse than no pin, so depth declines — visibly, in `reason` — whenever the edge is unknown, the
 * yardage is itself an estimate, or the green is too shallow for the flag to change the club.
 */
import fs from 'fs';
import path from 'path';
import { adjustForPin, describePin, aimNoteForPin, PIN_EDGE_INSET_YARDS } from '../../services/pinPosition';
import { useRoundStore, PIN_CENTER } from '../../store/roundStore';
import { resolveYardage } from '../../services/yardageResolver';
import * as smartFinder from '../../services/smartFinderService';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the rule is the greenkeeping convention, not a fraction I chose', () => {
  it('a pin sits an inset INSIDE the edge, and the inset is a real number', () => {
    // USGA hole-location guidance is a minimum of about four paces from any edge.
    expect(PIN_EDGE_INSET_YARDS).toBeGreaterThanOrEqual(4);
    expect(PIN_EDGE_INSET_YARDS).toBeLessThanOrEqual(6);
  });

  it('a back pin on a 30-yard green plays 10 longer', () => {
    // middle 150, edges at 135/165 → back pin at 165 − 5 = 160.
    expect(adjustForPin(150, 135, 165, 'back')).toEqual({ yards: 160, delta: 10, why: 'applied' });
  });

  it('a front pin on the same green plays 10 shorter', () => {
    expect(adjustForPin(150, 135, 165, 'front')).toEqual({ yards: 140, delta: -10, why: 'applied' });
  });

  it('a BIG green gives a genuinely deeper pin — which a fraction would understate', () => {
    // half-depth 22. Edge inset → +17. A two-thirds fraction would have said +14.7.
    expect(adjustForPin(150, 128, 172, 'back').delta).toBe(17);
  });

  it('a SHALLOW green gives almost nothing — which a fraction would overstate', () => {
    // half-depth 6. Edge inset → +1. A two-thirds fraction would have said +4.
    expect(adjustForPin(150, 144, 156, 'back').delta).toBe(1);
  });

  it('a green too shallow to hold a back pin changes NOTHING, and says why', () => {
    // half-depth 4, less than the inset: 'back' and 'middle' are the same club.
    expect(adjustForPin(150, 146, 154, 'back')).toEqual({ yards: 150, delta: 0, why: 'green_too_shallow' });
  });

  it('a middle pin is a no-op', () => {
    expect(adjustForPin(150, 135, 165, 'middle')).toEqual({ yards: 150, delta: 0, why: 'centre' });
  });

  it('an UNKNOWN edge never invents one', () => {
    expect(adjustForPin(150, null, null, 'back')).toEqual({ yards: 150, delta: 0, why: 'no_edge' });
    expect(adjustForPin(150, 135, null, 'back').why).toBe('no_edge');
    // and bad geometry is refused rather than producing a negative adjustment
    expect(adjustForPin(150, 135, 140, 'back').why).toBe('no_edge');
    expect(adjustForPin(150, 165, 180, 'front').why).toBe('no_edge');
  });

  it('side is never a distance — it does not appear in the maths at all', () => {
    const pinModule = code('services/pinPosition.ts');
    const adjust = pinModule.slice(pinModule.indexOf('export function adjustForPin'), pinModule.indexOf('export function describePin'));
    expect(adjust).not.toMatch(/\bside\b/);
  });
});

describe('one tap moves every surface, because the resolver owns it', () => {
  /**
   * The GPS branch is MOCKED, deliberately, and the first version of this block was not — it left the
   * resolver on the static-card tier, where `is_fallback` is true and the pin declines before it is ever
   * applied. Every resolver assertion was therefore running the DECLINED path, and break-testing proved
   * it: removing the `pinDeclared` check changed nothing and all twenty-one assertions stayed green.
   *
   * A test that only exercises the refusal cannot prove the feature. So this puts the resolver on
   * `gps_live` with a real, non-estimated green read — the only tier where a pin legitimately moves a
   * number.
   */
  beforeEach(() => {
    jest.spyOn(smartFinder, 'getLastFix').mockReturnValue({
      lat: 33.8, lng: -117.9, accuracy_m: 5, timestamp: Date.now(),
    } as never);
    jest.spyOn(smartFinder, 'classifyAccuracy').mockReturnValue({ level: 'strong' } as never);
    jest.spyOn(smartFinder, 'getGreenYardagesSync').mockReturnValue({
      front: 135, middle: 150, back: 165, reason: 'ok',
    } as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    useRoundStore.setState({ pinPosition: PIN_CENTER, pinDeclared: false } as never);
  });

  const withHole = (over: Record<string, unknown> = {}) => {
    useRoundStore.setState({
      isRoundActive: true, currentHole: 1, activeCourseId: 'c1',
      userStatedYardage: null, markedFix: null,
      courseHoles: [{ hole: 1, par: 4, distance: 150, front: 135, back: 165, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0 }],
      ...over,
    } as never);
  };

  it('the mocked tier really is the one a pin can move — or the rest proves nothing', () => {
    withHole();
    const r = resolveYardage(1);
    expect(r.value).toBe(150);
    expect(r.is_fallback).toBe(false);
    expect(r.back).toBe(165);
  });

  it('END TO END: a declared back pin makes every consumer see 160', () => {
    withHole();
    expect(resolveYardage(1).value).toBe(150);
    useRoundStore.getState().setPinPosition({ depth: 'back', side: 'right' });
    expect(resolveYardage(1).value).toBe(160);   // 165 back edge − 5 inset
    useRoundStore.getState().setPinPosition({ depth: 'front', side: 'left' });
    expect(resolveYardage(1).value).toBe(140);   // 135 front edge + 5
    /**
     * Clearing must UNDECLARE, not just set middle. Asserting only the yardage proved nothing here: a
     * declared middle pin returns early as a no-op and gives 150 either way, so the first version of this
     * passed with the declaration left standing. Break-testing found it.
     */
    useRoundStore.getState().setPinPosition(null);
    expect(resolveYardage(1).value).toBe(150);
    expect(useRoundStore.getState().pinDeclared).toBe(false);
    expect(useRoundStore.getState().pinPosition).toEqual(PIN_CENTER);
  });

  it('the pin is applied in resolveYardage, which is what every consumer calls', () => {
    const r = code('services/yardageResolver.ts');
    expect(r).toMatch(/applyDeclaredPin\(resolveYardageInner\(hole, round\), round, hole\)/);
    // 2026-09-25 — per HOLE: the pin said on the hole, else the round's (pinPosition.pinForHole).
    expect(r).toMatch(/const declared = pinForHole\(round, hole\);/);
    // the maths is imported, not restated here
    expect(r).toMatch(/import \{ adjustForPin, describePin, pinForHole \} from '\.\/pinPosition'/);
    expect(r).not.toMatch(/PIN_EDGE_INSET/);
  });

  it('an UNDECLARED pin changes nothing — middle is also the initial value', () => {
    withHole();
    const before = resolveYardage(1).value;
    useRoundStore.setState({ pinPosition: { depth: 'back', side: 'right' } } as never); // set, NOT declared
    expect(resolveYardage(1).value).toBe(before);
  });

  it('a declared pin does not touch the green edges — the flag moved, not the green', () => {
    withHole();
    const before = resolveYardage(1);
    useRoundStore.getState().setPinPosition({ depth: 'back', side: 'right' });
    const after = resolveYardage(1);
    expect(after.front).toBe(before.front);
    expect(after.back).toBe(before.back);
  });

  it('the reason SAYS the pin was applied, so no surface has to guess why the number moved', () => {
    withHole();
    useRoundStore.getState().setPinPosition({ depth: 'back', side: 'right' });
    const r = resolveYardage(1);
    expect(r.reason).toMatch(/Pin back right: playing 160 \(\+10 on the middle\)/);
  });

  it('a DECLINE is also stated, never silent — an estimated yardage keeps the middle', () => {
    jest.spyOn(smartFinder, 'getGreenYardagesSync').mockReturnValue({
      front: 135, middle: 150, back: 165, reason: 'estimated',
    } as never);
    withHole();
    useRoundStore.getState().setPinPosition({ depth: 'back', side: 'right' });
    const r = resolveYardage(1);
    expect(r.value).toBe(150);
    expect(r.reason).toMatch(/not adjusting for it/);
  });

  it('it declines on an ESTIMATED yardage rather than compounding a guess', () => {
    const y = code('services/yardageResolver.ts');
    expect(y).toMatch(/if \(r\.is_fallback\)/);
    expect(y).toMatch(/not adjusting for it/);
  });
});

describe('a pin lasts exactly one round — no longer, no shorter', () => {
  /**
   * Two rules that pull opposite ways, and both are needed:
   *   PERSISTED so a mid-round app restart does not silently hand back ten yards. Transport survives a
   *   restart being lost because the detector re-establishes it; nothing observes where a flag is, so a
   *   lost pin declaration is simply gone and every yardage quietly changes.
   *   CLEARED AT ROUND START because pins are set per DAY. Carrying yesterday's sheet into today would
   *   adjust every number off a fact that expired overnight, with nothing on screen to suggest it.
   */
  it('it is persisted, so a restart mid-round keeps the flag', () => {
    const store = code('store/roundStore.ts');
    const partialize = store.slice(store.indexOf('partialize: (s) =>'));
    expect(partialize).toMatch(/pinPosition: s\.pinPosition/);
    expect(partialize).toMatch(/pinDeclared: s\.pinDeclared/);
  });

  it('and a NEW round starts undeclared, so yesterday\'s sheet cannot carry over', () => {
    const store = code('store/roundStore.ts');
    const startRound = store.slice(store.indexOf('transportMode: resolvedTransport'), store.indexOf('transportMode: resolvedTransport') + 600);
    expect(startRound).toMatch(/pinPosition: PIN_CENTER/);
    expect(startRound).toMatch(/pinDeclared: false/);
  });
});

describe('the caddie is told the SIDE, which no yardage can carry', () => {
  it('the aim note names the safe half and the dead miss', () => {
    expect(aimNoteForPin({ depth: 'back', side: 'right' })).toMatch(/fat of the green is left/);
    expect(aimNoteForPin({ depth: 'front', side: 'left' })).toMatch(/fat of the green is right/);
  });

  it('a centre pin says nothing at all', () => {
    expect(aimNoteForPin({ depth: 'back', side: 'center' })).toBeNull();
    expect(aimNoteForPin(PIN_CENTER)).toBeNull();
  });

  it('it reads like a person said it', () => {
    expect(describePin({ depth: 'back', side: 'right' })).toBe('back right');
    expect(describePin({ depth: 'middle', side: 'left' })).toBe('left');
    expect(describePin(PIN_CENTER)).toBe('middle of the green');
  });

  it('it rides the one payload builder and the brain reads it', () => {
    const body = code('services/caddieRequestBody.ts');
    expect(body).toMatch(/pinPosition: safe\(/);
    // 2026-09-25 — the hole's pin, else the round's; nothing when neither was declared.
    expect(body).toMatch(/const declared = pinForHole\(r, currentHole\);\s*if \(!declared\) return null;/);
    const k = code('api/kevin.ts');
    expect(k).toMatch(/pinPosition = null,/);
    expect(k).toMatch(/"TODAY'S PIN"\} is \$\{pin\.said\}/);
    // and it must tell the model the depth is ALREADY in the numbers, or it will double-count
    expect(k).toMatch(/do not add or subtract for it again/);
  });
});

describe('the entry is where Tim asked for it', () => {
  const play = code('app/(tabs)/play.tsx');

  it('a 3x3 grid on the Play tab, beside the walking/cart choice', () => {
    expect(play).toMatch(/todays_pins/);
    expect(play).toMatch(/\['back', 'middle', 'front'\]/);
    expect(play).toMatch(/\['left', 'center', 'right'\]/);
    expect(play.indexOf('transportBtn')).toBeLessThan(play.indexOf('pinCell'));
  });

  it('tapping a cell DECLARES it — not just sets the value', () => {
    expect(play).toMatch(/setSetupPin\(\{ depth, side \}\)/);
    // 2026-09-25 — the flag shows the pin in force (the hole's in a round, the day's before).
    expect(play).toMatch(/const active = !!shownPin && shownPin\.depth === depth/);
  });

  it('it is optional, and says what skipping means', () => {
    expect(play).toMatch(/pin_hint/);
    expect(play).toMatch(/pin_set_hint/);
  });
});
