/**
 * Phase BR — Tutorial upload + manual entry.
 *
 * Player picks an instruction video (or skips and provides text-only),
 * types a brief title + optional notes, and we run Sonnet teaching-content
 * extraction. Result lands in tutorialStore as a TutorialEntry; user
 * navigates back to the tutorial library.
 *
 * Audio transcription (Whisper) is intentionally NOT wired here yet —
 * that's BR2. Today the player's typed notes are the primary signal.
 * Once BR2 ships, the audio transcript becomes the primary signal and
 * the notes become optional player annotation.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as VT from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../contexts/ThemeContext';
import { useTutorialStore } from '../../store/tutorialStore';
import { analyzeTutorial } from '../../services/tutorialAnalysis';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
import type { ClubId } from '../../services/clubRecognition';

const CLUBS: { label: string; value: ClubId }[] = [
  { label: 'Driver', value: 'DR' },
  { label: '3W', value: '3W' },
  { label: '5W', value: '5W' },
  { label: '4i', value: '4I' },
  { label: '5i', value: '5I' },
  { label: '6i', value: '6I' },
  { label: '7i', value: '7I' },
  { label: '8i', value: '8I' },
  { label: '9i', value: '9I' },
  { label: 'PW', value: 'PW' },
  { label: 'GW', value: 'GW' },
  { label: 'SW', value: 'SW' },
  { label: 'LW', value: 'LW' },
];

export default function TutorialUpload() {
  const router = useRouter();
  const { colors } = useTheme();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const addTutorial = useTutorialStore(s => s.addTutorial);
  const caddieName = getCaddieName(useSettingsStore(s => s.caddiePersonality));

  const [step, setStep] = useState<'compose' | 'analyzing'>('compose');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [instructor, setInstructor] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedClubs, setSelectedClubs] = useState<ClubId[]>([]);

  const toggleClub = (c: ClubId) => {
    setSelectedClubs(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  const onPickVideo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow video library access to attach a tutorial video.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;
      setVideoUri(uri);

      // Extract one representative frame at mid-clip for Sonnet visual
      // context. Best-effort; the analysis still runs without it.
      try {
        const t = await VT.getThumbnailAsync(uri, { time: 5_000, quality: 0.7 });
        const m = await ImageManipulator.manipulateAsync(
          t.uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
        );
        setFrameUri(m.uri);
      } catch (_) { /* frame is optional */ }
    } catch (e) {
      Alert.alert('Pick failed', e instanceof Error ? e.message : String(e));
    }
  };

  const onAnalyze = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert('Title needed', 'Give the tutorial a short title (e.g. "Marc — shallow attack on wedges").');
      return;
    }

    setStep('analyzing');
    const fullNotes = [
      instructor.trim() ? `Instructor: ${instructor.trim()}` : '',
      notes.trim(),
      selectedClubs.length > 0 ? `Player-tagged clubs: ${selectedClubs.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const outcome = await analyzeTutorial(
      { title: t, notes: fullNotes, frame_uri: frameUri },
      apiUrl,
    );

    if (outcome.kind !== 'ok') {
      const msg = outcome.kind === 'no_network'
        ? 'Lost connection — try again.'
        : `Analyzer hit a snag: ${outcome.message.slice(0, 200)}`;
      Alert.alert("Couldn't analyze", msg, [{ text: 'OK', onPress: () => setStep('compose') }]);
      return;
    }

    // Phase BR Component 11 — non-instruction guard. If Sonnet detected
    // the upload isn't golf instruction (off-topic title/notes, non-golf
    // frame), don't pollute the tutorial library with the entry. Suggest
    // Cage Mode for actual user-swing analysis.
    if (outcome.teaching_focus === 'not_instruction') {
      Alert.alert(
        "Doesn't look like a golf lesson",
        "If this is your own swing video, use Cage Mode for swing analysis. Tutorials are for coaching content — instructor-led lessons or instruction videos.",
        [
          { text: 'Try again', onPress: () => setStep('compose') },
          { text: 'Open Cage Mode', onPress: () => router.replace('/cage' as never) },
        ],
      );
      return;
    }

    // Merge player-tagged clubs with model-extracted ones; player wins
    // when they explicitly tagged.
    const mergedClubs: ClubId[] = Array.from(new Set([
      ...selectedClubs,
      ...outcome.target_clubs,
    ]));

    const id = addTutorial({
      source_kind: videoUri ? 'uploaded_video' : 'manual_note',
      source_uri: videoUri,
      title: t,
      instructor: outcome.instructor ?? (instructor.trim() || null),
      target_clubs: mergedClubs,
      player_notes: notes.trim() || null,
      teaching_focus: outcome.teaching_focus,
      key_cues: outcome.key_cues,
      target_situations: outcome.target_situations,
      extraction_confidence: outcome.confidence,
    });

    router.replace(`/swinglab/tutorial/${id}` as never);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Add Tutorial</Text>
          <View style={{ width: 60 }} />
        </View>

        {step === 'analyzing' ? (
          <View style={styles.savingCard}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.copy, { color: colors.text_primary, marginTop: 16 }]}>
              Reading the lesson…
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.copy, { color: colors.text_primary }]}>
                Capture a coaching lesson so {caddieName} can reference it during your rounds.
              </Text>
              <Text style={[styles.copySub, { color: colors.text_muted }]}>
                Attach the source video if you have it. A title plus a few notes about
                what the coach is teaching is enough for now.
              </Text>
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: videoUri ? colors.surface_elevated : colors.accent }]} onPress={onPickVideo}>
                <Text style={[styles.primaryBtnText, videoUri ? { color: colors.accent } : null]}>
                  {videoUri ? '✓ Video attached — tap to change' : 'Attach Video (optional)'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>TITLE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
                value={title}
                onChangeText={setTitle}
                placeholder="Marc — shallow attack on wedges"
                placeholderTextColor={colors.text_muted}
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>INSTRUCTOR (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
                value={instructor}
                onChangeText={setInstructor}
                placeholder="Marc Solomon"
                placeholderTextColor={colors.text_muted}
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>NOTES — WHAT IS THE LESSON ABOUT?</Text>
              <TextInput
                style={[styles.input, styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Keep the club low through impact. Weight forward. Less wrist."
                placeholderTextColor={colors.text_muted}
                multiline
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>TARGET CLUBS (OPTIONAL)</Text>
              <Text style={[styles.copySub, { color: colors.text_muted, marginTop: 4, marginBottom: 8 }]}>
                Tap any clubs this lesson directly applies to. {caddieName} will reference the
                lesson on shots with those clubs.
              </Text>
              <View style={styles.clubGrid}>
                {CLUBS.map(c => {
                  const active = selectedClubs.includes(c.value);
                  return (
                    <TouchableOpacity
                      key={c.value}
                      style={[
                        styles.clubBtn,
                        { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                        active && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                      ]}
                      onPress={() => toggleClub(c.value)}
                    >
                      <Text style={[styles.clubBtnText, { color: colors.text_muted }, active && { color: colors.accent, fontWeight: '700' }]}>
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 18 }]} onPress={onAnalyze}>
              <Text style={styles.primaryBtnText}>Analyze + Save</Text>
            </TouchableOpacity>
          </>
        )}
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
  title: { fontSize: 20, fontWeight: '900' },
  card: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 14,
    borderWidth: 1, padding: 14,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  copy: { fontSize: 15, lineHeight: 22 },
  copySub: { fontSize: 13, lineHeight: 19 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    fontSize: 15, marginTop: 8, minHeight: 44,
  },
  notesInput: { minHeight: 88 },
  clubGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  clubBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  clubBtnText: { fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    marginHorizontal: 16, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  savingCard: { alignItems: 'center', justifyContent: 'center', padding: 60 },
});
