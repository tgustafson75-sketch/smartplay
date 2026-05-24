/**
 * 2026-05-24 — Coach Mode player scan flow (BETA).
 *
 * Two-step camera capture inside Coach Mode that produces a per-player
 * calibration profile (services/playerCalibration → store/
 * playerCalibrationStore). Foundation for the per-player metric pipeline
 * — this screen does NOT touch swingMetricsService; storing a profile
 * makes the calibration available for downstream consumption when the
 * follow-up build wires it.
 *
 * Works for either a Coach-Mode-active family member OR the account
 * holder (Tim's self-scan path) — if no family member is active, the
 * subject defaults to the account holder via derivePlayerId-equivalent
 * resolution. "Also needs to work for my profile Tim" per the spec.
 *
 * Flow:
 *   1. SETUP — confirm subject name (defaulted from active member or
 *      account holder) + type height in cm
 *   2. UPRIGHT scan — frame student full-body, head + both feet
 *      visible, perpendicular to camera, upright. Pose detection
 *      validates landmarks; bad scan = redo prompt, nothing stored.
 *   3. ADDRESS scan — student stands into address; capture posture
 *      keypoints. Same validation gate.
 *   4. REVIEW — show derived numbers (scale, spine angle, stance);
 *      Save persists profile.
 *
 * Honest-degradation: a partial body, occluded feet, or implausible
 * proportions reject the scan BEFORE storage. A bad ruler is worse
 * than no ruler.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../../contexts/ThemeContext';
import { useFamilyStore } from '../../store/familyStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { usePlayerCalibrationStore } from '../../store/playerCalibrationStore';
import { analyzePoseFromUri, type PoseFrame } from '../../services/poseAnalysisApi';
import {
  validateUprightFrame,
  validateAddressFrame,
  buildProfile,
  type PlayerCalibrationProfile,
} from '../../services/playerCalibration';

type Step = 'setup' | 'upright_capture' | 'upright_processing' | 'address_capture' | 'address_processing' | 'review';

/** Resolve the scan subject — active family member preferred, account
 *  holder fallback. The fallback is what makes self-scan work for Tim
 *  per the spec's "also needs to work for my profile Tim". */
function resolveScanSubject(): { player_id: string; defaultName: string } {
  const fam = useFamilyStore.getState();
  const activeId = fam.active_member_id;
  const active = activeId ? fam.members.find(m => m.id === activeId && !m.archived) : null;
  if (active) {
    return { player_id: active.id, defaultName: active.firstName };
  }
  const profile = usePlayerProfileStore.getState();
  const stableId = profile.email && profile.email.trim().length > 0
    ? profile.email.trim().toLowerCase()
    : 'account_holder';
  const name = (profile.firstName || profile.name || 'Me').trim();
  return { player_id: stableId, defaultName: name };
}

export default function ScanStudent() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // ── Subject + setup ──────────────────────────────────────────────
  const [subject] = useState(() => resolveScanSubject());
  const [name, setName] = useState(subject.defaultName);
  const [heightCmStr, setHeightCmStr] = useState('');

  // ── Step state ──────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('setup');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [uprightFrame, setUprightFrame] = useState<PoseFrame | null>(null);
  const [addressFrame, setAddressFrame] = useState<PoseFrame | null>(null);
  const [resultProfile, setResultProfile] = useState<PlayerCalibrationProfile | null>(null);

  // ── Persist action ──────────────────────────────────────────────
  const setProfile = usePlayerCalibrationStore(s => s.setProfile);
  const existingProfile = usePlayerCalibrationStore(s => s.profiles[subject.player_id] ?? null);

  // Parse height defensively. Reject < 100cm or > 230cm (sanity).
  const heightCm = (() => {
    const n = parseFloat(heightCmStr);
    if (!Number.isFinite(n)) return null;
    if (n < 100 || n > 230) return null;
    return Math.round(n);
  })();

  const canStart = name.trim().length > 0 && heightCm != null;

  // ── Capture handler — shared by both upright + address steps ────
  const capture = useCallback(async (kind: 'upright' | 'address') => {
    if (!cameraRef.current) return;
    setErrorMsg(null);
    setStep(kind === 'upright' ? 'upright_processing' : 'address_processing');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      if (!photo?.uri) {
        setErrorMsg('Camera returned no photo. Try again.');
        setStep(kind === 'upright' ? 'upright_capture' : 'address_capture');
        return;
      }
      const frame = await analyzePoseFromUri(photo.uri);
      if (!frame || frame.keypoints.length === 0) {
        setErrorMsg('Pose read failed — try again with better lighting and the full body in frame.');
        setStep(kind === 'upright' ? 'upright_capture' : 'address_capture');
        return;
      }
      // Honest-degradation gate: validate before storing anything.
      const validation = kind === 'upright'
        ? validateUprightFrame(frame)
        : validateAddressFrame(frame);
      if (!validation.ok) {
        setErrorMsg(validation.reason);
        setStep(kind === 'upright' ? 'upright_capture' : 'address_capture');
        return;
      }
      // Capture passed — advance.
      if (kind === 'upright') {
        setUprightFrame(frame);
        setStep('address_capture');
      } else {
        setAddressFrame(frame);
        // Build profile now that we have both frames + the typed height.
        if (uprightFrame && heightCm != null) {
          const profile = buildProfile({
            player_id: subject.player_id,
            name: name.trim(),
            height_cm: heightCm,
            upright: uprightFrame,
            address: frame,
          });
          setResultProfile(profile);
          setStep('review');
        } else {
          // Defensive — shouldn't happen given step ordering.
          setErrorMsg('Missing upright frame. Restart from the top.');
          setStep('setup');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[scan-student] capture failed:', msg);
      setErrorMsg('Capture threw — try again.');
      setStep(kind === 'upright' ? 'upright_capture' : 'address_capture');
    }
  }, [uprightFrame, heightCm, name, subject.player_id]);

  const onSave = () => {
    if (!resultProfile) return;
    setProfile(resultProfile);
    Alert.alert(
      'Profile saved',
      `Calibration for ${resultProfile.name} stored. Future scans / metrics for this player will reference this profile.`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  };

  const restartScan = () => {
    setUprightFrame(null);
    setAddressFrame(null);
    setResultProfile(null);
    setErrorMsg(null);
    setStep('setup');
  };

  // ── Permission gate ─────────────────────────────────────────────
  const needsCamera = step === 'upright_capture' || step === 'address_capture' || step === 'upright_processing' || step === 'address_processing';
  if (needsCamera && !camPerm) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.permView}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }
  if (needsCamera && !camPerm?.granted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Scan Student</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.permView}>
          <Ionicons name="videocam-off-outline" size={40} color={colors.accent} />
          <Text style={[styles.permTitle, { color: colors.text_primary }]}>Camera Access</Text>
          <Text style={[styles.permText, { color: colors.text_muted }]}>
            Scan needs the camera to capture the student&apos;s full body for the calibration ruler.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={() => { if (camPerm?.canAskAgain) void requestCamPerm(); }}
          >
            <Text style={styles.primaryBtnText}>Grant Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Setup step UI ───────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Scan Student</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.hint, { color: colors.text_muted }]}>
            Capture a calibration profile for {subject.defaultName === name ? name : 'this player'}. Two quick scans — full-body upright (the ruler), then in golf address (the baseline). The profile saves to the player&apos;s record and the metric pipeline will use it when it lands next.
          </Text>

          {existingProfile && (
            <View style={[styles.warningCard, { backgroundColor: colors.surface, borderColor: '#F5A623' }]}>
              <Text style={[styles.warningText, { color: colors.text_primary }]}>
                Existing profile for this player: height {existingProfile.height_cm}cm, spine {existingProfile.posture_baseline.spine_angle_deg}°. Re-scanning overwrites it.
              </Text>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>PLAYER NAME</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text_primary }]}
            value={name}
            onChangeText={setName}
            placeholder="First name"
            placeholderTextColor={colors.text_muted}
            autoCorrect={false}
            autoCapitalize="words"
          />

          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 14 }]}>HEIGHT (CM)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text_primary }]}
            value={heightCmStr}
            onChangeText={setHeightCmStr}
            placeholder="e.g. 178"
            placeholderTextColor={colors.text_muted}
            keyboardType="number-pad"
            maxLength={3}
          />
          <Text style={[styles.subHint, { color: colors.text_muted }]}>
            The known dimension — calibrates the pixel ruler. Use cm (5&apos;10&quot; ≈ 178cm).
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { backgroundColor: canStart ? colors.accent : colors.surface_elevated, opacity: canStart ? 1 : 0.5, marginTop: 24 },
            ]}
            onPress={() => canStart && setStep('upright_capture')}
            disabled={!canStart}
            accessibilityRole="button"
            accessibilityLabel="Start scan"
          >
            <Text style={[styles.primaryBtnText, { color: canStart ? '#0d1a0d' : colors.text_muted }]}>
              Start scan
            </Text>
          </TouchableOpacity>

          <Text style={[styles.subHint, { color: colors.text_muted, marginTop: 14 }]}>
            Player ID: {subject.player_id}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Review step UI ──────────────────────────────────────────────
  if (step === 'review' && resultProfile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Scan Review</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.hint, { color: colors.text_muted }]}>
            Both scans read clean. Review the derived calibration below, then save.
          </Text>

          <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>PLAYER</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardValue, { color: colors.text_primary }]}>{resultProfile.name}</Text>
            <Text style={[styles.cardSub, { color: colors.text_muted }]}>
              ID {resultProfile.player_id} · height {resultProfile.height_cm}cm
            </Text>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>SCALE (THE RULER)</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardValue, { color: colors.accent }]}>
              {resultProfile.scale_cm_per_pixel.toFixed(3)} cm/px
            </Text>
            <Text style={[styles.cardSub, { color: colors.text_muted }]}>
              Real-world centimeters per pixel at the upright capture distance.
            </Text>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>PROPORTIONS</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Shoulder width (norm)</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.proportions.shoulder_width_norm.toFixed(3)}</Text></View>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Hip width (norm)</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.proportions.hip_width_norm.toFixed(3)}</Text></View>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Shoulder / hip</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.proportions.shoulder_to_hip_ratio.toFixed(2)}</Text></View>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Leg length (norm)</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.proportions.leg_length_norm.toFixed(3)}</Text></View>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Arm length (norm)</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.proportions.arm_length_norm.toFixed(3)}</Text></View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 18 }]}>ADDRESS BASELINE</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Spine angle</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.posture_baseline.spine_angle_deg}°</Text></View>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Stance width</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.posture_baseline.stance_width_cm} cm</Text></View>
            <View style={styles.kvRow}><Text style={[styles.k, { color: colors.text_muted }]}>Knee flex (norm)</Text><Text style={[styles.v, { color: colors.text_primary }]}>{resultProfile.posture_baseline.knee_flex_norm.toFixed(3)}</Text></View>
          </View>

          <Text style={[styles.subHint, { color: colors.text_muted, marginTop: 12 }]}>
            Note: {resultProfile.note}
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 18 }]}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel="Save calibration profile"
          >
            <Ionicons name="checkmark-circle" size={20} color="#0d1a0d" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Save profile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            onPress={restartScan}
            accessibilityRole="button"
            accessibilityLabel="Discard and re-scan"
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text_muted }]}>Discard &amp; re-scan</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Capture step UI (upright OR address) ────────────────────────
  const isUpright = step === 'upright_capture' || step === 'upright_processing';
  const isProcessing = step === 'upright_processing' || step === 'address_processing';

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="picture"
      />

      {/* Framing guide rectangle (mirrors quick-record's pattern) */}
      <View style={styles.framingGuide} pointerEvents="none">
        <View style={styles.framingFrame} />
        <Text style={styles.framingLabel}>
          {isUpright ? 'Full body · head to feet · perpendicular to camera' : 'Step into address · feet visible'}
        </Text>
      </View>

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.topBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.elapsedPill}>
          <Text style={styles.elapsedText}>
            {isUpright ? 'STEP 1 OF 2 · UPRIGHT' : 'STEP 2 OF 2 · ADDRESS'}
          </Text>
        </View>
        <View style={styles.topBtn} />
      </View>

      {/* Error chip when last attempt failed */}
      {errorMsg && (
        <View style={[styles.errorChip, { top: insets.top + 64 }]}>
          <Ionicons name="alert-circle" size={16} color="#ef4444" />
          <Text style={styles.errorChipText} numberOfLines={3}>{errorMsg}</Text>
        </View>
      )}

      {/* Bottom — capture button */}
      <View style={[styles.bottomArea, { bottom: insets.bottom + 24 }]}>
        <Text style={styles.hint}>
          {isProcessing
            ? 'Reading pose…'
            : isUpright
            ? 'Stand tall — head + both feet in the frame. Tap to capture.'
            : 'Stand into your normal address. Tap to capture.'}
        </Text>
        <TouchableOpacity
          onPress={() => capture(isUpright ? 'upright' : 'address')}
          disabled={isProcessing}
          style={[
            styles.recordOuter,
            { borderColor: '#ffffff', opacity: isProcessing ? 0.5 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Capture scan"
        >
          {isProcessing ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <View style={[styles.recordInner, { backgroundColor: '#fff', borderRadius: 28, width: 56, height: 56 }]} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  body: { padding: 16 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  subHint: { fontSize: 11, marginTop: 6, lineHeight: 16, fontStyle: 'italic' },
  warningCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  warningText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12, fontSize: 15, minHeight: 44 },
  card: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  cardValue: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2, fontVariant: ['tabular-nums'] },
  cardSub: { fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  k: { fontSize: 12, fontWeight: '600' },
  v: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12,
  },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  secondaryBtn: {
    paddingVertical: 12, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 10,
  },
  secondaryBtnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  permView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { fontSize: 20, fontWeight: '900' },
  permText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Camera-mode styles (mirror quick-record's framing pattern)
  topBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 10,
  },
  topBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  elapsedPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14,
  },
  elapsedText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  errorChip: {
    position: 'absolute', left: 24, right: 24,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(60,0,0,0.85)',
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#ef4444',
    zIndex: 11,
  },
  errorChipText: { flex: 1, color: '#fff', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  bottomArea: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', gap: 14,
  },
  recordOuter: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  recordInner: { /* dynamic */ },
  framingGuide: {
    position: 'absolute',
    top: '12%', left: '15%', right: '15%', bottom: '22%',
    alignItems: 'center', justifyContent: 'flex-end',
  },
  framingFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  framingLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6,
    marginBottom: 12,
  },
});
