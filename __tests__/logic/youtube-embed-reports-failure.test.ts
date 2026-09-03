/**
 * 2026-09-03 — the embedded YouTube players could not tell you when a video did not play.
 *
 * drill-video built an IFrame-API player with onReady + onStateChange but NO onError, so codes 100
 * (removed/private) and 101/150 (owner disallows embedding) rendered YouTube's own error inside the
 * WebView, posted nothing back, and left a black rectangle. jukebox loaded the raw embed URL, so
 * error events were not merely unhandled — they were impossible.
 *
 * The 19 drill/instructor video ids are HARDCODED and nothing filters them for embeddability. All 19
 * were playable when checked, which is a fact about that day rather than a property of the code.
 */
import {
  youtubePlayerHtml,
  parsePlayerMessage,
  describePlayerError,
  isEmbedBlocked,
} from '../../services/youtubeEmbed';

describe('youtubePlayerHtml', () => {
  it('registers an onError handler — the whole reason this exists', () => {
    const html = youtubePlayerHtml('cJa4lQ5_ZnQ');
    expect(html).toContain('onError');
    expect(html).toContain("post('error:'");
  });

  it('still reports ready and ended', () => {
    const html = youtubePlayerHtml('cJa4lQ5_ZnQ');
    expect(html).toContain("post('ready')");
    expect(html).toContain("post('ended')");
  });

  it('reports a failure when the IFrame API never loads at all', () => {
    // No network inside the WebView posts nothing and hangs exactly as before; the timeout is what
    // turns "silent forever" into a message.
    expect(youtubePlayerHtml('cJa4lQ5_ZnQ')).toMatch(/setTimeout\(function\(\)\{ if\(!ready\) post\('error:5'\); \}, 12000\)/);
  });

  it('strips anything that is not a youtube id before interpolating it into a script', () => {
    // This value is interpolated straight into a <script>, so it is filtered rather than trusted.
    // Only [A-Za-z0-9_-] survives — the quote, parens, semicolons and slashes that would close the
    // string and start a new statement are all removed, so the payload collapses to inert text.
    const html = youtubePlayerHtml("abc'); alert(1); //" as string);
    expect(html).not.toContain('alert(1)');
    // Scope the break-out check to the interpolated line: "');" occurs legitimately elsewhere in
    // the template (post('ready');), so asserting on the whole document proves nothing.
    const idLine = /videoId: '([^']*)'/.exec(html);
    expect(idLine).not.toBeNull();
    expect(idLine![1]).toMatch(/^[A-Za-z0-9_-]*$/);
    // A mangled id then fails as YouTube code 2, which has a message rather than a black screen.
    expect(describePlayerError(2)).toMatch(/link looks wrong/i);
  });
});

describe('parsePlayerMessage', () => {
  it('reads the three real messages and ignores noise', () => {
    expect(parsePlayerMessage('ready')).toEqual({ kind: 'ready' });
    expect(parsePlayerMessage('ended')).toEqual({ kind: 'ended' });
    expect(parsePlayerMessage('error:150')).toMatchObject({ kind: 'error', code: 150 });
    expect(parsePlayerMessage('something else')).toBeNull();
    expect(parsePlayerMessage(undefined)).toBeNull();
    expect(parsePlayerMessage(42)).toBeNull();
  });

  it('never throws on a malformed error code', () => {
    expect(parsePlayerMessage('error:')).toMatchObject({ kind: 'error', code: 0 });
    expect(parsePlayerMessage('error:abc')).toMatchObject({ kind: 'error', code: 0 });
  });
});

describe('describePlayerError', () => {
  it('names embedding-disabled as the owner’s choice, not our failure', () => {
    for (const code of [101, 150]) {
      expect(describePlayerError(code)).toMatch(/does not allow it to play inside other apps/i);
      expect(isEmbedBlocked(code)).toBe(true);
    }
  });

  it('distinguishes removed from blocked, because the remedies differ', () => {
    expect(describePlayerError(100)).toMatch(/removed or made private/i);
    // A removed video has no YouTube fallback worth offering.
    expect(isEmbedBlocked(100)).toBe(false);
  });

  it('always says something, even for a code YouTube has not documented', () => {
    expect(describePlayerError(999).length).toBeGreaterThan(0);
  });
});
