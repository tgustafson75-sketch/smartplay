/**
 * Phase BI — Custom Caddie portrait flow.
 *
 * Capture a selfie → resize to 1024x1024 PNG → POST to /api/image-edit
 * with a default "stylize as my personal golf caddie" prompt → store the
 * returned base64 portrait in player profile → toggle on Caddie home.
 *
 * The same b64 is also used as the user's profile image. Voice service
 * checks `useCustomCaddie` and applies a slightly faster + slightly
 * quieter playback so the personalized caddie sounds different from the
 * canonical Kevin without re-cutting TTS.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
// 2026-05-27 — Fix EW: route audio-mode changes through voiceService's
// setAudioModeSerial queue (configureAudioForRecording /
// configureAudioForSpeech) instead of direct Audio.setAudioModeAsync.
// Direct calls race the speech queue and can silently downgrade audio
// when speech is in-flight at record time.
import { configureAudioForRecording, configureAudioForSpeech } from '../../services/voiceService';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useCustomCaddieMediaStore } from '../../store/customCaddieMediaStore';
import { useSettingsStore } from '../../store/settingsStore';
// 2026-05-26 — Fix DY: in-screen voice recorder for personal caddie.
// Same UI as the AI portrait flow per Tim's directive — no separate
// screen — so the user records their own greetings right where they
// took the selfie + generated the caddie image.
import { phrasesByCategory, type CustomCaddiePhrase } from '../../services/customCaddieClips';
import { getApiBaseUrl } from '../../services/apiBase';

const DEFAULT_PROMPT =
  "Stylize this person as a confident golf caddie. Keep their face recognizable. Place them on a sunny PGA-style fairway, wearing a clean caddie polo and visor, holding a golf club. Photorealistic, soft warm lighting, 9:16 portrait composition with the head and shoulders centered.";

const apiUrl = getApiBaseUrl();

export default function CustomCaddieScreen() {
  const insets = useSafeAreaInsets();
  const {
    customCaddieName,
    setUseCustomCaddie,
    setCustomCaddieName,
    customCaddieGender,
    setCustomCaddieGender,
    // 2026-05-26 — Fix DY: recorded-greeting clips.
    // 2026-05-27 — Fix ED: default to {} so users hydrating from a
    // persist snapshot that pre-dates Fix DY can't crash this UI on
    // an undefined lookup. Zustand's persist middleware does merge
    // defaults but belt-and-suspenders here is free.
    customCaddieClips: rawCustomCaddieClips,
    setCustomCaddieClip,
    clearAllCustomCaddieClips,
    // 2026-06-11 (audit 4c) — legacy read fallback until migration moves these
    // blobs into customCaddieMediaStore.
    selfieB64: legacySelfieB64,
    customCaddiePortraitB64: legacyPortraitB64,
  } = usePlayerProfileStore();
  // The two base64 blobs now live in their own store (off the hot-write profile
  // store). Read media first, fall back to the legacy profile value.
  const {
    selfieB64: mediaSelfieB64,
    customCaddiePortraitB64: mediaPortraitB64,
    profilePortraitB64,
    setSelfieB64,
    setCustomCaddiePortraitB64,
    setProfilePortraitB64,
  } = useCustomCaddieMediaStore();
  const selfieB64 = mediaSelfieB64 ?? legacySelfieB64;
  const customCaddiePortraitB64 = mediaPortraitB64 ?? legacyPortraitB64;
  const customCaddieClips: Record<string, string> = rawCustomCaddieClips ?? {};

  // 2026-06-16 (Tim — "no way to actually make it apply") — explicit APPLY pipeline.
  // The custom caddie becomes active when BOTH useCustomCaddie is on (drives the
  // portrait via activeCustomPortrait) AND the persona is 'custom' (drives voice +
  // name). Previously the screen only pointed at the ••• cycler; now one button
  // sets both, so voice + person + portrait switch together — and the avatar stops
  // showing a stock caddie (it was stock because useCustomCaddie was never set).
  const useCustomCaddie = usePlayerProfileStore(s => s.useCustomCaddie);
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const setCaddiePersonality = useSettingsStore(s => s.setCaddiePersonality);
  const isCustomActive = useCustomCaddie && caddiePersonality === 'custom';
  const applyCustomCaddie = () => {
    setUseCustomCaddie(true);
    setCaddiePersonality('custom');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const switchToKevin = () => {
    setUseCustomCaddie(false);
    setCaddiePersonality('kevin');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  // 2026-06-16 (Tim) — apply the portrait as JUST the dashboard profile icon, WITHOUT
  // activating the custom caddie (voice/persona untouched). Separate from "use this
  // caddie" above.
  const portraitForPic = customCaddiePortraitB64 ?? selfieB64;
  const isProfilePic = !!profilePortraitB64 && profilePortraitB64 === portraitForPic;
  const useAsProfilePic = () => {
    if (!portraitForPic) return;
    setProfilePortraitB64(isProfilePic ? null : portraitForPic);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState<'capture' | 'generate' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 2026-05-26 — Fix DY: per-phrase recording state.
  // `recordingPhraseId` = id of the phrase currently being recorded
  // (null when idle). `previewingPhraseId` = phrase whose clip is
  // playing back. Mutually exclusive at the UI level — the row in
  // recording mode disables its own play button.
  const [recordingPhraseId, setRecordingPhraseId] = useState<string | null>(null);
  const [previewingPhraseId, setPreviewingPhraseId] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  // Tear down any in-flight recording / preview when the screen
  // unmounts so we don't leak file handles or hold the audio session.
  useEffect(() => {
    return () => {
      try {
        recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
      } catch { /* ignore */ }
      try {
        previewSoundRef.current?.stopAsync().catch(() => undefined);
        previewSoundRef.current?.unloadAsync().catch(() => undefined);
      } catch { /* ignore */ }
    };
  }, []);

  const captureSelfie = async () => {
    setError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to capture a selfie.');
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setBusy('capture');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        cameraType: ImagePicker.CameraType.front,
        quality: 0.85,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled || !result.assets[0]?.uri) {
        setBusy(null);
        return;
      }
      const uri = result.assets[0].uri;
      // Resize + force PNG (image-edit requires PNG, ≤4MB).
      const manip = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024, height: 1024 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.PNG },
      );
      // 2026-05-24 — SDK 54 moved readAsStringAsync to the legacy module.
      // The top-level 'expo-file-system' import no longer exposes it,
      // which was landing as "undefined is not a function" in the catch
      // below and surfacing as "Capture failed" to the user. Other files
      // in the codebase (glassesVisionInput, metaGlassesIngest) use the
      // same dynamic legacy import pattern.
      const FS = await import('expo-file-system/legacy');
      const b64 = await FS.readAsStringAsync(manip.uri, { encoding: FS.EncodingType.Base64 });
      setSelfieB64(b64);
    } catch (e) {
      console.log('[customCaddie] capture error', e);
      setError('Capture failed. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const generateCaddie = async () => {
    if (!selfieB64) {
      Alert.alert('Capture a selfie first', 'Tap "Take Selfie" to start.');
      return;
    }
    if (!prompt.trim()) {
      Alert.alert('Prompt required', 'Describe how the caddie should look.');
      return;
    }
    setError(null);
    setBusy('generate');
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await fetch(apiUrl + '/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: selfieB64, prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.b64) {
        const msg = (data && typeof data.error === 'string') ? data.error : `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      setCustomCaddiePortraitB64(data.b64);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.log('[customCaddie] generate error', e);
      setError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setBusy(null);
    }
  };

  const saveImage = async (b64: string, label: 'selfie' | 'caddie') => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const filename = `${label}-${Date.now()}.png`;
      const file = new File(Paths.cache, filename);
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      await Promise.resolve(file.write(bytes));
      // 2026-06-16 (Tim — "it makes you email it to save; we want save to phone") —
      // save straight to the device photo library (camera roll) via MediaLibrary,
      // not the share sheet. Fall back to the share sheet only if the photo
      // permission is denied, so the image is never lost.
      const ML = await import('expo-media-library');
      const perm = await ML.requestPermissionsAsync();
      if (perm.granted || perm.accessPrivileges === 'limited') {
        await ML.saveToLibraryAsync(file.uri);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved to Photos', `Your ${label === 'caddie' ? 'caddie' : 'selfie'} is in your camera roll.`);
        return;
      }
      // Permission denied → share-sheet fallback so the image isn't trapped.
      const can = await Sharing.isAvailableAsync();
      if (can) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'image/png',
          dialogTitle: label === 'caddie' ? 'Save your caddie' : 'Save your selfie',
          UTI: 'public.png',
        });
        return;
      }
      Alert.alert('Saved', `Saved to ${file.uri}.`);
    } catch (e) {
      console.log('[customCaddie] save error', e);
      Alert.alert('Save failed', 'Try again in a moment.');
    }
  };

  const clearAll = () => {
    Alert.alert(
      'Clear custom caddie?',
      'This removes your selfie and AI portrait. You can always re-create them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            setSelfieB64(null);
            setCustomCaddiePortraitB64(null);
            setUseCustomCaddie(false);
            // 2026-06-06 — Cross-commit audit: if the cycler had landed
            // on 'custom', leaving it stale means the persona display
            // says "My Caddie" but the avatar + voice fall back to
            // Kevin. Sync the cycler back to Kevin on Clear so all
            // three (label / avatar / voice) match.
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const settingsMod = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
              const s = settingsMod.useSettingsStore.getState();
              if (s.caddiePersonality === 'custom') {
                s.setCaddiePersonality('kevin');
              }
            } catch (e) {
              console.log('[customCaddie] clear → reset persona failed (non-fatal):', e);
            }
          },
        },
      ],
    );
  };

  const dataUri = (b64: string) => `data:image/png;base64,${b64}`;

  // 2026-05-26 — Fix DY: voice clip handlers.
  //
  // Storage: clips live in <documentDirectory>/customCaddieClips/. We
  // use documentDirectory (NOT cache) so the OS doesn't evict the
  // user's recordings under storage pressure. One file per phrase id;
  // re-recording a phrase overwrites the prior file via a unique name
  // and we delete the stale one.
  //
  // SDK 54: documentDirectory + getInfoAsync + makeDirectoryAsync +
  // moveAsync + deleteAsync all live in expo-file-system/legacy. The
  // new top-level File/Paths API doesn't cover the directory probe +
  // move flow we need yet. Pattern matches the legacy dynamic import
  // already used elsewhere in this screen (captureSelfie above).
  const getLegacyFS = async () => await import('expo-file-system/legacy');

  const clipsDirFor = (FS: { documentDirectory: string | null }) =>
    (FS.documentDirectory ?? '') + 'customCaddieClips/';

  const ensureClipsDir = async (): Promise<string | null> => {
    try {
      const FS = await getLegacyFS();
      const dir = clipsDirFor(FS);
      const info = await FS.getInfoAsync(dir);
      if (!info.exists) {
        await FS.makeDirectoryAsync(dir, { intermediates: true });
      }
      return dir;
    } catch (e) {
      console.log('[customCaddie] ensureClipsDir failed', e);
      return null;
    }
  };

  const startRecording = async (phraseId: string) => {
    try {
      // Stop any prior preview so the mic isn't fighting playback.
      if (previewSoundRef.current) {
        try { await previewSoundRef.current.stopAsync(); } catch { /* ignore */ }
        try { await previewSoundRef.current.unloadAsync(); } catch { /* ignore */ }
        previewSoundRef.current = null;
        setPreviewingPhraseId(null);
      }
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone access needed', 'Allow microphone access to record your voice.');
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Playback-quality recording (not the low-bitrate Whisper preset).
      // These clips are HEARD by the user, not transcribed — full
      // quality preset gives a noticeably cleaner result.
      // 2026-05-27 — Fix EW: route through voiceService's
      // configureAudioForRecording() so this hits the SAME
      // setAudioModeSerial queue everything else uses. Prior direct
      // Audio.setAudioModeAsync call bypassed the queue — if speech
      // was in-flight when the user tapped record, the modes raced
      // and audio could silently downgrade (same class of bug as
      // Fix EI / intro-video).
      await configureAudioForRecording();
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setRecordingPhraseId(phraseId);
    } catch (e) {
      console.log('[customCaddie] startRecording failed', e);
      Alert.alert('Recording failed', 'Try again in a moment.');
      setRecordingPhraseId(null);
    }
  };

  const stopRecording = async (phraseId: string) => {
    const rec = recordingRef.current;
    if (!rec) {
      setRecordingPhraseId(null);
      return;
    }
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await rec.stopAndUnloadAsync();
      const tempUri = rec.getURI();
      recordingRef.current = null;
      if (!tempUri) {
        setRecordingPhraseId(null);
        return;
      }
      // Move to a stable per-phrase path so re-records overwrite cleanly
      // and we know what to delete when the user clears one.
      const dir = await ensureClipsDir();
      if (!dir) {
        Alert.alert('Save failed', "Couldn't access storage. Try again.");
        return;
      }
      const FS = await getLegacyFS();
      const finalUri = dir + phraseId + '-' + Date.now() + '.m4a';
      // Delete the previous file for this phrase (if any) before
      // moving, so we don't accumulate stale recordings.
      const prevUri = customCaddieClips[phraseId];
      if (prevUri) {
        try { await FS.deleteAsync(prevUri, { idempotent: true }); } catch { /* ignore */ }
      }
      await FS.moveAsync({ from: tempUri, to: finalUri });
      setCustomCaddieClip(phraseId, finalUri);
    } catch (e) {
      console.log('[customCaddie] stopRecording failed', e);
      Alert.alert('Save failed', "Recording didn't save. Try again.");
    } finally {
      setRecordingPhraseId(null);
      // Restore playback-mode audio session so the preview / app voice
      // playback works after we recorded.
      // 2026-05-27 — Fix EW: same queue-bypass fix as the start path.
      // configureAudioForSpeech sets the full mode field set through
      // setAudioModeSerial so playback after recording isn't racing.
      try { await configureAudioForSpeech(); } catch { /* ignore */ }
    }
  };

  const previewClip = async (phraseId: string) => {
    const uri = customCaddieClips[phraseId];
    if (!uri) return;
    try {
      // Stop any prior preview before starting a new one.
      if (previewSoundRef.current) {
        try { await previewSoundRef.current.stopAsync(); } catch { /* ignore */ }
        try { await previewSoundRef.current.unloadAsync(); } catch { /* ignore */ }
        previewSoundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      previewSoundRef.current = sound;
      setPreviewingPhraseId(phraseId);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (!s.isLoaded || s.didJustFinish) {
          sound.unloadAsync().catch(() => undefined);
          if (previewSoundRef.current === sound) previewSoundRef.current = null;
          setPreviewingPhraseId(prev => prev === phraseId ? null : prev);
        }
      });
    } catch (e) {
      console.log('[customCaddie] previewClip failed', e);
      Alert.alert('Playback failed', 'Try re-recording this phrase.');
      setPreviewingPhraseId(null);
    }
  };

  const deleteClip = (phraseId: string) => {
    const uri = customCaddieClips[phraseId];
    if (!uri) return;
    Alert.alert(
      'Delete recording?',
      'The caddie will use the AI voice for this phrase until you record it again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const FS = await getLegacyFS();
              await FS.deleteAsync(uri, { idempotent: true });
            } catch { /* ignore */ }
            setCustomCaddieClip(phraseId, null);
          },
        },
      ],
    );
  };

  const clearAllRecordings = () => {
    const ids = Object.keys(customCaddieClips);
    if (ids.length === 0) return;
    Alert.alert(
      'Clear all recordings?',
      `Delete all ${ids.length} recorded ${ids.length === 1 ? 'phrase' : 'phrases'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            try {
              const FS = await getLegacyFS();
              for (const id of ids) {
                const uri = customCaddieClips[id];
                if (uri) {
                  try { await FS.deleteAsync(uri, { idempotent: true }); } catch { /* ignore */ }
                }
              }
            } catch { /* ignore */ }
            clearAllCustomCaddieClips();
          },
        },
      ],
    );
  };

  const recordedCount = Object.keys(customCaddieClips).length;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top + 12 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={26} color="#00C896" />
          </TouchableOpacity>
          <Text style={styles.title}>Your Caddie</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 64 + insets.bottom, paddingHorizontal: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.subtitle}>
            Take a selfie and we&apos;ll generate a personal caddie in your image. Used as your
            profile picture and your in-app caddie.
          </Text>

          {/* Selfie row */}
          <View style={styles.row}>
            <View style={styles.thumbBox}>
              {selfieB64 ? (
                <Image source={{ uri: dataUri(selfieB64) }} style={styles.thumb} />
              ) : (
                <Ionicons name="person-outline" size={48} color="#3a4f43" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Step 1 — Selfie</Text>
              <Text style={styles.rowSub}>Front camera, good light. Crop to a square.</Text>
              <TouchableOpacity
                style={[styles.actionBtn, busy === 'capture' && styles.actionBtnDisabled]}
                onPress={captureSelfie}
                disabled={busy !== null}
                activeOpacity={0.8}
              >
                {busy === 'capture' ? (
                  <ActivityIndicator color="#04140c" />
                ) : (
                  <Text style={styles.actionBtnText}>{selfieB64 ? 'Retake Selfie' : 'Take Selfie'}</Text>
                )}
              </TouchableOpacity>
              {selfieB64 && (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => saveImage(selfieB64, 'selfie')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="download-outline" size={16} color="#00C896" />
                  <Text style={styles.secondaryBtnText}>Save selfie</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Prompt */}
          <Text style={styles.sectionLabel}>Step 2 — Describe Your Caddie</Text>
          <TextInput
            style={styles.promptInput}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder="Describe the caddie's look, outfit, setting…"
            placeholderTextColor="#3a4f43"
          />

          {/* Generate row */}
          <View style={styles.row}>
            <View style={styles.thumbBox}>
              {customCaddiePortraitB64 ? (
                <Image source={{ uri: dataUri(customCaddiePortraitB64) }} style={styles.thumb} />
              ) : (
                <Ionicons name="sparkles-outline" size={48} color="#3a4f43" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Step 3 — Generate</Text>
              <Text style={styles.rowSub}>Sends your selfie + prompt to the image model.</Text>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  (!selfieB64 || busy !== null) && styles.actionBtnDisabled,
                ]}
                onPress={generateCaddie}
                disabled={!selfieB64 || busy !== null}
                activeOpacity={0.8}
              >
                {busy === 'generate' ? (
                  <ActivityIndicator color="#04140c" />
                ) : (
                  <Text style={styles.actionBtnText}>
                    {customCaddiePortraitB64 ? 'Regenerate' : 'Generate Caddie'}
                  </Text>
                )}
              </TouchableOpacity>
              {customCaddiePortraitB64 && (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => saveImage(customCaddiePortraitB64, 'caddie')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="download-outline" size={16} color="#00C896" />
                  <Text style={styles.secondaryBtnText}>Save caddie</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* 2026-06-06 — Phase Custom-as-5th-Persona: the previous
              "Use my custom caddie" Switch toggle is replaced by
              cycler integration. The custom caddie is now selectable
              as the 5th persona in the ••• menu's "Caddie:" cycler;
              picking it there flips useCustomCaddie automatically.
              The standalone toggle is kept here for back-compat (it
              still flips the boolean) but is no longer the primary
              way to activate the custom caddie. */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Name your caddie</Text>
              <Text style={styles.rowSub}>
                What should they be called? Shown in the persona cycler.
              </Text>
            </View>
          </View>
          <TextInput
            value={customCaddieName ?? ''}
            onChangeText={setCustomCaddieName}
            placeholder="My Caddie"
            placeholderTextColor="#6b7d72"
            style={[styles.nameInput]}
            maxLength={20}
            returnKeyType="done"
          />

          {/* 2026-06-06 — Broken Switch removed. The cycler in the •••
              menu is now the canonical way to activate the custom
              caddie ("My Caddie" / chosen name as the 5th persona);
              the old Switch was disconnected from the persona slider
              and didn't reliably swap the experience (Tim's report).
              Picking "{customCaddieName ?? 'My Caddie'}" in the cycler
              auto-flips useCustomCaddie behind the scenes — no
              standalone toggle needed. */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{isCustomActive ? `${customCaddieName ?? 'My Caddie'} is your caddie` : 'Use this caddie'}</Text>
              <Text style={styles.rowSub}>
                {isCustomActive
                  ? 'Active across the app — voice, portrait, and name.'
                  : 'Apply your voice, portrait, and name as the active caddie everywhere.'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={isCustomActive ? switchToKevin : applyCustomCaddie}
            disabled={!isCustomActive && !customCaddiePortraitB64}
            style={[
              styles.applyBtn,
              isCustomActive ? styles.applyBtnActive : (!customCaddiePortraitB64 && styles.applyBtnDisabled),
            ]}
            accessibilityRole="button"
            accessibilityLabel={isCustomActive ? 'Switch back to Kevin' : 'Use this custom caddie'}
          >
            <Ionicons
              name={isCustomActive ? 'checkmark-circle' : 'person-circle-outline'}
              size={18}
              color={isCustomActive ? '#06140b' : (customCaddiePortraitB64 ? '#06140b' : '#6b7d72')}
            />
            <Text style={[styles.applyBtnText, !isCustomActive && !customCaddiePortraitB64 && { color: '#6b7d72' }]}>
              {isCustomActive
                ? 'Active — tap to switch back to Kevin'
                : customCaddiePortraitB64
                  ? `Use ${customCaddieName ?? 'My Caddie'} as my caddie`
                  : 'Generate a portrait first'}
            </Text>
          </TouchableOpacity>
          {/* 2026-06-16 (Tim) — apply the portrait as JUST your dashboard icon, no
              caddie change. Secondary action so it's clearly separate from "use this
              caddie" above. */}
          {portraitForPic ? (
            <TouchableOpacity
              onPress={useAsProfilePic}
              style={styles.profilePicBtn}
              accessibilityRole="button"
              accessibilityLabel={isProfilePic ? 'Remove as profile picture' : 'Use as dashboard profile picture'}
            >
              <Ionicons name={isProfilePic ? 'checkmark-circle' : 'person-outline'} size={16} color="#00C896" />
              <Text style={styles.profilePicBtnText}>
                {isProfilePic ? 'Your profile picture — tap to remove' : 'Use as profile picture (dashboard icon)'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* 2026-05-26 — Fix DY: Step 4 — record YOUR voice for the
              fixed catalog of caddie phrases. When useCustomCaddie is
              ON, the voice service plays your recording instead of the
              AI voice for any phrase you've recorded. Anything outside
              the catalog (live conversational responses) still uses
              the AI voice — recording is purely additive. Lives in
              the SAME screen as the AI portrait (Tim's directive). */}
          <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Step 4 — Record Your Voice (optional)</Text>
          <View style={styles.recorderHelpRow}>
            <Ionicons name="information-circle-outline" size={14} color="#9ca3af" />
            <Text style={styles.recorderHelp}>
              Record short phrases in your own voice. The caddie uses
              your recording for any phrase you record and the AI voice
              for everything else. {recordedCount > 0 ? `${recordedCount} recorded.` : 'None recorded yet.'}
            </Text>
          </View>

          {/* 2026-06-12 (Tim) — default AI voice for any UNRECORDED line. Custom keeps its
              generated face but always speaks: male → Kevin's voice, female → Serena's. */}
          <Text style={styles.recorderHelp}>Default voice (for lines you don&apos;t record):</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 4 }}>
            {(['male', 'female'] as const).map(g => {
              const on = (customCaddieGender ?? 'male') === g;
              return (
                <TouchableOpacity
                  key={g}
                  onPress={() => setCustomCaddieGender(g)}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: on ? '#00C896' : '#374151', backgroundColor: on ? 'rgba(0,200,150,0.14)' : 'transparent' }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={g === 'male' ? 'man-outline' : 'woman-outline'} size={16} color={on ? '#00C896' : '#9ca3af'} />
                  <Text style={{ color: on ? '#00C896' : '#9ca3af', fontWeight: '700', fontSize: 13 }}>
                    {g === 'male' ? 'Male · Kevin' : 'Female · Serena'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(['greeting', 'reaction', 'encouragement', 'closing'] as const).map(cat => {
            const phrases = phrasesByCategory()[cat];
            const catLabel =
              cat === 'greeting' ? 'GREETINGS' :
              cat === 'reaction' ? 'REACTIONS' :
              cat === 'encouragement' ? 'ENCOURAGEMENT' : 'CLOSING';
            return (
              <View key={cat} style={{ marginBottom: 10 }}>
                <Text style={styles.recorderCatLabel}>{catLabel}</Text>
                {phrases.map((p: CustomCaddiePhrase) => {
                  const hasClip = !!customCaddieClips[p.id];
                  const isRecording = recordingPhraseId === p.id;
                  const isPreviewing = previewingPhraseId === p.id;
                  const anyRecording = recordingPhraseId !== null;
                  return (
                    <View key={p.id} style={styles.recorderRow}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.recorderText}>&ldquo;{p.text}&rdquo;</Text>
                        <Text style={styles.recorderHint}>{p.hint}</Text>
                      </View>
                      {/* Mic / stop button */}
                      <TouchableOpacity
                        onPress={() => isRecording ? stopRecording(p.id) : startRecording(p.id)}
                        disabled={anyRecording && !isRecording}
                        style={[
                          styles.recorderBtn,
                          isRecording && { backgroundColor: '#ef4444', borderColor: '#ef4444' },
                          (anyRecording && !isRecording) && { opacity: 0.35 },
                        ]}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={isRecording ? 'Stop recording' : 'Record phrase'}
                      >
                        <Ionicons
                          name={isRecording ? 'stop' : 'mic-outline'}
                          size={16}
                          color={isRecording ? '#f4f4f4' : '#00C896'}
                        />
                      </TouchableOpacity>
                      {/* Preview button — visible only when a clip exists */}
                      {hasClip && (
                        <TouchableOpacity
                          onPress={() => previewClip(p.id)}
                          disabled={isRecording}
                          style={[
                            styles.recorderBtn,
                            isPreviewing && { borderColor: '#f59e0b' },
                            isRecording && { opacity: 0.35 },
                          ]}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Preview recording"
                        >
                          <Ionicons name={isPreviewing ? 'volume-high' : 'play-outline'} size={16} color={isPreviewing ? '#f59e0b' : '#00C896'} />
                        </TouchableOpacity>
                      )}
                      {/* Delete — visible only when a clip exists */}
                      {hasClip && (
                        <TouchableOpacity
                          onPress={() => deleteClip(p.id)}
                          disabled={isRecording}
                          style={[styles.recorderBtn, { borderColor: '#7f1d1d' }, isRecording && { opacity: 0.35 }]}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel="Delete recording"
                        >
                          <Ionicons name="trash-outline" size={14} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}

          {recordedCount > 0 && (
            <TouchableOpacity onPress={clearAllRecordings} style={styles.clearBtn} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>Clear all recordings</Text>
            </TouchableOpacity>
          )}

          {(selfieB64 || customCaddiePortraitB64) && (
            <TouchableOpacity onPress={clearAll} style={styles.clearBtn} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>Clear selfie & caddie</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  title: { color: '#f4f4f4', fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  subtitle: { color: '#9ca3af', fontSize: 13, lineHeight: 19, marginVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#0d2418',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    marginBottom: 16,
  },
  thumbBox: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#04140c',
    borderWidth: 1.5,
    borderColor: '#1e3a28',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: '100%', height: '100%' },
  rowLabel: { color: '#f4f4f4', fontSize: 15, fontWeight: '700' },
  rowSub: { color: '#9ca3af', fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 10 },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 6 },
  applyBtnActive: { backgroundColor: '#88F700' },
  applyBtnDisabled: { backgroundColor: '#1e3a28' },
  applyBtnText: { color: '#06140b', fontSize: 15, fontWeight: '800' },
  profilePicBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, marginBottom: 8 },
  profilePicBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  actionBtn: {
    backgroundColor: '#00C896',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#04140c', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginTop: 6,
  },
  secondaryBtnText: { color: '#00C896', fontSize: 13, fontWeight: '600' },
  sectionLabel: { color: '#9ca3af', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 4, marginBottom: 8 },
  promptInput: {
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 10,
    padding: 12,
    color: '#f4f4f4',
    fontSize: 13,
    lineHeight: 19,
    minHeight: 110,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ef4444',
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: '#fca5a5', fontSize: 13, lineHeight: 18 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0d2418',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  clearBtn: { alignItems: 'center', padding: 14, marginTop: 8 },
  clearBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  nameInput: {
    backgroundColor: '#0d2418',
    color: '#f4f4f4',
    fontSize: 16,
    fontWeight: '600',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    marginTop: 4,
    marginBottom: 14,
  },
  // 2026-05-26 — Fix DY: recorder UI styles. Tighter row layout than
  // the existing image-row pattern because each row only has text +
  // 1-3 tiny icon buttons. Reuses brand-green border / dark bg from
  // the rest of the screen.
  recorderHelpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#0d2418',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 10,
    marginBottom: 12,
  },
  recorderHelp: { flex: 1, color: '#9ca3af', fontSize: 12, lineHeight: 17 },
  recorderCatLabel: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 4, marginBottom: 6 },
  recorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0d2418',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  recorderText: { color: '#f4f4f4', fontSize: 13, fontWeight: '700' },
  recorderHint: { color: '#6b7280', fontSize: 11, marginTop: 1 },
  recorderBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00C896',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#04140c',
  },
});
