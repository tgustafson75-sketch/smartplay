/**
 * 2026-09-01 — the pro-video -> drill loop dropped the swing-% ladder.
 *
 * A 07-09 audit found the "flagship TEMPO x SWING% drill dropped its ladder" and fixed it by
 * forwarding drillSwingPercents from the Drills screen's "Practice in Smart Motion" button. The
 * drill screen has TWO launch buttons, and the fix landed on one.
 *
 * The other goes through /drill-video — watch the pro do it, then record your own, which is the whole
 * point of the loop. That route neither declared nor forwarded the ladder, so a player who watched
 * the video first practised the flagship drill with no 50/75/100 reps and nothing saying so. Its own
 * header already claimed it handed off "with the same params the Drills screen" uses.
 *
 * Both launch buttons and the relay between them must carry the same set.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Everything SmartMotion needs to run a drill as the drill it is. */
const DRILL_PARAMS = ['drillId', 'drillName', 'drillShots', 'drillFocus', 'drillShotType', 'angle', 'drillSwingPercents'];

describe('every route into a drill carries the whole drill', () => {
  const issue = read('app/drills/[issue].tsx');
  const video = read('app/drill-video.tsx');

  /** The params object of each router.push in a file. */
  const pushes = (src: string) => [...src.matchAll(/router\.(?:push|replace)\(\{([\s\S]{0,1800}?)\}\)/g)].map((m) => m[1]);

  it('the Drills screen has two launch buttons — direct, and via the pro video', () => {
    const targets = pushes(issue).map((b) => /pathname: '([^']+)'/.exec(b)?.[1]);
    expect(targets).toContain('/swinglab/smartmotion');
    expect(targets).toContain('/drill-video');
  });

  it('THE BUG: both launch buttons send the swing-% ladder', () => {
    for (const b of pushes(issue)) {
      const target = /pathname: '([^']+)'/.exec(b)?.[1];
      if (target !== '/swinglab/smartmotion' && target !== '/drill-video') continue;
      expect(b).toMatch(/drillSwingPercents:/);
    }
  });

  it('the video screen ACCEPTS the ladder — a param it does not declare is a param it drops', () => {
    // slice from the CALL, not the import line that shares its name
    const at = video.indexOf('useLocalSearchParams<');
    expect(at).toBeGreaterThan(-1);
    const decl = video.slice(at, at + 400);
    expect(decl).toMatch(/drillSwingPercents\?: string/);
  });

  it('and forwards it on to SmartMotion', () => {
    const handoff = video.slice(video.indexOf("pathname: '/swinglab/smartmotion'"));
    expect(handoff).toMatch(/drillSwingPercents: params\.drillSwingPercents/);
  });

  it('THE CLASS: the video relay forwards every drill param it is given', () => {
    const handoff = video.slice(video.indexOf("pathname: '/swinglab/smartmotion'"), video.indexOf("pathname: '/swinglab/smartmotion'") + 1800);
    const missing = DRILL_PARAMS.filter((p) => !new RegExp(`${p}:`).test(handoff));
    expect(missing).toEqual([]);
  });

  it('SmartMotion still reads the ladder — forwarding it to a screen that ignores it is the same bug', () => {
    expect(read('app/swinglab/smartmotion.tsx')).toMatch(/drillSwingPercents/);
  });
});
