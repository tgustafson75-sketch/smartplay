/**
 * Phase R — Video upload flow.
 *
 * Single-screen flow: pick → metadata → save. Background Phase K analysis
 * fires automatically after save; user returns to SwingLab home with
 * confirmation and can browse the new entry in My Swing Library.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
// 2026-05-25 — Z Fold open: upload flow was left-aligned in the wide
// viewport. Same isWide + WIDE_CONTENT_MAX_WIDTH pattern used by Play
// tab + SmartMotion analysis (commits 538cfb3, 446b537).
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
import { pickVideo, probeVideo, ingestVideoFromPick, MAX_FILE_SIZE_MB } from '../../services/videoUpload';
import { uploadLog } from '../../services/uploadDiagnostic';
import { useCageStore, type SwingTag } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useFamilyStore } from '../../store/familyStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import { getApiBaseUrl } from '../../services/apiBase';

const CLUBS = ['Driver', '3W', '5W', 'Hybrid', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Putter'];
const TAGS: { id: SwingTag; label: string }[] = [
  { id: 'range', label: 'Range' },
  { id: 'cage', label: 'Cage' },
  { id: 'indoor', label: 'Indoor' },
  { id: 'course', label: 'Course' },
  { id: 'putt', label: 'Putt' },
  { id: 'chip', label: 'Chip' },
  { id: 'other', label: 'Other' },
];

export default function UploadSwing() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isWide } = useDeviceLayout();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = getApiBaseUrl();

  // 2026-05-27 — Fix EK: pre-warm /api/swing-analysis on mount so the
  // first uploaded swing doesn't pay Vercel cold-start.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../services/swingAnalysisWarmup').prewarmSwingAnalysis();
  }, []);

  const [step, setStep] = useState<'pick' | 'metadata' | 'saving'>('pick');
  const [uri, setUri] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [club, setClub] = useState<string>('7i');
  const [notes, setNotes] = useState('');
  // 2026-05-23 — Auto-default the swinger name from the active family
  // member when one is selected (Tim's been coaching Emma → upload
  // assumes Emma is the subject). User can edit either field.
  const activeMember = useFamilyStore(s =>
    s.active_member_id ? s.members.find(m => m.id === s.active_member_id) : null,
  );
  const familyMembers = useFamilyStore(s => s.members);
  const sessionHistory = useCageStore(s => s.sessionHistory);
  const [swinger, setSwinger] = useState(activeMember?.firstName ?? 'Me');

  // 2026-05-25 — Fix AS: swinger autocomplete chips. Tim's ask was
  // "before, when I did one video of my daughter, Lily, it knew all
  // the videos of my daughter, Lily" — so surface every name the user
  // has previously typed (or a family member they've registered) as
  // a quick-tap chip above the text input. Tap fills the field; the
  // user can still type free-text to override.
  //   - Always "Me" first (account holder)
  //   - Active family member next (when applicable, dedup vs "Me")
  //   - Other non-archived family members (by added_at)
  //   - Recently-used swinger names from sessionHistory.upload.swinger
  //     (newest first, dedup, skip empties / "Me" / family names)
  // 2026-05-25 — Bumped recent-name pool to 25 latest sessions (large
  // libraries shouldn't drown the chip row but we want long-tail
  // coverage of "the cousin who only showed up twice").
  const swingerSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (name: string | null | undefined) => {
      if (!name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(trimmed);
    };
    push('Me');
    if (activeMember) push(activeMember.firstName);
    familyMembers
      .filter(m => !m.archived)
      .sort((a, b) => a.added_at - b.added_at)
      .forEach(m => push(m.firstName));
    // Newest sessions first so "the person I most recently filmed"
    // sits closest to the front of the chip row.
    const recent = [...sessionHistory]
      .sort((a, b) => b.date - a.date)
      .slice(0, 25);
    recent.forEach(s => push(s.upload?.swinger));
    return out;
  }, [activeMember, familyMembers, sessionHistory]);
  const [tag, setTag] = useState<SwingTag | null>(null);
  // 2026-05-22 — Meta Ray-Ban glasses tag. POV downward video of hands/
  // putter/ball can't be read by the full-body swing-pose model. When
  // ON, the session is routed through puttingAnalysisService instead of
  // Phase K's pose pipeline. Auto-implies the 'putt' tag for clarity.
  const [sourceDevice, setSourceDevice] = useState<'meta_glasses' | 'phone' | null>(null);
  // 2026-05-23 — Camera perspective. Distinguishes "You looking down at
  // your own hands/setup" (POV → putting analyzer for the granular grip
  // detail) from "You watching someone ELSE swing" (full-body subject →
  // Phase K swing analyzer for the overall fault read). Defaults to
  // 'watching_someone' when a family member is active, else 'pov_self'.
  // User can override either way before saving.
  const [perspective, setPerspective] = useState<'pov_self' | 'watching_someone'>(
    activeMember ? 'watching_someone' : 'pov_self',
  );
  // 2026-06-14 (Tim — second video source) — camera ANGLE for this upload. A face-on
  // clip (e.g. an iPad/GoPro recording of the same swing) must be read as face-on, or
  // the engine withholds face-on metrics (sway/weight/rotation) thinking it's DTL.
  const [angle, setAngle] = useState<'down_the_line' | 'face_on'>('down_the_line');

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

  const onSave = async () => {
    if (!uri) return;
    setStep('saving');
    uploadLog('save-tap', { club, has_audio: hasAudio, duration_sec: durationSec });
    // 2026-05-22 — When the user flagged Meta glasses but didn't pick
    // a tag, auto-imply 'putt' (most common glasses POV use case so
    // the library + analyzer-router agree on intent).
    // 2026-05-23 — Only auto-imply for POV self; "watching someone"
    // glasses video is full-body and should keep an unset tag (the
    // analyzer routes on perspective, not the implicit putt tag).
    const effectiveTag: SwingTag | null =
      sourceDevice === 'meta_glasses' && !tag && perspective === 'pov_self' ? 'putt' : tag;
    // 2026-05-25 — Path A: watch-then-analyze for short clips.
    // Clips ≤6s are typically the swing-fills-the-whole-clip case
    // where auto-firing analysis sampled the right frames. But the
    // user wants to SEE the video play through before the analyst
    // touches it ("not watching the whole video" complaint). For
    // short clips, defer the analysis and pass ?watch=1 — the swing
    // detail screen auto-plays the video and fires runPhaseKOnSession
    // on didJustFinish. Long clips (>6s, or duration unknown) keep
    // the current auto-fire behavior; Path C (trim screen) will take
    // over for those in a follow-up commit tonight.
    // 2026-05-25 — Three-way routing based on clip duration:
    //   ≤60s : Path A — auto-fire analysis deferred to detail screen
    //          where the video auto-plays then triggers it on end
    //          (?watch=1 param). Covers in-app Quick Record (≤30s)
    //          AND user-uploaded short snippets up to a full minute.
    //   >60s : Path C — route to trim screen with deferred analysis
    //          so the user can mark the swing window before sampling.
    //          This is the instructor-video / multi-swing case where
    //          the player needs to isolate ONE swing from a longer clip.
    //   ?    : duration probe failed → fall back to current auto-fire
    //          behavior so the session never strands pending forever.
    // 2026-05-25 — Fix D: bumped from 6s → 60s. Tonight's complaint:
    // a 17s upload triggered the trim screen ("only had start and
    // stop for longer videos that were long like I had two and three
    // minute ones"). Trim screen is for genuinely long content.
    const SHORT_CLIP_SEC = 60;
    const hasKnownDuration = typeof durationSec === 'number' && durationSec > 0;
    const isShortClip = hasKnownDuration && durationSec <= SHORT_CLIP_SEC;
    const isLongClip = hasKnownDuration && durationSec > SHORT_CLIP_SEC;
    // 2026-06-14 (audit fix) — ingest can reject (e.g. a persist/AsyncStorage
    // write throw). Without a catch the screen sat on "Saving…" forever with no
    // recovery. Catch → restore the editable form + tell the user. (Tonight's
    // 2nd-video-source upload runs through here, so this dead-end mattered.)
    let sessionId: string;
    try {
      sessionId = await ingestVideoFromPick({
        uri, club, notes: notes.trim() || null, swinger: swinger.trim() || 'Me',
        tag: effectiveTag, has_audio: hasAudio, duration_sec: durationSec,
        source_device: sourceDevice,
        perspective,
        angleOverride: angle,
        deferAnalysis: isShortClip || isLongClip,
      });
    } catch (e) {
      console.log('[upload] ingest failed:', e);
      uploadLog('save-failed', { error: e instanceof Error ? e.message : String(e) });
      setStep('metadata');
      Alert.alert('Upload failed', "Couldn't save that video. Please try again.");
      return;
    }
    // Phase V — Kevin acknowledges the upload immediately and we navigate
    // straight to the swing detail surface. Feels like submitting work to
    // a coach who starts watching, not "uploaded successfully, navigate
    // somewhere if you want to check on it later".
    if (voiceEnabled) {
      void (async () => {
        await configureAudioForSpeech();
        // 2026-05-25 — userInitiated:true so this speaks even when
        // trust=1 (Quiet). The user JUST tapped Upload — this is the
        // moment that most warrants the audible "got your video"
        // ack. Without the flag, isVoiceAllowed silenced it at L1.
        await speak("Got your video. Let me take a look.", voiceGender, language, apiUrl, { userInitiated: true });
      })().catch(() => undefined);
    }
    // Routing: long → trim screen; short → detail with watch param;
    // unknown duration → detail (legacy auto-fire path runs).
    if (isLongClip) {
      router.replace(`/swinglab/trim?session_id=${sessionId}` as never);
    } else {
      const watchParam = isShortClip ? '?watch=1' : '';
      router.replace(`/swinglab/swing/${sessionId}${watchParam}` as never);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.scroll, isWide && { alignItems: 'center' }]}>
       <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH } : undefined}>
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
              preserved during review. You can toggle to the caddie&apos;s analysis voice anytime.
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
              {/* 2026-05-26 — Fix AS: quick-tap chip row of known
                  swingers (account holder + family roster + prior
                  upload names). Tap to fill; free-text still works. */}
              {swingerSuggestions.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 8 }}
                  contentContainerStyle={{ paddingRight: 8 }}
                >
                  {swingerSuggestions.map(name => {
                    const selected = swinger.trim().toLowerCase() === name.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[
                          styles.pill,
                          { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                          selected && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                        ]}
                        onPress={() => setSwinger(name)}
                        accessibilityRole="button"
                        accessibilityLabel={`Set swinger to ${name}`}
                      >
                        <Text style={[
                          styles.pillText,
                          { color: colors.text_muted },
                          selected && { color: colors.accent, fontWeight: '700' },
                        ]}>{name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
                value={swinger}
                onChangeText={setSwinger}
                placeholder="Me"
                placeholderTextColor={colors.text_muted}
              />
            </View>

            {/* 2026-05-23 — Camera perspective. Splits glasses video into
                its two real use cases: looking DOWN at your own hands
                (POV grip/setup detail → putting analyzer) vs watching
                someone ELSE swing (full body → Phase K swing analyzer).
                Defaults to "Someone else" when a family member is
                active in the family roster; "You" otherwise. */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>PERSPECTIVE</Text>
              <View style={styles.tagRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                    perspective === 'pov_self' && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                  onPress={() => setPerspective('pov_self')}
                >
                  <Text style={[
                    styles.pillText,
                    { color: colors.text_muted },
                    perspective === 'pov_self' && { color: colors.accent, fontWeight: '700' },
                  ]}>👤 You (POV)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                    perspective === 'watching_someone' && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                  onPress={() => setPerspective('watching_someone')}
                >
                  <Text style={[
                    styles.pillText,
                    { color: colors.text_muted },
                    perspective === 'watching_someone' && { color: colors.accent, fontWeight: '700' },
                  ]}>👥 Someone else</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.helperText, { color: colors.text_muted }]}>
                {perspective === 'pov_self'
                  ? 'Looking down at your own setup — routes to grip / putting analysis.'
                  : 'Watching another golfer swing — routes to full swing fault analysis.'}
              </Text>
            </View>

            {/* 2026-06-14 (Tim — second video source) — camera ANGLE for this clip.
                A face-on import (iPad/GoPro of the same swing) MUST be tagged face-on,
                or the engine reads it as DTL and withholds face-on metrics. */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>CAMERA ANGLE</Text>
              <View style={styles.tagRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                    angle === 'down_the_line' && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                  onPress={() => setAngle('down_the_line')}
                >
                  <Text style={[
                    styles.pillText,
                    { color: colors.text_muted },
                    angle === 'down_the_line' && { color: colors.accent, fontWeight: '700' },
                  ]}>Down the line</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                    angle === 'face_on' && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                  onPress={() => setAngle('face_on')}
                >
                  <Text style={[
                    styles.pillText,
                    { color: colors.text_muted },
                    angle === 'face_on' && { color: colors.accent, fontWeight: '700' },
                  ]}>Face-on</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.helperText, { color: colors.text_muted }]}>
                {angle === 'down_the_line'
                  ? 'Behind you, looking down the target line — reads path / plane / early extension.'
                  : 'Facing you — reads weight shift / hip rotation / sway. Use this for an iPad/GoPro face-on clip.'}
              </Text>
            </View>

            {/* 2026-05-22 — Capture device. Meta Ray-Ban POV video routes
                to the putting analyzer (puttingAnalysisService) instead
                of Phase K's full-body swing pose pipeline. */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.text_muted }]}>CAPTURE DEVICE</Text>
              <View style={styles.tagRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                    sourceDevice === 'phone' && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                  onPress={() => setSourceDevice(sourceDevice === 'phone' ? null : 'phone')}
                >
                  <Text style={[
                    styles.pillText,
                    { color: colors.text_muted },
                    sourceDevice === 'phone' && { color: colors.accent, fontWeight: '700' },
                  ]}>📱 Phone</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    { borderColor: colors.border, backgroundColor: colors.surface_elevated },
                    sourceDevice === 'meta_glasses' && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
                  ]}
                  onPress={() => setSourceDevice(sourceDevice === 'meta_glasses' ? null : 'meta_glasses')}
                >
                  <Text style={[
                    styles.pillText,
                    { color: colors.text_muted },
                    sourceDevice === 'meta_glasses' && { color: colors.accent, fontWeight: '700' },
                  ]}>🕶️ Meta Glasses</Text>
                </TouchableOpacity>
              </View>
              {sourceDevice === 'meta_glasses' && perspective === 'pov_self' && (
                <Text style={[styles.helperText, { color: colors.text_muted }]}>
                  POV downward video — routes to PuttingLab analysis (face / stroke / read).
                </Text>
              )}
              {sourceDevice === 'meta_glasses' && perspective === 'watching_someone' && (
                <Text style={[styles.helperText, { color: colors.text_muted }]}>
                  Outward camera — routes to full swing analysis (fault + drill).
                </Text>
              )}
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
       </View>
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
  helperText: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  primaryBtn: {
    marginHorizontal: 16, marginTop: 18, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  savingCard: { alignItems: 'center', justifyContent: 'center', padding: 60 },
});
