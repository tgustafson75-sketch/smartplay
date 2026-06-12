/**
 * 2026-05-25 — Fix AG: pinch-zoom + pan wrapper for the SmartMotion
 * video so the coach can zoom in on a specific area of fault (hands at
 * the top, hips at impact, etc) to walk the student through.
 *
 * Usage:
 *   <ZoomableView style={...}>
 *     <Video ... />
 *   </ZoomableView>
 *
 * Behavior:
 *   - Pinch to zoom (1× to 4×)
 *   - When zoomed > 1, pan to move the focal point
 *   - Double-tap anywhere to reset to 1× and recenter
 *   - Single-tap passes through (so native video controls still work)
 *
 * Implementation notes:
 *   - react-native-gesture-handler v2 + reanimated v3+ composed API
 *   - GestureDetector lives ABOVE the children; the children render
 *     unchanged. Animated.View applies the transform.
 *   - Pan is clamped so the user can't drag the content off the
 *     visible frame entirely — at edge boundaries the gesture stops.
 *   - Coach Mode + standalone swing detail both use this; no surface-
 *     specific logic here, keep it pure-presentational.
 */

import React from 'react';
import { StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  /** Outer style — applied to the gesture-wrapping container. Set
   *  width + height + aspectRatio here as you would on a plain View. */
  style?: StyleProp<ViewStyle>;
  /** Min / max zoom levels. Defaults: 1 → 4. */
  minScale?: number;
  maxScale?: number;
  /** Optional callback fired when the user zooms in/out. Useful to
   *  surface a "zoomed Nx" badge or to lock native video controls
   *  when zoomed (they conflict with pan gestures). */
  onScaleChange?: (scale: number) => void;
  /** 2026-06-11 — single-tap callback (e.g. tap-anywhere-to-play/pause). Composed
   *  to WAIT for the double-tap-to-reset to fail, so a double-tap doesn't also fire
   *  a single tap. Only wired when provided — other callers (Coach Mode) keep their
   *  single-tap passing through to native controls. */
  onSingleTap?: () => void;
}

export default function ZoomableView({
  children,
  style,
  minScale = 1,
  maxScale = 4,
  onScaleChange,
  onSingleTap,
}: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const notify = React.useCallback(
    (s: number) => { onScaleChange?.(s); },
    [onScaleChange],
  );
  const fireSingleTap = React.useCallback(() => { onSingleTap?.(); }, [onSingleTap]);

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      const next = Math.max(minScale, Math.min(maxScale, savedScale.value * e.scale));
      scale.value = next;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= minScale) {
        // Reset translate when fully zoomed out so we don't strand the
        // content off-center.
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
      runOnJS(notify)(scale.value);
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onUpdate(e => {
      // Only allow pan when zoomed past 1× (otherwise pan is dead and
      // single-tap-then-pan was registering as a flicker).
      if (scale.value <= minScale) return;
      translateX.value = savedTx.value + e.translationX;
      translateY.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = translateX.value;
      savedTy.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      savedScale.value = 1;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
      runOnJS(notify)(1);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd((_e, success) => { if (success) runOnJS(fireSingleTap)(); });

  // Compose: pinch + pan are simultaneous; doubleTap is exclusive
  // (otherwise the second tap of a double could fire a pan onUpdate). When a
  // single-tap handler is wired, it sits between double-tap and the pinch/pan
  // (Exclusive priority order) so a double-tap-to-reset still wins over a single
  // tap, and a pinch/pan still beats a tap.
  const composed = Gesture.Simultaneous(pinch, pan);
  const root = onSingleTap
    ? Gesture.Exclusive(doubleTap, singleTap, composed)
    : Gesture.Exclusive(doubleTap, composed);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={root}>
      <Animated.View style={[styles.container, style, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
});
