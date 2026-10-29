/**
 * 2026-10-16 — voice seam review of the parallel fixes. Each fixer verified its own change; these are
 * the places where two met.
 *
 * The caddie-tab hook (hooks/useVoiceCaddie) cannot load under jest (native imports), so its cases
 * are structural checks over comment-stripped source; the brain-call cases are behavioural.
 */
import * as fs from 'fs';
import * as path from 'path';

const code = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the caddie-tab pre-round shortcut', () => {
  const v = code('hooks/useVoiceCaddie.ts');
  // 2026-10-28 (Brain review r5) — the shortcut moved to services/tabPreRoundShortcut (the hook still
  // dispatches on it); its order guard is pinned behaviourally in a-sentence-about-a-round-does-not-start-one.
  const fn = code('services/tabPreRoundShortcut.ts');
  it('the hook still runs the shortcut, from the moved owner', () => {
    expect(v).toMatch(/const shortcut = tabPreRoundShortcut\(transcript,/);
    expect(v).not.toMatch(/function buildPreRoundShortcutIntent\(/);
  });

  it('THE BUG: a question never becomes a shortcut ("What should I hit here?" went silent)', () => {
    expect(fn).toMatch(/if \(!cleaned\) return null;\s*if \(isNotACommand\(transcript\)\) return null;/);
    expect(fn).not.toMatch(/'what should i hit'/);
  });

  it('a tool open the handler declines falls through to the caddie instead of ending the turn', () => {
    expect(v).toMatch(/const declined = \(result as \{ route_to_brain\?: boolean \}\)\.route_to_brain === true && !result\.voice_response && !result\.tool_action;\s*if \(!declined\) \{/);
    // ...and cannot fall into the quick-round handler on the way.
    expect(v).toMatch(/if \(shortcut\.intent_type === 'quick_round'\) \{\s*const result = await quickRoundHandler\.execute/);
  });

  it('loose phrases that read as commands are gone', () => {
    expect(fn).not.toMatch(/aliases: \[[^\]]*'coach'[,\]]/);
    expect(fn).not.toMatch(/"let's play",/);
    expect(fn).not.toMatch(/'another round',/);
  });

  it('a mic the app opened that nobody answered stays silent when its upload fails', () => {
    const offline = v.slice(v.indexOf('const failTranscribeOffline = async'), v.indexOf('const failTranscribeOffline = async') + 2500);
    expect(offline.indexOf('if (opts?.quietIfEmpty)')).toBeGreaterThan(-1);
    expect(offline.indexOf('if (opts?.quietIfEmpty)')).toBeLessThan(offline.indexOf('Vibration.vibrate'));
    expect(v).toMatch(/recordVoiceEndpointFailure\('transcribe'\);\s*if \(opts\?\.quietIfEmpty\)/);
  });
});

describe('the brain call', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
  });
  afterEach(() => { global.fetch = realFetch; jest.dontMock('../../services/featureAccess'); });

  it('THE BUG: an ALREADY-aborted signal makes no call (a shushed turn\'s retry was billed)', async () => {
    const f = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: 'x' }) }));
    global.fetch = f as unknown as typeof fetch;
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await askCaddie({ message: 'what club', language: 'en', timeoutMs: 5_000, signal: ctrl.signal })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('re-review: an aborted turn is refused before the plan gate (no paywall raised for a shushed turn)', async () => {
    const gate = jest.fn(() => true);
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: gate, takeCaddiePaywallBlock: () => null }));
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    const ctrl = new AbortController();
    ctrl.abort();
    await askCaddie({ message: 'x', language: 'en', timeoutMs: 1000, signal: ctrl.signal });
    expect(gate).not.toHaveBeenCalled();
  });

  it('any answer from our server retires a cached "no internet" verdict', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: 'x', error: 'boom', errorType: 'Error' }) })) as unknown as typeof fetch;
    const conn = require('../../store/connectivityStore') as typeof import('../../store/connectivityStore');
    const spy = jest.spyOn(conn, 'reportOnline');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    await askCaddie({ message: 'what club', language: 'en', timeoutMs: 5_000 });
    expect(spy).toHaveBeenCalled();
  });

  it('the earbud does not retry a turn that was shushed', () => {
    // 2026-10-28 (Brain review F7) — nor one the phone itself timed out (that turn is still billed).
    expect(code('services/listeningSession.ts')).toMatch(/if \(!chatSpoken && live\(\) && !firstTimedOut\) try \{/);
  });
});
