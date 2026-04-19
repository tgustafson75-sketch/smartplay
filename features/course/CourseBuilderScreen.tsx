/**
 * CourseBuilderScreen.tsx
 *
 * Entry point for the Course Builder feature.
 *
 * Screens:
 *   'landing'      → choose Manual or From Scorecard
 *   'scorecard'    → ScorecardLoader flow
 *   'builder'      → hole list; tap any hole to edit
 *   'holeEditor'   → HoleEditor for the selected hole
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useCourseState } from './useCourseState';
import ScorecardLoader from './ScorecardLoader';
import HoleEditor from './HoleEditor';
import VoiceRecorder from './VoiceRecorder';
import type { HoleData } from './useCourseState';

// ── Screen union ──────────────────────────────────────────────────────────────

type Screen = 'landing' | 'scorecard' | 'builder' | 'holeEditor';

// ── Par badge colors ──────────────────────────────────────────────────────────

const PAR_COLOR: Record<number, string> = {
  3: '#3B82F6',
  4: '#10B981',
  5: '#F59E0B',
};

// ── Hole row ──────────────────────────────────────────────────────────────────

function HoleRow({ hole, onPress }: { hole: HoleData; onPress: () => void }) {
  return (
    <Pressable style={hs.row} onPress={onPress}>
      <View style={[hs.holeBadge, { backgroundColor: PAR_COLOR[hole.par] ?? '#6B7280' }]}>
        <Text style={hs.holeNum}>{hole.hole}</Text>
      </View>
      <View style={hs.info}>
        <Text style={hs.holeLabel}>Hole {hole.hole}</Text>
        <Text style={hs.holeMeta}>
          Par {hole.par} · {hole.yardage}y
          {hole.features.length > 0 ? `  ·  ${hole.features[0]}${hole.features.length > 1 ? ` +${hole.features.length - 1}` : ''}` : ''}
        </Text>
        {hole.notes ? <Text style={hs.holeNote} numberOfLines={1}>{hole.notes}</Text> : null}
      </View>
      <Text style={hs.chevron}>›</Text>
    </Pressable>
  );
}

const hs = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#111E14' },
  holeBadge: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  holeNum:   { color: '#fff', fontWeight: '700', fontSize: 14 },
  info:      { flex: 1 },
  holeLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  holeMeta:  { color: '#9CA3AF', fontSize: 12, marginTop: 1 },
  holeNote:  { color: '#4B5563', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  chevron:   { color: '#4B5563', fontSize: 20 },
});

// ── Main component ────────────────────────────────────────────────────────────

export default function CourseBuilderScreen() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [courseName, setCourseName] = useState('');

  const {
    course,
    editingHole,
    setEditingHole,
    createFromParsed,
    createBlank,
    updateHole,
    setCourseName: applyName,
    reset,
  } = useCourseState();

  // ── Landing ───────────────────────────────────────────────────────────────

  if (screen === 'landing') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.container}>
          <Text style={s.title}>Course Builder</Text>
          <Text style={s.subtitle}>Set up your course in seconds.</Text>

          <Pressable
            style={[s.card, s.cardGreen]}
            onPress={() => setScreen('scorecard')}
          >
            <Text style={s.cardIcon}>📷</Text>
            <Text style={s.cardTitle}>Load From Scorecard</Text>
            <Text style={s.cardDesc}>Upload a scorecard photo and auto-fill 18 holes instantly.</Text>
          </Pressable>

          <Pressable
            style={s.card}
            onPress={() => {
              createBlank('New Course');
              setScreen('builder');
            }}
          >
            <Text style={s.cardIcon}>✏️</Text>
            <Text style={s.cardTitle}>Create Manually</Text>
            <Text style={s.cardDesc}>Enter hole data by hand, or use voice notes.</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Scorecard loader ──────────────────────────────────────────────────────

  if (screen === 'scorecard') {
    return (
      <SafeAreaView style={s.safe}>
        <ScorecardLoader
          onParsed={(holes) => {
            createFromParsed('Rancho California Golf Club', holes);
            setScreen('builder');
          }}
          onCancel={() => setScreen('landing')}
        />
      </SafeAreaView>
    );
  }

  // ── Hole editor ───────────────────────────────────────────────────────────

  if (screen === 'holeEditor' && editingHole) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.backRow}>
          <Pressable onPress={() => { setEditingHole(null); setScreen('builder'); }}>
            <Text style={s.backBtn}>← Back</Text>
          </Pressable>
        </View>
        <HoleEditor
          hole={editingHole}
          onSave={(updated) => {
            updateHole(updated);
            setEditingHole(null);
            setScreen('builder');
          }}
          onCancel={() => { setEditingHole(null); setScreen('builder'); }}
        />
        {/* Voice recorder wired to append to the hole notes */}
        <View style={s.voiceSection}>
          <VoiceRecorder
            onTranscribed={(text) => {
              const appended = editingHole.notes
                ? `${editingHole.notes} ${text}`
                : text;
              setEditingHole({ ...editingHole, notes: appended });
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Builder (hole list) ───────────────────────────────────────────────────

  if (screen === 'builder' && course) {
    const totalPar    = course.holes.reduce((acc, h) => acc + h.par, 0);
    const totalYardage = course.holes.reduce((acc, h) => acc + h.yardage, 0);

    return (
      <SafeAreaView style={s.safe}>
        {/* Header */}
        <View style={s.builderHeader}>
          <Pressable onPress={() => { reset(); setScreen('landing'); }}>
            <Text style={s.backBtn}>← Back</Text>
          </Pressable>
          <TextInput
            style={s.nameInput}
            value={course.name}
            onChangeText={applyName}
            placeholder="Course name"
            placeholderTextColor="#4B5563"
          />
        </View>

        {/* Summary strip */}
        <View style={s.summaryRow}>
          <Text style={s.summaryText}>18 holes</Text>
          <Text style={s.summarySep}>·</Text>
          <Text style={s.summaryText}>Par {totalPar}</Text>
          <Text style={s.summarySep}>·</Text>
          <Text style={s.summaryText}>{totalYardage.toLocaleString()} yards</Text>
        </View>

        {/* Hole list */}
        <FlatList
          data={course.holes}
          keyExtractor={(h) => String(h.hole)}
          renderItem={({ item }) => (
            <HoleRow
              hole={item}
              onPress={() => {
                setEditingHole(item);
                setScreen('holeEditor');
              }}
            />
          )}
          style={{ flex: 1 }}
        />

        {/* Save CTA */}
        <View style={s.footer}>
          <Pressable
            style={s.btnSave}
            onPress={() => Alert.alert('Course Saved', `"${course.name}" is ready to play.`)}
          >
            <Text style={s.btnSaveText}>✅  Save Course</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Fallback
  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#0a1a0e' },
  container:     { flex: 1, padding: 24 },
  title:         { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 4 },
  subtitle:      { color: '#9CA3AF', fontSize: 15, marginBottom: 32 },

  card:          { backgroundColor: '#111E14', borderRadius: 14, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: '#1F3A22' },
  cardGreen:     { borderColor: '#059669', backgroundColor: '#052e1e' },
  cardIcon:      { fontSize: 28, marginBottom: 8 },
  cardTitle:     { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  cardDesc:      { color: '#6B7280', fontSize: 13, lineHeight: 18 },

  backRow:       { paddingHorizontal: 16, paddingVertical: 10 },
  backBtn:       { color: '#A7F3D0', fontSize: 15 },
  builderHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  nameInput:     { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700', backgroundColor: '#111E14', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#1F3A22' },

  summaryRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  summaryText:   { color: '#9CA3AF', fontSize: 13 },
  summarySep:    { color: '#1F3A22', fontSize: 13 },

  voiceSection:  { paddingHorizontal: 20, paddingBottom: 12 },

  footer:        { padding: 16 },
  btnSave:       { backgroundColor: '#059669', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnSaveText:   { color: '#fff', fontSize: 15, fontWeight: '700' },
});
