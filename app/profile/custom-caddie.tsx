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

import React, { useState } from 'react';
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
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerProfileStore } from '../../store/playerProfileStore';

const DEFAULT_PROMPT =
  "Stylize this person as a confident golf caddie. Keep their face recognizable. Place them on a sunny PGA-style fairway, wearing a clean caddie polo and visor, holding a golf club. Photorealistic, soft warm lighting, 9:16 portrait composition with the head and shoulders centered.";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

export default function CustomCaddieScreen() {
  const insets = useSafeAreaInsets();
  const {
    selfieB64,
    customCaddiePortraitB64,
    useCustomCaddie,
    setSelfieB64,
    setCustomCaddiePortraitB64,
    setUseCustomCaddie,
  } = usePlayerProfileStore();

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState<'capture' | 'generate' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const b64 = await FileSystem.readAsStringAsync(manip.uri, { encoding: 'base64' });
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
      const can = await Sharing.isAvailableAsync();
      if (!can) {
        Alert.alert('Sharing not available', `Saved to ${file.uri}.`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'image/png',
        dialogTitle: label === 'caddie' ? 'Save your caddie' : 'Save your selfie',
        UTI: 'public.png',
      });
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
          },
        },
      ],
    );
  };

  const dataUri = (b64: string) => `data:image/png;base64,${b64}`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
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

          {/* Use toggle */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Use my custom caddie</Text>
              <Text style={styles.rowSub}>
                Replaces Kevin&apos;s portrait + slightly tweaks the voice (sped up, toned down).
              </Text>
            </View>
            <Switch
              value={useCustomCaddie}
              onValueChange={setUseCustomCaddie}
              disabled={!customCaddiePortraitB64}
              trackColor={{ false: '#1e3a28', true: '#00C896' }}
              thumbColor={useCustomCaddie ? '#04140c' : '#9ca3af'}
            />
          </View>

          {(selfieB64 || customCaddiePortraitB64) && (
            <TouchableOpacity onPress={clearAll} style={styles.clearBtn} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>Clear selfie & caddie</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
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
});
