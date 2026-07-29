import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * HoleBrandBadge — the SmartPlay-branded neon-green hole chip that sits in the UPPER-RIGHT corner
 * of every hole flyover (Caddie tab L1 preview + SmartVision). Course · HOLE N · distance, on a soft
 * dark glass panel with a neon rim + glow so it reads over bright satellite turf without a heavy box.
 *
 * 2026-07-28 (Tim) — "our own branded overlay, neon green info … Course, Hole, and Distance … cleanly
 * in a corner." Kept compact + right-aligned so it tucks BELOW the ••• tools pill (SmartVision passes a
 * top offset via `style`) and never overlaps it.
 */
export function HoleBrandBadge({
  course,
  hole,
  distanceYds,
  distanceCaption = 'YDS',
  style,
}: {
  course?: string | null;
  hole: number;
  /** Yardage to show (hole total, or live yards-to-pin). Hidden when null/0. */
  distanceYds?: number | null;
  /** Small caption under/after the number (e.g. "YDS", "TO PIN"). */
  distanceCaption?: string;
  /** Position override — the mount point sets top/right so it clears the tools pill. */
  style?: StyleProp<ViewStyle>;
}) {
  const courseLabel = (course || '').trim();
  const hasDist = typeof distanceYds === 'number' && distanceYds > 0;
  return (
    // Default corner = top-right (top:8/right:8); callers pass `style` to relocate (e.g. SmartVision
    // pins it bottom-left so it never crowds the green, which always sits top-center of the flyover).
    <View pointerEvents="none" style={[styles.badge, style ?? { top: 8, right: 8 }]}>
      {courseLabel ? (
        <Text style={styles.course} numberOfLines={1}>
          {courseLabel}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.hole}>HOLE {hole}</Text>
        {hasDist ? (
          <View style={styles.distWrap}>
            <Text style={styles.dist}>{distanceYds}</Text>
            <Text style={styles.distCaption}>{distanceCaption}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const NEON = '#00F5B0';

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    maxWidth: '72%',
    backgroundColor: 'rgba(3,12,7,0.60)',
    borderWidth: 1,
    borderColor: 'rgba(0,245,176,0.55)',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'flex-end',
  },
  course: {
    color: 'rgba(228,255,246,0.90)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  hole: {
    color: NEON,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0,245,176,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  distWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  dist: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
    textShadowColor: 'rgba(0,245,176,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  distCaption: { color: 'rgba(0,245,176,0.85)', fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
});

export default HoleBrandBadge;
