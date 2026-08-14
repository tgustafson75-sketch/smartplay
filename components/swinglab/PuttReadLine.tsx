/**
 * 2026-08-13 — the READ LINE drawn over a still from the putt.
 *
 * Tim: "it would be cool to have a line show after putt analysis to the hole, maybe using a photo."
 *
 * WHAT THIS IS: the line the player should have played — ball → apex → hole — drawn on the frame the
 * analysis picked, curved by the break it already read. Every input comes from work the app was
 * already doing: the frames were extracted for the analysis, the break was already computed, and the
 * clip is already stored, so the still is re-extracted on demand rather than kept around.
 *
 * WHAT THIS IS NOT: a trace of where the ball actually rolled. That needs real ball tracking —
 * services/putting/puttRoll.ts exists and computes start/break/speed from a tracked path, but nothing
 * feeds it a path yet (greenHeat.ts:19 says so outright). Labelling this "your putt" would be a lie the
 * player couldn't detect, so the caption says READ and the difference is stated on screen.
 *
 * SAFETY: this renders null unless it has everything — an analysis readLine, a clip, a usable duration,
 * and a frame that actually extracts. The putt card works well today and must be unchanged when any
 * part of this is missing.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path, Circle, Line as SvgLine } from 'react-native-svg';
import * as VideoThumbnails from '../../utils/videoThumbnail';
import { puttFrameTimeSec } from '../../services/puttFrameExtractor';
import type { PuttingAnalysis } from '../../services/puttingAnalysisService';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  readLine: NonNullable<PuttingAnalysis['readLine']>;
  /** The stored putt clip. Without it there is no still to draw on. */
  clipUri: string | null | undefined;
  /** Clip length; the frame index is only meaningful against a duration. */
  clipDurationSec: number | null | undefined;
}

const BOX_H = 200;

export default function PuttReadLine({ readLine, clipUri, clipDurationSec }: Props) {
  const { colors } = useTheme();
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeSec = puttFrameTimeSec(readLine.frameIndex, clipDurationSec ?? 0);
    if (!clipUri || timeSec == null) { setFailed(true); return; }
    void (async () => {
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(clipUri, {
          time: Math.round(timeSec * 1000),
          quality: 0.85,
        });
        if (!cancelled) setFrameUri(uri);
      } catch {
        // A frame we can't pull is not an error worth surfacing — the analysis above it is intact.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [clipUri, clipDurationSec, readLine.frameIndex]);

  if (failed) return null;
  if (!frameUri) {
    return (
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const { ball, hole, apex } = readLine;
  // A breaking putt bends through the apex; a straight one is a straight line. Quadratic through the
  // apex rather than a spline — two segments of a real read, not a decorative curve.
  const path = apex
    ? `M ${ball.x * 100} ${ball.y * 100} Q ${apex.x * 100} ${apex.y * 100} ${hole.x * 100} ${hole.y * 100}`
    : null;

  return (
    <View style={styles.wrap}>
      <View style={[styles.box, { borderColor: colors.border }]}>
        <Image source={{ uri: frameUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
          {path ? (
            <Path d={path} stroke="#00C896" strokeWidth={1.1} fill="none" strokeLinecap="round" />
          ) : (
            <SvgLine
              x1={ball.x * 100} y1={ball.y * 100} x2={hole.x * 100} y2={hole.y * 100}
              stroke="#00C896" strokeWidth={1.1} strokeLinecap="round"
            />
          )}
          <Circle cx={ball.x * 100} cy={ball.y * 100} r={1.8} fill="#FFFFFF" stroke="#00C896" strokeWidth={0.7} />
          <Circle cx={hole.x * 100} cy={hole.y * 100} r={2.2} fill="none" stroke="#FBBF24" strokeWidth={1} />
        </Svg>
      </View>
      {/*
        The honesty line. This is the read, not the roll — and the player cannot tell the difference by
        looking, so it is said in words rather than implied.
      */}
      <Text style={[styles.caption, { color: colors.text_muted }]}>
        The line to play — read from the break above{readLine.confidence ? ` · ${Math.round(readLine.confidence)}% confidence` : ''}. Not a trace of your actual roll.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  box: {
    height: BOX_H, borderRadius: 10, overflow: 'hidden', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  caption: { fontSize: 11, marginTop: 6, lineHeight: 15 },
});
