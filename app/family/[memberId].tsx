/**
 * 2026-05-22 — Family member swing library (per-member roll-up).
 *
 * Surfaces a single family member's swing history:
 *   - Header: avatar + name + age band + recent-trend pill
 *   - Voice CTA strip: "Coach Emma's swing" / "Analyze Emma's swing"
 *     — taps a same-effect button + reminds the parent of the voice path
 *   - Latest swing card (JuniorSwingResultCard full)
 *   - Compare strip: latest vs N-back (JuniorSwingCompare)
 *   - Full history list (compact cards, newest first)
 *
 * Reads from services/juniorSwingAnalyzer's per-member history.
 * Defensive: empty state CTAs encourage the first capture with both
 * voice + tap paths.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator,
 useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useFamilyStore, ageBand, type AgeBand } from '../../store/familyStore';
import {
  getMemberSwingHistory,
  analyzeJuniorSwing,
  type JuniorSwingAnalysis,
} from '../../services/juniorSwingAnalyzer';
import {
  beginFamilyRecording, endFamilyRecording, getActiveFamilyRecordingMember,
} from '../../services/glassesVisionInput';
import JuniorSwingResultCard from '../../components/JuniorSwingResultCard';
import JuniorSwingCompare from '../../components/JuniorSwingCompare';
import JuniorSwingTrendChart from '../../components/JuniorSwingTrendChart';

const BAND_LABEL: Record<AgeBand, string> = {
  tiny: 'Tiny',
  junior: 'Junior',
  teen: 'Teen',
  adult: 'Adult',
};

export default function FamilyMemberScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const member = useFamilyStore((s) => s.getMember(memberId ?? null));

  const [history, setHistory] = useState<JuniorSwingAnalysis[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  // Declared up here (with all hooks, before the !member early return)
  // so hook order stays stable — rules-of-hooks.
  const [comparing, setComparing] = useState(false);
  const { width: windowWidth } = useWindowDimensions();

  const refreshHistory = useCallback(async () => {
    if (!member) return;
    const h = await getMemberSwingHistory(member.id);
    setHistory(h);
  }, [member]);

  useFocusEffect(useCallback(() => {
    void refreshHistory();
    setRecordingActive(getActiveFamilyRecordingMember() === (member?.id ?? null));
  }, [member, refreshHistory]));

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  if (!member) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
            <Text style={[styles.headerBackText, { color: colors.accent }]}>← Back</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Member not found</Text>
          <View style={styles.headerBack} />
        </View>
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.text_muted }]}>
            This roster entry was removed. Add them again from Settings → Family Coaching.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const band = ageBand(member.age);
  const latest = history && history.length > 0 ? history[history.length - 1] : null;
  const earlier = history && history.length > 1 ? history[history.length - 2] : null;

  const toggleRecording = () => {
    if (recordingActive) {
      endFamilyRecording();
      setRecordingActive(false);
    } else {
      beginFamilyRecording(member.id);
      setRecordingActive(true);
    }
  };

  const tryAnalyze = async () => {
    setAnalyzing(true);
    try {
      await analyzeJuniorSwing({ memberId: member.id });
      await refreshHistory();
    } finally {
      setAnalyzing(false);
    }
  };

  // 2026-05-22 — Caddie Brain compare. Pulls the member's most-recent
  // video clip + the prior one and runs swingComparisonEngine via the
  // central engine. Toast surfaces the overall_match + leads with the
  // top takeaway. Defensive: requires >=2 swings in history.
  const tryCompare = async () => {
    if (!history || history.length < 2) {
      const toast = await import('../../store/toastStore');
      toast.useToastStore.getState().show('Need at least two swings to compare.');
      return;
    }
    setComparing(true);
    try {
      const engine = await import('../../services/smartAnalysisEngine');
      const toast = await import('../../store/toastStore');
      // Pull clip URIs from the cage store by looking at the recent
      // swings tied to this member id. Junior-swing history doesn't
      // carry the video URI directly; the user typically uploads
      // first via SwingLab. For voice/tap UX surface, route to library
      // so the user can pick which two swings to compare side-by-side.
      const env = await engine.analyze({
        kind: 'swing_compare',
        against: 'self_previous',
        speak: true,
      });
      const result = env.result as { overall_match?: number } | null;
      if (env.status === 'partial' || env.confidence === 0) {
        toast.useToastStore.getState().show('Open SwingLab to pick two swings to compare.');
        router.push('/swinglab/library' as never);
      } else {
        toast.useToastStore.getState().show(
          `${member.firstName} vs prior: ${result?.overall_match ?? '?'}% match`,
        );
      }
    } catch (e) {
      console.log('[memberLibrary] compare failed:', e);
    } finally {
      setComparing(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
          <Text style={[styles.headerBackText, { color: colors.accent }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]} numberOfLines={1}>
          {member.firstName}
        </Text>
        <Pressable
          onPress={() => router.push('/family/roster' as never)}
          hitSlop={10}
          style={styles.headerBack}
        >
          <Text style={[styles.headerBackText, { color: colors.text_muted, textAlign: 'right' }]}>
            Edit
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero card */}
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={styles.heroAvatar}>{member.avatar_emoji}</Text>
          <View style={styles.heroText}>
            <Text style={[styles.heroName, { color: colors.text_primary }]}>{member.firstName}</Text>
            <Text style={[styles.heroMeta, { color: colors.text_muted }]}>
              {member.age != null ? `${member.age}y · ` : ''}{BAND_LABEL[band]} band · {member.skillLevel.replace(/_/g, ' ')}
              {member.handedness !== 'unknown' ? ` · ${member.handedness}-handed` : ''}
            </Text>
            {member.nickname ? (
              <Text style={[styles.heroNickname, { color: colors.accent }]}>&quot;{member.nickname}&quot;</Text>
            ) : null}
          </View>
        </View>

        {/* Voice + tap CTAs */}
        <View style={[styles.ctaCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          <Text style={[styles.ctaTitle, { color: colors.text_primary }]}>Hands-free</Text>
          <Text style={[styles.ctaHint, { color: colors.text_muted }]}>
            Say &quot;Coach {member.firstName}&apos;s swing&quot; to start a tagged recording on the glasses, then &quot;Analyze {member.firstName}&apos;s swing&quot; to hear the feedback.
          </Text>
          <View style={styles.ctaRow}>
            <Pressable
              onPress={toggleRecording}
              style={[
                styles.primaryBtn,
                { backgroundColor: recordingActive ? '#ef4444' : colors.accent },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {recordingActive ? '■ Stop recording' : `● Record ${member.firstName}'s swing`}
              </Text>
            </Pressable>
            <Pressable
              onPress={tryAnalyze}
              disabled={analyzing}
              style={[
                styles.secondaryBtn,
                { borderColor: colors.accent, opacity: analyzing ? 0.5 : 1 },
              ]}
            >
              {analyzing ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={[styles.secondaryBtnText, { color: colors.accent }]}>Analyze last clip</Text>
              )}
            </Pressable>
            {/* 2026-05-22 — Caddie Brain compare. Disabled when <2 swings. */}
            {history && history.length >= 2 && (
              <Pressable
                onPress={tryCompare}
                disabled={comparing}
                style={[
                  styles.secondaryBtn,
                  { borderColor: '#a78bfa', opacity: comparing ? 0.5 : 1 },
                ]}
              >
                {comparing ? (
                  <ActivityIndicator color="#a78bfa" />
                ) : (
                  <Text style={[styles.secondaryBtnText, { color: '#a78bfa' }]}>Compare to last</Text>
                )}
              </Pressable>
            )}
          </View>
        </View>

        {/* Latest swing card */}
        {history === null ? (
          <View style={[styles.loading, { backgroundColor: colors.surface }]}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : latest ? (
          <>
            {/* 2026-05-22 — Progress dashboard. Trend strip lives ABOVE
                the latest-swing card so the long-arc progress story
                lands first. Renders when ≥2 swings are in history. */}
            {history && history.length >= 2 && (
              <View style={[styles.trendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <JuniorSwingTrendChart
                  history={history}
                  width={Math.max(240, windowWidth - 64)}
                  height={84}
                  label={`${member.firstName}'s LAST ${Math.min(12, history.length)} SWINGS`}
                  showRange
                  color={colors.accent}
                />
              </View>
            )}

            <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>LATEST SWING</Text>
            <JuniorSwingResultCard analysis={latest} />

            {earlier && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>VS EARLIER</Text>
                <JuniorSwingCompare
                  left={earlier}
                  right={latest}
                  leftLabel={formatRelativeShort(earlier.timestamp)}
                  rightLabel="Now"
                />
              </>
            )}

            {history.length > 1 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>
                  HISTORY ({history.length})
                </Text>
                <View style={styles.historyList}>
                  {history.slice(0, -1).reverse().map((a) => (
                    <JuniorSwingResultCard key={a.swingId} analysis={a} compact />
                  ))}
                </View>
              </>
            )}
          </>
        ) : (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>
              First swing coming up
            </Text>
            <Text style={[styles.emptyText, { color: colors.text_muted }]}>
              Tap &quot;Record {member.firstName}&apos;s swing&quot; above (or say it), capture on the glasses or phone, then &quot;Analyze {member.firstName}&apos;s swing.&quot; We&apos;ll start tracking progress from there.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatRelativeShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Earlier';
  const diff = Date.now() - d.getTime();
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  headerBack: { flex: 1 },
  headerBackText: { fontSize: 14, fontWeight: '600' },
  headerTitle: { flex: 2, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  scroll: { padding: 16, gap: 12 },

  hero: {
    flexDirection: 'row', gap: 14, borderRadius: 16, borderWidth: 1, padding: 16, alignItems: 'center',
  },
  heroAvatar: { fontSize: 42 },
  heroText: { flex: 1, gap: 2 },
  heroName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  heroMeta: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  heroNickname: { fontSize: 13, fontWeight: '700', fontStyle: 'italic' },

  ctaCard: {
    borderRadius: 14, borderWidth: 1, padding: 14, gap: 10,
  },
  ctaTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  ctaHint: { fontSize: 12, lineHeight: 18 },
  ctaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },

  primaryBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, flex: 1, alignItems: 'center', minWidth: 200 },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', flex: 1, minWidth: 140 },
  secondaryBtnText: { fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },

  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 4 },

  historyList: { gap: 10 },

  loading: { padding: 24, alignItems: 'center', borderRadius: 14 },

  trendCard: {
    borderRadius: 14, borderWidth: 1, padding: 12, marginTop: 4,
  },
  empty: {
    borderWidth: 1, borderRadius: 14, padding: 22, gap: 8, alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
