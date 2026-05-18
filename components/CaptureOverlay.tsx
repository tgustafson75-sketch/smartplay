/**
 * Phase 110-followup — Round-side capture surface.
 *
 * Subscribes to mediaCapture for the 'shot' kind. When a voice command
 * fires (e.g. "record this shot"), this overlay:
 *   1. Spins up CameraView full-screen
 *   2. Records video for ~5 seconds
 *   3. Saves the file to the app's document directory
 *   4. Calls commitCapture(id, uri) so playback paths see the URI
 *   5. Auto-dismisses
 *
 * NOT for cage 'swing' captures — those are owned by CageSessionOverlay's
 * existing session recording flow. mediaCapture's subscriber registration
 * is kind-aware so the routing is clean.
 *
 * 2026-05-17 — 'highlight' (hero shot) capture kind removed. The auto-
 * opening replay+share pane was a ChatGPT-era idea Tim never liked.
 * The plain 'shot' path stays — clip lands in the swing library and on
 * the most recent shot's clip_uri, where it can be replayed/shared
 * later from a less interruptive surface.
 *
 * Camera permission is requested lazily on first use; cached after grant.
 * If the user denies, the next capture request shows a brief inline error
 * and dismisses (no UI loop).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRoundStore } from '../store/roundStore';
import {
  subscribeCapture,
  commitCapture,
  getMostRecentCapture,
  type CaptureKind,
  type CaptureRequest,
} from '../services/mediaCapture';
import {
  startImpactRecording,
  stopAndDetectImpact,
  abortImpactRecording,
  cleanupImpactRecording,
} from '../services/acousticImpactDetector';

/**
 * Maximum recording duration (ms) if no acoustic strike is detected.
 * When the impact detector fires (strike heard), we stop POST_STRIKE_MS
 * after the impact instead — saves clip size and centers analysis on
 * the strike moment.
 */
const DURATION_BY_KIND: Record<CaptureKind, number> = {
  shot: 5_000,
  swing: 8_000,
};
/** Trail after the strike before stopping. 1.5s captures follow-through
 *  + ball flight start, then trims dead air at the end. */
const POST_STRIKE_MS = 1500;

interface ActiveCapture {
  id: string;
  kind: CaptureKind;
  startedAt: number;
}

export default function CaptureOverlay() {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState<ActiveCapture | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);

  const handleRequest = useCallback((req: CaptureRequest) => {
    // Defensive: only the kinds we declared.
    if (req.kind !== 'shot') return;
    // Defensive: round-context kinds need an active round.
    if (!useRoundStore.getState().isRoundActive) {
      console.warn('[captureOverlay] capture request outside active round; ignoring');
      return;
    }

    // Build the same id mediaCapture used so commitCapture matches.
    // mediaCapture creates the placeholder with id = `${startedAt}_${kind}`;
    // this overlay receives the request post-creation, so we re-derive
    // by reading the most recent capture from mediaCapture instead.
    // Cleaner: pass the id back via the listener payload — but since the
    // CaptureRequest doesn't currently carry the id, we re-fetch from
    // recentCaptures (the matching record was just pushed).
    const recent = getMostRecentCapture();
    if (!recent) {
      console.warn('[captureOverlay] no recent capture record found post-request');
      return;
    }

    setActive({
      id: recent.id,
      kind: req.kind,
      startedAt: Date.now(),
    });
  }, []);

  // Subscribe once on mount.
  useEffect(() => {
    const unsub = subscribeCapture(['shot'], handleRequest);
    return () => { unsub(); };
  }, [handleRequest]);

  // Drive the recording lifecycle when an active capture is set.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      // Permission check
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          if (!cancelled) {
            setErrorMsg('Camera permission needed.');
            setTimeout(() => {
              if (!cancelled) {
                setActive(null);
                setErrorMsg(null);
              }
            }, 1800);
          }
          return;
        }
      }

      // Wait one tick so CameraView mounts before recordAsync.
      await new Promise(r => setTimeout(r, 80));
      if (cancelled) return;

      const cam = cameraRef.current;
      if (!cam) {
        if (!cancelled) {
          setErrorMsg('Camera not ready.');
          setTimeout(() => {
            if (!cancelled) { setActive(null); setErrorMsg(null); }
          }, 1500);
        }
        return;
      }

      try {
        recordingPromiseRef.current = cam.recordAsync() as Promise<{ uri: string } | undefined>;
        const maxDuration = DURATION_BY_KIND[active.kind];

        // Schedule the FIXED-MAX stop. The real-time impact callback
        // below will replace this with an earlier stop the moment a
        // strike is detected.
        const scheduleStop = (ms: number) => {
          if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
          stopTimerRef.current = setTimeout(() => {
            try { cam.stopRecording(); } catch {}
          }, ms);
        };
        scheduleStop(maxDuration);

        // Start the parallel acoustic recording. When the meter crosses
        // the impact threshold, replace the max-duration timer with
        // (now - recordingStart + POST_STRIKE_MS). Keeps clips short
        // and centered on the strike. Fire-and-forget: if mic is denied
        // or device busy, the fixed timer still runs.
        const recStart = Date.now();
        void startImpactRecording({
          onImpactDetected: (offsetMs) => {
            if (cancelled) return;
            const elapsed = Date.now() - recStart;
            const fromNowMs = Math.max(0, (offsetMs - elapsed) + POST_STRIKE_MS);
            scheduleStop(fromNowMs);
          },
        }).catch(() => undefined);

        const result = await recordingPromiseRef.current;
        if (cancelled) return;

        // Now stop the acoustic detector and read the final impact data.
        // This is the SAME pass that powered the real-time callback;
        // calling stopAndDetectImpact yields the precise peak + dB +
        // confidence which we persist alongside the clip.
        let acousticImpactMs: number | null = null;
        let acousticConfidence: number | null = null;
        try {
          const reading = await stopAndDetectImpact();
          if (reading) {
            acousticImpactMs = reading.impact_ms;
            acousticConfidence = reading.confidence;
            // Discard the WAV — we don't ship CaptureOverlay clips to
            // the acoustic server for ball-speed (different surface).
            void cleanupImpactRecording(reading.audio_uri);
          }
        } catch { /* noop */ }

        if (result?.uri) {
          commitCapture(active.id, result.uri, {
            impact_ms: acousticImpactMs,
            impact_confidence: acousticConfidence,
          });
        } else {
          console.warn('[captureOverlay] recordAsync returned no uri');
        }
      } catch (e) {
        console.warn('[captureOverlay] recording failed:', e);
        if (!cancelled) setErrorMsg('Recording failed.');
        // Make sure the parallel audio is torn down on the failure path.
        void abortImpactRecording().catch(() => undefined);
      } finally {
        if (stopTimerRef.current) {
          clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
        }
        recordingPromiseRef.current = null;
        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) { setActive(null); setErrorMsg(null); }
          }, errorMsg ? 1500 : 200);
        }
      }
    })();

    // Capture the ref value at effect time so the cleanup doesn't read
    // a possibly-mutated cameraRef.current later.
    const camAtEffect = cameraRef.current;
    return () => {
      cancelled = true;
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      try { camAtEffect?.stopRecording(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;
  // Render only when round-active to avoid mounting CameraView on
  // surfaces that don't expect it (e.g. Settings, About).
  if (!isRoundActive) return null;

  const elapsedSec = active ? Math.floor((Date.now() - active.startedAt) / 1000) : 0;
  const totalSec = active ? Math.ceil(DURATION_BY_KIND[active.kind] / 1000) : 0;

  return (
    <View style={styles.overlay} pointerEvents="box-only">
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="video"
      />
      <View style={styles.hud}>
        <View style={styles.recDot} />
        <Text style={styles.hudLabel}>
          Shot · {elapsedSec}s / {totalSec}s
        </Text>
        {errorMsg ? <Text style={styles.errText}>{errorMsg}</Text> : null}
      </View>
      {!cameraRef.current && <ActivityIndicator color="#fff" style={styles.spinner} />}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    zIndex: 10000,
  },
  camera: {
    flex: 1,
  },
  hud: {
    position: 'absolute',
    top: 60,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
    marginRight: 8,
  },
  hudLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  errText: {
    color: '#fca5a5',
    fontSize: 11,
    marginLeft: 8,
  },
  spinner: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -10,
  },
});
