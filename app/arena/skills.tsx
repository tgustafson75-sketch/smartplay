import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePointsStore } from '../../store/pointsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const TARGETS = [
  { distance: 50,  club: 'SW' },
  { distance: 75,  club: 'GW' },
  { distance: 100, club: 'PW' },
  { distance: 125, club: '9I' },
  { distance: 150, club: '8I' },
];

export default function Skills() {
  const router = useRouter();
  const { addPoints } = usePointsStore();
  const { voiceGender, voiceEnabled, language } = useSettingsStore();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const [currentTarget, setCurrentTarget] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [complete, setComplete] = useState(false);

  const handleResult = async (hit: boolean) => {
    const newResults = [...results, hit];
    setResults(newResults);

    if (newResults.length >= TARGETS.length) {
      setComplete(true);
      const score = newResults.filter(Boolean).length;
      const pts = score * 15;
      addPoints(pts, 'Skills Challenge');

      const summary =
        score >= 4 ? score + ' out of 5. That\'s a great round.' :
        score >= 3 ? score + ' out of 5. Solid effort.' :
                     score + ' out of 5. Keep working those distances.';

      if (voiceEnabled) {
        await configureAudioForSpeech();
        await speak(summary, voiceGender, language, apiUrl);
      }
    } else {
      setCurrentTarget(currentTarget + 1);
    }
  };

  const score = results.filter(Boolean).length;
  const target = TARGETS[currentTarget];

  if (complete) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.completeView}>
          <Text style={styles.completeTitle}>Skills Complete</Text>
          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>SCORE</Text>
            <Text style={styles.scoreValue}>{score + ' / ' + TARGETS.length}</Text>
          </View>
          <View style={styles.dotsRow}>
            {results.map((hit, i) => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: hit ? '#00C896' : '#ef4444' }]}
              />
            ))}
          </View>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace('/arena' as never)}
          >
            <Text style={styles.doneBtnText}>Back to Arena</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Skills Challenge</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Progress */}
        <View style={styles.progress}>
          {TARGETS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                i < results.length && {
                  backgroundColor: results[i] ? '#00C896' : '#ef4444',
                  borderColor: results[i] ? '#00C896' : '#ef4444',
                },
                i === currentTarget && { borderColor: '#00C896' },
              ]}
            />
          ))}
        </View>

        {/* Current target */}
        {target !== undefined && (
          <View style={styles.targetCard}>
            <Text style={styles.targetDist}>{target.distance + ' yds'}</Text>
            <Text style={styles.targetClub}>{'Suggested: ' + target.club}</Text>
            <Text style={styles.targetCount}>
              {'Target ' + (currentTarget + 1) + ' of ' + TARGETS.length}
            </Text>
          </View>
        )}

        {/* Hit or miss */}
        <TouchableOpacity style={styles.hitBtn} onPress={() => handleResult(true)}>
          <Text style={styles.hitBtnText}>✓ Hit the Target</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.missBtn} onPress={() => handleResult(false)}>
          <Text style={styles.missBtnText}>✕ Missed</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backText: {
    color: '#00C896',
    fontSize: 16,
    fontWeight: '600',
    width: 60,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 32,
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1e3a28',
    borderWidth: 2,
    borderColor: '#1e3a28',
  },
  targetCard: {
    backgroundColor: '#0d2418',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
  },
  targetDist: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '900',
  },
  targetClub: {
    color: '#00C896',
    fontSize: 16,
    marginTop: 8,
  },
  targetCount: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 8,
  },
  hitBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 10,
  },
  hitBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  missBtn: {
    backgroundColor: '#1a0a0a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 18,
    alignItems: 'center',
  },
  missBtnText: {
    color: '#ef4444',
    fontSize: 17,
    fontWeight: '700',
  },
  completeView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  completeTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 24,
  },
  scoreCard: {
    backgroundColor: '#0d2418',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  scoreLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  scoreValue: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '900',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 32,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  doneBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
