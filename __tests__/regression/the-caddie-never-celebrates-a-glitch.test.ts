/**
 * 2026-09-13 (Tim: "Finish all no device test items") — THE CELEBRATION HAD NO UPPER BOUND.
 *
 * `services/caddieRewards` fires a spoken reward on a tee shot over REWARD_DRIVE_YARDS (250). It had no
 * ceiling, so the corrupt capture the rest of the app already defends against — a GPS jump, or a
 * whole-course total leaking into one shot — produced "Hammered. That one's going." about a number
 * nobody hit. `setLongestDrive` REJECTS those rather than clamping ("a drive never exceeds ~500y … keep
 * the current best rather than record a fake number"), `longestDriveFrom` filters on MAX_REAL_DRIVE, and
 * services/shotTracking carries the same guard. This path had none of it — an unguarded file from
 * docs/audit-unguarded-inventory.md.
 *
 * Celebrating a fabricated number is worse than missing a real one: it teaches the player the app's
 * measurements cannot be trusted, on the one occasion it volunteers an opinion unprompted.
 *
 * And the copy restated the threshold. "Pured it. Two-fifty plus." is REWARD_DRIVE_YARDS written out in
 * prose, so tuning the constant to 230 would have the caddie announce "two-fifty plus" over a 235-yard
 * drive. One owner for the number; the line no longer repeats it.
 */
import fs from 'fs';
import path from 'path';
import { MAX_REAL_DRIVE } from '../../services/round/scoredRoundStats';

/**
 * The constants are read from SOURCE, not imported: `services/caddieRewards` pulls in voiceService →
 * expo-speech / expo-file-system, which this environment does not provide. scoredRoundStats is pure and
 * imports cleanly, so the relationship between the two numbers is still asserted against the real value.
 */
const numberFromSource = (rel: string, name: string): number => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(
    fs.readFileSync(path.join(root, rel), 'utf8'),
  );
  if (!m) throw new Error(`${name} not found in ${rel}`);
  return Number(m[1]);
};

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const rewards = code('services/caddieRewards.ts');
const REWARD_DRIVE_YARDS = numberFromSource('services/caddieRewards.ts', 'REWARD_DRIVE_YARDS');
const REWARD_PUTTS = numberFromSource('services/caddieRewards.ts', 'REWARD_PUTTS');

describe('a celebrated drive has to be a real one', () => {
  it('the threshold sits below the plausibility ceiling — or nothing could ever fire', () => {
    expect(REWARD_DRIVE_YARDS).toBeLessThan(MAX_REAL_DRIVE);
    expect(REWARD_DRIVE_YARDS).toBeGreaterThan(150);
  });

  it('a distance past the ceiling is rejected, not clamped and not celebrated', () => {
    expect(rewards).toMatch(/shot\.distance_yards > MAX_REAL_DRIVE\) return;/);
  });

  it('the ceiling is IMPORTED, not restated — one answer to "what is a real drive"', () => {
    expect(rewards).toMatch(/import \{ MAX_REAL_DRIVE \} from '\.\/round\/scoredRoundStats';/);
    expect(rewards).not.toMatch(/MAX_REAL_DRIVE\s*=/);
    expect(rewards).not.toMatch(/>\s*500/);
  });

  it('it still only fires on a measured TEE shot', () => {
    // The reward is about the drive, so the other gates must survive the fix.
    expect(rewards).toMatch(/shot\.shot_in_hole_index !== 1\) return;/);
    expect(rewards).toMatch(/!shot\.logged_via\) return;/);
    expect(rewards).toMatch(/typeof shot\.distance_yards !== 'number'\) return;/);
  });

  it('and only once per shot', () => {
    expect(rewards).toMatch(/firedShotIds\.has\(shot\.id\)\) return;/);
    expect(rewards).toMatch(/firedShotIds\.add\(shot\.id\)/);
  });
});

describe('the spoken line does not restate the threshold', () => {
  it('no variant writes the number out in prose', () => {
    const block = rewards.slice(rewards.indexOf('DRIVE_VARIANTS'), rewards.indexOf('ONE_PUTT_VARIANTS'));
    expect(block).not.toMatch(/two[- ]fifty/i);
    // nor any spelled-out yardage that would desync from the constant
    expect(block).not.toMatch(/\b(two|three|four)\s*hundred\b/i);
    expect(block).not.toMatch(/\b2[0-9]{2}\b/);
  });

  it('there are still several variants, so it does not become a catchphrase', () => {
    const block = rewards.slice(rewards.indexOf('DRIVE_VARIANTS'), rewards.indexOf('ONE_PUTT_VARIANTS'));
    expect([...block.matchAll(/'/g)].length).toBeGreaterThanOrEqual(8);
  });
});

describe('the one-putt reward is unchanged', () => {
  it('fires on exactly one putt, once per hole', () => {
    expect(REWARD_PUTTS).toBe(1);
    expect(rewards).toMatch(/putts !== REWARD_PUTTS\) return;/);
    expect(rewards).toMatch(/firedPuttKeys\.has\(key\)\) return;/);
  });
});
