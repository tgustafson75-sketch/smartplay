/**
 * 2026-09-13 (Tim, reviewing the dashboard) — "putts should be always in Feet."
 *
 * The Highlights card read LONGEST PUTT 22y. Nobody has ever described a putt in yards, and the app
 * was not merely displaying them that way — it was COLLECTING them that way:
 *
 *   1. `QuickLogShotSheet` offers `putter` in its club list and then asked for "Distance (yards)".
 *      A player logging a twenty-five-footer typed 25 and the app recorded a 75-foot putt.
 *   2. `ShotTimeline` printed "yds" on every row, so a putt logged from eight yards read "8 yds"
 *      rather than the twenty-four-footer it was.
 *   3. The Settings field said "(yards)" and `setLongestPutt` clamped at 1000 — three times the
 *      longest putt ever holed in a tournament, in the wrong unit. It rejected nothing.
 *   4. And the caddie could not be asked. LONGEST PUTT has sat beside LONGEST DRIVE on that card
 *      since June; the drive got a query topic on 2026-09-12 and the putt never did. Drawn, stored,
 *      unaskable — the half that keeps being missing.
 *      [[smartplay-defect-class-unwired-halves]]
 *
 * The conversion itself already existed, in services/simGame, put there on 2026-09-03 after a `* 1.6`
 * reported every SwingSim putt at half its length. Right fix, wrong home: FEET_PER_YARD is a fact
 * about golf, and the surfaces that needed it could not reach it without importing a shot engine.
 * [[two-owners-is-the-root-cause]] [[a-yard-is-three-feet]]
 */
import fs from 'fs';
import path from 'path';
import {
  FEET_PER_YARD,
  PUTT_MAX_FEET,
  isPutterClub,
  puttFeetFrom,
  puttYardsFromFeet,
  shotDistanceDisplay,
} from '../../services/puttUnits';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/en.json'), 'utf8'));

describe('the unit has one owner, and it is not the sim game', () => {
  it('puttUnits defines it and simGame no longer holds a copy', () => {
    const pu = code('services/puttUnits.ts');
    expect(pu).toMatch(/export const FEET_PER_YARD = 3;/);
    expect(pu).toMatch(/export function puttFeetFrom/);
    const sg = code('services/simGame.ts');
    expect(sg).not.toMatch(/export const FEET_PER_YARD/);
    expect(sg).not.toMatch(/export function puttFeetFrom/);
  });

  it('every consumer of the conversion imports it from the owner', () => {
    for (const f of [
      'app/swinglab/simround.tsx',
      'services/simRoundAuto.ts',
      'scripts/simulations/sim-auto-round.ts',
    ]) {
      const src = code(f);
      expect(src).toMatch(/puttFeetFrom\(/);
      expect(src).toMatch(/puttFeetFrom[^\n]*from '[^']*puttUnits'|from '[^']*puttUnits'/);
    }
  });

  it('feet → yards → feet is lossless, so nothing drifts across a round trip', () => {
    for (const ft of [1, 2, 3, 7, 12, 25, 38, 66, 101, 180]) {
      expect(puttFeetFrom(puttYardsFromFeet(ft))).toBe(ft);
    }
  });
});

describe('a putter is recognised wherever it is spelled', () => {
  it.each(['putter', 'Putter', 'p', 'P', ' putter '])('%s is the flat stick', (c) => {
    expect(isPutterClub(c)).toBe(true);
  });

  it.each(['7 iron', 'Driver', 'pw', 'PW', 'pitching wedge', '', null, undefined])(
    '%s is not', (c) => expect(isPutterClub(c as string)).toBe(false),
  );
});

describe('every surface a human reads a putt on says feet', () => {
  it('a shot row shows a putt in feet and everything else in yards', () => {
    expect(shotDistanceDisplay('putter', 8)).toEqual({ value: '24', unit: 'ft' });
    expect(shotDistanceDisplay('7 iron', 165)).toEqual({ value: '165', unit: 'yds' });
  });

  it('no distance means no number — never a 0', () => {
    expect(shotDistanceDisplay('putter', null)).toBeNull();
    expect(shotDistanceDisplay('putter', Number.NaN)).toBeNull();
  });

  it('the timeline asks the owner rather than hardcoding "yds" on every row', () => {
    const st = code('components/caddie/ShotTimeline.tsx');
    expect(st).toMatch(/shotDistanceDisplay\(shot\.club, shot\.distance_yards\)/);
    // the unit comes from the answer, so it cannot be right for irons and wrong for putts
    expect(st).toMatch(/\{dist\?\.unit \?\? 'yds'\}/);
    expect(st).not.toMatch(/<Text style=\{styles\.distUnit\}>yds<\/Text>/);
  });

  it('the RECAP shot map asks the same owner — the unit had two renderers', () => {
    /**
     * 2026-09-13, triple-check. ShotTimeline was fixed and components/recap/HoleShotMap was not: it
     * appended ' yd' to every shot, so the same putt read "24 ft" on the dashboard and "8 yd" in the
     * recap. A unit with two renderers is a unit with two answers.
     */
    const map = code('components/recap/HoleShotMap.tsx');
    expect(map).toMatch(/shotDistanceDisplay\(selected\?\.club, selected\?\.distance_yards\)/);
    expect(map).not.toMatch(/selected\.distance_yards \+ ' yd'/);
  });

  it('no surface appends a distance unit by hand instead of asking', () => {
    // The property, swept: any file that renders a shot's distance_yards must get its unit from the
    // owner. Stated as a sweep so the NEXT renderer cannot repeat this.
    const offenders: string[] = [];
    for (const rel of ['components/caddie/ShotTimeline.tsx', 'components/recap/HoleShotMap.tsx']) {
      const src = code(rel);
      if (/distance_yards[^\n]*(?:\+\s*' ?(?:yd|yds|y)'|>yds<)/.test(src)) offenders.push(rel);
      if (!src.includes('shotDistanceDisplay')) offenders.push(`${rel} (does not ask the owner)`);
    }
    expect(offenders).toEqual([]);
  });

  it('the Quick Log sheet asks for FEET once the putter is picked, and converts on the way in', () => {
    const q = code('components/QuickLogShotSheet.tsx');
    /**
     * 2026-09-18 — this pinned the literal `isPutterClub(club) ? puttYardsFromFeet(distNum) : distNum`
     * and went red when the OTHER branch learned about metres (a player set to metres who types 133
     * must store 145). The property this test is about is untouched: the putter is still checked
     * FIRST and still converts from feet. Asserted as "the putt branch is unchanged and it comes
     * before anything else", which is the actual rule, rather than as the shape of the line that
     * happened to implement it. [[a-guard-can-assert-the-broken-shape]]
     */
    expect(q).toMatch(/isPutterClub\(club\)\s*\?\s*puttYardsFromFeet\(distNum\)\s*:/);
    // ...and the non-putt branch must NOT quietly go back to storing the raw typed number.
    expect(q).toMatch(/puttYardsFromFeet\(distNum\)\s*:\s*\(fromDisplayDistance\(distNum, distanceUnit\)/);
    expect(q).toMatch(/isPutterClub\(club\)[\s\S]{0,120}distance_feet_optional/);
    expect(en.quick_log_shot_sheet.text.distance_feet_optional).toMatch(/feet/i);
  });

  it('the Settings field and the Highlights card both say feet', () => {
    expect(en.settings.text.longest_putt_feet).toMatch(/feet/i);
    // the yards spelling is gone, not merely unused — a key left behind is a key something re-uses
    expect(en.settings.text.longest_putt_yards).toBeUndefined();
    // 2026-09-14 — the field moved with the profile form out of Settings.
    const s = code('components/profile/ProfileForm.tsx');
    expect(s).toMatch(/longest_putt_feet/);
    expect(s).not.toMatch(/longest_putt_yards/);
    // and Settings must not have kept a second copy of it
    expect(code('app/settings.tsx')).not.toMatch(/longest_putt/);
    const d = code('app/(tabs)/dashboard.tsx');
    expect(d).toMatch(/longestPuttFeet != null \? `\$\{longestPuttFeet\} ft`/);
    expect(d).toMatch(/Longest putt \$\{longestPuttFeet\} feet/);
  });
});

describe('the stored personal best is feet, and says so in its name', () => {
  const store = code('store/playerProfileStore.ts');

  it('the field carries the unit', () => {
    expect(store).toMatch(/longestPuttFeet: number \| null;/);
    expect(store).toMatch(/setLongestPuttFeet: \(feet: number \| null\) => void;/);
    // nothing may still read or write the yards-era name
    expect(store).not.toMatch(/longestPutt:/);
  });

  it('an absurd entry is REJECTED rather than clamped, the same call setLongestDrive makes', () => {
    expect(store).toMatch(/if \(feet > PUTT_MAX_FEET\) return;/);
    expect(store).not.toMatch(/Math\.min\(1000/);
    // and the cap is a real putting number, not a yardage
    expect(PUTT_MAX_FEET).toBeGreaterThan(375); // the longest putt holed on tour
    expect(PUTT_MAX_FEET).toBeLessThan(600);
  });

  it('the setter behaves: feet in, feet out, junk clears', () => {
    const { usePlayerProfileStore } = require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore');
    const api = usePlayerProfileStore.getState();
    api.setLongestPuttFeet(38);
    expect(usePlayerProfileStore.getState().longestPuttFeet).toBe(38);
    api.setLongestPuttFeet(PUTT_MAX_FEET + 1); // a mis-key must not become a personal best
    expect(usePlayerProfileStore.getState().longestPuttFeet).toBe(38);
    api.setLongestPuttFeet(null);
    expect(usePlayerProfileStore.getState().longestPuttFeet).toBeNull();
  });

  it('the migration converts the old yards value at the rate the old LABEL promised', () => {
    // 22 in a field that said "(yards)" is 66 feet. Reinterpreting it as feet would mean deciding
    // the label had been lying, which is a guess; dropping it loses a personal best to a rename.
    /**
     * 2026-09-14 — this pinned `version: 4,` and broke on the very next migration (home courses
     * became a set of three, v5). The version NUMBER is not what this test cares about; it cares
     * that the conversion still happens and still uses the rate the old label promised. Asserting
     * the number would make every future migration look like a putting regression.
     *
     * What IS worth pinning is that the version never goes BACKWARDS — a lowered version silently
     * stops migrate() running for anyone already on the higher one.
     */
    const version = Number(/version: (\d+),/.exec(store)?.[1] ?? 0);
    expect(version).toBeGreaterThanOrEqual(4);
    expect(store).toMatch(/p\.longestPuttFeet = Math\.min\(PUTT_MAX_FEET, Math\.round\(p\.longestPutt \* FEET_PER_YARD\)\)/);
    expect(store).toMatch(/delete p\.longestPutt;/);
    expect(Math.round(22 * FEET_PER_YARD)).toBe(66);
  });
});

describe('the caddie can be asked', () => {
  const routed = (u: string) => {
    const i = precheckLocalIntent(u);
    return { type: i?.intent_type ?? null, topic: String(i?.parameters?.query_topic ?? '') };
  };

  it.each([
    "what's my longest putt",
    'longest putt',
    'what was my furthest putt',
    'my best putt ever',
  ])('"%s" reaches the longest_putt topic', (u) => {
    expect(routed(u)).toEqual({ type: 'query_status', topic: 'longest_putt' });
  });

  it('beats putt_stats to it — the more specific question has to win', () => {
    // "putts today" is a putt_stats phrase; "my longest putt today" is not.
    expect(routed('my longest putt today').topic).toBe('longest_putt');
    expect(routed('how many putts so far').topic).toBe('putt_stats');
  });

  it('the handler answers in FEET, and never implies it measured the putt', () => {
    const h = code('services/intents/queryStatusHandler.ts');
    expect(h).toMatch(/topic === 'longest_putt'/);
    expect(h).toMatch(/longestPuttFeet/);
    expect(h).toMatch(/\$\{ft\} feet/);
    // putts are counted per hole, never measured — the answer says whose number it is
    expect(h).toMatch(/query:longest_putt:unset/);
  });

  it('it is answered OFF the round too, because a personal best has nothing to do with today', () => {
    const h = code('services/intents/queryStatusHandler.ts');
    const answeredAt = h.indexOf("topic === 'longest_putt'");
    const offRoundGate = h.indexOf('!round.isRoundActive');
    expect(answeredAt).toBeGreaterThan(-1);
    expect(answeredAt).toBeLessThan(offRoundGate);
  });
});
