/**
 * 2026-09-10 (Tim: "We have to keep digging. I am tired of half done work.") — THE DEAD-SETTING GATE.
 *
 * The orphan-export sweep (scripts/simulations/orphanExports) catches a function nobody imports. It
 * cannot catch the shape that actually keeps reaching the course: a SETTING that is declared,
 * persisted, shown in the UI or settable by voice, written by its setter — and read by nothing.
 * From the outside that is a switch the player flips that does nothing at all, and the caddie
 * cheerfully confirming it.
 *
 * Found by this sweep on 2026-09-10:
 *   - `smartVisionImagery` — voice said "SmartVision showing satellite aerial now." Nothing read it.
 *   - `highContrastUserTouched` — declared, persisted, set by setHighContrast, and the v21 migration
 *     it exists to constrain asked a PROXY instead, so a deliberate "off" was switched back on.
 *
 * A field may be legitimately unread. It goes in KNOWN_UNREAD with the reason, which is the same
 * contract as ORPHAN_BASELINE: you may keep it, you may not keep it SILENTLY.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const settingsSrc = fs.readFileSync(path.join(ROOT, 'store/settingsStore.ts'), 'utf8');

/** Directories that count as "the app reads this". */
const SEARCH_DIRS = [
  'app', 'services', 'components', 'hooks', 'store', 'utils',
  'constants', 'contexts', 'data', 'lib', 'api', 'theme', 'styles',
];

/**
 * Files whose reads do NOT count as the app using a value: the store that owns it, the screen that
 * only renders the switch, and the diagnostics dump that prints every field by reflection. A field
 * read ONLY by these is still dead to the product — that is exactly how smartVisionImagery hid.
 */
const NOT_A_REAL_READER = [
  'store/settingsStore.ts',
  'app/settings.tsx',
  'app/owner-logs.tsx',
];

const KNOWN_UNREAD: Record<string, string> = {
  smartVisionImagery:
    'Deliberately dead. Tim closed the Static/Satellite toggle 2026-08-11 ("it is always satellite"); ' +
    'smartvision-imagery-single-path.test.ts guards that decision. The field is kept only so persisted ' +
    'settings rehydrate cleanly, its setter is removed, and the voice command now states the truth ' +
    'instead of confirming a change. Delete once no store snapshot in the wild carries it.',
};

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every field declared in the persisted state, taken from `partialize` — the list that ships. */
function persistedFields(): string[] {
  const m = settingsSrc.match(/partialize:\s*\(s\)\s*=>\s*\(\{([\s\S]*?)\n {6}\}\)/);
  if (!m) return [];
  return [...m[1].matchAll(/^\s+([a-zA-Z_][A-Za-z0-9_]*):\s*s\.\1,/gm)].map(x => x[1]);
}

describe('a setting nobody reads', () => {
  const files = SEARCH_DIRS.flatMap(d => walk(d))
    .filter(f => !NOT_A_REAL_READER.some(n => f.endsWith(n)));
  const corpus = files.map(f => ({ f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

  it('finds the persisted settings list', () => {
    expect(persistedFields().length).toBeGreaterThan(20);
  });

  /**
   * The persist MIGRATION is a legitimate consumer — it is the whole reason a flag like
   * `highContrastUserTouched` exists (to constrain a future default change). It lives inside
   * settingsStore.ts, which is otherwise excluded, so it is matched on its own rather than by
   * re-admitting the entire store (where a field's own `partialize` line would count as a "read"
   * and make every dead field look alive).
   */
  const migrateBody = (() => {
    const i = settingsSrc.indexOf('migrate: (persisted, version)');
    if (i < 0) return '';
    const j = settingsSrc.indexOf('partialize:', i);
    return settingsSrc.slice(i, j > i ? j : undefined);
  })();

  it('locates the migrate body, so this exemption cannot silently match nothing', () => {
    expect(migrateBody.length).toBeGreaterThan(500);
    expect(migrateBody).toContain('version <');
  });

  it('every persisted setting is read by real app code, or is listed with a reason', () => {
    const unread: string[] = [];
    for (const field of persistedFields()) {
      // A read looks like `.field` somewhere that is not a comment.
      const re = new RegExp(String.raw`\.${field}\b`);
      const found = corpus.some(({ src }) =>
        src.split('\n').some(line => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
          return re.test(line);
        }),
      );
      const readByMigration = new RegExp(String.raw`\bp\.${field}\b`).test(migrateBody);
      if (!found && !readByMigration && !(field in KNOWN_UNREAD)) unread.push(field);
    }
    expect(unread).toEqual([]);
  });

  it('every KNOWN_UNREAD entry carries a real reason, not a shrug', () => {
    for (const [field, reason] of Object.entries(KNOWN_UNREAD)) {
      expect(reason.length).toBeGreaterThan(60);
      expect(reason).toMatch(/\d{4}-\d{2}-\d{2}|Tim|deliberate/i);
      // and it must still BE a persisted field — a stale exemption is its own rot
      expect(persistedFields()).toContain(field);
    }
  });
});

describe('the v21 appearance migration asks the flag, not a proxy', () => {
  it('honours highContrastUserTouched', () => {
    // It read `theme_preference === "system"` as a proxy for "never customised", then
    // `highContrast !== true` — which cannot tell "never enabled" from "deliberately disabled".
    expect(settingsSrc).toMatch(/version < 21[\s\S]{0,2200}highContrastUserTouched !== true/);
  });

  it('setHighContrast still records that the player chose', () => {
    // The guard above is worthless if nothing ever sets the flag.
    expect(settingsSrc).toMatch(/setHighContrast:\s*\(v\)\s*=>\s*set\(\{[^}]*highContrastUserTouched:\s*true/);
  });
});
