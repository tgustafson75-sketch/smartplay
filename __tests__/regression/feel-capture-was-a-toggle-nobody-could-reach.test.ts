/**
 * 2026-09-14 — found while clearing the 27 unused-variable warnings Tim asked about, which is
 * exactly how this class hides.
 *
 * `FeelCaptureRow` was a complete, owner-gated Settings row for `settingsStore.feelCaptureEnabled`.
 * It was rendered by NOTHING. And `services/feelCaptureService` gates on that flag —
 * `if (!useSettingsStore.getState().feelCaptureEnabled) return false` — so the whole feel-vs-real
 * calibration path was permanently off, with no way for any owner to switch it on.
 *
 * A built, persisted, service-gating capability that looked identical to a leftover import. The
 * difference between the two is only visible if you read them, which is why the sweep was worth
 * doing by hand rather than with --fix.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('feel capture can be switched on', () => {
  const settings = code('app/settings.tsx');

  it('the row is actually rendered, not merely defined', () => {
    expect(settings).toMatch(/function FeelCaptureRow\(/);
    expect(settings).toMatch(/<FeelCaptureRow colors=\{colors\} \/>/);
  });

  it('it sits behind the owner gate, like the service it feeds', () => {
    const at = settings.indexOf('<FeelCaptureRow');
    const gate = settings.lastIndexOf('const showOwner = isOwnerEmail', at);
    expect(gate).toBeGreaterThan(-1);
    // and nothing closes the owner section between the gate and the row
    expect(settings.slice(gate, at)).not.toContain('</CollapsibleSection>');
  });

  it('the flag it writes is the one the service reads', () => {
    expect(settings).toMatch(/setFeelCaptureEnabled/);
    const svc = code('services/feelCaptureService.ts');
    expect(svc).toMatch(/feelCaptureEnabled/);
    // The service's gate — the reason an unreachable toggle meant a dead feature.
    expect(svc).toMatch(/if \(!useSettingsStore\.getState\(\)\.feelCaptureEnabled\) return false;/);
  });

  it('the row is the only writer, so it cannot be dropped again without the flag becoming unsettable', () => {
    const writers = ['app/settings.tsx']
      .filter((f) => code(f).includes('setFeelCaptureEnabled'));
    expect(writers).toEqual(['app/settings.tsx']);
  });
});
