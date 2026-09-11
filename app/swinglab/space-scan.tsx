/**
 * Phase W — Practice Space Scan screen.
 *
 * Three states: capture → analyzing → result. User takes ONE photo of
 * their practice space; Sonnet vision returns a structured 30-second
 * setup assessment. Saving the result persists a SpaceConfiguration
 * the cage-mode setup screen can pre-fill from.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import AppIcon from '../../components/AppIcon';
import {
  scanSpace,
  saveSpaceConfiguration,
  type SpaceAssessment,
  type SpaceType,
} from '../../services/spaceAssessment';
import { useSettingsStore } from '../../store/settingsStore';
import { speakChunked, configureAudioForSpeech } from '../../services/voiceService';
import { safeBack } from '../../services/safeBack';
import { getApiBaseUrl } from '../../services/apiBase';
import { useTranslation } from 'react-i18next';

type Phase = 'capture' | 'analyzing' | 'result' | 'failed';

const SPACE_TYPE_LABEL: Record<SpaceType, string> = {
  cage:      'Cage',
  range_bay: 'Range Bay',
  backyard:  'Backyard',
  basement:  'Basement',
  garage:    'Garage',
  other:     'Practice Space',
};

export default function SpaceScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = getApiBaseUrl();

  const [phase, setPhase] = useState<Phase>('capture');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<SpaceAssessment | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const onCapture = async (mode: 'camera' | 'library') => {
    const perm = mode === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('swinglab_space_scan.alert.permission_needed'), mode === 'camera'
        ? 'Allow camera access to scan your practice space.'
        : 'Allow photo access to pick a space photo.');
      return;
    }
    const result = mode === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, allowsEditing: false });
    if (result.canceled || !result.assets[0]?.uri) return;

    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    setPhase('analyzing');
    void analyze(uri);
  };

  const analyze = async (uri: string) => {
    try {
      // Resize for upload payload — long edge 1024.
      const resized = await manipulateAsync(uri, [{ resize: { width: 1024 } }], {
        compress: 0.85, format: SaveFormat.JPEG, base64: true,
      });
      const base64 = resized.base64;
      if (!base64) throw new Error('Could not read image bytes.');

      const result = await scanSpace(base64, 'image/jpeg', voiceGender);
      if (result.kind === 'ok') {
        setAssessment(result.assessment);
        setPhase('result');
        // Speak the summary so the player gets the read while they read.
        if (voiceEnabled && result.assessment.summary) {
          void (async () => {
            await configureAudioForSpeech();
            await speakChunked(result.assessment.summary, voiceGender, language, apiUrl);
          })();
        }
        return;
      }
      if (result.kind === 'too_large') {
        setErrorMessage('Photo was too large after resizing — try one with less detail.');
      } else if (result.kind === 'no_network') {
        setErrorMessage("Couldn't reach the analysis service. Check your connection and try again.");
      } else {
        setErrorMessage(result.message ?? 'Something went sideways on my end. Try again.');
      }
      setPhase('failed');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  };

  const onSave = async () => {
    if (!assessment) return;
    // v1 — keep the picker URI as-is; temp eviction means the thumbnail
    // can disappear over time, but the assessment text always survives.
    // Stable persistent storage is a follow-up.
    const result = await saveSpaceConfiguration({
      label: label.trim() || SPACE_TYPE_LABEL[assessment.space_type],
      thumbnail_uri: photoUri,
      assessment,
    });
    if (result.kind === 'error') {
      Alert.alert(
        t('swinglab_space_scan.alert.couldn_t_save'),
        t('swinglab_space_scan.alert.local_storage_is_full_or'),
      );
      return;
    }
    Alert.alert(t('swinglab_space_scan.alert.saved'), t('swinglab_space_scan.alert.your_space_is_saved_cage'));
    router.replace('/(tabs)/swinglab' as never);
  };

  const onRetake = () => {
    setPhotoUri(null);
    setAssessment(null);
    setErrorMessage(null);
    setLabel('');
    setPhase('capture');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>{t('swinglab_space_scan.space_scan_screen.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('swinglab_space_scan.space_scan_screen.scan_your_space')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {phase === 'capture' && (
          <>
            <View style={styles.heroCard}>
              <AppIcon name="camera-outline" size={36} color="#00C896" />
              <Text style={styles.heroTitle}>{t('swinglab_space_scan.space_scan_screen.show_me_your_practice_space')}</Text>
              <Text style={styles.heroBody}>
                {t('swinglab_space_scan.space_scan_screen.one_photo_30_second_read')}
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => onCapture('camera')}>
              <AppIcon name="camera" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>{t('swinglab_space_scan.space_scan_screen.take_photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => onCapture('library')}>
              <AppIcon name="images-outline" size={18} color="#00C896" />
              <Text style={styles.secondaryBtnText}>{t('swinglab_space_scan.space_scan_screen.pick_from_library')}</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'analyzing' && (
          <View style={styles.analyzeCard}>
            {photoUri && <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />}
            <View style={styles.analyzeRow}>
              <ActivityIndicator color="#00C896" />
              <View style={{ flex: 1 }}>
                <Text style={styles.analyzeTitle}>{t('swinglab_space_scan.space_scan_screen.reading_the_space')}</Text>
                <Text style={styles.analyzeSub}>{t('swinglab_space_scan.space_scan_screen.about_15_seconds')}</Text>
              </View>
            </View>
          </View>
        )}

        {phase === 'failed' && (
          <View style={[styles.heroCard, { borderColor: '#ef4444' }]}>
            <AppIcon name="alert-circle-outline" size={36} color="#ef4444" />
            <Text style={[styles.heroTitle, { color: '#ef4444' }]}>{t('swinglab_space_scan.space_scan_screen.couldn_t_read_the_space')}</Text>
            <Text style={styles.heroBody}>
              {errorMessage ?? "Something went sideways on my end."} Try a wider shot showing the hitting area, mat, and net.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRetake}>
              <Text style={styles.primaryBtnText}>{t('swinglab_space_scan.space_scan_screen.try_again')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'result' && assessment && (
          <>
            {photoUri && <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />}

            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.space_type')}</Text>
              <Text style={styles.resultValue}>{SPACE_TYPE_LABEL[assessment.space_type]}</Text>
              <Text style={styles.summary}>{assessment.summary}</Text>
            </View>

            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.setup')}</Text>
              <Bullet text={assessment.recommended_setup.mat_position} />
              <Bullet text={assessment.recommended_setup.aim_direction} />
            </View>

            {(assessment.camera_position.dtl_placement || assessment.camera_position.face_on_placement) && (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.phone_placement')}</Text>
                {assessment.camera_position.dtl_placement && (
                  <Bullet text={'Down-the-line: ' + assessment.camera_position.dtl_placement} />
                )}
                {assessment.camera_position.face_on_placement && (
                  <Bullet text={'Face-on: ' + assessment.camera_position.face_on_placement} />
                )}
              </View>
            )}

            {assessment.recommended_drills.length > 0 && (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.best_drills_here')}</Text>
                <View style={styles.pillRow}>
                  {assessment.recommended_drills.map(d => (
                    <View key={d} style={styles.goodPill}>
                      <Text style={styles.goodPillText}>{d}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {assessment.avoid_drills.length > 0 && (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.save_for_another_space')}</Text>
                {assessment.avoid_drills.map(a => (
                  <View key={a.drill_id} style={styles.avoidRow}>
                    <View style={styles.avoidPill}>
                      <Text style={styles.avoidPillText}>{a.drill_id}</Text>
                    </View>
                    <Text style={styles.avoidReason}>{a.reason}</Text>
                  </View>
                ))}
              </View>
            )}

            {assessment.safety_notes.length > 0 && (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.watch_for')}</Text>
                {assessment.safety_notes.map((n, i) => <Bullet key={i} text={n} />)}
              </View>
            )}

            {assessment.limitations.length > 0 && (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.honest_limits')}</Text>
                {assessment.limitations.map((n, i) => <Bullet key={i} text={n} muted />)}
              </View>
            )}

            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>{t('swinglab_space_scan.space_scan_screen.name_this_space_optional')}</Text>
              <TextInput
                style={styles.labelInput}
                value={label}
                onChangeText={setLabel}
                placeholder={SPACE_TYPE_LABEL[assessment.space_type]}
                placeholderTextColor="#3a5a40"
              />
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={onSave}>
              <AppIcon name="bookmark-outline" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>{t('swinglab_space_scan.space_scan_screen.save_space')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onRetake}>
              <Text style={styles.secondaryBtnText}>{t('swinglab_space_scan.space_scan_screen.scan_again')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, muted && { backgroundColor: '#6b7280' }]} />
      <Text style={[styles.bulletText, muted && { color: '#c2cad4' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  back: { color: '#00C896', fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: '#fff', fontSize: 18, fontWeight: '900' },
  scroll: { paddingBottom: 60, paddingHorizontal: 16 },

  heroCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 16, padding: 20, alignItems: 'center', gap: 10, marginTop: 8,
  },
  heroTitle: { color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  heroBody: { color: '#c2cad4', fontSize: 13, lineHeight: 19, textAlign: 'center' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 14, marginTop: 14,
  },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderColor: '#00C896', borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, marginTop: 8,
  },
  secondaryBtnText: { color: '#00C896', fontSize: 14, fontWeight: '800' },

  analyzeCard: { marginTop: 8, gap: 12 },
  analyzeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 14, padding: 14,
  },
  analyzeTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  analyzeSub: { color: '#6b7280', fontSize: 12, marginTop: 2 },

  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, marginTop: 8, backgroundColor: '#000' },

  resultCard: {
    marginTop: 12, padding: 14, borderRadius: 14,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
  },
  resultLabel: { color: '#6b7280', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  resultValue: { color: '#00C896', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  summary: { color: '#fff', fontSize: 14, lineHeight: 20 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#00C896', marginTop: 7 },
  bulletText: { flex: 1, color: '#e5e7eb', fontSize: 13, lineHeight: 19 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  goodPill: {
    backgroundColor: '#0d2418', borderColor: '#00C896', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  goodPillText: { color: '#00C896', fontSize: 12, fontWeight: '700' },

  avoidRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  avoidPill: {
    backgroundColor: '#1f0a0a', borderColor: '#ef4444', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  avoidPillText: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  avoidReason: { flex: 1, color: '#c2cad4', fontSize: 12, lineHeight: 17 },

  labelInput: {
    backgroundColor: '#060f09', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: '#fff', fontSize: 14,
  },
});
