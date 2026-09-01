/**
 * 2026-09-01 (Tim: "all white text brighten please").
 *
 * This is a GOLF app. The screen is read at arm's length, outdoors, in direct sun, often through
 * polarised sunglasses — conditions where grey-400 on a dark ground is comfortable at a desk and
 * marginal on a tee box. 177 text colours were raised: the shared `text_muted` token, 144 inline
 * copies of the SAME grey that had been hardcoded across 62 screens instead of using the token, and
 * 32 low-alpha whites.
 *
 * Accent hues (#86efac, #a3e635, #a78bfa) are deliberately untouched — they are not body text.
 * Low-alpha whites used for BORDERS and BACKGROUNDS are untouched too; only `color:` is text.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.tsx')) out.push(f);
    }
  };
  walk(path.join(root, 'app'));
  walk(path.join(root, 'components'));
  return out;
}

const files = sourceFiles();
const rel = (f: string) => path.relative(root, f);

describe('no text is dimmer than a tee box can read', () => {
  it('the shared muted token is bright enough', () => {
    const tokens = fs.readFileSync(path.join(root, 'theme/tokens.ts'), 'utf8');
    expect(tokens).not.toMatch(/text_muted:\s*'#9ca3af'/);
    expect(tokens).toMatch(/text_muted:\s*'#c2cad4'/);
  });

  it('no screen hardcodes the old grey as a text colour', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const grey of ['#9ca3af', '#9aa5b1', '#94a3b8']) {
        if (new RegExp(`color: ?'${grey}'`, 'i').test(src)) offenders.push(`${rel(f)} -> ${grey}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no white TEXT is under 60% opacity', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/color: ?'rgba\(255, ?255, ?255, ?(0\.[0-9]+)\)'/g)) {
        if (parseFloat(m[1]) < 0.6) offenders.push(`${rel(f)} -> alpha ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('BORDERS and BACKGROUNDS are left alone — this guard is about text only', () => {
    // Proof the sweep was surgical: faint white borders still exist and must not be "fixed".
    const anyFaintBorder = files.some((f) =>
      /(borderColor|backgroundColor): ?'rgba\(255, ?255, ?255, ?0\.[0-2][0-9]?\)'/.test(
        fs.readFileSync(f, 'utf8'),
      ),
    );
    expect(anyFaintBorder).toBe(true);
  });

  it('accent hues are untouched — they are not body text', () => {
    const stillThere = files.some((f) => /#86efac/i.test(fs.readFileSync(f, 'utf8')));
    expect(stillThere).toBe(true);
  });
});

describe('SmartFinder measures during practice', () => {
  const store = fs.readFileSync(path.join(root, 'store/smartFinderStore.ts'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'app/smartfinder.tsx'), 'utf8');

  it('the setting exists and PERSISTS — "I am practising" outlives a mount', () => {
    expect(store).toMatch(/offCourse: boolean/);
    expect(store).toMatch(/partialize:.*offCourse: s\.offCourse/);
    expect(store).toMatch(/version: 4/);
  });

  it('the screen honours the setting OR a genuinely absent course', () => {
    expect(screen).toMatch(/const offCourse = offCourseSetting \|\| !geoCourseId;/);
  });

  it('the hole navigator stands down, and the player is told why', () => {
    expect(screen).toMatch(/\{!offCourse && \(\n\s*<View style=\{styles\.holeNav\}>/);
    expect(screen).toMatch(/PRACTICE MEASURE/);
    expect(screen).toMatch(/POINT-TO-POINT MEASURE/);
  });

  it('it can be turned back off — a one-way door would be a trap', () => {
    expect(screen).toMatch(/setOffCourse\(false\)/);
    expect(screen).toMatch(/setOffCourse\(true\)/);
  });
});
