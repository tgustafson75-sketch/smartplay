/**
 * Phase BR — Tutorial detail view.
 *
 * Renders a TutorialEntry with toggle for active practice context.
 * Toggling on enforces the MAX_ACTIVE cap (3) — if at cap, surfaces a
 * prompt explaining the user has to deactivate one first.
 */

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';
import { useTutorialStore, MAX_ACTIVE_TUTORIALS } from '../../../store/tutorialStore';
import { clubLabel } from '../../../services/clubRecognition';
import { useSettingsStore } from '../../../store/settingsStore';
import { getCaddieName } from '../../../lib/persona';

export default function TutorialDetail() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const tutorial = useTutorialStore(s => s.tutorials.find(t => t.id === id) ?? null);
  const setActive = useTutorialStore(s => s.setActive);
  const deleteTutorial = useTutorialStore(s => s.deleteTutorial);
  const caddieName = getCaddieName(useSettingsStore(s => s.voiceGender));

  if (!tutorial) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Tutorial</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.emptyCard}>
          <Text style={[styles.emptyTitle, { color: colors.text_primary }]}>Tutorial not found.</Text>
          <Text style={[styles.emptyBody, { color: colors.text_muted }]}>It may have been deleted.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const onToggleActive = (next: boolean) => {
    const ok = setActive(tutorial.id, next);
    if (!ok && next) {
      Alert.alert(
        'Active tutorials full',
        `You can have up to ${MAX_ACTIVE_TUTORIALS} tutorials active at once. Deactivate one in the library before activating this one.`,
      );
    }
  };

  const onDelete = () => {
    Alert.alert(
      'Delete tutorial?',
      'The teaching summary and practice context will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          deleteTutorial(tutorial.id);
          router.back();
        }},
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]} numberOfLines={1}>
          {tutorial.title}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.text_muted }]}>ACTIVE PRACTICE CONTEXT</Text>
              <Text style={[styles.subText, { color: colors.text_secondary, marginTop: 4 }]}>
                {tutorial.is_active
                  ? `${caddieName} will reference this lesson during your rounds.`
                  : `${caddieName} will not reference this lesson until you activate it.`}
              </Text>
            </View>
            <Switch
              value={tutorial.is_active}
              onValueChange={onToggleActive}
              trackColor={{ false: colors.border, true: colors.accent_muted }}
              thumbColor={tutorial.is_active ? colors.accent : '#ffffff'}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text_muted }]}>TEACHING FOCUS</Text>
          <Text style={[styles.body, { color: colors.text_primary, marginTop: 6 }]}>
            {tutorial.teaching_focus}
          </Text>
          {tutorial.instructor && (
            <Text style={[styles.subText, { color: colors.text_muted, marginTop: 6 }]}>
              From {tutorial.instructor}
            </Text>
          )}
        </View>

        {tutorial.key_cues.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>KEY CUES</Text>
            {tutorial.key_cues.map((cue, i) => (
              <View key={i} style={styles.cueRow}>
                <Text style={[styles.bullet, { color: colors.accent }]}>•</Text>
                <Text style={[styles.body, { color: colors.text_primary, flex: 1 }]}>{cue}</Text>
              </View>
            ))}
          </View>
        )}

        {tutorial.target_clubs.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>TARGET CLUBS</Text>
            <View style={styles.clubRow}>
              {tutorial.target_clubs.map(c => (
                <View key={c} style={[styles.clubPill, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
                  <Text style={[styles.clubPillText, { color: colors.text_secondary }]}>
                    {clubLabel(c)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {tutorial.target_situations.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>WHEN IT APPLIES</Text>
            {tutorial.target_situations.map((s, i) => (
              <View key={i} style={styles.cueRow}>
                <Text style={[styles.bullet, { color: colors.accent }]}>•</Text>
                <Text style={[styles.body, { color: colors.text_primary, flex: 1 }]}>{s}</Text>
              </View>
            ))}
          </View>
        )}

        {tutorial.player_notes && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text_muted }]}>YOUR NOTES</Text>
            <Text style={[styles.subText, { color: colors.text_secondary, marginTop: 6 }]}>
              {tutorial.player_notes}
            </Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text_muted }]}>EXTRACTION CONFIDENCE</Text>
          <Text style={[styles.body, { color: colors.text_primary, marginTop: 6 }]}>
            {tutorial.extraction_confidence}
          </Text>
          <Text style={[styles.subText, { color: colors.text_muted, marginTop: 4 }]}>
            {tutorial.extraction_confidence === 'low'
              ? 'Adding more notes — what the coach said, swing thoughts, target clubs — will improve future re-extractions.'
              : 'The teaching summary above was extracted from your notes by Sonnet vision.'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.deleteBtn, { borderColor: colors.error }]}
          onPress={onDelete}
        >
          <Text style={[styles.deleteText, { color: colors.error }]}>Delete Tutorial</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600', width: 60 },
  title: { fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  card: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 14,
    borderWidth: 1, padding: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  body: { fontSize: 15, lineHeight: 22 },
  subText: { fontSize: 13, lineHeight: 19 },
  cueRow: { flexDirection: 'row', marginTop: 8 },
  bullet: { fontSize: 16, marginRight: 8, lineHeight: 22 },
  clubRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  clubPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
  clubPillText: { fontSize: 12, fontWeight: '600' },
  emptyCard: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyBody: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  deleteBtn: {
    marginHorizontal: 16, marginTop: 18, marginBottom: 18,
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    borderWidth: 1,
  },
  deleteText: { fontSize: 14, fontWeight: '700' },
});
