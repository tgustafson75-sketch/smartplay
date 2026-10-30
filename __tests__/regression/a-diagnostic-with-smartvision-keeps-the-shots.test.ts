/**
 * 2026-10-29 (Brain review r15, brain-sv-drops-diagnostic-shots) — A DIAGNOSTIC WITH SMARTVISION OPEN
 * STILL GETS THE LAST TEN SHOTS.
 *
 * "Why am I slicing it" with SmartVision open took the sv branch of the user message, which carried
 * the SmartVision block but not recentShotsBlock. The non-SmartVision branch carries it, and nothing
 * in the sv branch says the omission was on purpose, so the answer was built without the shots it
 * was asked to read. Both branches must carry the shots block in the same place.
 */
import * as fs from 'fs';
import * as path from 'path';

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

describe('a diagnostic with SmartVision open keeps the shots', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '../../api/kevin.ts'), 'utf8'));
  const start = src.indexOf('const userMessage = sv');
  const endMarker = '${baseMessage}`;';
  const end = src.indexOf(endMarker, start) + endMarker.length;
  const block = src.slice(start, end);
  const split = block.indexOf(': `${kbPrefix');
  const svBranch = block.slice(0, split);
  const plainBranch = block.slice(split);

  it('the user-message block and both branches are found', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(split).toBeGreaterThan(0);
    expect(svBranch).toContain('[/SMARTVISION OPEN]');
  });

  it('the SmartVision branch carries the recent-shots block next to the turn context', () => {
    expect(svBranch).toMatch(/\$\{turnContextPrefix\}\$\{recentShotsBlock\}\$\{onCourseContextBlock\}/);
  });

  it('the plain branch still carries it, and the SmartVision branch never drops it', () => {
    expect(plainBranch).toMatch(/\$\{turnContextPrefix\}\$\{recentShotsBlock\}\$\{onCourseContextBlock\}/);
    expect(svBranch).not.toMatch(/SMARTVISION OPEN\][\s\S]*?\[\/SMARTVISION OPEN\][\s\S]*?\$\{turnContextPrefix\}\$\{onCourseContextBlock\}/);
  });
});
