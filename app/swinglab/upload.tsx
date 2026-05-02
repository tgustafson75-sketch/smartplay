/**
 * Phase R — Video upload flow.
 *
 * Single-screen flow: pick → metadata → save. Background Phase K analysis
 * fires automatically after save; user returns to SwingLab home with
 * confirmation and can browse the new entry in My Swing Library.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { pickVideo, probeVideo, ingestVideoFromPick, MAX_FILE_SIZE_MB } from '../../services/videoUpload';
import type { SwingTag } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';

const CLUBS = ['Driver', '3W', '5W', 'Hybrid', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Putter'];
const TAGS: { id: SwingTag; label: string }[] = [
  { id: 'range', label: 'Range' },
  { id: 'cage', label: 'Cage' },
  { id: 'indoor', label: 'Indoor' },
  { id: 'course', label: 'Course' },
  { id: 'other', label: 'Other' },
];

export default function UploadSwing() {
  const router = useRouter();
  const { colors } = useTheme();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  const [step, setStep] = useState<'pick' | 'metadata' | 'saving'>('pick');
  const [uri, setUri] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [club, setClub] = useState<string>('7i');
  const [notes, setNotes] = useState('');
  const [swinger, setSwinger] = useState('Me');
  const [tag, setTag] = useState<SwingTag | null>(null);

  const onPick = async () => {
    const result = await pickVideo();
    if (result.kind === 'cancelled') return;
    if (result.kind === 'permission_denied') {
      Alert.alert('Permission needed', 'Allow access to your video library to upload swings.');
      return;
    }
    if (result.kind === 'error') {
      Alert.alert('Upload failed', result.message);
      return;
    }
    setUri(result.uri);
    const probe = await probeVideo(result.uri);
    setHasAudio(probe.has_audio);
    setDurationSec(probe.duration_sec ?? (result.durationMillis ? result.durationMillis / 1000 : null));
    setStep('metadata');
  };

  const onSave = () => {
    if (!uri) return;
    setStep('saving');
    const sessionId = ingestVideoFromPick({
      uri, club, notes: notes.trim() || null, swinger: swinger.trim() || 'Me',
      tag, has_audio: hasAudio, duration_sec: durationSec,
    });
    // Phase V — Kevin acknowledges the upload immediately and we navigate
    // straight to the swing detail surface. Feels like submitting work to
    // a coach who starts watching, not "uploaded successfully, navigate
    // somewhere if you want to check on it later".
    if (voiceEnabled) {
      void (async () => {
        await configureAudioForSpeech();
        await speak("Got your video. Let me take a look.", voiceGender, language, apiUrl);
      })();
    }
    router.replace(`/swinglab/swing/${sessionId}` as never);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Upload Swing</Text>
          <View style={{ width: 60 }} />
        </View>

        {step === 'pick' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.copy, { color: colors.text_primary }]}>
              Pick a swing video from your phone. Cap is {MAX_FILE_SIZE_MB}MB.
            </Text>
            <Text style={[styles.copySub, { color: colors.text_muted }]}>
              Videos with coaching audio (a coach&apos;s voice over the swing) play with the audio
              preserved during review. You can toggle to Kevin&apos;s analysis voice anytime.
            </Text>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={onPick}>
              <Text style={styles.primaryBtnText}>Pick Video</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'metadata' && uri && (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>VIDEO</Text>
              <Text style={[styles.value, { color: colors.text_primary }]} numberOfLines={1}>
                {durationSec ? `${durationSec.toFixed(1)}s` : 'Loaded'}{hasAudio ? ' · audio detected' : ' · no audio'}
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>CLUB</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {CLUBS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.pill,
                      { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                      club === c && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                    ]}
                    onPress={() => setClub(c)}
                  >
                    <Text style={[
                      styles.pillText,
                      { color: colors.text_muted },
                      club === c && { color: colors.accent, fontWeight: '700' },
                    ]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. range session, working on tempo"
                placeholderTextColor={colors.text_muted}
                multiline
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>WHO&apos;S SWINGING?</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
                value={swinger}
                onChangeText={setSwinger}
                placeholder="Me"
                placeholderTextColor={colors.text_muted}
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>TAG</Text>
              <View style={styles.tagRow}>
                {TAGS.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.pill,
                      { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                      tag === t.id && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                    ]}
                    onPress={() => setTag(tag === t.id ? null : t.id)}
                  >
                    <Text style={[
                      styles.pillText,
                      { color: colors.text_muted },
                      tag === t.id && { color: colors.accent, fontWeight: '700' },
                    ]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={onSave}>
              <Text style={styles.primaryBtnText}>Add to Library</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'saving' && (
          <View style={styles.savingCard}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.copy, { color: colors.text_primary, marginTop: 16 }]}>Saving…</Text>
          </View>
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
  value: { fontSize: 15, fontWeight: '600', marginTop: 6 },
  copy: { fontSize: 15, lineHeight: 22 },
  copySub: { fontSize: 13, marginTop: 8, lineHeight: 19 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    fontSize: 15, marginTop: 8, minHeight: 44,
  },
  pill: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, marginRight: 6, marginTop: 6,
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  primaryBtn: {
    marginHorizontal: 16, marginTop: 18, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  savingCard: { alignItems: 'center', justifyContent: 'center', padding: 60 },
});
