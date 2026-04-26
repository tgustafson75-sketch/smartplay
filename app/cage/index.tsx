import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRelationshipStore } from '../../store/relationshipStore';

const CLUBS = [
  { label: 'Driver', value: 'DR' },
  { label: '3 Wood', value: '3W' },
  { label: '5 Wood', value: '5W' },
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
  { label: 'Putter', value: 'PT' },
];

export default function CageIndex() {
  useKeepAwake();
  const router = useRouter();

  const { startSession, cameraAlignment, sessionHistory } = useCageStore();
  const { watchConnected } = useSettingsStore();
  const { confidenceByClub } = useRelationshipStore();

  const [selectedClub, setSelectedClub] = useState('7I');

  const lastSession =
    sessionHistory.length > 0 ? sessionHistory[sessionHistory.length - 1] : null;

  const handleStart = () => {
    if (!selectedClub) {
      Alert.alert('Select a club', 'Pick a club before starting.');
      return;
    }
    startSession(selectedClub);
    router.push('/cage/session' as never);
  };

  const clubConfidence = confidenceByClub[selectedClub];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Cage Mode</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* CAMERA STATUS */}
        <View style={[styles.cameraCard, cameraAlignment?.locked && styles.cameraCardLocked]}>
          <View style={styles.cameraRow}>
            <Text style={styles.cameraIcon}>📹</Text>
            <View style={styles.cameraText}>
              <Text style={styles.cameraTitle}>
                {cameraAlignment?.locked ? 'Camera Ready ✓' : 'Camera Not Set'}
              </Text>
              <Text style={styles.cameraSub}>
                {cameraAlignment?.locked
                  ? 'SmartMotion active'
                  : 'Optional — tap to set up'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.cameraSetBtn}
              onPress={() =>
                router.push({
                  pathname: '/smartmotion',
                  params: { club: selectedClub },
                } as never)
              }
            >
              <Text style={styles.cameraSetText}>
                {cameraAlignment?.locked ? 'Adjust' : 'Set Up'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* DEVICE STATUS */}
        <View style={styles.deviceRow}>
          <View style={[styles.devicePill, watchConnected && styles.devicePillActive]}>
            <Text style={styles.deviceIcon}>⌚</Text>
            <Text style={[styles.deviceLabel, watchConnected && styles.deviceLabelActive]}>
              {watchConnected ? 'Watch On' : 'Watch Off'}
            </Text>
          </View>
          <View style={styles.devicePill}>
            <Text style={styles.deviceIcon}>🎵</Text>
            <Text style={styles.deviceLabel}>Sound On</Text>
          </View>
        </View>

        {/* CLUB SELECTOR */}
        <Text style={styles.sectionLabel}>Select Club</Text>

        {clubConfidence !== undefined && (
          <View style={styles.confidenceBadge}>
            <Text style={styles.confidenceText}>
              {'Kevin rates your ' + selectedClub + ' at ' +
                Math.round(clubConfidence * 100) + '% confidence'}
            </Text>
          </View>
        )}

        <View style={styles.clubGrid}>
          {CLUBS.map(club => (
            <TouchableOpacity
              key={club.value}
              style={[styles.clubBtn, selectedClub === club.value && styles.clubBtnActive]}
              onPress={() => setSelectedClub(club.value)}
            >
              <Text style={[
                styles.clubBtnText,
                selectedClub === club.value && styles.clubBtnTextActive,
              ]}>
                {club.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* LAST SESSION */}
        {lastSession && (
          <View style={styles.lastSession}>
            <Text style={styles.lastSessionLabel}>LAST SESSION</Text>
            <Text style={styles.lastSessionText}>
              {lastSession.club + ' · ' + lastSession.shots.length + ' shots' +
                (lastSession.dominantMiss ? ' · Miss: ' + lastSession.dominantMiss : '')}
            </Text>
          </View>
        )}

        {/* HISTORY LINK */}
        {sessionHistory.length > 0 && (
          <TouchableOpacity
            style={styles.historyBtn}
            onPress={() => router.push('/cage/history' as never)}
          >
            <Text style={styles.historyBtnText}>View Session History →</Text>
          </TouchableOpacity>
        )}

        {/* START */}
        <TouchableOpacity style={styles.startBtn} onPress={handleStart} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>Start Session</Text>
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
    marginBottom: 16,
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
  cameraCard: {
    backgroundColor: '#1a0a00',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f97316',
    padding: 14,
    marginBottom: 10,
  },
  cameraCardLocked: {
    backgroundColor: '#0d2418',
    borderColor: '#00C896',
  },
  cameraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cameraIcon: { fontSize: 24 },
  cameraText: { flex: 1 },
  cameraSetBtn: {
    backgroundColor: '#003d20',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#00C896',
  },
  cameraSetText: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
  },
  cameraTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  cameraSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  deviceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  devicePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0d1a0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  devicePillActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#0d1a2a',
  },
  deviceIcon: { fontSize: 14 },
  deviceLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  deviceLabelActive: {
    color: '#60a5fa',
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  confidenceBadge: {
    backgroundColor: '#0d2418',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  confidenceText: {
    color: '#00C896',
    fontSize: 12,
  },
  clubGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  clubBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
  },
  clubBtnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  clubBtnText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  clubBtnTextActive: {
    color: '#00C896',
  },
  lastSession: {
    backgroundColor: '#0d1a0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    marginBottom: 16,
  },
  lastSessionLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  lastSessionText: {
    color: '#9ca3af',
    fontSize: 13,
  },
  historyBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  historyBtnText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  startBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  startBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
});
