/**
 * 2026-09-03 — ONE embedded YouTube player, and it reports its own failures.
 *
 * Two screens embed YouTube — the drill video and the jukebox — and neither could tell you when the
 * video did not play.
 *
 *   • drill-video built an IFrame-API player and registered onReady + onStateChange but NO onError.
 *     YouTube's error codes are exactly the cases that matter: 100 (removed/private), 101 and 150
 *     (the owner disabled embedding), 2 (bad id), 5 (player failure). On any of them the player
 *     renders YouTube's own error inside the WebView, onReady never fires, nothing is posted back,
 *     and the screen sits on a black rectangle the player has to back out of.
 *   • jukebox loaded the raw `youtube.com/embed/<id>` URL, so there was no IFrame API at all and
 *     error events were not merely unhandled, they were impossible.
 *
 * Embedding-disabled is the live risk, not a hypothetical. The song search route already filters on
 * `videoEmbeddable: true`, so the jukebox is mostly protected by construction — but the 19 drill and
 * instructor video ids are HARDCODED and were never filtered by anything. All 19 are currently
 * playable (checked 2026-09-03), which is a fact about today rather than a property of the code: a
 * rights-holder can disable embedding at any time and the app would go black with no explanation.
 *
 * So the player says what happened, and the screens decide what to offer. One builder rather than
 * two, because the two copies had already drifted into different failure modes.
 * [[two-owners-is-the-root-cause]] [[caddie-failsafe-no-walls]]
 */

import { UIManager } from 'react-native';

/**
 * 2026-09-09 (Tim — "YouTube links for drills not showing") — IS THERE A NATIVE WEBVIEW?
 *
 * Both embedding screens answered this with `UIManager.getViewManagerConfig('RNCWebView')`, which is
 * the OLD ARCHITECTURE's question. app.json has had `newArchEnabled: true` since before this repo's
 * history begins, so the app runs bridgeless, and RN 0.81's BridgelessUIManager returns null from
 * getViewManagerConfig for every component unless the ViewConfig interop layer is on — its own error
 * text says "If you want to see if this component is registered with React Native, please call
 * hasViewManagerConfig() instead." react-native-webview 13.15.0 ships a Fabric component
 * (codegenConfig RNCWebViewSpec, type "all"), so the player IS there; the detector could not see it.
 *
 * The consequence was not a broken player, it was NO player: both screens read false, skipped the
 * WebView entirely and opened `youtube.com/embed/<id>` in the in-app browser, which YouTube serves as
 * "Video unavailable" outside an embedding page — then popped straight back. Watch a drill, land back
 * on the dashboard a second later. That is exactly the route trail in the 09-08 report.
 *
 * One exported answer instead of a constant copied into two screens: the two copies were already the
 * same bug twice. [[two-owners-is-the-root-cause]]
 */
export function hasNativeWebView(component?: unknown): boolean {
  /**
   * 2026-09-09 (triple-check pass, a defect in my own fix from an hour earlier).
   *
   * `hasViewManagerConfig` is present on BOTH UIManagers, but they do not fail the same way. Paper's
   * returns `getViewManagerConfig(name) != null` — safe. Bridgeless delegates to
   * `unstable_hasComponent`, which THROWS A BARE STRING when `global.__nativeComponentRegistry__hasComponent`
   * has not been installed yet:
   *
   *     throw `unstable_hasComponent('${'$'}{name}'): Global function is not registered`;
   *
   * Optional chaining guards a MISSING method, not a throwing one. Both callers evaluate this at
   * module scope, so a throw would escape module evaluation and take the whole route down — a white
   * screen, which is worse than the silent false it replaced.
   */
  try {
    const has = UIManager.hasViewManagerConfig?.('RNCWebView');
    if (typeof has === 'boolean') return has;
  } catch { /* registry global not installed yet — fall through to the direct check */ }
  /**
   * Undeterminable, so ask the definitive question instead: did the module actually hand us a
   * component? The screens import WebView statically from react-native-webview, so on a build that
   * linked it this is non-null, and on one that did not it is undefined and the in-app browser path
   * is correct. That is a fact about THIS build rather than a guess, and it cannot throw.
   */
  return component != null;
}

/** What the WebView posts back. Anything unrecognised is ignored by the caller. */
export type PlayerMessage =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'error'; code: number; reason: string };

/** YouTube IFrame API error codes, in the words a player should hear. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return 'This video link looks wrong, so it could not be opened.';
    case 5:
      return 'This device could not play this video.';
    case 100:
      return 'This video has been removed or made private by whoever posted it.';
    case 101:
    case 150:
      // By far the most likely of the five, and the one that needs the YouTube hand-off.
      return 'The owner of this video does not allow it to play inside other apps.';
    default:
      return 'This video could not be played.';
  }
}

/** True when the video exists but simply refuses to play embedded — worth offering YouTube itself. */
export function isEmbedBlocked(code: number): boolean {
  return code === 101 || code === 150;
}

/**
 * The player document. `onError` is the whole point of this file existing; onReady and onStateChange
 * were already there and are carried across unchanged.
 */
export function youtubePlayerHtml(videoId: string): string {
  // Only ever an 11-char YouTube id reaches here, but this is interpolated into a script tag, so it
  // is stripped rather than trusted. A malformed id becomes a code-2 error, which now has a message.
  const safeId = String(videoId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{width:100%;height:100%}</style></head>
<body><div id="p"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
  var post = function(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m); };
  // If the API script itself never loads (no network inside the WebView), nothing would ever be
  // posted and the screen would hang exactly as it did before. Report that as a player failure.
  var ready = false;
  setTimeout(function(){ if(!ready) post('error:5'); }, 12000);
  function onYouTubeIframeAPIReady(){
    new YT.Player('p', {
      videoId: '${safeId}',
      playerVars: { rel:0, modestbranding:1, playsinline:1, autoplay:1, fs:1 },
      events: {
        onReady: function(){ ready = true; post('ready'); },
        onStateChange: function(e){ if(e.data === 0){ post('ended'); } },
        onError: function(e){ ready = true; post('error:' + (e && e.data != null ? e.data : 0)); }
      }
    });
  }
</script></body></html>`;
}

/** Parse a WebView message into something a screen can switch on. Never throws. */
export function parsePlayerMessage(raw: unknown): PlayerMessage | null {
  const s = typeof raw === 'string' ? raw : '';
  if (s === 'ready') return { kind: 'ready' };
  if (s === 'ended') return { kind: 'ended' };
  if (s.startsWith('error:')) {
    const code = Number(s.slice(6));
    const n = Number.isFinite(code) ? code : 0;
    return { kind: 'error', code: n, reason: describePlayerError(n) };
  }
  return null;
}
