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
  var cur = null, idle = null, queued = 0, cancelled = {};
  // 2026-10-04 (sweep) — the app times a job from when it STARTS here, not from when it was queued: a grab
  // waiting behind a motion pass used to time out and reset the whole page (killing the motion pass too).
  function begin(id) { if (idle) { clearTimeout(idle); idle = null; } post({ type: 'start', id: id }); }
  // Release the decoder only when nothing is queued — a release armed by the previous job used to fire
  // in the middle of a motion pass and turn its remaining seeks into timeouts.
  function settle() { queued--; if (idle) clearTimeout(idle); idle = queued > 0 ? null : setTimeout(release, 8000); }
  window.__cancel = function (id) { cancelled[id] = true; };
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
    queued++;
    frameQ = frameQ.then(function () {
      begin(id);
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
      }).then(settle);
    });
  };
  // 2026-10-03 (Tim: "can the web be used instead?") — the web SmartMotion's motion window, ported
  // from smartmotion/src/lib/frames.ts findMotionWindow. Finds the swing by LOCALISED MOTION between
  // tiny blurred frames (128x72) — no pose — and takes the LAST substantial event, because people press
  // record, set up, swing, and stop. Seconds, where locating with pose cost 10-20s.
  var PW = 128, PH = 72, GRID = 8;
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function blur(src, w, h) {
    var out = new Float32Array(src.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var sum = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) { var yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (var dx = -1; dx <= 1; dx++) { var xx = x + dx; if (xx < 0 || xx >= w) continue; sum += src[yy * w + xx]; n++; } }
      out[y * w + x] = sum / n;
    }
    return out;
  }
  function cellDiffs(a, b, w, h) {
    var cells = [], cw = Math.floor(w / GRID), ch = Math.floor(h / GRID);
    for (var gy = 0; gy < GRID; gy++) for (var gx = 0; gx < GRID; gx++) {
      var sum = 0, n = 0;
      for (var y = gy * ch; y < (gy + 1) * ch; y++) for (var x = gx * cw; x < (gx + 1) * cw; x++) { sum += Math.abs(a[y * w + x] - b[y * w + x]); n++; }
      cells.push(n ? sum / n : 0);
    }
    return cells;
  }
  window.__motion = function (id, src) {
    if (idle) { clearTimeout(idle); idle = null; }
    queued++;
    frameQ = frameQ.then(function () {
      begin(id);
      return within(load(src), 5000, 'load').then(function () {
        var dur = v.duration;
        if (!isFinite(dur) || dur <= 0) throw new Error('no duration');
        var count = Math.max(12, Math.min(44, Math.round(dur / 0.35)));
        var cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
        var cx = cv.getContext('2d', { willReadFrequently: true });
        var times = [], energy = [], prev = null, i = 0;
        function step() {
          if (i >= count) return Promise.resolve();
          if (cancelled[id]) return Promise.reject(new Error('cancelled'));
          var t = Math.min((dur * i) / (count - 1), Math.max(0, dur - 0.05)); i++;
          return within(seek(t), 4000, 'seek').then(function () {
            cx.drawImage(v, 0, 0, PW, PH);
            var d = cx.getImageData(0, 0, PW, PH).data, px = PW * PH, luma = new Float32Array(px);
            for (var k = 0; k < px; k++) { var o = k * 4; luma[k] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]; }
            var sm = blur(luma, PW, PH);
            if (prev) { var cells = cellDiffs(sm, prev, PW, PH); times.push(t); energy.push(Math.max(0, Math.max.apply(null, cells) - median(cells))); }
            prev = sm;
          }, function () { /* a failed probe leaves a gap */ }).then(step);
        }
        return step().then(function () {
          var out = { type: 'motion', id: id, ok: true, durationMs: Math.round(dur * 1000), window: null, bursts: [] };
          if (energy.length < 3) return post(out);
          var peak = Math.max.apply(null, energy), base = median(energy);
          // 2026-10-03 — BURSTS: distinct short peaks of motion (stricter floor than the window below), so
          // a busy clip (wind, setup, the swing, turning to watch) still yields candidates the app can
          // check with a couple of pose reads each. The swing is the burst where the hands go up.
          var bfloor = Math.max(base * 1.25, peak * 0.55), blo = -1;
          for (var b = 0; b <= energy.length; b++) {
            var on = b < energy.length && energy[b] >= bfloor;
            if (on && blo === -1) blo = b;
            if (!on && blo !== -1) {
              var bpk = blo; for (var bb = blo; bb < b; bb++) if (energy[bb] > energy[bpk]) bpk = bb;
              out.bursts.push({ startMs: Math.round((blo > 0 ? times[blo - 1] : 0) * 1000), endMs: Math.round(times[b - 1] * 1000), peakMs: Math.round(times[bpk] * 1000), peak: Math.round(energy[bpk] * 10) / 10 });
              blo = -1;
            }
          }
          if (peak < 1.5 || peak < base * 1.8) return post(out);
          var floor = Math.max(base, peak * 0.35), events = [], lo = -1;
          for (var j = 0; j < energy.length; j++) {
            if (energy[j] >= floor) { if (lo === -1) lo = j; }
            else if (lo !== -1) { events.push({ lo: lo, hi: j - 1, peak: Math.max.apply(null, energy.slice(lo, j)) }); lo = -1; }
          }
          if (lo !== -1) events.push({ lo: lo, hi: energy.length - 1, peak: Math.max.apply(null, energy.slice(lo)) });
          if (!events.length) return post(out);
          var sub = events.filter(function (e) { return e.peak >= peak * 0.25; });
          var ch = sub.length ? sub[sub.length - 1] : events[events.length - 1];
          var rawStart = ch.lo > 0 ? times[ch.lo - 1] : 0, rawEnd = times[ch.hi];
          var pad = Math.max(0.25, (rawEnd - rawStart) * 0.4);
          var st = Math.max(0, rawStart - pad);
          var en = Math.min(dur, rawEnd + pad >= dur - 0.5 ? dur : rawEnd + pad);
          // Where in the event the motion peaked — the downswing — as a hint for impact.
          var pk = ch.lo; for (var q = ch.lo; q <= ch.hi; q++) if (energy[q] > energy[pk]) pk = q;
          if (en - st < dur * 0.92) out.window = { startMs: Math.round(st * 1000), endMs: Math.round(en * 1000), peakMs: Math.round(times[pk] * 1000) };
          post(out);
        });
      }).catch(function (e) {
        post({ type: 'motion', id: id, ok: false, error: String(e && e.message || e) });
      }).then(function () { delete cancelled[id]; settle(); });
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
      post({ type: 'start', id: id });
      // A failed LOAD (runtime, wasm, model) is tagged so the app remembers it; a bad frame is not.
      return ensurePose().catch(function (e) { throw new Error('pose load: ' + String(e && e.message || e)); }).then(function (l) {
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
  // 2026-10-04 (sweep) — clear exact frames / private clip copies a killed session left in the cache.
  // Deferred so it never competes with launch; every platform (the clip copies exist on iOS too).
  useEffect(() => {
    const t = setTimeout(() => {
      void (require('../utils/videoThumbnail') as typeof import('../utils/videoThumbnail')).sweepOrphanFrameFiles();
    }, 10_000);
    return () => clearTimeout(t);
  }, []);
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
