/**
 * 2026-09-08 (Tim — "YouTube links for drills not showing").
 *
 * The drill player and the jukebox each asked `UIManager.getViewManagerConfig('RNCWebView')` to find
 * out whether a native WebView existed. That is the OLD architecture's question. app.json sets
 * `newArchEnabled: true`, so the app runs bridgeless, and RN 0.81's BridgelessUIManager returns null
 * from getViewManagerConfig for EVERY component unless the ViewConfig interop layer is on. Its own
 * error text points at the replacement: "please call hasViewManagerConfig() instead."
 *
 * So both screens concluded there was no player — on a build that ships one — skipped the WebView and
 * opened `youtube.com/embed/<id>` in the in-app browser, which YouTube refuses to serve outside an
 * embedding page, then popped straight back to where you came from.
 *
 * The failure is silent and total, which is why it needs a gate rather than a comment: nothing throws
 * and nothing logs, the feature is simply never reached.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'hooks', 'services'];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('component presence is asked in a way the new architecture can answer', () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(path.join(root, d)));

  it('the app is actually on the new architecture', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    expect(appJson.expo.newArchEnabled).toBe(true);
  });

  /** Comments are stripped first: the fix's own note quotes the broken call to explain it. */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('THE CLASS: nothing gates a feature on getViewManagerConfig', () => {
    const offenders = files
      .filter((f) => /\.getViewManagerConfig\s*[?.(]/.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(offenders).toEqual([]);
  });

  /**
   * 2026-09-09 (triple-check) — a defect in the fix above, found by reading RN's source rather than
   * trusting the API name. Bridgeless `hasViewManagerConfig` delegates to `unstable_hasComponent`,
   * which THROWS A BARE STRING when the native component registry global is not installed yet.
   * Optional chaining guards a missing method, not a throwing one — and both screens call this at
   * MODULE SCOPE, so an escape would fail module evaluation and white-screen the whole route.
   */
  it('the detector cannot throw, and says so in code', () => {
    const embed = fs.readFileSync(path.join(root, 'services/youtubeEmbed.ts'), 'utf8');
    const fn = embed.slice(embed.indexOf('export function hasNativeWebView'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/try\s*\{[\s\S]*hasViewManagerConfig[\s\S]*\}\s*catch/);
    // And when it cannot answer, it must NOT answer `false` — that is the original bug returning.
    expect(body).toContain('return component != null;');
    expect(body).not.toMatch(/catch[\s\S]{0,80}return false/);
  });

  it('both screens hand it the component, so the fallback is a fact not a guess', () => {
    for (const screen of ['app/drill-video.tsx', 'app/jukebox.tsx']) {
      const src = fs.readFileSync(path.join(root, screen), 'utf8');
      expect(src).toContain('hasNativeWebView(WebView)');
      expect(src).toMatch(/import \{ WebView[^}]*\} from 'react-native-webview'/);
    }
  });

  it('there is ONE owner of the WebView answer, and both screens use it', () => {
    const embed = fs.readFileSync(path.join(root, 'services/youtubeEmbed.ts'), 'utf8');
    expect(embed).toContain('hasViewManagerConfig');
    for (const screen of ['app/drill-video.tsx', 'app/jukebox.tsx']) {
      const src = fs.readFileSync(path.join(root, screen), 'utf8');
      expect(src).toContain('hasNativeWebView');
      expect(stripComments(src)).not.toContain('getViewManagerConfig');
    }
  });
});
