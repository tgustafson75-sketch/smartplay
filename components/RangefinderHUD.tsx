/**
 * RangefinderHUD
 * ─────────────────────────────────────────────────────────────────────────────
 * Pro-level semi-transparent overlay that floats on top of every rangefinder
 * mode.  Always shows:
 *   TOP    → Hole N | Par N | score vs par
 *   BOTTOM → F xxx  M xxx  B xxx  /  To Target: xxx
 *
 * The crosshair itself lives in TargetingOverlay (TARGET mode) or the existing
 * camera view (STANDARD mode).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  hole:           number;
  par:            number;
  scoreToPar:     number | null;   // null = no rounds scored yet
  front:          number | null;
  middle:         number | null;
  back:           number | null;
  targetYards:    number | null;   // null = no target drag active
  gpsStatus:      'off' | 'searching' | 'good' | 'weak';
  /** Mode label shown in top-right corner */
  mode:           'STANDARD' | 'TARGET' | 'MAP';
}

export default function RangefinderHUD({
  hole, par, scoreToPar,
  front, middle, back,
  targetYards,
  gpsStatus,
  mode,
}: Props) {
  // Score vs par label
  const vspLabel = scoreToPar == null
    ? ''
    : scoreToPar === 0 ? 'E'
    : scoreToPar > 0   ? `+${scoreToPar}`
    : `${scoreToPar}`;
  const vspColor = scoreToPar == null
    ? '#9CA3AF'
    : scoreToPar < 0  ? '#4ade80'
    : scoreToPar === 0 ? '#A7F3D0'
    : '#f87171';

  const gpsColor = gpsStatus === 'good' ? '#4ade80'
    : gpsStatus === 'weak' ? '#fbbf24'
    : '#9ca3af';
  const gpsDot = gpsStatus === 'good' ? '●'
    : gpsStatus === 'searching' ? '○'
    : gpsStatus === 'weak' ? '◑'
    : '○';

  return (
    <>
      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <View style={styles.topBar} pointerEvents="none">
        {/* Hole / par */}
        <View style={styles.topLeft}>
          <Text style={styles.holeLabel}>HOLE</Text>
          <Text style={styles.holeNum}>{hole}</Text>
          <Text style={styles.parLabel}>PAR {par}</Text>
        </View>

        {/* Score vs par */}
        {vspLabel !== '' && (
          <View style={[styles.vspBadge, { borderColor: vspColor }]}>
            <Text style={[styles.vspText, { color: vspColor }]}>{vspLabel}</Text>
          </View>
        )}

        {/* GPS dot + mode */}
        <View style={styles.topRight}>
          <Text style={[styles.gpsDot, { color: gpsColor }]}>{gpsDot} GPS</Text>
          <Text style={styles.modeLabel}>{mode}</Text>
        </View>
      </View>

      {/* ── BOTTOM YARDAGE STRIP ─────────────────────────────────────────── */}
      <View style={styles.bottomBar} pointerEvents="none">
        {/* F / M / B */}
        <View style={styles.fmbRow}>
          {front  != null && <YardCell label="F" value={front}  dim />}
          {middle != null && <YardCell label="M" value={middle} hero />}
          {back   != null && <YardCell label="B" value={back}   dim />}
        </View>

        {/* Target yardage */}
        {targetYards != null && (
          <View style={styles.targetRow}>
            <Text style={styles.targetLabel}>⊕ TO TARGET</Text>
            <Text style={styles.targetYards}>{targetYards}</Text>
            <Text style={styles.targetUnit}>yds</Text>
          </View>
        )}
      </View>
    </>
  );
}

// ── Sub-component: single yardage cell ──────────────────────────────────────
function YardCell({
  label, value, dim = false, hero = false,
}: { label: string; value: number; dim?: boolean; hero?: boolean }) {
  return (
    <View style={styles.yardCell}>
      <Text style={[styles.yardCellLabel, dim && styles.dimText]}>{label}</Text>
      <Text
        style={[
          styles.yardCellValue,
          dim  && styles.dimValue,
          hero && styles.heroValue,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 10,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flex: 1,
  },
  holeLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  holeNum: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  parLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '700',
  },
  vspBadge: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  vspText: {
    fontSize: 13,
    fontWeight: '800',
  },
  topRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  gpsDot: {
    fontSize: 10,
    fontWeight: '700',
  },
  modeLabel: {
    color: '#FFE600',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.60)',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 8,
  },
  fmbRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  yardCell: {
    alignItems: 'center',
    gap: 2,
  },
  yardCellLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  yardCellValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  dimText: {
    color: 'rgba(255,255,255,0.5)',
  },
  dimValue: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
  },
  heroValue: {
    color: '#A7F3D0',
    fontSize: 28,
    fontWeight: '900',
    textShadowColor: 'rgba(167,243,208,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },

  // Target row
  targetRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  targetLabel: {
    color: '#FFE600',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  targetYards: {
    color: '#FFE600',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: 'rgba(255,230,0,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  targetUnit: {
    color: 'rgba(255,230,0,0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
});
