/**
 * 2026-10-03 — the page behind services/frameEngine: a hidden WebView that seeks a <video> to an exact
 * time and posts the drawn frame back. Android only — iOS's native thumbnails are already exact.
 * Mounted once in app/_layout but renders nothing until the first frame request; invisible and untouchable.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  attachFrameEngine, detachFrameEngine, onFrameEngineMessage, resetFrameEngine, subscribeFrameEngine, frameEngineState,
} from '../services/frameEngine';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<canvas id="c"></canvas>
<script>
(function () {
  var post = function (o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); };
  // Every step is bounded HERE, so one stalled seek or load can never wedge the queue behind it.
  function within(p, ms, what) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error(what + ' timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  var v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  document.body.appendChild(v);
  var c = document.getElementById('c');
  var cur = null, idle = null;
  // Separate queues: a slow pose runtime load must never make frame grabs time out behind it.
  var frameQ = Promise.resolve(), poseQ = Promise.resolve();
  function release() { cur = null; v.removeAttribute('src'); try { v.load(); } catch (e) {} }
  function load(src) {
    return new Promise(function (res, rej) {
      if (cur === src && v.readyState >= 1) return res();
      cur = src;
      v.onloadedmetadata = function () { res(); };
      v.onerror = function () { cur = null; rej(new Error('load ' + (v.error && v.error.code))); };
      v.src = src; v.load();
    });
  }
  function seek(t) {
    return new Promise(function (res, rej) {
      var done = false;
      var finish = function () { if (done) return; done = true; v.removeEventListener('seeked', onSeeked); v.removeEventListener('error', onErr); res(); };
      var onErr = function () { if (done) return; done = true; rej(new Error('seek error')); };
      var onSeeked = function () {
        // Draw the frame the seek presented; don't wait long for the compositor on a hidden view.
        if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(function () { finish(); }); setTimeout(finish, 120); }
        else finish();
      };
      v.addEventListener('seeked', onSeeked);
      v.addEventListener('error', onErr);
      if (Math.abs(v.currentTime - t) < 0.0005) { v.currentTime = t + 0.001; } else { v.currentTime = t; }
    });
  }
  window.__grab = function (id, src, tMs, maxDim) {
    if (idle) { clearTimeout(idle); idle = null; }
    frameQ = frameQ.then(function () {
      return within(load(src), 5000, 'load').then(function () {
        var dur = v.duration;
        // Past the end is an ERROR, exactly like the native retriever: callers find a clip's length
        // by asking for frames at 8s / 15s / 30s and seeing which ones fail.
        if (isFinite(dur) && tMs / 1000 > dur + 0.05) throw new Error('past end');
        var t = Math.min(Math.max(0, tMs / 1000), isFinite(dur) ? Math.max(0, dur - 0.02) : tMs / 1000);
        return within(seek(t), 4000, 'seek');
      }).then(function () {
        var w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) throw new Error('no video size');
        var s = Math.min(1, maxDim / Math.max(w, h));
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        var url = c.toDataURL('image/jpeg', 0.85);
        post({ type: 'frame', id: id, ok: true, b64: url.slice(url.indexOf(',') + 1), w: c.width, h: c.height });
      }).catch(function (e) {
        post({ type: 'frame', id: id, ok: false, error: String(e && e.message || e) });
      }).then(function () {
        // Let go of the decoder and the file a few seconds after the last grab.
        if (idle) clearTimeout(idle);
        idle = setTimeout(release, 8000);
      });
    });
  };
  // 2026-10-03 — pose, in the browser, for when the phone's native engine fails (a GPU delegate that
  // builds and then rejects every frame). Same model file the native module uses, read from the APK.
  var landmarker = null, loading = null;
  function readAsset(path) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest(); x.open('GET', path, true); x.responseType = 'arraybuffer';
      x.onload = function () { (x.status === 0 || x.status === 200) && x.response ? res(new Uint8Array(x.response)) : rej(new Error('asset ' + x.status)); };
      x.onerror = function () { rej(new Error('asset read failed')); };
      x.send();
    });
  }
  function ensurePose() {
    if (landmarker) return Promise.resolve(landmarker);
    if (loading) return loading;
    loading = within(import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'), 25000, 'pose runtime').then(function (mp) {
      return Promise.all([
        within(mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'), 25000, 'pose wasm'),
        readAsset('file:///android_asset/mediapipe/pose_landmarker_full.task'),
      ]).then(function (r) {
        return mp.PoseLandmarker.createFromOptions(r[0], {
          baseOptions: { modelAssetBuffer: r[1], delegate: 'CPU' },
          runningMode: 'IMAGE', numPoses: 1,
          minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
      });
    }).then(function (l) { landmarker = l; return l; }, function (e) { loading = null; throw e; });
    return loading;
  }
  window.__pose = function (id, b64) {
    poseQ = poseQ.then(function () {
      return ensurePose().then(function (l) {
        return within(new Promise(function (res, rej) {
          var img = new Image();
          img.onload = function () { res(img); };
          img.onerror = function () { rej(new Error('image decode')); };
          img.src = 'data:image/jpeg;base64,' + b64;
        }), 4000, 'image').then(function (img) {
          var t0 = Date.now();
          var r = l.detect(img);
          var lm = (r.landmarks && r.landmarks[0]) || [];
          post({ type: 'pose', id: id, ok: true, ms: Date.now() - t0,
            landmarks: lm.map(function (p) { var vis = p.visibility == null ? 1 : p.visibility; return { x: p.x, y: p.y, z: p.z, visibility: vis, presence: p.presence == null ? vis : p.presence }; }) });
        });
      }).catch(function (e) {
        post({ type: 'pose', id: id, ok: false, error: String(e && e.message || e) });
      });
    });
  };
  post({ type: 'ready' });
})();
</script></body></html>`;

export function FrameEngineHost(): React.ReactElement | null {
  const ref = useRef<WebView>(null);
  const [{ wanted, generation }, setState] = useState(frameEngineState);
  useEffect(() => subscribeFrameEngine(() => setState(frameEngineState())), []);
  useEffect(() => () => detachFrameEngine(), []);
  const onLoadEnd = useCallback(() => {
    attachFrameEngine((js) => ref.current?.injectJavaScript(js));
  }, []);
  const onMessage = useCallback((e: WebViewMessageEvent) => onFrameEngineMessage(e.nativeEvent.data), []);
  // A killed or crashed renderer: fail what is pending and come back with a fresh page (the remount
  // below keys on `generation`). Without this, injections went into a dead view and every request
  // waited out its timeout.
  const onGone = useCallback(() => resetFrameEngine('renderer gone'), []);
  if (Platform.OS !== 'android' || !wanted) return null;
  return (
    <View pointerEvents="none" style={styles.host}>
      <WebView
        key={generation}
        ref={ref}
        source={{ html: PAGE, baseUrl: 'file:///' }}
        originWhitelist={['*']}
        javaScriptEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mediaPlaybackRequiresUserAction={false}
        onLoadEnd={onLoadEnd}
        onMessage={onMessage}
        onRenderProcessGone={onGone}
        onContentProcessDidTerminate={onGone}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 2, height: 2, left: -10, top: -10, opacity: 0 },
  web: { width: 2, height: 2, backgroundColor: 'transparent' },
});
