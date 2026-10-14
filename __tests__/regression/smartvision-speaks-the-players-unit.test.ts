/**
 * 2026-10-13 (SmartVision/GPS audit #9) — SmartVision's hole header was a hard-coded `${yardage}y` and the
 * yardage book printed raw yards: a metres player read yards on the two most-looked-at labels.
 */
import fs from 'fs';
import path from 'path';
const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('SmartVision speaks the player\'s unit', () => {
  it('the hole header converts', () => {
    const sv = read('app/smartvision.tsx');
    expect(sv).not.toMatch(/`PAR \$\{par\} · \$\{yardage\}y`/);
    expect(sv).toMatch(/`PAR \$\{par\} · \$\{formatDistanceCompact\(yardage, liveDistanceUnit\(\)\)\}`/);
  });
  it('the yardage book converts front and back', () => {
    const p = read('components/smartvision/YardageBookPanel.tsx');
    expect(p).not.toMatch(/F: \{r\.front\}  B: \{r\.back\}/);
    expect(p).toMatch(/toDisplayDistance\(r\.front, liveDistanceUnit\(\)\)/);
  });
});
