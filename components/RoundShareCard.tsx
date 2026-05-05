import React, { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RoundMode } from '../types/patterns';

const MODE_LABELS: Record<string, string> = {
  break_100: 'Break 100',
  break_90: 'Break 90',
  break_80: 'Break 80',
  free_play: 'Free Play',
};

export interface ShareCardProps {
  courseName: string;
  date: string;
  totalScore: number;
  mode: RoundMode;
  ghostVariance: number | null;
  ghostLabel: string | null;
  heroStat: string;
  kevinQuote: string;
  caddieName?: string;
}

// Rendered offscreen at 360×640 — captureRef scales to 1080×1920
const RoundShareCard = forwardRef<View, ShareCardProps>(
  ({ courseName, date, totalScore, mode, ghostVariance, ghostLabel: _ghostLabel, heroStat, kevinQuote, caddieName = 'Kevin' }, ref) => {
    const modeLabel = MODE_LABELS[mode] ?? mode;

    const ghostColor = ghostVariance == null
      ? '#374151'
      : ghostVariance <= 0 ? '#00C896' : '#ef4444';

    const ghostText = ghostVariance == null
      ? null
      : ghostVariance === 0
        ? 'Tied vs past you'
        : ghostVariance < 0
          ? `Won by ${Math.abs(ghostVariance)} vs past you`
          : `Lost by ${ghostVariance} vs past you`;

    return (
      <View ref={ref} style={styles.card}>

        {/* ── HEADER ────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <Text style={styles.logoText}>SmartPlay</Text>
            <Text style={styles.logoBadge}>AI CADDIE</Text>
          </View>
          <Text style={styles.courseName} numberOfLines={2}>{courseName}</Text>
          <Text style={styles.dateText}>{date}</Text>
        </View>

        {/* ── SCORE ─────────────────────────── */}
        <View style={styles.scoreSection}>
          <Text style={styles.scoreNumber}>{totalScore}</Text>
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>{modeLabel}</Text>
          </View>
          {ghostText && (
            <View style={[styles.ghostPill, { borderColor: ghostColor }]}>
              <Text style={[styles.ghostPillText, { color: ghostColor }]}>{ghostText}</Text>
            </View>
          )}
        </View>

        {/* ── HERO STAT ─────────────────────── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroStatLabel}>HIGHLIGHT</Text>
          <Text style={styles.heroStat}>{heroStat}</Text>
        </View>

        {/* ── QUOTE ─────────────────────────── */}
        <View style={styles.quoteSection}>
          <Text style={styles.quoteText}>&quot;{kevinQuote}&quot;</Text>
          <Text style={styles.quoteAttrib}>— {caddieName}</Text>
        </View>

        {/* ── FOOTER ────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerTag}>Your AI caddie. Get better.</Text>
          <Text style={styles.footerUrl}>smartplaycaddie.com</Text>
        </View>

      </View>
    );
  }
);

RoundShareCard.displayName = 'RoundShareCard';
export default RoundShareCard;

// Light-theme card — 360×640 points
const styles = StyleSheet.create({
  card: {
    width: 360,
    height: 640,
    backgroundColor: '#f5f9f6',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: '#0d2418',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    gap: 6,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  logoText: {
    color: '#00C896',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  logoBadge: {
    color: '#374151',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    backgroundColor: '#0a1a0a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  courseName: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  dateText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
  },
  scoreSection: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#c5e0d0',
  },
  scoreNumber: {
    color: '#0d1a0d',
    fontSize: 88,
    fontWeight: '900',
    lineHeight: 88,
    letterSpacing: -4,
  },
  modePill: {
    backgroundColor: '#eaf4ef',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#c5e0d0',
  },
  modePillText: {
    color: '#009e7a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  ghostPill: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
  },
  ghostPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroSection: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#c5e0d0',
  },
  heroStatLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroStat: {
    color: '#0d1a0d',
    fontSize: 17,
    fontWeight: '700',
  },
  quoteSection: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'center',
    gap: 8,
  },
  quoteText: {
    color: '#374151',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  quoteAttrib: {
    color: '#009e7a',
    fontSize: 12,
    fontWeight: '700',
  },
  footer: {
    backgroundColor: '#0d2418',
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerTag: {
    color: '#6b7280',
    fontSize: 11,
  },
  footerUrl: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '600',
  },
});
