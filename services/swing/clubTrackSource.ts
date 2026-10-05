/**
 * 2026-10-04 (Tim: "Check if we can finally get the swing arc trace to finally work … we never have tracked
 * club head or shaft successfully" / "make sure we get this right. This is a primary function of the app")
 *
 * THE CLUBHEAD TRACKER — the source the hidden browser page (components/FrameEngineHost) runs, and the
 * same string jest evaluates, so what is tested is byte-for-byte what ships.
 *
 * Why it replaces /api/club-path: that asked a general vision model for the clubhead's pixel position in
 * 14 frames, and localisation of a small object is what such models are worst at — Tim's report read
 * "detected 2 of 14". This is classical computer vision anchored on what the app already measures well:
 *   - MOTION, frame against BOTH neighbours (1-3 frames apart): the club as it is in THIS frame, not
 *     its ghost; each pair's own compression-noise floor sets the threshold;
 *   - the BODY from the pose frames: the clubhead is at club length from the hands (or arm + club from
 *     the shoulders) along an unbroken moving SHAFT; head, torso, legs, below-the-feet shadows and the
 *     non-ball side at ground level are excluded;
 *   - one smooth PATH through the per-frame candidates (Viterbi), "not seen" being a real state, so a
 *     frame where the club is hidden behind the body stays empty instead of guessed.
 * Measured positions only (Tim's law) — never an interpolated or fabricated point.
 *
 * Desk-validated 2026-10-04 on Tim's 3870 (14.5s, 30fps) and swing6b (6s, 30fps): on the clubhead
 * through takeaway, top, impact and follow-through; no detections at address.
 */
export const CLUB_TRACK_JS = String.raw`/* Clubhead tracker — pure functions over decoded frames. Runs in the app's hidden browser engine
 * (components/FrameEngineHost) and in the desk test bench, unchanged.
 *
 * Input:
 *   frames:  [{ t (ms), w, h, luma: Uint8Array(w*h) }] — consecutive frames at the clip's own rate
 *   anchors: (t) => { hand:{x,y}, shoulder:{x,y}, hip:{x,y}, knee:{x,y}, ankleY, bodyH } | null  (pixels)
 * Output: [{ t, x, y, score } | null] per frame — MEASURED positions only; null where not seen.
 */
(function (root) {
  'use strict';

  var T_MOTION = 22;          // luma change that counts as motion
  var GAPS = [1, 2, 3];       // frame gaps: 1 for the fast downswing, 2-3 for the slow takeaway/finish

  // Compression noise and grass shimmer differ per clip and per frame pair: the threshold is set above
  // this pair's own noise floor (the 97th percentile of |difference| — most of the frame is static).
  function noiseFloor(A, B) {
    var hist = new Uint32Array(256), n = A.length, step = 7, c = 0;
    for (var p = 0; p < n; p += step) { hist[Math.abs(A[p] - B[p])]++; c++; }
    var target = c * 0.97, acc = 0;
    for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  }
  function motionMask(frames, i) {
    var f = frames[i], n = f.w * f.h, m = new Uint8Array(n);
    for (var g = 0; g < GAPS.length; g++) {
      var k = GAPS[g], a = frames[i - k], b = frames[i + k];
      // BOTH neighbours or nothing: with one side missing, a static frame edge reads as motion
      // (the caller decodes a few frames either side of the swing so its own edges are covered)
      if (!a || !b) continue;
      var L = f.luma, A = a ? a.luma : null, B = b ? b.luma : null;
      var T = Math.max(T_MOTION, 2 + Math.max(A ? noiseFloor(L, A) : 0, B ? noiseFloor(L, B) : 0));
      for (var p = 0; p < n; p++) {
        if (m[p]) continue;
        var da = A ? Math.abs(L[p] - A[p]) : 255, db = B ? Math.abs(L[p] - B[p]) : 255;
        // present NOW and not in either neighbour = the object at this frame, not its ghost
        if (da > T && db > T) m[p] = 1;
      }
    }
    return m;
  }

  function dilate(m, w, h) {
    var o = new Uint8Array(m.length);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var p = y * w + x;
      if (m[p] || m[p - 1] || m[p + 1] || m[p - w] || m[p + w] || m[p - w - 1] || m[p - w + 1] || m[p + w - 1] || m[p + w + 1]) o[p] = 1;
    }
    return o;
  }

  // Fraction of the hand→P line (its outer part: the shaft) that is moving.
  function shaftCoverage(md, w, hx, hy, px, py, from) {
    var dx = px - hx, dy = py - hy, len = Math.sqrt(dx * dx + dy * dy);
    var n = Math.max(6, Math.floor(len / 2)), hit = 0, tot = 0;
    for (var s = Math.floor(n * from); s <= n; s++) {
      var x = Math.round(hx + (dx * s) / n), y = Math.round(hy + (dy * s) / n);
      tot++; if (md[y * w + x]) hit++;
    }
    return tot ? hit / tot : 0;
  }

  // The clubhead is a BLOB at the end of the shaft: moving pixels around P, beyond it along the shaft.
  function headMass(m, w, h, hx, hy, px, py) {
    var c = 0, R = 4;
    for (var y = Math.max(0, py - R); y <= Math.min(h - 1, py + R); y++)
      for (var x = Math.max(0, px - R); x <= Math.min(w - 1, px + R); x++) if (m[y * w + x]) c++;
    return c / ((2 * R + 1) * (2 * R + 1));
  }

  function candidates(frames, i, an, clubLen) {
    var f = frames[i], w = f.w, h = f.h, m = motionMask(frames, i), md = dilate(m, w, h);
    var B = an.bodyH;
    // From the HANDS (club length) and from the SHOULDERS (arm + club): pose comes ~20 times a swing,
    // and through the downswing interpolated hands can be a hand-width off; the shoulders barely move,
    // and the moving arm + shaft chain from them reaches the head the same way.
    var fromHands = searchFrom(m, md, w, h, an, an.hand.x, an.hand.y,
      clubLen ? clubLen * 0.45 : B * 0.3, clubLen ? clubLen * 1.25 : B * 0.95, 0.2);
    var fromShoulders = searchFrom(m, md, w, h, an, an.shoulder.x, an.shoulder.y,
      clubLen ? clubLen * 0.9 : B * 0.5, clubLen ? clubLen * 1.5 : B * 1.3, 0.35);   // arm (~0.4 club) + club
    var all = fromHands.concat(fromShoulders);
    all.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    for (var k = 0; k < all.length && keep.length < 6; k++) {
      var c = all[k], dup = false;
      for (var j = 0; j < keep.length; j++) if (Math.hypot(c.x - keep[j].x, c.y - keep[j].y) < B * 0.08) { dup = true; break; }
      if (!dup) keep.push(c);
    }
    return keep;
  }

  function searchFrom(m, md, w, h, an, hx, hy, rMin, rMax, covFrom) {
    var B = an.bodyH, hy0 = an.hand.y;
    // body exclusions: legs/feet column below the hips, and everything below the ankles (shadows)
    var legX = an.hip.x, legHalf = B * 0.17, hipY = an.hip.y;
    // the head and torso move a lot and are never the clubhead
    // head: the nose is low on the head; the crown sits ~0.06 body-heights above it
    // (the nose is the FRONT of the head; seen down the line the skull sits behind it, over the shoulders)
    var nx = an.head ? an.head.x : an.shoulder.x, ny = an.head ? an.head.y : an.shoulder.y - B * 0.1;
    var hdX = (nx + an.shoulder.x) / 2, hdY = ny - B * 0.03, hdR = B * 0.2;
    var tx0 = Math.min(an.shoulder.x, an.hip.x) - B * 0.18, tx1 = Math.max(an.shoulder.x, an.hip.x) + B * 0.18;
    // hands up (backswing top, finish): the head cannot be down by the ground — that is its SHADOW
    var handsHigh = hy0 < an.shoulder.y + B * 0.1;
    var ty0 = an.shoulder.y - B * 0.1, ty1 = an.hip.y;   // from the neck down
    var out = [];
    for (var y = 0; y < h; y += 2) {
      // through impact the head is AT the ball, which from a raised camera sits a little below the
      // ankles in the picture; with the hands high a point down there can only be a shadow
      if (y > an.ankleY + (handsHigh ? -B * 0.05 : B * 0.12)) break;
      for (var x = 0; x < w; x += 2) {
        var p = y * w + x;
        if (!m[p]) continue;
        if (y > hipY && Math.abs(x - legX) < legHalf) continue;
        if ((x - hdX) * (x - hdX) + (y - hdY) * (y - hdY) < hdR * hdR) continue;
        if (x > tx0 && x < tx1 && y > ty0 && y < ty1) continue;
        if (handsHigh && y > hipY) continue;
        // at ground level the head can only be on the BALL side of the feet; the other side is a shadow
        if (an.ballSide && y > an.knee.y && (x - an.hip.x) * an.ballSide < -B * 0.05) continue;
        var dx = x - hx, dy = y - hy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < rMin || d > rMax) continue;
        var cov = shaftCoverage(md, w, hx, hy, x, y, covFrom);
        if (cov < 0.6) continue;
        var mass = headMass(m, w, h, hx, hy, x, y);
        // farther along a well-covered shaft, ending in a blob = the head
        out.push({ x: x, y: y, d: d, dh: Math.hypot(x - an.hand.x, y - an.hand.y), score: cov * cov * (0.5 + 0.5 * Math.min(1, d / rMax)) * (0.6 + 0.4 * mass) });
      }
    }
    // the outermost well-supported points along each direction (the shaft's END, not its middle)
    out.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    for (var k = 0; k < out.length && keep.length < 6; k++) {
      var c = out[k], near = false;
      for (var j = 0; j < keep.length; j++) {
        var q = keep[j], ang = Math.abs(Math.atan2(c.y - hy, c.x - hx) - Math.atan2(q.y - hy, q.x - hx));
        if (Math.min(ang, 2 * Math.PI - ang) < 0.25) { near = true; if (c.d > q.d && c.score > q.score * 0.8) { keep[j] = c; } break; }
      }
      if (!near) keep.push(c);
    }
    return keep;
  }

  // One smooth path through the per-frame candidates (Viterbi), with "not seen" as a real state.
  function bestPath(cands, bodyH) {
    var MISS = 1.2, n = cands.length;
    var cost = [], back = [];
    for (var i = 0; i < n; i++) {
      var cs = cands[i] || [], ci = [], bi = [];
      var states = cs.concat([null]);
      for (var s = 0; s < states.length; s++) {
        var st = states[s], emit = st ? -Math.log(Math.max(1e-3, st.score)) : MISS;
        if (i === 0) { ci.push(emit); bi.push(-1); continue; }
        var prev = (cands[i - 1] || []).concat([null]), best = Infinity, arg = 0;
        for (var r = 0; r < prev.length; r++) {
          var pr = prev[r], tr = 0;
          if (st && pr) {
            // the downswing moves the head ~1.6 body-heights in ONE frame at 30fps (Tim's 3870, top -> impact)
            var dd = Math.hypot(st.x - pr.x, st.y - pr.y) / (bodyH * 1.8);
            tr = dd * dd;
          }
          var v = cost[i - 1][r] + tr;
          if (v < best) { best = v; arg = r; }
        }
        ci.push(best + emit); bi.push(arg);
      }
      cost.push(ci); back.push(bi);
    }
    var path = new Array(n), last = cost[n - 1], idx = 0;
    for (var s2 = 1; s2 < last.length; s2++) if (last[s2] < last[idx]) idx = s2;
    for (var i2 = n - 1; i2 >= 0; i2--) {
      var states2 = (cands[i2] || []).concat([null]);
      path[i2] = states2[idx];
      idx = back[i2][idx];
    }
    return path;
  }

  function track(frames, anchorAt) {
    var ans = frames.map(function (f) { return anchorAt(f.t); });
    var a0 = ans.find(function (a) { return a; });
    var side = a0 ? Math.sign(a0.hand.x - a0.hip.x) : 0;
    ans.forEach(function (a) { if (a) a.ballSide = side; });
    var bodyH = 0, nb = 0;
    ans.forEach(function (a) { if (a) { bodyH += a.bodyH; nb++; } });
    bodyH = nb ? bodyH / nb : frames[0].h * 0.3;
    // pass 1: wide reach; club length = the typical hand→head distance of confident frames
    var c1 = frames.map(function (_, i) { return ans[i] ? candidates(frames, i, ans[i], 0) : []; });
    var p1 = bestPath(c1, bodyH), ds = [];
    p1.forEach(function (p) { if (p && p.score > 0.35) ds.push(p.dh); });
    ds.sort(function (a, b) { return a - b; });
    var clubLen = ds.length >= 4 ? ds[Math.floor(ds.length * 0.75)] : 0;
    // pass 2: reach scaled to THIS club
    var c2 = clubLen ? frames.map(function (_, i) { return ans[i] ? candidates(frames, i, ans[i], clubLen) : []; }) : c1;
    var p2 = clubLen ? bestPath(c2, bodyH) : p1;
    // a detection with no detection on either side is noise, not a club that appeared for 33ms
    p2 = p2.map(function (p, i) { return p && (p2[i - 1] || p2[i + 1]) ? p : null; });
    return {
      clubLen: clubLen,
      points: p2.map(function (p, i) { return p ? { t: frames[i].t, x: p.x, y: p.y, score: Math.round(p.score * 100) / 100 } : null; }),
    };
  }

  // The app's pose frames: [{ t, kp: { name: [x, y, score] } }], x/y NORMALISED to the frame. Returns
  // anchorAt(t) in pixels of a W x H working frame, interpolated between the pose frames either side.
  function anchorsFromPoses(poses, W, H) {
    var ps = (poses || []).filter(function (p) { return p && p.kp; }).sort(function (a, b) { return a.t - b.t; });
    function pick(p, names) {
      var sx = 0, sy = 0, n = 0;
      for (var i = 0; i < names.length; i++) { var k = p.kp[names[i]]; if (k && k[2] > 0.2) { sx += k[0]; sy += k[1]; n++; } }
      return n ? { x: sx / n * W, y: sy / n * H } : null;
    }
    function at1(p) {
      var hand = pick(p, ['left_wrist', 'right_wrist']), sh = pick(p, ['left_shoulder', 'right_shoulder']);
      var hip = pick(p, ['left_hip', 'right_hip']), knee = pick(p, ['left_knee', 'right_knee']);
      var la = p.kp.left_ankle, ra = p.kp.right_ankle, nose = pick(p, ['nose']);
      var ankleY = Math.max(la && la[2] > 0.2 ? la[1] * H : 0, ra && ra[2] > 0.2 ? ra[1] * H : 0);
      if (!hand || !sh || !hip || !ankleY) return null;
      var top = nose ? nose.y : sh.y - (hip.y - sh.y) * 0.45;
      return { hand: hand, shoulder: sh, hip: hip, knee: knee || { x: hip.x, y: (hip.y + ankleY) / 2 }, head: nose, ankleY: ankleY, bodyH: ankleY - top };
    }
    var A = ps.map(function (p) { return { t: p.t, a: at1(p) }; }).filter(function (x) { return x.a; });
    function lerpPt(u, v, f) { return u && v ? { x: u.x + (v.x - u.x) * f, y: u.y + (v.y - u.y) * f } : (u || v); }
    return function (t) {
      if (!A.length) return null;
      var j = 0; while (j < A.length && A[j].t < t) j++;
      var lo = A[Math.max(0, j - 1)], hi = A[Math.min(A.length - 1, j)];
      var f = hi.t === lo.t ? 0 : Math.min(1, Math.max(0, (t - lo.t) / (hi.t - lo.t)));
      var a = lo.a, b = hi.a;
      return {
        hand: lerpPt(a.hand, b.hand, f), shoulder: lerpPt(a.shoulder, b.shoulder, f), hip: lerpPt(a.hip, b.hip, f),
        knee: lerpPt(a.knee, b.knee, f), head: lerpPt(a.head, b.head, f),
        ankleY: a.ankleY + (b.ankleY - a.ankleY) * f, bodyH: a.bodyH + (b.bodyH - a.bodyH) * f,
      };
    };
  }

  root.ClubTrack = { track: track, anchorsFromPoses: anchorsFromPoses, _motionMask: motionMask, _candidates: candidates, _bestPath: bestPath };
})(typeof window !== 'undefined' ? window : globalThis);
`;
