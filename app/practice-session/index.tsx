import React, { useState } from 'react';
import { Modal, TextInput ,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useSwingSessionStore } from '../../store/swingSessionStore';
// 2026-05-21 — Consolidation 1 / Merge C: watch-connected state moved
// from settingsStore to watchStore (the dedicated watch store) so
// there's one source of truth when the native SDK lands.
import { useWatchStore } from '../../store/watchStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import KevinCoachBox from '../../components/swinglab/KevinCoachBox';
import AppIcon from '../../components/AppIcon';
import { getDialog } from '../../services/dialogEngine';
import { getMostRecentSpaceConfiguration, type SpaceConfiguration } from '../../services/spaceAssessment';
import { practiceLog } from '../../services/practiceTelemetry';
import { useTranslation } from 'react-i18next';

// Phase I — short club label for the Coach intro template
const CLUB_LABELS: Record<string, string> = {
  '7I': '7 Iron', '5I': '5 Iron', '8I': '8 Iron', '9I': '9 Iron',
  PW: 'Pitching Wedge', SW: 'Sand Wedge', LW: 'Lob Wedge', GW: 'Gap Wedge',
  '3W': '3 Wood', '5W': '5 Wood', D: 'Driver', H: 'Hybrid',
};
function clubLabel(code: string): string {
  return CLUB_LABELS[code] ?? code;
}

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
  const { t } = useTranslation();
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const router = useRouter();

  const { startSession, cameraAlignment, sessionHistory, setDistanceCalibration } = useSwingSessionStore();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationInput, setCalibrationInput] = useState('');
  const watchConnected = useWatchStore((s) => s.isConnected);
  const { confidenceByClub } = useRelationshipStore();

  const [selectedClub, setSelectedClub] = useState('7I');
  // Phase W — surface the user's most-recent space scan so the cage setup
  // pre-fills with Kevin's saved advice (mat / aim / phone placement).
  const [savedSpace, setSavedSpace] = useState<SpaceConfiguration | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getMostRecentSpaceConfiguration();
      if (!cancelled) setSavedSpace(s);
    })();
    return () => { cancelled = true; };
  }, []);

  const lastSession =
    sessionHistory.length > 0 ? sessionHistory[sessionHistory.length - 1] : null;

  const handleStart = () => {
    if (!selectedClub) {
      practiceLog('cage-index-start', 'fail', { reason: 'no-club-selected' });
      Alert.alert(t('practice_session.alert.select_a_club'), t('practice_session.alert.pick_a_club_before_starting'));
      return;
    }
    practiceLog('cage-index-start', 'ok', { club: selectedClub, route: '/practice-session/session' });
    startSession(selectedClub);
    router.push('/practice-session/session' as never);
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
            <Text style={styles.backText}>{t('practice_session.cage_index.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('practice_session.cage_index.cage_mode')}</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Phase I — Coach intro keyed off the selected club. Updates as the
             club selection changes. */}
        <KevinCoachBox
          body={getDialog('coach', 'cage_mode_setup_intro', { club: clubLabel(selectedClub) })}
          accent="coach"
        />

        {/* Phase W — saved practice space pre-fill. Shows Kevin's setup
            advice from the most recent /swinglab/space-scan so the player
            doesn't need to re-derive mat / aim / phone position each time.
            Tap routes back to the scan flow if they want to update. */}
        {savedSpace ? (
          <TouchableOpacity
            style={styles.spaceCard}
            activeOpacity={0.85}
            onPress={() => router.push('/swinglab/space-scan' as never)}
          >
            <View style={styles.spaceHeader}>
              <AppIcon name="scan-outline" size={18} color="#00C896" />
              <Text style={styles.spaceLabel}>{savedSpace.label.toUpperCase()}</Text>
              <Text style={styles.spaceRescan}>{t('practice_session.cage_index.re_scan')}</Text>
            </View>
            <Text style={styles.spaceSummary}>{savedSpace.assessment.summary || 'Saved.'}</Text>
            {savedSpace.assessment.recommended_setup?.mat_position ? (
              <View style={styles.spaceRow}>
                <Text style={styles.spaceTag}>{t('practice_session.cage_index.mat')}</Text>
                <Text style={styles.spaceVal}>{savedSpace.assessment.recommended_setup.mat_position}</Text>
              </View>
            ) : null}
            {savedSpace.assessment.recommended_setup?.aim_direction ? (
              <View style={styles.spaceRow}>
                <Text style={styles.spaceTag}>{t('practice_session.cage_index.aim')}</Text>
                <Text style={styles.spaceVal}>{savedSpace.assessment.recommended_setup.aim_direction}</Text>
              </View>
            ) : null}
            {savedSpace.assessment.camera_position?.dtl_placement ? (
              <View style={styles.spaceRow}>
                <Text style={styles.spaceTag}>{t('practice_session.cage_index.phone')}</Text>
                <Text style={styles.spaceVal}>{savedSpace.assessment.camera_position.dtl_placement}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.scanPromptCard}
            activeOpacity={0.85}
            onPress={() => router.push('/swinglab/space-scan' as never)}
          >
            <AppIcon name="scan-outline" size={20} color="#00C896" />
            <View style={{ flex: 1 }}>
              <Text style={styles.scanPromptTitle}>{t('practice_session.cage_index.scan_your_space')}</Text>
              <Text style={styles.scanPromptSub}>{t('practice_session.cage_index.30_seconds_kevin_tells_you')}</Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}

        {/* CAMERA STATUS */}
        {/*
          2026-09-10 (Tim) — THIS CARD CONTRADICTED ITSELF.

          The title keyed on `cameraAlignment.locked`, and `setCameraAlignment` — the ONLY writer of
          `locked: true` — is called by nothing, anywhere (store-wide orphan sweep): the fine
          aim-lock step it belongs to was never built. `setDistanceCalibration` deliberately
          preserves rather than sets it (`locked: s.cameraAlignment?.locked ?? false`).

          So a player who calibrated their distance saw a grey "Camera Not Set" directly above
          "Calibrated to 25 yards" — the card telling them two opposite things at once, and the one
          that looked authoritative was the wrong one.

          `locked` and `distance_yards` are two different facts. Ready means we know SOMETHING
          usable, and the subtitle already says which. Honest degradation rather than a false
          negative. [[guards-by-element-not-blanket-suppression]] [[illustration-data-points]]
        */}
        {(() => { const cameraKnown = !!cameraAlignment?.locked || cameraAlignment?.distance_yards != null; return (
        <View style={[styles.cameraCard, cameraKnown && styles.cameraCardLocked]}>
          <View style={styles.cameraRow}>
            <AppIcon name="videocam-outline" size={22} color={cameraKnown ? '#00C896' : '#9ca3af'} />
            <View style={styles.cameraText}>
              <Text style={styles.cameraTitle}>
                {cameraAlignment?.locked
                  ? 'Camera Ready ✓'
                  : cameraAlignment?.distance_yards != null
                    ? 'Camera Calibrated ✓'
                    : 'Camera Not Set'}
              </Text>
              <Text style={styles.cameraSub}>
                {cameraAlignment?.distance_yards != null
                  ? `Calibrated to ${cameraAlignment.distance_yards} yards`
                  : cameraAlignment?.locked
                    ? 'SwingLab ready · distance not calibrated'
                    : 'Optional — tap to set up'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.cameraSetBtn}
              onPress={() => {
                // Phase J — open distance calibration modal. Pre-populate
                // with the existing value if one exists so re-opening is
                // an "adjust" rather than "set fresh."
                setCalibrationInput(
                  cameraAlignment?.distance_yards != null
                    ? String(cameraAlignment.distance_yards)
                    : '',
                );
                setCalibrationOpen(true);
              }}
            >
              <Text style={styles.cameraSetText}>
                {cameraAlignment?.distance_yards != null ? 'Adjust' : 'Set Up'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        ); })()}

        {/* DEVICE STATUS */}
        <View style={styles.deviceRow}>
          <View style={[styles.devicePill, watchConnected && styles.devicePillActive]}>
            <AppIcon name="watch-outline" size={16} color={watchConnected ? '#60a5fa' : '#6b7280'} />
            <Text style={[styles.deviceLabel, watchConnected && styles.deviceLabelActive]}>
              {watchConnected ? 'Watch On' : 'Watch Off'}
            </Text>
          </View>
          <View style={styles.devicePill}>
            <AppIcon name="musical-notes-outline" size={16} color="#6b7280" />
            <Text style={styles.deviceLabel}>{t('practice_session.cage_index.sound_on')}</Text>
          </View>
        </View>

        {/* CLUB SELECTOR */}
        <Text style={styles.sectionLabel}>{t('practice_session.cage_index.select_club')}</Text>

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
            <Text style={styles.lastSessionLabel}>{t('practice_session.cage_index.last_session')}</Text>
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
            onPress={() => router.push('/practice-session/history' as never)}
          >
            <Text style={styles.historyBtnText}>{t('practice_session.cage_index.view_session_history')}</Text>
          </TouchableOpacity>
        )}

        {/* START */}
        <TouchableOpacity style={styles.startBtn} onPress={handleStart} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>{t('practice_session.cage_index.start_session')}</Text>
        </TouchableOpacity>

        {/* TARGET CALIBRATION — acoustic dataset builder */}
        <TouchableOpacity
          style={styles.calibrateTargetBtn}
          onPress={() => router.push('/practice-session/target-calibration' as never)}
          activeOpacity={0.8}
        >
          <AppIcon name="radio-button-on-outline" size={18} color="#6b7280" />
          <Text style={styles.calibrateTargetText}>{t('practice_session.cage_index.target_calibration')}</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Phase J — Distance calibration modal. Walk to a reference target
           in the cage, type the yardage, save. One-time per cage; re-open
           to adjust. Calibration powers acoustic ball speed reference, future
           pose-distance corrections (K), and CV target sizing (L). */}
      <Modal
        visible={calibrationOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalibrationOpen(false)}
      >
        <TouchableOpacity activeOpacity={1} style={calStyles.scrim} onPress={() => setCalibrationOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%', alignItems: 'center' }}
          >
          <TouchableOpacity activeOpacity={1} style={calStyles.card}>
            <Text style={calStyles.title}>{t('practice_session.cage_index.cage_distance')}</Text>
            <Text style={calStyles.body}>
              {t('practice_session.cage_index.walk_to_a_reference_target')}
            </Text>
            <Text style={calStyles.label}>{t('practice_session.cage_index.yards')}</Text>
            <TextInput
              style={calStyles.input}
              value={calibrationInput}
              onChangeText={setCalibrationInput}
              keyboardType="number-pad"
              placeholder="e.g. 8"
              placeholderTextColor="#4b5563"
              autoFocus
            />
            <View style={calStyles.actions}>
              <TouchableOpacity onPress={() => setCalibrationOpen(false)} style={calStyles.btn}>
                <Text style={calStyles.btnText}>{t('play.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const yards = parseInt(calibrationInput, 10);
                  if (yards > 0 && yards < 200) {
                    setDistanceCalibration(yards);
                    setCalibrationOpen(false);
                  }
                }}
                style={[calStyles.btn, calStyles.btnPrimary]}
              >
                <Text style={[calStyles.btnText, calStyles.btnTextPrimary]}>{t('practice_session.cage_index.save')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const calStyles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { backgroundColor: '#0d2418', borderRadius: 14, borderWidth: 1, borderColor: '#1e3a28', padding: 18, width: '100%', maxWidth: 380 },
  title: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 10 },
  body: { color: '#e8f5e9', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  label: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  input: {
    backgroundColor: '#0a1e12', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 10,
    color: '#ffffff', fontSize: 22, fontWeight: '800',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1e3a28', borderRadius: 10, backgroundColor: '#0a1e12' },
  btnPrimary: { borderColor: '#00C896', backgroundColor: '#003d20' },
  btnText: { color: '#c2cad4', fontSize: 13, fontWeight: '700' },
  btnTextPrimary: { color: '#00C896' },
});

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
  spaceCard: {
    marginHorizontal: 16, marginTop: 12, padding: 14,
    backgroundColor: '#0d2418', borderColor: '#00C896', borderWidth: 1,
    borderRadius: 14, gap: 8,
  },
  spaceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spaceLabel: { color: '#00C896', fontSize: 11, fontWeight: '900', letterSpacing: 1.4, flex: 1 },
  spaceRescan: { color: '#c2cad4', fontSize: 11, fontWeight: '700' },
  spaceSummary: { color: '#fff', fontSize: 13, lineHeight: 19 },
  spaceRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 4 },
  spaceTag: { color: '#6b7280', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, width: 50, marginTop: 2 },
  spaceVal: { flex: 1, color: '#e5e7eb', fontSize: 12, lineHeight: 17 },
  scanPromptCard: {
    marginHorizontal: 16, marginTop: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 14,
  },
  scanPromptTitle: { color: '#00C896', fontSize: 13, fontWeight: '800' },
  scanPromptSub: { color: '#c2cad4', fontSize: 11, marginTop: 2, lineHeight: 16 },
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
    color: '#c2cad4',
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
  calibrateTargetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginTop: 4,
  },
  calibrateTargetText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
});
