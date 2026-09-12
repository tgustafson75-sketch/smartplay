/**
 * 2026-09-11 (Tim) — THE BRANDED ICON SET, AND THE TWO WAYS IT SILENTLY BREAKS.
 *
 * Tim produced the Play-tab and Dashboard sheets to the Smart Motion style lock. Two failure modes
 * neither a human eye nor a diff reliably catches:
 *
 *   1. A MISSING ASSET. A `require()` for a file that is not there is a red box at runtime, and in
 *      a diff it looks exactly like a correct one.
 *   2. A HARDCODED TINT. The brand lime #88F700 is superb on dark and washes out badly on white —
 *      a contact sheet on white shows it plainly. The theme already carries `accent_lime`, darkened
 *      to #5a9e1a for light by the 2026-09-05 contrast pass, so every icon must tint from the token
 *      and never from a literal. Tim's instruction: "make sure light and dark work interchangeably,
 *      that something doesn't get washed out."
 */
import fs from 'fs';
import path from 'path';

const root = (p: string) => path.join(__dirname, '../../', p);
const read = (p: string) => fs.readFileSync(root(p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const play = strip(read('app/(tabs)/play.tsx'));
const dash = strip(read('app/(tabs)/dashboard.tsx'));

describe('every branded icon that is required actually exists', () => {
  const requires = (src: string) =>
    [...src.matchAll(/require\('\.\.\/\.\.\/(assets\/icons\/(?:play|dash)\/[a-z-]+\.png)'\)/g)].map((m) => m[1]);

  it('the Play tab requires its seven section icons and they are all on disk', () => {
    const list = requires(play);
    expect(list.length).toBeGreaterThanOrEqual(7);
    for (const rel of list) {
      expect(fs.existsSync(root(rel))).toBe(true);
      expect(fs.statSync(root(rel)).size).toBeGreaterThan(2000);
    }
  });

  it('the Dashboard requires its icons and they are all on disk', () => {
    const list = requires(dash);
    expect(list.length).toBeGreaterThanOrEqual(13);
    for (const rel of list) {
      expect(fs.existsSync(root(rel))).toBe(true);
      expect(fs.statSync(root(rel)).size).toBeGreaterThan(2000);
    }
  });

  it('and nothing in the icon folders is orphaned — a drawn icon nobody shows is wasted work', () => {
    const used = new Set([...requires(play), ...requires(dash)].map((r) => path.basename(r)));
    for (const dir of ['assets/icons/play', 'assets/icons/dash']) {
      for (const f of fs.readdirSync(root(dir))) {
        if (f.endsWith('.png')) expect(used.has(f)).toBe(true);
      }
    }
  });

  it('and every icon in a map is actually RENDERED, not merely required', () => {
    /**
     * require() is not the same as shown. My first version of the guard above checked only the
     * requires, and five dashboard icons sat in the map with nothing rendering them — the exact
     * half-build this codebase treats as a live bug. Assert each map key appears in JSX.
     * [[orphans-are-live-bugs-not-dead-code]]
     */
    for (const [src, mapName] of [[play, 'SEC_ICON'], [dash, 'DASH_ICON']] as const) {
      const at = src.indexOf(`const ${mapName} = {`);
      expect(at).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('} as const;', at));
      const keys = [...body.matchAll(/^\s*(\w+):\s*require\(/gm)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(5);
      for (const k of keys) {
        expect(src).toMatch(new RegExp(`source=\\{${mapName}\\.${k}\\}`));
      }
    }
  });
});

describe('every branded icon is tinted from the theme, never a literal', () => {
  const tintsIn = (src: string) => [...src.matchAll(/tintColor=\{([^}]+)\}/g)].map((m) => m[1].trim());

  it('the Play tab tints only from accent_lime', () => {
    const t = tintsIn(play);
    expect(t.length).toBeGreaterThanOrEqual(7);
    for (const v of t) expect(v).toBe('colors.accent_lime');
  });

  it('the Dashboard tints only from accent_lime', () => {
    const t = tintsIn(dash);
    expect(t.length).toBeGreaterThanOrEqual(9);
    for (const v of t) expect(v).toBe('colors.accent_lime');
  });

  it('no branded icon is tinted with a hex literal — that is the washout Tim stopped', () => {
    for (const src of [play, dash]) {
      expect(src).not.toMatch(/tintColor=\{?['"]#/);
    }
  });

  it('accent_lime really does differ between light and dark, or the tint achieves nothing', () => {
    const tokens = read('theme/tokens.ts');
    const all = [...tokens.matchAll(/accent_lime:\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all).size).toBeGreaterThanOrEqual(2);
    expect(all).toContain('#88F700');            // the brand lime, on dark
  });
});

describe('the timeline no longer collides with what follows it', () => {
  it('the block after the progress chart clears the axis labels', () => {
    // TrendChart draws its x labels INSIDE the svg at `height - 3`, flush to the bottom edge, so the
    // moment the timeline was added this heading began sitting on top of "5 wks ago".
    const raw = read('app/(tabs)/dashboard.tsx');
    const at = raw.indexOf("preRound.enough || preRound.buckets.some");
    expect(at).toBeGreaterThan(-1);
    const m = /marginTop: (\d+)/.exec(raw.slice(at, at + 900));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(18);
  });
});

/**
 * 2026-09-11 (Tim) — "fix score trend. Kind of the whole point."
 *
 * The SHOT STATS tile labelled SCORE TREND was showing the AVERAGE score-vs-par over the last five
 * rounds — a level, not a direction. It then drew a trending-UP arrow beside it and rendered it in
 * the positive accent, so "+15.6" (fifteen over par) arrived with three separate signals all saying
 * good news. In golf lower is better, so every one of them was backwards.
 */
describe('SCORE TREND is a trend, and says which way is good', () => {
  const dashRaw = read('app/(tabs)/dashboard.tsx');

  it('compares two halves rather than averaging one window', () => {
    expect(dash).toMatch(/const early = vs\.slice\(0, half\)/);
    expect(dash).toMatch(/const late = vs\.slice\(vs\.length - half\)/);
    expect(dash).toMatch(/const delta = avg\(late\) - avg\(early\)/);
  });

  it('treats DOWN as improvement, because lower is better in golf', () => {
    expect(dash).toMatch(/improving: delta < -0\.5/);
    expect(dash).toMatch(/scoreTrend\.improving \? 'trending-down-outline'/);
  });

  it('will not call a trend off fewer than four rounds', () => {
    // With two or three, one bad afternoon IS the trend. A dash beats a confident number.
    expect(dash).toMatch(/if \(vs\.length < 4\) return null/);
  });

  it('colours bad news as bad news — the tile used to be green whatever it said', () => {
    expect(dashRaw).toMatch(/tone\?: 'good' \| 'bad' \| 'neutral'/);
    expect(dashRaw).toMatch(/tone === 'bad' \? colors\.accent_amber/);
    expect(dash).toMatch(/scoreTrend\.worsening \? 'bad'/);
  });

  it('and the other three tiles are untouched — tone defaults to good', () => {
    expect(dashRaw).toMatch(/tone = 'good',/);
  });

  it('a flat stretch claims nothing — no arrow, no colour', () => {
    expect(dash).toMatch(/: 'remove-outline'/);
    expect(dash).toMatch(/: 'neutral'/);
  });
});
