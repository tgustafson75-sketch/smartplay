import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import KevinCoachBox from '../../components/swinglab/KevinCoachBox';
import {
  analyzeSession,
  getKevinShotResponse,
} from '../../services/patternEngine';
import {
  speak,
  configureAudioForSpeech,
  isSpeaking,
  stopSpeaking,
} from '../../services/voiceService';
import { useWatchStore } from '../../store/watchStore';
import { simulateSwing, getKevinTempoLine } from '../../services/watchService';
import { setSuppressed as setEarbudSuppressed } from '../../services/earbudControl';
import AppIcon from '../../components/AppIcon';
import { recognizeClubFromUri, clubLabel } from '../../services/clubRecognition';
import { track } from '../../services/analytics';

// Phase BL — manual picker grid. Values match the legacy CLUBS list in
// app/cage/index.tsx and the ClubId catalog in services/clubRecognition.ts.
const CLUB_PICKER: { label: string; value: string }[] = [
  { label: 'Driver', value: 'DR' },
  { label: '3 Wood', value: '3W' },
  { label: '5 Wood', value: '5W' },
  { label: '7 Wood', value: '7W' },
  { label: '3 Hybrid', value: '3H' },
  { label: '4 Hybrid', value: '4H' },
  { label: '5 Hybrid', value: '5H' },
  { label: '4 Iron', value: '4I' },
  { label: '5 Iron', value: '5I' },
  { label: '6 Iron', value: '6I' },
  { label: '7 Iron', value: '7I' },
  { label: '8 Iron', value: '8I' },
  { label: '9 Iron', value: '9I' },
  { label: 'PW', value: 'PW' },
  { label: 'GW', value: 'GW' },
  { label: 'SW', value: 'SW' },
  { label: 'LW', value: 'LW' },
];

const FEEL_OPTIONS = [
  { label: 'Flush',  value: 'flush', color: '#00C896', emoji: '🎯' },
  { label: 'Solid',  value: 'solid', color: '#00C896', emoji: '✓' },
  { label: 'Fat',    value: 'fat',   color: '#f97316', emoji: '⬇️' },
  { label: 'Thin',   value: 'thin',  color: '#fbbf24', emoji: '⬆️' },
  { label: 'Heel',   value: 'heel',  color: '#ef4444', emoji: '←' },
  { label: 'Toe',    value: 'toe',   color: '#ef4444', emoji: '→' },
];

const SHAPE_OPTIONS = [
  { label: 'Draw',     value: 'draw' },
  { label: 'Straight', value: 'straight' },
  { label: 'Fade',     value: 'fade' },
  { label: 'Hook',     value: 'hook' },
  { label: 'Slice',    value: 'slice' },
  { label: 'Push',     value: 'push' },
  { label: 'Pull',     value: 'pull' },
];

export default function CageSession() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();
  const _params = useLocalSearchParams();

  const { activeSession, addShot, endSession, setActiveClub, clubMenuOpen, setClubMenuOpen } = useCageStore();
  const { voiceGender, voiceEnabled, language, cageAutoClubDetection } = useSettingsStore();
  const { isConnected: watchConnected, recordSwing: recordWatchSwing } = useWatchStore();
  const { addObservation, updateClubConfidence } = useRelationshipStore();
  const { dominantMiss: _dominantMiss } = usePlayerProfileStore();
  const [identifyingClub, setIdentifyingClub] = useState(false);

  const [selectedFeel, setSelectedFeel] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState('');
  const [shotCount, setShotCount] = useState(0);
  const [isKevinSpeaking, setIsKevinSpeaking] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  // Phase BL — currentClub reflects mid-session switches; falls back to the
  // session's initial club for legacy sessions without segments.
  const club = activeSession?.currentClub ?? activeSession?.club ?? '7I';
  const shots = activeSession?.shots ?? [];

  useEffect(() => {
    if (!activeSession) {
      router.replace('/cage' as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  // Phase O.5 — earbud-tap suppression while user is in active swing capture.
  // Restored on unmount so PostSessionReview gets normal earbud behavior.
  useEffect(() => {
    setEarbudSuppressed(true);
    return () => { setEarbudSuppressed(false); };
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const opening = "Let's go. " + club + '. One shot at a time.';
    setLastResponse(opening);
    if (voiceEnabled) {
      setTimeout(async () => {
        setIsKevinSpeaking(true);
        await configureAudioForSpeech();
        await speak(opening, voiceGender, language, apiUrl);
        setIsKevinSpeaking(false);
      }, 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flashKevinCard = () => {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Phase BL — register the new club, fire confidence-aware Kevin/Serena
  // ack, and close the manual picker if it was open. Used by all three
  // trigger paths (manual / vision / voice → comes through setActiveClub).
  const applyClubSwitch = async (
    club_id: string,
    source: 'manual' | 'voice' | 'vision',
    confidence?: 'high' | 'medium' | 'low',
  ) => {
    if (!activeSession) return;
    if (activeSession.currentClub === club_id) {
      setClubMenuOpen(false);
      return;
    }
    setActiveClub(club_id, source, confidence);
    setClubMenuOpen(false);

    if (voiceEnabled) {
      const ack = source === 'vision' && confidence === 'medium'
        ? `Looks like ${clubLabel(club_id)}.`
        : `Got it, ${clubLabel(club_id)}.`;
      try {
        setIsKevinSpeaking(true);
        await configureAudioForSpeech();
        await speak(ack, voiceGender, language, apiUrl);
      } catch {
        // ignore TTS failures — the visual switch already happened
      } finally {
        setIsKevinSpeaking(false);
      }
    }
  };

  // Phase BL — primary photo path. User taps "Identify Club", camera
  // opens, snaps the club sole, vision reads the stamped number, three-tier
  // confidence routes to auto-register / confirm prompt / manual fallback.
  const handleIdentifyClub = async () => {
    if (!activeSession || identifyingClub) return;

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access to identify clubs by their sole stamp.');
      return;
    }

    setIdentifyingClub(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) {
        track('club_recognition_cancelled', {});
        return;
      }

      const outcome = await recognizeClubFromUri(result.assets[0].uri, apiUrl);

      if (outcome.kind !== 'ok') {
        Alert.alert(
          "Couldn't read the club",
          'Pick it from the list and try the camera again next time.',
          [{ text: 'OK', onPress: () => setClubMenuOpen(true) }],
        );
        return;
      }

      if (outcome.club_id === 'unknown' || outcome.confidence === 'low') {
        track('club_recognition_low_confidence', { club_id: outcome.club_id });
        Alert.alert(
          "Couldn't read the club",
          'Pick it from the list — better lighting or angle next time.',
          [{ text: 'OK', onPress: () => setClubMenuOpen(true) }],
        );
        return;
      }

      if (outcome.confidence === 'medium') {
        Alert.alert(
          'Looks like ' + clubLabel(outcome.club_id),
          outcome.reasoning || 'Confirm or pick a different one.',
          [
            { text: 'Different club', onPress: () => setClubMenuOpen(true) },
            { text: 'Yes, ' + clubLabel(outcome.club_id), onPress: () => applyClubSwitch(outcome.club_id, 'vision', 'medium') },
          ],
        );
        return;
      }

      // High confidence — auto-register
      await applyClubSwitch(outcome.club_id, 'vision', 'high');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      track('club_recognition_exception', { message: msg });
      Alert.alert('Something went wrong', "Pick the club from the list and we'll try again next time.", [
        { text: 'OK', onPress: () => setClubMenuOpen(true) },
      ]);
    } finally {
      setIdentifyingClub(false);
    }
  };

  const handleLogShot = async () => {
    if (!selectedFeel) return;
    if (isSpeaking()) {
      await stopSpeaking();
    }

    const shotData = {
      club,
      feel: selectedFeel,
      shape: selectedShape,
      contact: selectedFeel,
      direction: selectedShape,
      clipUri: null,
      acousticContact: null,
      aiAnalysis: null,
    };

    addShot(shotData);
    const newCount = shotCount + 1;
    setShotCount(newCount);

    const allShots = [
      ...shots,
      { ...shotData, id: 'temp', timestamp: Date.now() },
    ];
    const pattern = analyzeSession(allShots, club);

    let kevinResponse = '';

    if (newCount % 5 === 0) {
      kevinResponse = pattern.kevinSummary;

      if (pattern.rootCause) {
        addObservation({
          type: 'technical',
          content:
            club + ': ' + pattern.rootCause +
            (pattern.rootCauseDetail ? '. ' + pattern.rootCauseDetail : ''),
        });
      }

      updateClubConfidence(club, pattern.flushRate / 100);

    } else if (newCount === 10 && pattern.kevinNextDrill) {
      kevinResponse = pattern.kevinNextDrill;

    } else if (newCount === 15) {
      if (pattern.trend === 'improving') {
        kevinResponse = "You're finding it. Better in the second half.";
      } else if (pattern.trend === 'declining') {
        kevinResponse = 'Losing it a little. Reset. One shot at a time.';
      } else {
        kevinResponse = pattern.kevinSummary;
      }

    } else {
      kevinResponse = getKevinShotResponse(
        selectedFeel,
        selectedShape,
        newCount,
        pattern,
        club,
      );
    }

    if (pattern.streakInfo && newCount % 5 !== 0) {
      kevinResponse = pattern.streakInfo;
    }

    flashKevinCard();
    setLastResponse(kevinResponse);

    if (voiceEnabled && kevinResponse) {
      setIsKevinSpeaking(true);
      await configureAudioForSpeech();
      await speak(kevinResponse, voiceGender, language, apiUrl);
      setIsKevinSpeaking(false);
    }

    // Watch tempo comment every 3 shots
    if (watchConnected) {
      const watchMetrics = simulateSwing(club, selectedFeel);
      recordWatchSwing(watchMetrics);
      if (newCount % 3 === 0) {
        const tempoLine = getKevinTempoLine(watchMetrics, club);
        setTimeout(async () => {
          if (voiceEnabled) {
            await configureAudioForSpeech();
            await speak(tempoLine, voiceGender, language, apiUrl);
          }
        }, 2000);
      }
    }

    setSelectedFeel(null);
    setSelectedShape(null);
  };

  const handleEndSession = () => {
    const pattern = analyzeSession(shots, club);

    if (shots.length >= 5) {
      updateClubConfidence(club, pattern.flushRate / 100);
    }

    endSession({
      dominantMiss: pattern.dominantMiss,
      rootCause: pattern.rootCause,
      summary: pattern.kevinSummary,
    });
    router.replace('/cage/summary' as never);
  };

  const pattern = analyzeSession(shots, club);

  const trendIcon =
    pattern.trend === 'improving'  ? '↑' :
    pattern.trend === 'declining'  ? '↓' :
    pattern.trend === 'consistent' ? '→' : '';

  const trendColor =
    pattern.trend === 'improving'  ? '#00C896' :
    pattern.trend === 'declining'  ? '#ef4444' : '#6b7280';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleEndSession}>
            <Text style={styles.endText}>End</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            {/* Phase BL — tap to open manual picker; long-press disabled in
                 favor of the explicit camera button below to keep gestures
                 obvious for one-handed cage use. */}
            <TouchableOpacity onPress={() => setClubMenuOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
              <Text style={styles.title}>{club}</Text>
            </TouchableOpacity>
            <View style={styles.headerSubRow}>
              <Text style={styles.shotCount}>{shots.length + ' shots'}</Text>
              {cageAutoClubDetection && (
                <TouchableOpacity
                  onPress={handleIdentifyClub}
                  disabled={identifyingClub}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.identifyBtn}
                >
                  <AppIcon name="camera-outline" size={12} color={identifyingClub ? '#6b7280' : '#00C896'} />
                  <Text style={[styles.identifyBtnText, identifyingClub && { color: '#6b7280' }]}>
                    {identifyingClub ? 'Reading…' : 'ID club'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.headerRight}>
            <Text style={[styles.trendIcon, { color: trendColor }]}>
              {trendIcon}
            </Text>
            {watchConnected && (
              <AppIcon name="watch-outline" size={14} color="#60a5fa" />
            )}
          </View>
        </View>

        {/* Phase I.5 — Kevin minimized to ambient indicator during active
             recording. Silent in foreground; the box re-expands at the
             post-session review screen. */}
        <KevinCoachBox body="" minimized />

        {/* PATTERN BAR */}
        {shots.length >= 3 && (
          <View style={styles.patternWrap}>
            <View style={styles.patternBar}>
              {pattern.flushRate > 0 && (
                <View style={[
                  styles.patternFill,
                  { flex: pattern.flushRate, backgroundColor: '#00C896' },
                ]} />
              )}
              {pattern.fatRate > 0 && (
                <View style={[
                  styles.patternFill,
                  { flex: pattern.fatRate, backgroundColor: '#f97316' },
                ]} />
              )}
              {pattern.thinRate > 0 && (
                <View style={[
                  styles.patternFill,
                  { flex: pattern.thinRate, backgroundColor: '#fbbf24' },
                ]} />
              )}
              {(pattern.heelRate + pattern.toeRate) > 0 && (
                <View style={[
                  styles.patternFill,
                  {
                    flex: pattern.heelRate + pattern.toeRate,
                    backgroundColor: '#ef4444',
                  },
                ]} />
              )}
            </View>
            <View style={styles.patternLegend}>
              <Text style={[styles.legendItem, { color: '#00C896' }]}>
                {pattern.flushRate + '%'}
              </Text>
              {pattern.fatRate > 0 && (
                <Text style={[styles.legendItem, { color: '#f97316' }]}>
                  {'Fat ' + pattern.fatRate + '%'}
                </Text>
              )}
              {pattern.thinRate > 0 && (
                <Text style={[styles.legendItem, { color: '#fbbf24' }]}>
                  {'Thin ' + pattern.thinRate + '%'}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* KEVIN CARD */}
        {lastResponse !== '' && (
          <Animated.View style={[styles.kevinCard, { opacity: fadeAnim }]}>
            <View style={styles.kevinHeader}>
              <Text style={styles.kevinLabel}>KEVIN</Text>
              {isKevinSpeaking && (
                <Text style={styles.speakingDot}>●</Text>
              )}
            </View>
            <Text style={styles.kevinText}>{lastResponse}</Text>
            {pattern.rootCause && shots.length >= 5 && (
              <View style={styles.rootCauseBadge}>
                <Text style={styles.rootCauseText}>{pattern.rootCause}</Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* FEEL BUTTONS */}
        <Text style={styles.sectionLabel}>Contact?</Text>
        <View style={styles.feelGrid}>
          {FEEL_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.feelBtn,
                selectedFeel === opt.value && {
                  borderColor: opt.color,
                  backgroundColor: opt.color + '25',
                },
              ]}
              onPress={() => setSelectedFeel(opt.value)}
            >
              <Text style={styles.feelEmoji}>{opt.emoji}</Text>
              <Text style={[
                styles.feelBtnText,
                selectedFeel === opt.value && {
                  color: opt.color,
                  fontWeight: '800',
                },
              ]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* SHAPE BUTTONS */}
        <Text style={styles.sectionLabel}>Shape?</Text>
        <View style={styles.shapeGrid}>
          {SHAPE_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.shapeBtn,
                selectedShape === opt.value && styles.shapeBtnActive,
              ]}
              onPress={() =>
                setSelectedShape(selectedShape === opt.value ? null : opt.value)
              }
            >
              <Text style={[
                styles.shapeBtnText,
                selectedShape === opt.value && styles.shapeBtnTextActive,
              ]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* LOG SHOT */}
        <TouchableOpacity
          style={[styles.logBtn, !selectedFeel && styles.logBtnDisabled]}
          onPress={handleLogShot}
          disabled={!selectedFeel}
          activeOpacity={0.85}
        >
          <Text style={styles.logBtnText}>Log Shot</Text>
        </TouchableOpacity>

        {/* SWINGLAB */}
        <TouchableOpacity
          style={styles.smartMotionBtn}
          onPress={() => router.push('/(tabs)/swinglab' as never)}
        >
          <AppIcon name="film-outline" size={20} color="#00C896" />
          <Text style={styles.smartMotionLabel}>SwingLab</Text>
        </TouchableOpacity>

        {/* SHOT HISTORY DOTS */}
        {shots.length > 0 && (
          <View style={styles.history}>
            <Text style={styles.historyLabel}>SESSION</Text>
            <View style={styles.dotsWrap}>
              {shots.map((shot, i) => {
                const color =
                  shot.feel === 'flush' || shot.feel === 'solid' ? '#00C896' :
                  shot.feel === 'fat'  ? '#f97316' :
                  shot.feel === 'thin' ? '#fbbf24' : '#ef4444';
                return (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: color,
                        opacity:  (i + 1) % 5 === 0 ? 1 : 0.7,
                        width:    (i + 1) % 5 === 0 ? 16 : 12,
                        height:   (i + 1) % 5 === 0 ? 16 : 12,
                        borderRadius: (i + 1) % 5 === 0 ? 8 : 6,
                      },
                    ]}
                  />
                );
              })}
            </View>
            <View style={styles.statsRow}>
              <Text style={styles.statText}>{pattern.flushRate + '% solid'}</Text>
              {pattern.dominantMiss && (
                <Text style={styles.statText}>{'Miss: ' + pattern.dominantMiss}</Text>
              )}
              {pattern.streakInfo && (
                <Text style={[styles.statText, { color: '#00C896' }]}>
                  {pattern.streakInfo}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* DRILL SUGGESTION */}
        {pattern.kevinNextDrill && shots.length >= 10 && (
          <View style={styles.drillCard}>
            <Text style={styles.drillLabel}>KEVIN SUGGESTS</Text>
            <Text style={styles.drillText}>{pattern.kevinNextDrill}</Text>
          </View>
        )}

      </ScrollView>

      {/* Phase BL — manual club picker. Always-accessible tertiary fallback
           for the auto-recognition flow. Opened by header tap, vision low-
           confidence, or the "show clubs" voice intent. */}
      <Modal
        visible={clubMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setClubMenuOpen(false)}
      >
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Switch Club</Text>
            <Text style={styles.pickerSub}>Tap to switch — new shots will tag this club.</Text>
            <View style={styles.pickerGrid}>
              {CLUB_PICKER.map(c => {
                const active = c.value === club;
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.pickerBtn, active && styles.pickerBtnActive]}
                    onPress={() => applyClubSwitch(c.value, 'manual')}
                  >
                    <Text style={[styles.pickerBtnText, active && styles.pickerBtnTextActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setClubMenuOpen(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  endText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
    width: 40,
  },
  headerCenter: {
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },
  shotCount: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 1,
  },
  // Phase BL — header sub-row + identify-club button
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  identifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#0a1a0a',
  },
  identifyBtnText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Phase BL — manual picker modal
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0d1a0d',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 20,
  },
  pickerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 4,
  },
  pickerSub: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 16,
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
    minWidth: 76,
    alignItems: 'center',
  },
  pickerBtnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  pickerBtnText: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '700',
  },
  pickerBtnTextActive: {
    color: '#00C896',
  },
  pickerCancel: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
  },
  pickerCancelText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 40,
    justifyContent: 'flex-end',
  },
  trendIcon: {
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'right',
  },
  watchDot: {
    fontSize: 14,
    opacity: 0.7,
  },
  patternWrap: {
    marginBottom: 12,
  },
  patternBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#1e3a28',
    marginBottom: 4,
  },
  patternFill: {
    height: '100%',
  },
  patternLegend: {
    flexDirection: 'row',
    gap: 12,
  },
  legendItem: {
    fontSize: 11,
    fontWeight: '700',
  },
  kevinCard: {
    backgroundColor: '#0d2418',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  kevinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  kevinLabel: {
    color: '#00C896',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  speakingDot: {
    color: '#00C896',
    fontSize: 10,
  },
  kevinText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
  },
  rootCauseBadge: {
    marginTop: 8,
    backgroundColor: '#1a0800',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  rootCauseText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '600',
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  feelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  feelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
  },
  feelEmoji: {
    fontSize: 14,
  },
  feelBtnText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  shapeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  shapeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
  },
  shapeBtnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  shapeBtnText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  shapeBtnTextActive: {
    color: '#00C896',
  },
  logBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  logBtnDisabled: {
    backgroundColor: '#1e3a28',
    opacity: 0.5,
  },
  logBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  smartMotionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
    marginBottom: 8,
  },
  smartMotionIcon: {
    fontSize: 18,
  },
  smartMotionLabel: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  history: {
    backgroundColor: '#0d1a0d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    marginBottom: 10,
  },
  historyLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  dotsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 8,
    alignItems: 'center',
  },
  dot: {
    borderRadius: 6,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  statText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  drillCard: {
    backgroundColor: '#0d1a0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5A623',
    padding: 12,
  },
  drillLabel: {
    color: '#F5A623',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 6,
  },
  drillText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
});
