/**
 * 2026-09-09 (72-hour triple-check) — THE GUARD WATCHED THE WRONG DIRECTORIES.
 *
 * `.github/workflows/ota-guard.yml` (09-06) exists to stop a native change riding an OTA, because an
 * OTA ships JS into an already-installed native shell: if that JS needs native code the shell lacks,
 * the app crashes on launch, and a launch crash cannot download the OTA that would fix it.
 *
 * It matched `^(ios|android)/`. Those are prebuild OUTPUT. This repo's authored native source lives
 * in android-native/, ios-native/, plugins/ (Expo config plugins that inject native code), targets/
 * (the Apple Watch target) and wear-os-app/ — none of which were listed. A PR editing
 * `android-native/WearSwingBridgeModule.kt` passed the gate cleanly.
 *
 * Not theoretical: the two watch fixes named in the 09-09 log — a command path on the Data Layer
 * module, a CapabilityClient listener — are exactly that file, and this guard was the stated reason
 * they could not ship by OTA.
 *
 * So this test DERIVES the set: any top-level directory holding native sources must be named in the
 * workflow. A new one added later fails here rather than being discovered by a launch crash.
 * [[no-half-fixes-enforce-every-surface]]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ota-guard.yml'), 'utf8');
/**
 * The RUN STEPS only — YAML comments stripped.
 *
 * 2026-09-09: the override assertion below failed on its first run against the workflow's own header
 * ("a hard gate with no override flag"). Fourth time this sprint a guard has been defeated by prose
 * describing the very thing it forbids — run-sim.ts on 08-31, the anchor scan this morning, and now
 * this. A file's account of itself is not the file doing the thing, and apparently I need the lesson
 * written into every scanner I touch. [[a-stale-header-is-a-source-someone-trusts]]
 */
const workflowSteps = workflow.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');

/** Top-level dirs containing native sources, found rather than listed. */
function nativeSourceDirs(): string[] {
  const NATIVE_EXT = /\.(kt|java|swift|m|mm|h|gradle|podspec)$/;
  const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'build', '__tests__', 'docs']);
  const found = new Set<string>();
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const walk = (dir: string, depth: number): boolean => {
      if (depth > 4) return false;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
      for (const c of entries) {
        if (c.isDirectory()) {
          if (SKIP.has(c.name)) continue;
          if (walk(path.join(dir, c.name), depth + 1)) return true;
        } else if (NATIVE_EXT.test(c.name)) return true;
      }
      return false;
    };
    if (walk(path.join(root, e.name), 0)) found.add(e.name);
  }
  return [...found].sort();
}

describe('the OTA guard knows where native code actually lives', () => {
  const dirs = nativeSourceDirs();

  it('finds native source dirs at all (a scan that finds nothing passes vacuously)', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    // The two that were missing and that the watch work needs.
    expect(dirs).toEqual(expect.arrayContaining(['android-native', 'ios-native']));
  });

  it.each(nativeSourceDirs())('the workflow names %s', (dir) => {
    expect(workflow).toContain(dir);
  });

  it('still blocks the generated projects, app config, eas.json and dependency changes', () => {
    expect(workflowSteps).toContain("'^(ios|android)/'");
    expect(workflowSteps).toContain('app\\.(json|config');
    expect(workflowSteps).toContain("'^eas\\.json$'");
    expect(workflowSteps).toContain('dependency changes');
  });

  it('config plugins and patches count — both change the native build without touching ios/ or android/', () => {
    expect(workflow).toContain("'^plugins/'");
    expect(workflow).toContain("'^patches/'");
  });

  it('has no override flag — a native change is not an OTA that needs care, it is a store build', () => {
    expect(workflowSteps).not.toMatch(/skip-ota-guard|force.?ota|override/i);
  });
});
