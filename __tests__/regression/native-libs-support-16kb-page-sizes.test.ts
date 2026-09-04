/**
 * 2026-09-04 — PLAY REJECTED BUNDLE 25: "Your app does not support 16 KB memory page sizes."
 *
 * Apps targeting Android 15+ must ship 64-bit native libraries whose PT_LOAD segments are aligned
 * to 16384 bytes. On a device using 16 KB pages, an unaligned library can fail to load — so this is
 * a crash-on-launch class of defect on newer hardware, not a paperwork issue.
 *
 * Every 64-bit .so in the bundle was checked by parsing its ELF program headers: 56 aligned
 * correctly and exactly one did not — libmediapipe_tasks_vision_jni.so, at 4096, from
 * com.google.mediapipe:tasks-vision, which was pinned at 0.10.14. Candidate versions were then
 * checked the same way rather than trusting release notes; 0.10.26.1 and 0.10.29 are aligned,
 * 0.10.21 is not, and 0.10.35 ships no arm64-v8a library at all.
 *
 * This asserts the VERSION FLOOR at source, because the .so itself lives in a Gradle artifact that
 * is not in the repo and android/ is gitignored — there is nothing in a checkout for a test to
 * read. The floor is the thing a future edit would get wrong: a downgrade, or a well-meaning pin to
 * 0.10.35 that removes arm64 support entirely.
 *
 * The authoritative check is on the built artifact, and it is one command:
 *
 *   unzip -q app.aab -d x && for f in x/base/lib/arm64-v8a/*.so; do  # max PT_LOAD p_align >= 16384
 *
 * [[a-budget-must-fit-what-runs-inside-it]] [[state-what-you-measured-not-what-you-intended]]
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const plugin = fs.readFileSync(path.join(root, 'plugins', 'withMediaPipePose.js'), 'utf8');

/** Versions verified BY READING THE ELF HEADER of the arm64 library in each published AAR. */
const ALIGNED_16KB = ['0.10.26.1', '0.10.29'];
const KNOWN_UNALIGNED = ['0.10.14', '0.10.21'];
/** Published, but its AAR contains no arm64-v8a library — pinning it would drop 64-bit ARM. */
const NO_ARM64 = ['0.10.35'];

function pinnedVersion(): string {
  // Strip comments first: the block above this constant NAMES the bad versions, and a naive match
  // would read the documentation as the pin. This has bitten this repo repeatedly.
  const code = plugin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = /const MP_VERSION = '([^']+)'/.exec(code);
  if (!m) throw new Error('MP_VERSION not found in withMediaPipePose.js');
  return m[1];
}

describe('native libraries support 16 KB page sizes', () => {
  it('mediapipe tasks-vision is pinned to a version whose arm64 library is 16KB-aligned', () => {
    expect(ALIGNED_16KB).toContain(pinnedVersion());
  });

  it('it is not one of the versions measured as UNALIGNED — Play rejects these', () => {
    expect(KNOWN_UNALIGNED).not.toContain(pinnedVersion());
  });

  it('and not a version that ships no arm64-v8a library at all', () => {
    expect(NO_ARM64).not.toContain(pinnedVersion());
  });

  it('the guard reads the pin, not the prose describing it', () => {
    // If the comment block is ever removed, this still has to find a real constant.
    expect(pinnedVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
