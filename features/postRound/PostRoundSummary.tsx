/**
 * features/postRound/PostRoundSummary.tsx
 *
 * Full-screen modal sheet shown immediately after a round ends.
 * Displays the AI caddie's post-round insights inline — no navigation required.
 *
 * Props:
 *   visible    — controls Modal visibility
 *   analysis   — RoundAnalysis result (from analyzeRound())
 *   insights   — RoundInsight[] (from generateInsights())
 *   onDismiss  — called when user taps "Done" or the backdrop
 */

import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Palette } from '../../constants/theme';
import type { RoundAnalysis } from '../smartCaddie/engine/RoundAnalysis';
import type { RoundInsight } from '../smartCaddie/engine/InsightEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  visible:   boolean;
  analysis:  RoundAnalysis | null;
  insights:  RoundInsight[];
  onDismiss: () => void;
}

// ── Tone → colour ─────────────────────────────────────────────────────────────

const toneColor: Record<RoundInsight['tone'], string> = {
  warning:  '#f4a0a0',
  tip:      '#fcd34d',
  positive: Palette.positive,
};

const toneBorder: Record<RoundInsight['tone'], string> = {
  warning:  'rgba(244,160,160,0.25)',
  tip:      'rgba(252,211,77,0.20)',
  positive: 'rgba(46,204,113,0.20)',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PostRoundSummary({ visible, analysis, insights, onDismiss }: Props) {
  const insets = useSafeAreaInsets();

  if (!analysis) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={onDismiss} />

      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {/* Handle */}
        <View style={s.handle} />

        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Round Summary</Text>
          <Text style={s.sub}>{analysis.totalShots} shots tracked</Text>
        </View>

        {/* Score pill */}
        <View style={s.scoreRow}>
          <View style={s.scorePill}>
            <Text style={s.scoreLabel}>Performance</Text>
            <Text style={s.scoreValue}>{analysis.performanceScore}</Text>
            <Text style={s.scoreLabel}>/ 100</Text>
          </View>

          {analysis.bestClub && (
            <View style={[s.scorePill, { borderColor: 'rgba(46,204,113,0.4)' }]}>
              <Text style={s.scoreLabel}>Best club</Text>
              <Text style={[s.scoreValue, { color: Palette.positive }]}>{analysis.bestClub}</Text>
            </View>
          )}
        </View>

        {/* Insights list */}
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {insights.length === 0 ? (
            <Text style={s.noData}>Not enough shots to generate insights.</Text>
          ) : (
            insights.map((insight) => (
              <View
                key={insight.id}
                style={[s.insightCard, { borderColor: toneBorder[insight.tone], backgroundColor: toneBorder[insight.tone] }]}
              >
                <View style={s.insightTop}>
                  <Text style={s.insightEmoji}>{insight.emoji}</Text>
                  <Text
                    numberOfLines={2}
                    ellipsizeMode="tail"
                    style={[s.insightHeadline, { color: toneColor[insight.tone] }]}
                  >
                    {insight.headline}
                  </Text>
                </View>
                <Text numberOfLines={3} ellipsizeMode="tail" style={s.insightDetail}>
                  {insight.detail}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Done button */}
        <Pressable style={s.doneBtn} onPress={onDismiss}>
          <Text style={s.doneBtnText}>Done — End Round</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#0b1f16',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderColor: 'rgba(46,204,113,0.2)',
  },
  handle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  sub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    marginTop: 2,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  scorePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  scoreLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  scoreValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  noData: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  insightCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  insightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  insightEmoji: {
    fontSize: 18,
  },
  insightHeadline: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  insightDetail: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    lineHeight: 19,
  },
  doneBtn: {
    marginTop: 16,
    backgroundColor: Palette.positive,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#071E16',
    fontSize: 15,
    fontWeight: '800',
  },
});
