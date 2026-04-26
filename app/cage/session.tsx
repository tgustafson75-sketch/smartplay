import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
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
  useKeepAwake();
  const router = useRouter();
  const params = useLocalSearchParams();

  const { activeSession, addShot, endSession } = useCageStore();
  const { voiceGender, voiceEnabled, language } = useSettingsStore();
  const { addObservation, updateClubConfidence } = useRelationshipStore();
  const { dominantMiss } = usePlayerProfileStore();

  const [selectedFeel, setSelectedFeel] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState('');
  const [shotCount, setShotCount] = useState(0);
  const [isKevinSpeaking, setIsKevinSpeaking] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const club = activeSession?.club ?? '7I';
  const shots = activeSession?.shots ?? [];

  useEffect(() => {
    if (!activeSession) {
      router.replace('/cage' as never);
    }
  }, [activeSession]);

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
            <Text style={styles.title}>{club}</Text>
            <Text style={styles.shotCount}>{shots.length + ' shots'}</Text>
          </View>

          <Text style={[styles.trendIcon, { color: trendColor }]}>
            {trendIcon}
          </Text>
        </View>

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

        {/* SMART MOTION */}
        <TouchableOpacity
          style={styles.smartMotionBtn}
          onPress={() =>
            router.push({
              pathname: '/smartmotion',
              params: {
                club,
                feel: selectedFeel ?? '',
                shape: selectedShape ?? '',
              },
            } as never)
          }
        >
          <Text style={styles.smartMotionIcon}>🎥</Text>
          <Text style={styles.smartMotionLabel}>SmartMotion</Text>
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
  trendIcon: {
    fontSize: 24,
    fontWeight: '900',
    width: 40,
    textAlign: 'right',
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
