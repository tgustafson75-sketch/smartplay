import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePointsStore } from '../../store/pointsStore';
import AppIcon from '../../components/AppIcon';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { scoreCTPShot, bucketToFeet } from '../../services/cvScoring';
import { Alert } from 'react-native';

const DISTANCES = [50, 75, 100, 125, 150, 175, 200];

const RESULT_OPTIONS = [
  { label: 'Inside 3ft',   value: 3,  color: '#F5A623' },
  { label: 'Inside 6ft',   value: 6,  color: '#00C896' },
  { label: 'Inside 10ft',  value: 10, color: '#60a5fa' },
  { label: 'Inside 20ft',  value: 20, color: '#9ca3af' },
  { label: 'Outside 20ft', value: 30, color: '#6b7280' },
  { label: 'Missed green', value: 99, color: '#ef4444' },
];

const MAX_SHOTS = 5;

export default function CTP() {
  const router = useRouter();
  const { addPoints } = usePointsStore();
  const { voiceGender, voiceEnabled, language } = useSettingsStore();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const [distance, setDistance] = useState(100);
  const [started, setStarted] = useState(false);
  const [results, setResults] = useState<number[]>([]);
  const [complete, setComplete] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [tierUpgrade, setTierUpgrade] = useState<{ from: string; to: string } | null>(null);

  // Phase L — score the current shot via camera + CV. Falls back to manual
  // bucket buttons either way (Mike's choice; CV is just a faster path).
  const handleCameraScore = async () => {
    if (scoring) return;
    setScoring(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera needed', 'Grant camera access to score shots with the camera.');
        return;
      }
      const photo = await ImagePicker.launchCameraAsync({ quality: 0.85, base64: false });
      if (photo.canceled || !photo.assets?.[0]?.uri) return;
      const m = await ImageManipulator.manipulateAsync(
        photo.assets[0].uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!m.base64) {
        Alert.alert('Could not encode photo', 'Try again.');
        return;
      }
      const result = await scoreCTPShot(m.base64, distance, 'image/jpeg');
      if (result.kind === 'ok') {
        const feet = result.scoring.proximity_feet ?? bucketToFeet(result.scoring.proximity_bucket);
        handleResult(feet);
      } else if (result.kind === 'low_quality') {
        Alert.alert('Hard to read', result.follow_up);
      } else if (result.kind === 'no_network') {
        Alert.alert('No connection', "Use the manual buttons or try the camera again when you're back online.");
      } else {
        Alert.alert('Scoring failed', "Use the manual buttons for this shot.");
      }
    } finally {
      setScoring(false);
    }
  };

  const handleResult = async (feet: number) => {
    const newResults = [...results, feet];
    setResults(newResults);

    if (newResults.length >= MAX_SHOTS) {
      setComplete(true);
      const validShots = newResults.filter(r => r < 99);
      const best = validShots.length > 0 ? Math.min(...validShots) : Infinity;
      const pts =
        best <= 3 ? 50 :
        best <= 6 ? 40 :
        best <= 10 ? 30 :
        best <= 20 ? 20 : 10;
      // Phase R — capture old tier before mutating to detect upgrade celebration
      const oldTier = usePointsStore.getState().tier;
      addPoints(pts, 'CTP Challenge');
      const newTier = usePointsStore.getState().tier;
      if (newTier !== oldTier) {
        setTierUpgrade({ from: oldTier, to: newTier });
      }

      const summary =
        best < 99
          ? 'Best shot was ' + best + ' feet. ' +
            (best <= 6 ? 'That\'s a great result.' : 'Keep working on it.')
          : 'Tough round. Keep at the distance work.';

      if (voiceEnabled) {
        await configureAudioForSpeech();
        await speak(summary, voiceGender, language, apiUrl);
      }
    }
  };

  const validResults = results.filter(r => r < 99);
  const bestResult = validResults.length > 0 ? Math.min(...validResults) : null;

  if (complete) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.completeView}>
          <Text style={styles.completeTitle}>Challenge Complete</Text>
          <Text style={styles.completeSub}>{distance + ' yard CTP'}</Text>

          <View style={styles.bestCard}>
            <Text style={styles.bestLabel}>BEST SHOT</Text>
            <Text style={styles.bestValue}>
              {bestResult !== null ? bestResult + ' ft' : 'Missed green'}
            </Text>
          </View>

          <View style={styles.dotsRow}>
            {results.map((r, i) => (
              <View
                key={i}
                style={[styles.resultDot, {
                  backgroundColor:
                    r <= 3 ? '#F5A623' :
                    r <= 6 ? '#00C896' :
                    r <= 10 ? '#60a5fa' :
                    r <= 20 ? '#9ca3af' : '#ef4444',
                }]}
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

        {/* Phase R — tier upgrade celebration */}
        <Modal visible={tierUpgrade != null} transparent animationType="fade" onRequestClose={() => setTierUpgrade(null)}>
          <Pressable style={styles.tierBg} onPress={() => setTierUpgrade(null)}>
            <Pressable style={styles.tierCard} onPress={() => {}}>
              <AppIcon name="trophy" size={56} color="#F5A623" />
              <Text style={styles.tierTitle}>Tier Up</Text>
              <Text style={styles.tierFrom}>{tierUpgrade?.from}</Text>
              <Text style={styles.tierArrow}>↓</Text>
              <Text style={styles.tierTo}>{tierUpgrade?.to}</Text>
              <TouchableOpacity style={styles.tierBtn} onPress={() => setTierUpgrade(null)}>
                <Text style={styles.tierBtnText}>Nice</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Closest to Pin</Text>
          <View style={{ width: 60 }} />
        </View>

        {!started ? (
          <>
            <Text style={styles.label}>Pick your distance</Text>
            <View style={styles.distGrid}>
              {DISTANCES.map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.distBtn, distance === d && styles.distBtnActive]}
                  onPress={() => setDistance(d)}
                >
                  <Text style={[styles.distBtnText, distance === d && styles.distBtnTextActive]}>
                    {d + ' yds'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.startBtn} onPress={() => setStarted(true)}>
              <Text style={styles.startBtnText}>Start Challenge</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.shotInfo}>
              <Text style={styles.shotInfoDist}>{distance + ' yards'}</Text>
              <Text style={styles.shotInfoCount}>
                {'Shot ' + (results.length + 1) + ' of ' + MAX_SHOTS}
              </Text>
            </View>

            <Text style={styles.label}>How close?</Text>

            {/* Phase L — Camera-based scoring shortcut. Manual buckets stay as
                 the primary fallback. */}
            <TouchableOpacity
              onPress={handleCameraScore}
              disabled={scoring}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, paddingVertical: 14, marginBottom: 12,
                borderWidth: 1.5, borderColor: '#F5A623', borderRadius: 12,
                backgroundColor: 'rgba(245,166,35,0.08)',
                opacity: scoring ? 0.5 : 1,
              }}
              activeOpacity={0.85}
            >
              <AppIcon name="camera" size={18} color="#F5A623" />
              <Text style={{ color: '#F5A623', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 }}>
                {scoring ? 'Scoring…' : 'Score with photo'}
              </Text>
            </TouchableOpacity>

            {RESULT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.resultBtn, { borderColor: opt.color }]}
                onPress={() => handleResult(opt.value)}
              >
                <Text style={[styles.resultBtnText, { color: opt.color }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}

            {results.length > 0 && (
              <View style={styles.dotsRow}>
                {results.map((r, i) => (
                  <View
                    key={i}
                    style={[styles.resultDot, {
                      backgroundColor:
                        r <= 3 ? '#F5A623' :
                        r <= 6 ? '#00C896' :
                        r <= 10 ? '#60a5fa' :
                        r <= 20 ? '#9ca3af' : '#ef4444',
                    }]}
                  />
                ))}
              </View>
            )}
          </>
        )}
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
    marginBottom: 20,
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
  label: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  distGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  distBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
  },
  distBtnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  distBtnText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  distBtnTextActive: {
    color: '#00C896',
  },
  startBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  shotInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  shotInfoDist: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
  },
  shotInfoCount: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
  },
  resultBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#0d1a0d',
  },
  resultBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
  },
  resultDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
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
    marginBottom: 8,
  },
  completeSub: {
    color: '#6b7280',
    fontSize: 16,
    marginBottom: 32,
  },
  bestCard: {
    backgroundColor: '#0d2418',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  bestLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  bestValue: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '900',
  },
  doneBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
    alignItems: 'center',
    marginTop: 16,
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  // Phase R — tier upgrade celebration
  tierBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  tierCard: {
    width: '78%', maxWidth: 360, padding: 28, borderRadius: 20,
    backgroundColor: '#0d1a0d', borderWidth: 2, borderColor: '#F5A623',
    alignItems: 'center',
  },
  tierEmoji: { fontSize: 56 },
  tierTitle: { color: '#F5A623', fontSize: 22, fontWeight: '900', letterSpacing: 1, marginTop: 8 },
  tierFrom: { color: '#6b7280', fontSize: 14, marginTop: 16 },
  tierArrow: { color: '#6b7280', fontSize: 18, marginVertical: 4 },
  tierTo: { color: '#fff', fontSize: 22, fontWeight: '800' },
  tierBtn: { marginTop: 24, backgroundColor: '#F5A623', paddingHorizontal: 36, paddingVertical: 12, borderRadius: 12 },
  tierBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },
});
