import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCageStore } from '../../store/cageStore';
import { startReviewSession , getShotsForReview } from '../../services/cageReview';
import { REVIEW_MODES, type ReviewSession } from '../../types/cageReview';

export default function CageReviewStart() {
  const router = useRouter();
  const { session_id } = useLocalSearchParams<{ session_id: string }>();
  const { sessionHistory } = useCageStore();
  const [selectedMode, setSelectedMode] = useState<ReviewSession['mode'] | null>(null);
  const [starting, setStarting] = useState(false);

  const session = sessionHistory.find(s => s.id === session_id) ?? null;

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Session not found</Text>
          <Text style={styles.emptyText}>This session may have been cleared from history.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (session.shots.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No swings logged</Text>
          <Text style={styles.emptyText}>No swings were detected this session. Start another session to use review mode.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleStart = async () => {
    if (!selectedMode) return;
    setStarting(true);
    try {
      const reviewSession = await startReviewSession(session.id, selectedMode);
      router.replace({
        pathname: '/cage-review/[review_session_id]',
        params: { review_session_id: reviewSession.id },
      } as never);
    } catch {
      setStarting(false);
    }
  };

  const previewCount = selectedMode
    ? getShotsForReview(selectedMode, session.shots).length
    : session.shots.length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review with Kevin</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sessionMeta}>
          {session.club} · {session.shots.length} shots
        </Text>

        <Text style={styles.sectionLabel}>REVIEW MODE</Text>

        {REVIEW_MODES.map(mode => (
          <TouchableOpacity
            key={mode.id}
            style={[styles.modeCard, selectedMode === mode.id && styles.modeCardActive]}
            onPress={() => setSelectedMode(mode.id)}
            activeOpacity={0.8}
          >
            <View style={styles.modeCardHeader}>
              <Text style={[styles.modeTitle, selectedMode === mode.id && styles.modeTitleActive]}>
                {mode.title}
              </Text>
              <Text style={styles.modeTime}>{mode.time}</Text>
            </View>
            <Text style={styles.modeDesc}>{mode.description}</Text>
          </TouchableOpacity>
        ))}

        {selectedMode && (
          <Text style={styles.previewText}>
            Kevin will review {previewCount} shot{previewCount !== 1 ? 's' : ''} with you.
          </Text>
        )}

        <TouchableOpacity
          style={[styles.startBtn, !selectedMode && styles.startBtnDisabled]}
          onPress={handleStart}
          disabled={!selectedMode || starting}
        >
          {starting ? (
            <ActivityIndicator color="#060f09" />
          ) : (
            <Text style={styles.startBtnText}>
              {selectedMode ? 'Start Review' : 'Select a mode'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 60 },
  sessionMeta: { color: '#6b7280', fontSize: 13, marginBottom: 20 },
  sectionLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
  modeCard: {
    backgroundColor: '#0d2418', borderRadius: 12,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 14, marginBottom: 10,
  },
  modeCardActive: { borderColor: '#00C896', backgroundColor: '#0a2a1c' },
  modeCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modeTitle: { color: '#9ca3af', fontSize: 15, fontWeight: '800' },
  modeTitleActive: { color: '#00C896' },
  modeTime: { color: '#4b5563', fontSize: 11 },
  modeDesc: { color: '#6b7280', fontSize: 13, lineHeight: 18 },
  previewText: { color: '#4b5563', fontSize: 12, marginTop: 6, marginBottom: 4, textAlign: 'center' },
  startBtn: {
    backgroundColor: '#00C896', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 24,
  },
  startBtnDisabled: { backgroundColor: '#1e3a28' },
  startBtnText: { color: '#060f09', fontSize: 16, fontWeight: '800' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  emptyText: { color: '#6b7280', fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
