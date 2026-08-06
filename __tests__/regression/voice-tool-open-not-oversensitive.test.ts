// 2026-08-06 (Tim — "if I say 'log an issue with smart vision' it OPENS smart vision; we're still too
// sensitive"). Bare tool-name opens must NOT fire when the utterance is clearly ABOUT the tool (logging an
// issue, a bug, a crash, feedback) — the tool name is an object, not a command. Explicit opens still work.
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

const tool = (t: string) => {
  const i = precheckLocalIntent(t);
  return i?.intent_type === 'open_tool' ? String(i?.parameters?.tool_name ?? '') : (i?.intent_type ?? null);
};

describe('tool-open precheck is not over-sensitive (offline)', () => {
  it('still opens on explicit commands', () => {
    expect(tool('open smartvision')).toBe('smartvision');
    expect(tool('smart vision')).toBe('smartvision');
    expect(tool('open smartfinder')).toBe('smartfinder');
    expect(tool('swing lab')).toBe('swinglab');
    expect(tool("what's the smart play")).toBe('smartplay');
    expect(tool('the smart play')).toBe('smartplay');
  });

  it('does NOT open when the utterance is about logging an issue / bug / crash', () => {
    for (const t of [
      'log an issue with smart vision',
      'report a bug in smartvision',
      'smartvision crashed',
      "smart vision isn't working",
      'give feedback on smart vision',
      'log an issue with swing lab',
      // 2026-08-06 (voice audit) — smartplay had a bare `the smart play` alt with no tool-guard.
      'log an issue with the smart play',
      'the smart play feature is broken',
    ]) {
      expect(tool(t)).not.toBe('smartvision');
      expect(tool(t)).not.toBe('swinglab');
      expect(tool(t)).not.toBe('smartplay');
    }
  });
});
