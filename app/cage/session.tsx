import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCageStore, CageShot } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { analyzeSession } from '../../services/patternEngine';
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const FEEL_OPTIONS = [
  { label: 'Flush',  value: 'flush', color: '#00C896' },
  { label: 'Solid',  value: 'solid', color: '#00C896' },
  { label: 'Fat',    value: 'fat',   color: '#f97316' },
  { label: 'Thin',   value: 'thin',  color: '#fbbf24' },
  { label: 'Heel',   value: 'heel',  color: '#ef4444' },
  { label: 'Toe',    value: 'toe',   color: '#ef4444' },
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

  const { activeSession, addShot, endSession } = useCageStore();
  const { voiceGender, voiceEnabled, language } = useSettingsStore();
  const { addObservation } = useRelationshipStore();

  const [selectedFeel, setSelectedFeel] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState('');
  const [shotCount, setShotCount] = useState(0);

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const club = activeSession?.club ?? '7I';
  const shots = activeSession?.shots ?? [];

  useEffect(() => {
    if (!activeSession) {
      router.replace('/cage' as never);
    }
  }, [activeSession]);

  useEffect(() => {
    if (activeSession && voiceEnabled) {
      const opening = 'Let\'s go. ' + club + '. One shot at a time.';
      setLastResponse(opening);
      setTimeout(async () => {
        await configureAudioForSpeech();
        await speak(opening, voiceGender, language, apiUrl);
      }, 500);
    }
  }, []);

  const handleLogShot = async () => {
    if (!selectedFeel) return;

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

    const allShots: CageShot[] = [
      ...shots,
      { ...shotData, id: 'temp', timestamp: Date.now() },
    ];
    const pattern = analyzeSession(allShots, club);

    let kevinResponse = '';

    if (selectedFeel === 'flush' || selectedFeel === 'solid') {
      kevinResponse = newCount === 1 ? 'Good start.' : 'That\'s one.';
    } else if (selectedFeel === 'fat') {
      kevinResponse = pattern.fatRate >= 40
        ? 'You\'re hitting behind it. Ball first. Ground after.'
        : 'Heavy. Ball first next one.';
    } else if (selectedFeel === 'thin') {
      kevinResponse = 'Stay down through it.';
    } else if (selectedFeel === 'heel') {
      kevinResponse = 'Out of the heel. Stand a touch closer.';
    } else if (selectedFeel === 'toe') {
      kevinResponse = 'Off the toe. Move a touch closer.';
    }

    if (newCount % 5 === 0) {
      kevinResponse = pattern.kevinSummary;
      if (pattern.rootCause) {
        addObservation({ type: 'technical', content: club + ': ' + pattern.rootCause });
      }
    }

    setLastResponse(kevinResponse);

    if (voiceEnabled && kevinResponse) {
      await configureAudioForSpeech();
      await speak(kevinResponse, voiceGender, language, apiUrl);
    }

    setSelectedFeel(null);
    setSelectedShape(null);
  };

  const handleEndSession = () => {
    const pattern = analyzeSession(shots, club);
    endSession({
      dominantMiss: pattern.dominantMiss,
      rootCause: pattern.rootCause,
      summary: pattern.kevinSummary,
    });
    router.replace('/cage/summary' as never);
  };

  const pattern = analyzeSession(shots, club);

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
          <Text style={styles.title}>{club + ' · ' + shots.length + ' shots'}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* PATTERN BAR */}
        {shots.length >= 3 && (
          <View style={styles.patternBar}>
            <View style={[styles.patternFill, { width: `${pattern.flushRate}%`, backgroundColor: '#00C896' }]} />
            <View style={[styles.patternFill, { width: `${pattern.fatRate}%`, backgroundColor: '#f97316' }]} />
            <View style={[styles.patternFill, { width: `${pattern.thinRate}%`, backgroundColor: '#fbbf24' }]} />
          </View>
        )}

        {/* KEVIN CARD */}
        {lastResponse !== '' && (
          <View style={styles.kevinCard}>
            <Text style={styles.kevinLabel}>KEVIN</Text>
            <Text style={styles.kevinText}>{lastResponse}</Text>
          </View>
        )}

        {/* FEEL */}
        <Text style={styles.sectionLabel}>How did that feel?</Text>
        <View style={styles.feelGrid}>
          {FEEL_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.feelBtn,
                selectedFeel === opt.value && {
                  borderColor: opt.color,
                  backgroundColor: opt.color + '20',
                },
              ]}
              onPress={() => setSelectedFeel(opt.value)}
            >
              <Text style={[
                styles.feelBtnText,
                selectedFeel === opt.value && { color: opt.color },
              ]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* SHAPE */}
        <Text style={styles.sectionLabel}>Shot shape</Text>
        <View style={styles.shapeGrid}>
          {SHAPE_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.shapeBtn,
                selectedShape === opt.value && styles.shapeBtnActive,
              ]}
              onPress={() => setSelectedShape(selectedShape === opt.value ? null : opt.value)}
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

        {/* SHOT HISTORY */}
        {shots.length > 0 && (
          <View style={styles.history}>
            <Text style={styles.historyLabel}>THIS SESSION</Text>
            <View style={styles.historyRow}>
              {shots
                .slice(-10)
                .reverse()
                .map((shot, i) => {
                  const color =
                    shot.feel === 'flush' || shot.feel === 'solid' ? '#00C896' :
                    shot.feel === 'fat'   ? '#f97316' :
                    shot.feel === 'thin'  ? '#fbbf24' : '#ef4444';
                  return (
                    <View key={i} style={[styles.shotDot, { backgroundColor: color }]} />
                  );
                })}
            </View>
            <Text style={styles.historyStats}>
              {pattern.flushRate + '% solid' +
                (pattern.dominantMiss ? ' · Miss: ' + pattern.dominantMiss : '')}
            </Text>
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
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  endText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
    width: 40,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  patternBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#1e3a28',
    marginBottom: 12,
  },
  patternFill: {
    height: '100%',
  },
  kevinCard: {
    backgroundColor: '#0d2418',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  kevinLabel: {
    color: '#00C896',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  kevinText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  feelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  feelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
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
    marginBottom: 16,
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
    marginBottom: 16,
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
  history: {
    backgroundColor: '#0d1a0d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
  },
  historyLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  historyRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  shotDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  historyStats: {
    color: '#9ca3af',
    fontSize: 12,
  },
});
