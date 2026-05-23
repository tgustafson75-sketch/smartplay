import React from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type { LieAnalysis, RiskRewardCall } from '../../services/lieAnalysisService';

type Props = {
  imageUri: string;
  analysis: LieAnalysis;
  speaking: boolean;
  onReplay: () => void;
  onGotIt: () => void;
  onTryAgain: () => void;
  /** 2026-05-22 — Optional strategy overlay. When the camera surface
   *  had "Include strategy" toggled on, enrichedLieAnalysis returned a
   *  risk_reward band + tradeoff + alternative play; the strategy
   *  block renders below the tactical advice without re-shaping the
   *  base card. */
  riskReward?: RiskRewardCall | null;
};

const RISK_COLOR: Record<RiskRewardCall['band'], string> = {
  conservative: '#86efac',
  standard:     '#cbd5e1',
  aggressive:   '#fbbf24',
  go_for_it:    '#f87171',
};

const RISK_LABEL: Record<RiskRewardCall['band'], string> = {
  conservative: 'CONSERVATIVE',
  standard:     'STANDARD',
  aggressive:   'AGGRESSIVE',
  go_for_it:    'GO FOR IT',
};

const CONFIDENCE_COLOR: Record<LieAnalysis['confidence_level'], string> = {
  high: '#00C896',
  medium: '#F5A623',
  low: '#ef4444',
};

const CONFIDENCE_LABEL: Record<LieAnalysis['confidence_level'], string> = {
  high: 'CONFIDENT',
  medium: 'WORKING IT',
  low: 'TENTATIVE',
};

/**
 * Phase H — analysis results display. Captured image thumbnail, Kevin's
 * spoken analysis text, recommended club, alternative play (when present),
 * confidence dot, and three actions (replay / got it / try again).
 */
export default function AnalysisResult({
  imageUri, analysis, speaking, onReplay, onGotIt, onTryAgain, riskReward,
}: Props) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />

      <View style={styles.card}>
        <View style={styles.confidenceRow}>
          <View style={[styles.confidenceDot, { backgroundColor: CONFIDENCE_COLOR[analysis.confidence_level] }]} />
          <Text style={[styles.confidenceLabel, { color: CONFIDENCE_COLOR[analysis.confidence_level] }]}>
            {CONFIDENCE_LABEL[analysis.confidence_level]}
          </Text>
          {analysis.conservative_call && (
            <View style={styles.tag}><Text style={styles.tagText}>SAFE PLAY</Text></View>
          )}
        </View>

        <Text style={styles.situation}>{analysis.situation_description}</Text>
        <Text style={styles.advice}>{analysis.tactical_advice}</Text>

        {analysis.recommended_club && (
          <View style={styles.clubRow}>
            <Text style={styles.clubLabel}>CLUB</Text>
            <Text style={styles.clubValue}>{analysis.recommended_club}</Text>
          </View>
        )}

        {analysis.alternative_play && (
          <View style={styles.altBlock}>
            <Text style={styles.altLabel}>ALTERNATIVE</Text>
            <Text style={styles.altText}>{analysis.alternative_play}</Text>
          </View>
        )}

        {analysis.goal_aware_note && (
          <View style={styles.goalBlock}>
            <Text style={styles.goalLabel}>FOR YOUR GOAL</Text>
            <Text style={styles.goalText}>{analysis.goal_aware_note}</Text>
          </View>
        )}

        {riskReward && (
          <View style={styles.strategyBlock}>
            <View style={styles.strategyHeaderRow}>
              <Text style={styles.strategyHeaderLabel}>STRATEGY</Text>
              <View style={[styles.bandTag, { borderColor: RISK_COLOR[riskReward.band] }]}>
                <Text style={[styles.bandTagText, { color: RISK_COLOR[riskReward.band] }]}>
                  {RISK_LABEL[riskReward.band]}
                </Text>
              </View>
            </View>
            <Text style={styles.strategyTradeoff}>{riskReward.tradeoff}</Text>
            {riskReward.alternative_play && (
              <Text style={styles.strategyAlt}>
                If you&apos;re feeling cautious: {riskReward.alternative_play}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onReplay}>
          <Text style={styles.actionBtnText}>{speaking ? '■ Stop' : '▶ Replay'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={onGotIt}>
          <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>Got it</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={onTryAgain}>
          <Text style={styles.actionBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 32 },
  thumb: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, marginBottom: 14 },
  card: {
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 16,
  },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  confidenceLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  tag: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1,
    borderColor: '#F5A623',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: { color: '#F5A623', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  situation: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, marginBottom: 10, fontStyle: 'italic' },
  advice: { color: '#ffffff', fontSize: 16, lineHeight: 23, fontWeight: '600' },
  clubRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 12,
    marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#1e3a28',
  },
  clubLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  clubValue: { color: '#00C896', fontSize: 22, fontWeight: '900' },
  altBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#1e3a28' },
  altLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  altText: { color: '#9ca3af', fontSize: 13, lineHeight: 19 },
  goalBlock: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: '#1e3a28',
  },
  goalLabel: { color: '#F5A623', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  goalText: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  actionBtn: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 10,
    backgroundColor: '#0a1e12',
  },
  actionBtnPrimary: { borderColor: '#00C896', backgroundColor: '#003d20' },
  actionBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  actionBtnTextPrimary: { color: '#00C896' },
  // 2026-05-22 — strategy overlay (rendered when enrichedLieAnalysis
  // included a risk_reward call). Distinct from the goal/alt blocks
  // because the band carries hue semantics.
  strategyBlock: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: '#1e3a28',
  },
  strategyHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  strategyHeaderLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  bandTag: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1,
  },
  bandTagText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  strategyTradeoff: { color: '#e8f5e9', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  strategyAlt: {
    color: '#9ca3af', fontSize: 12, lineHeight: 17, marginTop: 6, fontStyle: 'italic',
  },
});
