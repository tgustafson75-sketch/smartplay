/**
 * SwingStillComposite — bakes the SmartMotion overlay (skeleton + tempo trace +
 * fault-region heat) INTO a still image.
 *
 * 2026-07-06 (Tim carry-over #2: "we were supposed to export videos WITH the
 * overlays and reporting, still not working"). The on-screen overlay is a
 * react-native-svg layer drawn OVER the expo-av <Video> — it is never composited
 * into the pixel buffer, so every share/save/report of the clip (or a raw
 * thumbnail of it) comes out clean. There is no client-side video encoder in the
 * app (skia/gl/ffmpeg are all absent pending the native rebuild), so a burned-in
 * *video* is not achievable in JS today — but a burned-in *still* is, using the
 * same react-native-view-shot pattern that already ships for round share cards.
 *
 * This hook extracts the frame at a given time (expo-video-thumbnails), stacks
 * SwingBodyOverlay over it in an off-screen, correctly-aspected box, and
 * captureRef()s the pair into a single PNG. Because it uses the SAME clip + the
 * SAME pose timeline the live player uses, the skeleton lands on the body exactly
 * as it does on screen.
 *
 * Video-surface note: view-shot cannot reliably rasterize a live <Video> (it's a
 * separate native surface that often captures black), which is why we composite
 * over an extracted Image, not over the player itself.
 */

import React, { useCallback, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as VideoThumbnails from 'expo-video-thumbnails';
import SwingBodyOverlay from './SwingBodyOverlay';
import type { PoseFrame } from '../../services/poseAnalysisApi';

type OverlayOpts = {
  poseFrames: PoseFrame[];
  faultJoints?: string[];
  faultSevere?: boolean;
  showSkeleton?: boolean;
  showTrace?: boolean;
};

type Job = {
  frameUri: string;
  w: number;
  h: number;
  timeMs: number;
  resolve: (uri: string | null) => void;
};

// Cap the long edge so the composite PNG stays a sane size (the source clip can
// be 1080p+; a report/photo still doesn't need more).
const CAPTURE_MAX = 1080;

/**
 * Returns { capture, element }.
 *  - Render `element` once anywhere in the screen tree (it lives off-screen and
 *    only mounts while a capture is in flight).
 *  - Call `capture(clipUri, timeMs)` to get a PNG file URI with the overlay
 *    baked in at that time, or null if capture isn't possible.
 */
export function useSwingStillCapture(opts: OverlayOpts) {
  const viewRef = useRef<View>(null);
  const jobRef = useRef<Job | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  jobRef.current = job;

  const capture = useCallback(async (clipUri: string, timeMs: number): Promise<string | null> => {
    if (!opts.poseFrames || opts.poseFrames.length < 2) return null;
    let frameUri: string;
    let w = 0;
    let h = 0;
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(clipUri, {
        time: Math.max(0, Math.round(timeMs)),
        quality: 1,
      });
      frameUri = thumb.uri;
      w = thumb.width || 0;
      h = thumb.height || 0;
    } catch (e) {
      console.log('[SwingStillComposite] thumbnail failed (non-fatal)', e);
      return null;
    }
    if (!w || !h) { w = 720; h = 1280; }
    return await new Promise<string | null>((resolve) => {
      setJob({ frameUri, w, h, timeMs, resolve });
    });
  }, [opts.poseFrames]);

  // Fires once the extracted frame Image has painted; the SVG overlay renders
  // synchronously, so by now both layers are on screen. Two rAFs guard against
  // capturing before the first paint commits.
  const onFrameReady = useCallback(() => {
    const j = jobRef.current;
    if (!j) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (jobRef.current !== j) return;
        try {
          const out = await captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' });
          j.resolve(out);
        } catch (e) {
          console.log('[SwingStillComposite] capture failed (non-fatal)', e);
          j.resolve(null);
        } finally {
          setJob(null);
        }
      });
    });
  }, []);

  let box: { w: number; h: number } | null = null;
  if (job) {
    const long = Math.max(job.w, job.h);
    const scale = long > CAPTURE_MAX ? CAPTURE_MAX / long : 1;
    box = { w: Math.round(job.w * scale), h: Math.round(job.h * scale) };
  }

  const element = job && box ? (
    <View style={styles.offscreen} pointerEvents="none">
      {/* collapsable=false keeps the native view alive for captureRef on Android */}
      <View
        ref={viewRef}
        collapsable={false}
        style={{ width: box.w, height: box.h, backgroundColor: '#0B1220' }}
      >
        <Image
          source={{ uri: job.frameUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLoadEnd={onFrameReady}
        />
        <SwingBodyOverlay
          frames={opts.poseFrames}
          currentTimeMs={job.timeMs}
          showSkeleton={opts.showSkeleton ?? true}
          showTrace={opts.showTrace ?? true}
          resizeMode="contain"
          faultJoints={opts.faultJoints}
          faultSevere={opts.faultSevere}
        />
      </View>
    </View>
  ) : null;

  return { capture, element };
}

const styles = StyleSheet.create({
  // Laid out (so view-shot can rasterize it) but parked far off-screen.
  offscreen: { position: 'absolute', left: -100000, top: 0 },
});
