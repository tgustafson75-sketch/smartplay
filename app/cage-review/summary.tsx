import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getReviewSession } from '../../services/cageReview';
import { getCurrentProfile } from '../../services/vocabularyProfile';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import type { ReviewSession } from '../../types/cageReview';
import type { VocabularyProfile } from '../../types/vocabulary';
import type { ReviewLabels } from '../../store/cageStore';
import { getApiBaseUrl } from '../../services/apiBase';

export default function CageReviewSummary() {
  const { review_session_id } = useLocalSearchParams<{ review_session_id: string }>();
  const router = useRouter();
  const { sessionHistory } = useCageStore();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = getApiBaseUrl();

  const [review, setReview] = useState<ReviewSession | null>(null);
  const [profile, setProfile] = useState<VocabularyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!review_session_id) return;
      const [r, p] = await Promise.all([
        getReviewSession(review_session_id),
        getCurrentProfile(),
      ]);
      setReview(r);
      setProfile(p);
      setLoading(false);

      if (voiceEnabled && p?.kevin_summary) {
        setTimeout(async () => {
          await configureAudioForSpeech();
          speak(p.kevin_summary, voiceGender, language, apiUrl).catch(() => {});
        }, 600);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review_session_id]);

  // ── Stats from reviewed shots ─────────────────────────────────────────────

  const reviewedShots = (() => {
    if (!review) return [];
    const cageSession = sessionHistory.find(s => s.id === review.cage_session_id);
    if (!cageSession) return [];
    return cageSession.shots.filter(s =>
      review.shots_reviewed.includes(s.id) && s.review_labels
    );
  })();

  const strikeDistribution = (() => {
    const counts: Partial<Record<ReviewLabels['strike_location'], number>> = {};
    reviewedShots.forEach(s => {
      if (!s.review_labels) return;
      const loc = s.review_labels.strike_location;
      counts[loc] = (counts[loc] ?? 0) + 1;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([loc, count]) => ({ loc, count }));
  })();

  const qualityDistribution = (() => {
    const counts: Partial<Record<ReviewLabels['contact_quality'], number>> = {};
    reviewedShots.forEach(s => {
      if (!s.review_labels) return;
      const q = s.review_labels.contact_quality;
      counts[q] = (counts[q] ?? 0) + 1;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([q, count]) => ({ q, count }));
  })();

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00C896" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const labeledCount = review?.shots_reviewed.length ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.title}>Review Complete</Text>
          <Text style={styles.subtitle}>{labeledCount} shot{labeledCount !== 1 ? 's' : ''} labeled</Text>
        </View>

        {/* KEVIN VOCABULARY SUMMARY */}
        {profile?.kevin_summary && (
          <View style={styles.kevinCard}>
            <Text style={styles.kevinLabel}>KEVIN</Text>
            <Text style={styles.kevinText}>{profile.kevin_summary}</Text>
          </View>
        )}

        {/* STRIKE DISTRIBUTION */}
        {strikeDistribution.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>STRIKE LOCATION</Text>
            <View style={styles.distCard}>
              {strikeDistribution.map(({ loc, count }) => (
                <View key={loc} style={styles.distRow}>
                  <Text style={styles.distLabel}>
                    {loc.charAt(0).toUpperCase() + loc.slice(1)}
                  </Text>
                  <View style={styles.distBarWrap}>
                    <View
                      style={[
                        styles.distBar,
                        {
                          width: `${Math.round((count / reviewedShots.length) * 100)}%`,
                          backgroundColor: loc === 'center' ? '#00C896' : loc === 'unknown' ? '#374151' : '#f97316',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.distCount}>{count}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* CONTACT QUALITY */}
        {qualityDistribution.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>CONTACT QUALITY</Text>
            <View style={styles.distCard}>
              {qualityDistribution.map(({ q, count }) => (
                <View key={q} style={styles.distRow}>
                  <Text style={styles.distLabel}>
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </Text>
                  <View style={styles.distBarWrap}>
                    <View
                      style={[
                        styles.distBar,
                        {
                          width: `${Math.round((count / reviewedShots.length) * 100)}%`,
                          backgroundColor: q === 'pure' || q === 'good' ? '#00C896' : q === 'okay' ? '#fbbf24' : '#ef4444',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.distCount}>{count}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* VOCABULARY PROFILE */}
        {profile && (
          <>
            <Text style={styles.sectionLabel}>YOUR VOCABULARY</Text>
            <View style={styles.vocabCard}>
              {profile.observed_terminology.strike_terms.length > 0 && (
                <View style={styles.vocabRow}>
                  <Text style={styles.vocabRowLabel}>Strike</Text>
                  <Text style={styles.vocabTerms}>
                    {profile.observed_terminology.strike_terms.join(', ')}
                  </Text>
                </View>
              )}
              {profile.observed_terminology.contact_terms.length > 0 && (
                <View style={styles.vocabRow}>
                  <Text style={styles.vocabRowLabel}>Contact</Text>
                  <Text style={styles.vocabTerms}>
                    {profile.observed_terminology.contact_terms.join(', ')}
                  </Text>
                </View>
              )}
              {profile.observed_terminology.diagnostic_terms.length > 0 && (
                <View style={styles.vocabRow}>
                  <Text style={styles.vocabRowLabel}>Diagnosis</Text>
                  <Text style={styles.vocabTerms}>
                    {profile.observed_terminology.diagnostic_terms.join(', ')}
                  </Text>
                </View>
              )}
              {profile.observed_terminology.feel_terms.length > 0 && (
                <View style={styles.vocabRow}>
                  <Text style={styles.vocabRowLabel}>Feel</Text>
                  <Text style={styles.vocabTerms}>
                    {profile.observed_terminology.feel_terms.join(', ')}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* DONE */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.replace('/(tabs)/swinglab' as never)}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  content: { padding: 16, paddingBottom: 60 },
  header: { marginBottom: 20 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '900', marginBottom: 4 },
  subtitle: { color: '#6b7280', fontSize: 14 },
  kevinCard: {
    backgroundColor: '#0d2418', borderLeftWidth: 3, borderLeftColor: '#00C896',
    borderRadius: 10, padding: 14, marginBottom: 20,
  },
  kevinLabel: { color: '#00C896', fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  kevinText: { color: '#ffffff', fontSize: 15, lineHeight: 22 },
  sectionLabel: {
    color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2,
    marginBottom: 8, marginTop: 4,
  },
  distCard: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12, marginBottom: 16, gap: 8,
  },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', width: 68 },
  distBarWrap: { flex: 1, height: 8, backgroundColor: '#1e3a28', borderRadius: 4, overflow: 'hidden' },
  distBar: { height: 8, borderRadius: 4 },
  distCount: { color: '#6b7280', fontSize: 11, width: 20, textAlign: 'right' },
  vocabCard: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12, marginBottom: 16, gap: 8,
  },
  vocabRow: { flexDirection: 'row', gap: 8 },
  vocabRowLabel: { color: '#4b5563', fontSize: 11, fontWeight: '700', width: 68 },
  vocabTerms: { flex: 1, color: '#e5e7eb', fontSize: 12, lineHeight: 18 },
  doneBtn: {
    backgroundColor: '#00C896', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  doneBtnText: { color: '#060f09', fontSize: 16, fontWeight: '800' },
});
