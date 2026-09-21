/**
 * 2026-09-20 (Tim, from Echo Hills) — "I still had racing while I was playing."
 *
 * "Racing" is Tim's own word, from 2026-07-30: two spoken things competing. The speak queue handles
 * that correctly — one wins, the loser is dropped and logged as speak_superseded — and the 2026-09-01
 * pass added `preemptedBy` to that entry specifically so "the next field report names the surface
 * that cancelled".
 *
 * IT NAMED NOTHING. stopSpeaking defaults its reason to 'stop' and, of sixty call sites, exactly one
 * passed anything else. Tim's entry (speak_superseded, /caddie, hole 1, preemptedBy 'stop',
 * msSinceStop 276) therefore indicts every screen in the app equally.
 *
 * So every call site now names itself. The behaviour is deliberately unchanged — an unknown label
 * still degrades to 'stop' for the seven branches that test the reason — which is why this guards
 * the DIAGNOSTIC, not the dispatch. [[missing-log-entry-is-the-evidence]]
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.join(__dirname, '../..');
const voice = fs.readFileSync(path.join(ROOT, 'services/voiceService.ts'), 'utf8');

/** Every stopSpeaking call in app code, ignoring comments and the definition itself. */
function callSites(): { file: string; line: number; text: string }[] {
  const out = execFileSync('grep', [
    '-rn', 'stopSpeaking(', '--include=*.ts', '--include=*.tsx',
    'app', 'services', 'components', 'hooks', 'store',
  ], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean)
    .map((l) => {
      const m = l.match(/^([^:]+):(\d+):(.*)$/);
      return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
    })
    .filter((x): x is { file: string; line: number; text: string } => x != null)
    .filter((x) => !x.file.includes('__tests__'))
    .filter((x) => !/^\s*(\*|\/\/|\/\*)/.test(x.text))
    .filter((x) => !/export const stopSpeaking/.test(x.text));
}

describe('a cut line names who cut it', () => {
  it('there are call sites to check — never pass vacuously', () => {
    expect(callSites().length).toBeGreaterThanOrEqual(30);
  });

  it('no call site stops the caddie anonymously', () => {
    const bare = callSites().filter((c) => /stopSpeaking\(\s*\)/.test(c.text));
    expect(bare.map((c) => `${c.file}:${c.line}`)).toEqual([]);
  });

  it('the log keeps the caller label verbatim, while dispatch keeps the known seven', () => {
    // Dispatch is coerced to the known seven; the log keeps the caller's label.
    expect(voice).toMatch(/SPEECH_ID_REASONS\.includes\(why as SpeechIdReason\)/);
    expect(voice).toMatch(/claimSpeechId\(reason\);/);
    expect(voice).toMatch(/lastStopReason = isKnown \|\| isSurface \? why : 'stop';/);
    expect(voice).not.toMatch(/lastStopReason = reason;/);
  });

  it('a label that is not a label is refused, so a press event cannot become the reason', () => {
    /**
     * The 2026-09-09 sim scenario over this function exists partly to stop `onPress={stopSpeaking}`
     * recording a React press EVENT as the reason. Recording `why` verbatim would have handed that
     * object straight to the issue log, so the label is validated before it is kept — one of the
     * seven, or a well-formed `screen:` one. The widening found this, which is the argument for
     * widening a guard rather than deleting it.
     */
    expect(voice).toMatch(/\^screen:\[a-z0-9-\]\+\$/);
    expect(voice).toMatch(/typeof why === 'string'/);
  });

  it('the mic-open barge-in is distinguishable from a screen-level stop', () => {
    // The most likely author of a mid-round racing report, so it must not read as a generic stop.
    expect(voice).toMatch(/stopSpeaking\('screen:mic-open'\)/);
  });
});
