/**
 * 2026-09-09 — the YouTube drill videos never played, and it was never the player's fault.
 *
 * /drill-video and /jukebox both gated their <WebView> on
 *
 *     const HAS_NATIVE_WEBVIEW = !!UIManager.getViewManagerConfig?.('RNCWebView');
 *
 * written 2026-06-13 for a real but temporary condition — an OTA JS update landing on an installed
 * APK that predated react-native-webview. It has been permanently FALSE since, for a reason that
 * has nothing to do with whether the WebView is present:
 *
 *   app.json sets newArchEnabled: true, and RN 0.81 New Architecture is bridgeless-only. In
 *   bridgeless mode `UIManager` is BridgelessUIManager, whose getViewManagerConfig returns null
 *   (and console.errors) unless the legacy ViewConfig interop layer is enabled — nothing in this
 *   repo enables it. It could not have helped regardless: react-native-webview 13.15 registers
 *   RNCWebView via codegenNativeComponent, i.e. the Fabric registry, which legacy view-manager
 *   constants never see. hasViewManagerConfig() is the bridgeless equivalent; getViewManagerConfig()
 *   cannot answer this question at all.
 *
 * Consequence: every tap fell through to an in-app browser on the bare embed URL and popped the
 * screen. No IFrame API, so no 'ended' event, no watch points, and on /drill-video the entire deck —
 * instructor line, "Try this drill in Smart Motion" — never rendered. THREE rounds of fixes went
 * into the player document (onError, the 12s no-API timeout, one shared builder) and none of them
 * ever executed, because the WebView was never mounted. That is why the tests all passed.
 *
 * The guard never protected anything either: react-native-webview is imported statically at the top
 * of both screens, so a build without it fails at module load, not at render.
 *
 * This test is the gate the player HTML tests could not be — they proved the document was correct,
 * not that anything rendered it.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const SCREENS = ['app/drill-video.tsx', 'app/jukebox.tsx'] as const;

/** Strip block and line comments so the archaeology above doesn't satisfy its own assertions. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the embedded YouTube player is actually mounted', () => {
  it.each(SCREENS)('%s renders a WebView', (rel) => {
    expect(code(read(rel))).toContain('<WebView');
  });

  it.each(SCREENS)('%s does not gate the player on a legacy view-manager lookup', (rel) => {
    // getViewManagerConfig is a Paper API. Under bridgeless it returns null for every name, so any
    // reintroduction of it here is a player that renders on no build at all.
    expect(code(read(rel))).not.toContain('getViewManagerConfig');
    expect(code(read(rel))).not.toContain('HAS_NATIVE_WEBVIEW');
  });

  it.each(SCREENS)('%s has no in-app-browser fallback left to swallow the video', (rel) => {
    // The fallback opened youtube.com/embed top-level in a Custom Tab and immediately popped the
    // screen. It cannot report a completed watch, so it cannot be the path a drill video takes.
    expect(code(read(rel))).not.toContain('WebBrowser.openBrowserAsync');
  });

  it('the WebView is configured so YouTube can autoplay inline rather than demand a tap', () => {
    for (const rel of SCREENS) {
      const src = code(read(rel));
      expect(src).toContain('allowsInlineMediaPlayback');
      expect(src).toContain('mediaPlaybackRequiresUserAction={false}');
      expect(src).toContain('javaScriptEnabled');
      // The IFrame API needs a real origin; html-with-baseUrl gives it one.
      expect(src).toContain("baseUrl: 'https://www.youtube.com'");
    }
  });

  it('the drill deck is tied to the video, not to the vanished native-webview probe', () => {
    // The "Try this drill in Smart Motion" handoff is the point of the video->drill loop. It was
    // gated on the same permanently-false constant, so it never appeared.
    const src = code(read('app/drill-video.tsx'));
    expect(src).toContain('{videoId && (');
  });
});
