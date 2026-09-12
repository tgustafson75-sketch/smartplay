import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  isMetaWearablesAvailable,
  startMetaWearablesStreaming,
  stopMetaWearablesStreaming,
  describeGlassesError,
  onGlassesStatusChange,
  getGlassesStatusSync,
  type GlassesStatus,
} from '../services/metaWearablesBridge';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  TextInput,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { MESSAGING_ENABLED } from '../constants/featureFlags';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';
import { displayCaddieName } from '../services/caddieResolver';
// 2026-05-21 — Consolidation 1 / Merge C: watch-connected display
// reads from the dedicated watchStore so all three call sites
// (cage-mode, cage/summary, settings) share one source of truth.
import { useWatchStore } from '../store/watchStore';
import { watchDeviceLabel } from '../services/watchBridge';
import { useOwnerChecklistStore } from '../store/ownerChecklistStore';
import { initWatchSwingBridge, stopWatchSwingBridge, isWatchSwingBridgeAvailable } from '../services/watchSwingBridge';
// 2026-05-27 — Fix EA: screenshot mode toggle (hides system chrome
// for clean promo / store screenshots). Sourced from its own store
// so app-wide consumers (the root StatusBar binding) read the same flag.
import { useScreenshotModeStore } from '../store/screenshotModeStore';
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';
import { useToastStore } from '../store/toastStore';
import { useTrustLevelStore, TRUST_LEVEL_META, TRUST_LEVEL_SLIDER_ORDER } from '../store/trustLevelStore';
import { useVoiceHitRateStore } from '../store/voiceHitRateStore';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { isFeatureShelved } from '../services/releaseSurface';
import CloudBackupCard from '../components/settings/CloudBackupCard';
import type { ThemeColors } from '../theme/tokens';
import { getCaddieName, selectablePersonas } from '../lib/persona';
import { syncBluetoothMediaButtonState } from '../services/voiceTriggers';
import { setEnabled as setEarbudEnabled } from '../services/earbudControl';
import {
  startSimulatedWalk, stopSimulatedWalk, getAvailableWalks,
  subscribeToWalk, isSimulatedActive, type SimulatedWalkState,
} from '../services/simulatedGPS';
import { setScreenContext } from '../services/screenContext';
import * as Sentry from '@sentry/react-native';

// 2026-07-08 (Tim — "answer, don't interview") — primes the caddie to INVITE the golfer
// to talk and then LISTEN, not run a Q&A. Ingested to CNS via narrativeIngest.
const GET_TO_KNOW_FOCUS =
  'the player wants to tell you about their game so you get to know them. Open with ONE short, warm line inviting them to talk (e.g. "Tell me about your game — how you practice, what you\'re chasing"), then LISTEN. Do NOT interrogate or run a checklist of questions. Acknowledge what they volunteer so they know you heard it. They lead; you listen and remember.';

export default function Settings() {
  const router = useRouter();
  // Audit follow-up (2026-05-13) — pull bottom inset so the last
  // Settings row doesn't clip under the home indicator on notched
  // devices. Applied to the ScrollView's contentContainerStyle below.
  const insets = useSafeAreaInsets();

  const { colors } = useTheme();
  const { t } = useTranslation();

  const {
    // 2026-05-26 — Fix BE: Cecily Mode toggle state + setter.
    cecilyMode,
    setCecilyMode,
    // 2026-05-26 — Fix AP Phase 2: Continuous Conversation toggle.
    continuousConversationMode,
    setContinuousConversationMode,
    language,
    responseMode,
    highContrast,
    autoListenEnabled,
    cartMode,
    skip_briefings,
    proactive_kevin_enabled,
    distance_unit,
    theme_preference,
    // 2026-07-06 — earbud tap-to-talk is REAL and back. The native listener
    // (BluetoothMediaButtonModule + withBluetoothMediaButton plugin, app.json) has
    // been in the build; the removed track-player path (mediaKeyBridge) was a DEAD
    // second implementation. Live toggle restored.
    earbudTapToTalk,
    setEarbudTapToTalk,
    kevinGreetingEnabled,
    setKevinGreetingEnabled,
    // 2026-05-30 — Fix FY: Local Mode toggle.
    localMode,
    setLocalMode,
    setLanguage,
    setResponseMode,
    setHighContrast,
    // PGA HOPE follow-up + re-sim — accessibility / persona-fit fields.
    largeText,
    setLargeText,
    ttsCaptions,
    setTtsCaptions,
    simpleBriefing,
    setSimpleBriefing,
    simpleBriefingUserTouched,
    personaIntensity,
    setPersonaIntensity,
    setAutoListenEnabled,
    setCartMode,
    setSkipBriefings,
    setProactiveKevinEnabled,
    setDistanceUnit,
    setThemePreference,
  } = useSettingsStore();

  // Watch-connected status for the disabled "Galaxy Watch · Not wired"
  // display row. Reads from the dedicated watchStore — stays false
  // until the native SDK lands and flips it.
  const watchConnected = useWatchStore((s) => s.isConnected);
  /**
   * 2026-09-09 — the count rides on the row itself, so Owner Tools says there is work without opening
   * it. Selected as the raw array and counted in a useMemo, NOT `.filter(...).length` inside the
   * selector: a selector that allocates is what caused the recap screen's "Maximum update depth
   * exceeded" three times, and the repo has a guard for exactly this shape. Caught by that guard on
   * first run, which is the guard doing its job.
   */
  const checklistItems = useOwnerChecklistStore((s) => s.items);
  const checklistOpen = useMemo(() => checklistItems.filter((i) => !i.done).length, [checklistItems]);
  // 2026-06-30 (Tim — "turning on the watch is blocked") — the Galaxy Watch swing-IMU bridge
  // shipped in the native build, so this is a REAL toggle now. Available only when the native
  // module is linked (latest build); on an older binary it stays disabled with a clear note.
  const watchSwingEnabled = useSettingsStore((s) => s.watchSwingEnabled);
  const setWatchSwingEnabled = useSettingsStore((s) => s.setWatchSwingEnabled);
  const watchWrist = useSettingsStore((s) => s.watchWrist);
  const setWatchWrist = useSettingsStore((s) => s.setWatchWrist);
  const watchBridgeAvailable = isWatchSwingBridgeAvailable();
  const watchHealthSnapshot = useWatchStore((s) => s.lastHealthSnapshot);
  const watchHealthSyncAt = useWatchStore((s) => s.lastHealthSyncAt);

  // 4-persona caddie selector — driven by caddiePersonality (the source
  // of truth). voiceGender is auto-synced inside the store setter.
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const setCaddiePersonality = useSettingsStore(s => s.setCaddiePersonality);

  // Phase 105 — per-pillar team assignments.
  const caddieAssignments = useSettingsStore(s => s.caddieAssignments);
  const setCaddieForPillar = useSettingsStore(s => s.setCaddieForPillar);
  const resetCaddieAssignments = useSettingsStore(s => s.resetCaddieAssignments);
  // Phase 106 — team handoff suggestions suppression.
  const caddieSuggestions = useSettingsStore(s => s.caddieSuggestions);
  const setCaddieSuggestions = useSettingsStore(s => s.setCaddieSuggestions);
  // Phase 107 — GPS quality debug overlay toggle.
  const gpsQualityDebugOverlay = useSettingsStore(s => s.gpsQualityDebugOverlay);
  const setGpsQualityDebugOverlay = useSettingsStore(s => s.setGpsQualityDebugOverlay);
  // 2026-06-30 (audit) — these round behaviors are consumed (_layout.tsx, holeDetection,
  // roundStore) and their setters existed, but no toggle was ever built — even though the
  // _layout.tsx comment literally promises "Settings → Auto Shot Detection". Expose both;
  // store defaults are unchanged (auto-shot OFF, auto-advance ON), so behavior is identical
  // until the user opts in.
  const autoShotDetection = useSettingsStore(s => s.autoShotDetection);
  const ownerFieldTest = useSettingsStore(s => s.ownerFieldTest);
  const setOwnerFieldTest = useSettingsStore(s => s.setOwnerFieldTest);
  const setAutoShotDetection = useSettingsStore(s => s.setAutoShotDetection);
  const autoHoleAdvance = useSettingsStore(s => s.autoHoleAdvance);
  const setAutoHoleAdvance = useSettingsStore(s => s.setAutoHoleAdvance);
  const interactiveRound = useSettingsStore(s => s.interactiveRound);
  const setInteractiveRound = useSettingsStore(s => s.setInteractiveRound);
  // 2026-06-24 — Off-device data layer Phase A: usage telemetry opt-in.
  const analyticsOptIn = useSettingsStore(s => s.analyticsOptIn);
  const setAnalyticsOptIn = useSettingsStore(s => s.setAnalyticsOptIn);

  // Persona-aware display name. Settings labels reference the active caddie
  // by name consistently with the rest of the app.
  const caddieName = getCaddieName(caddiePersonality);

  // 2026-05-19 — trust level read inline in Round Experience instead of
  // routing to a sub-screen. Same store, same persistence.
  const trustLevel = useTrustLevelStore(s => s.level);
  const setTrustLevel = useTrustLevelStore(s => s.setLevel);

  /**
   * 2026-05-19 — Toggle wrapper that fires a Medium haptic and a toast
   * on every state change. Previously the bare setters gave no visible
   * confirmation — the switch thumb sliding was the only signal that the
   * change took. Tim's "we go to change settings but you get no
   * confirmations of what's actually taking place." Now every wrapped
   * toggle says, in one line, what just happened.
   */
  const confirmToggle = (label: string, setter: (v: boolean) => void) => (v: boolean) => {
    setter(v);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    useToastStore.getState().show(`${label}: ${v ? 'ON' : 'OFF'}`);
  };

  // 2026-05-17 — Phase 413 health-data settings hooks.
  const healthDataEnabled = useSettingsStore(s => s.healthDataEnabled);
  const setHealthDataEnabled = useSettingsStore(s => s.setHealthDataEnabled);
  const shareCommunityData = useSettingsStore(s => s.shareCommunityData);
  const setShareCommunityData = useSettingsStore(s => s.setShareCommunityData);
  const shareDiagnostics = useSettingsStore(s => s.shareDiagnostics);
  const setShareDiagnostics = useSettingsStore(s => s.setShareDiagnostics);
  const setHasAskedHealthPermission = useSettingsStore(s => s.setHasAskedHealthPermission);

  const {
    name,
    role,
    coachCredentials,
    handicap,
    handedness,
    dominantMiss,
    physicalLimitation,
    goal,
    personalBest,
    preferredTee,
    /**
     * 2026-09-10 (Tim: "I am tired of half done work") — FOUR PROFILE FIELDS WITH READERS AND NO
     * WRITER. missType, experienceContext, homeCourse and default_mode each have live consumers and
     * were never editable anywhere, so every one of those consumers took its null branch forever:
     *   homeCourse        -> play.tsx default-selects your home course; smartvision's last-resort
     *                        courseId; contextSynthesizer's brief to Kevin
     *   missType          -> ball-fit's ball recommendation
     *   experienceContext -> coachingAdaptation's tone + complexity (always the default branch),
     *                        videoUpload, ball-fit
     *   default_mode      -> the mode Kevin assumes when you start a round
     * The comment further down this file CLAIMED these were already here ("experience, home course"),
     * which is most likely why nobody noticed for months. [[a-stale-header-is-a-source-someone-trusts]]
     */
    missType,
    experienceContext,
    distanceControl,
    homeCourse,
    default_mode,
    setMissType,
    setExperienceContext,
    setDistanceControl,
    setHomeCourse,
    setDefaultMode,
    setName,
    setRole,
    setCoachCredentials,
    setHandicap,
    setHandedness,
    setDominantMiss,
    setPhysicalLimitation,
    setGoal,
    setPersonalBest,
    setPreferredTee,
  } = usePlayerProfileStore();

  /**
   * 2026-09-11 — what the caddie has LEARNED about how much to talk, in the player's own words.
   * Loaded once; the card shows it and offers a reset. Null means nothing learned, which is a
   * perfectly good state and reads as "Normal length" rather than an error.
   */
  const [learnedStyleLine, setLearnedStyleLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const cs = await import('../services/caddieStyle');
        const line = cs.describeLearnedStyle(await cs.loadLearnedStyle());
        if (alive) setLearnedStyleLine(line);
      } catch { /* nothing learned yet */ }
    })();
    return () => { alive = false; };
  }, []);
  const [editName, setEditName] = useState(name);
  const [editHandicap, setEditHandicap] = useState(String(handicap));
  const [editCreds, setEditCreds] = useState(coachCredentials ?? '');
  const [editHomeCourse, setEditHomeCourse] = useState(homeCourse ?? '');
  const [editGoal, setEditGoal] = useState(goal ?? '');

  // 2026-07-11 — Ray-Ban Meta glasses live stream (DAT v0.8). Subscribe to the
  // bridge status; the toggle starts/stops the POV camera stream into the caddie.
  const [glasses, setGlasses] = useState<GlassesStatus>(getGlassesStatusSync());
  useEffect(() => onGlassesStatusChange(setGlasses), []);
  const onToggleGlasses = useCallback((v: boolean) => {
    if (v) {
      startMetaWearablesStreaming('medium', 24).catch((e: unknown) => {
        // 2026-07-30 (Tim — "our toggle is blocking, glasses ARE connected in the Meta app"). The old
        // catch swallowed the REAL DAT error and always said "pair in the Meta app first" — misleading
        // once the glasses are actually paired. Surface the actual native failure code + message (e.g.
        // DAT_SESSION_FAILED / "missing application id") so the true cause is visible WITHOUT a rebuild,
        // and record it to the issue log (which now auto-sends) so we capture it off-device.
        const err = e as { code?: unknown; message?: unknown } | null;
        const code = typeof err?.code === 'string' ? err.code : '';
        const msg = typeof err?.message === 'string' ? err.message : String(e ?? 'unknown error');
        // 2026-08-07 (Tim — raw "NO_ELIGIBLE_DEVICE" toast). Show a HUMAN, actionable line (north star:
        // no robotic error codes); the raw code + message still go to the issue log below for diagnosis.
        // 2026-08-08 — signing SHA verified EXACT against Meta's registration (parsed from the shipped
        // APK), so an eligibility failure is the Meta-side chain: Developer Mode + owner account. GUIDE
        // it (Alert with the two steps + an Open-Meta-AI button) instead of a transient toast.
        if ((code || msg).toUpperCase().includes('ELIGIBLE') || (code || '').toUpperCase().includes('SESSION')) {
          Alert.alert(
            t('settings.alert.glasses_not_authorized_yet'),
            t('settings.alert.the_app_registration_check_out'),
            [
              { text: 'Open Meta AI', onPress: () => { Linking.openURL('fb-mwa://').catch(() => Linking.openURL('https://www.meta.com/smart-glasses/app/').catch(() => {})); } },
              { text: 'OK', style: 'cancel' },
            ],
          );
        } else {
          useToastStore.getState().show(describeGlassesError(code, msg));
        }
        try {
          (require('../store/issueLogStore') as typeof import('../store/issueLogStore'))
            .useIssueLogStore.getState().addAppEvent('glasses_connect_failed', { code, message: msg }, 'app_error');
        } catch { /* non-fatal */ }
      });
    } else {
      stopMetaWearablesStreaming().catch(() => {});
    }
  }, [t]);
  const handicapIndex = usePlayerProfileStore(s => s.handicap_index);
  const setHandicapIndex = usePlayerProfileStore(s => s.setHandicapIndex);
  const handicapGender = usePlayerProfileStore(s => s.handicap_gender);
  const setHandicapGender = usePlayerProfileStore(s => s.setHandicapGender);
  const [editIndex, setEditIndex] = useState(handicapIndex != null ? String(handicapIndex) : '');
  // 2026-05-26 — Fix AB Phase 1: GHIN # local edit mirror.
  const ghinNumber = usePlayerProfileStore(s => s.ghin_number);
  const setGhinNumber = usePlayerProfileStore(s => s.setGhinNumber);
  const [editGhin, setEditGhin] = useState(ghinNumber ?? '');
  // 2026-06-09 — Account email. Setting it to an owner-allowlisted address
  // unlocks Owner Tools (the auto-mirror stops once the allow-list has >1
  // entry, so this explicit input is the supported path). Mirrors locally.
  const accountEmail = usePlayerProfileStore(s => s.email);
  const setAccountEmail = usePlayerProfileStore(s => s.setEmail);
  const [editEmail, setEditEmail] = useState(accountEmail ?? '');

  // 2026-05-26 — Fix BD: WHS handicap recompute from roundHistory.
  // Walks every round (live + Batch-28 imports) ≥ 9 holes, rebuilds
  // the recent_differentials list, and computes a fresh Index via
  // best-8-of-20. Replaces the existing differentials list outright
  // so a stale/wrong index gets corrected. Toast + console log on
  // success so the user can see the new value land.
  const onRecalculateHandicap = useCallback(() => {
    try {
      const roundMod = require('../store/roundStore') as typeof import('../store/roundStore');
      const calcMod = require('../services/handicapCalculator') as typeof import('../services/handicapCalculator');
      // 2026-07-06 (audit P0) — canonical filter from roundStore: also excludes sim rounds, which
      // this site's inline copy missed.
      // 2026-09-11 — and it now REPAIRS first: historical rounds of 7-13 holes carried no posting
      // basis and had never counted, and old 9s/18s posted uncapped. One helper so the three
      // Recalculate surfaces cannot drift apart on the order of the two steps.
      const { eligible, repaired, nowCounted } = roundMod.recalculateHandicapRounds();
      if (eligible.length < 3) {
        Alert.alert(
          t('settings.alert.need_more_rounds'),
          `Recalculation needs at least 3 postable rounds. You have ${eligible.length}. Play more rounds or import past rounds (Settings → Help → Import Past Round). A round of 7-13 holes posts as a nine; under 7 holes cannot post.`,
        );
        return;
      }
      const differentials = calcMod.rebuildDifferentialsFromHistory(eligible);
      // Reset the rolling window to the recomputed list. Done by
      // clearing + re-pushing because there's no setRecentDifferentials.
      const profileMod = usePlayerProfileStore.getState();
      // Clear by setting handicap_index null → that's a noop on the
      // differentials. Use the partial-state setter pattern instead:
      // direct set via the store API.
      usePlayerProfileStore.setState({ recent_differentials: differentials });
      const result = calcMod.estimateNewIndex(differentials);
      if (result.newIndex != null) {
        profileMod.setHandicapIndex(result.newIndex);
        setEditIndex(String(result.newIndex));
        /**
         * 2026-09-11 — SAY WHAT THE REPAIR DID, because it is why the number moved.
         *
         * A recalculate that silently restamps historical rounds and hands back a different Index is
         * indistinguishable from a bug. `nowCounted` is the part that surprises: rounds of 7-13
         * holes had never counted toward the Index at all, so this is the tap where they start.
         */
        const repairNote = repaired > 0
          ? `\n\nRepaired the scoring basis on ${repaired} past round${repaired === 1 ? '' : 's'}` +
            (nowCounted > 0
              ? `, ${nowCounted} of which had never counted toward your Index (a round of 7-13 holes posts as a nine).`
              : ' — blow-up holes are now capped at net double bogey, as the Rules of Handicapping require.')
          : '';
        Alert.alert(
          t('settings.alert.handicap_updated'),
          `New Index: ${result.newIndex.toFixed(1)}\n\n${result.estimateNote}${repairNote}`,
        );
      } else {
        Alert.alert(t('settings.alert.could_not_compute'), result.estimateNote);
      }
    } catch (e) {
      console.log('[settings] recalculate handicap threw:', e);
      Alert.alert(t('settings.alert.recalculation_failed'), e instanceof Error ? e.message : String(e));
    }
  }, [t]);
  // 2026-06-16 — Meta glasses voice-log import (v1: JSON file, active
  // round only). Picks the Meta View export, hands the file URI to
  // ingestMetaGlassesJson, and surfaces the IngestResult via toast.
  // ingested:0 with no other counts means there was no active round —
  // we message that honestly rather than a silent no-op. The service
  // throws on unreadable / unparseable / non-array files; caught here.
  const onImportMetaGlassesLog = useCallback(() => {
    void (async () => {
      try {
        const DocumentPicker = await import('expo-document-picker');
        const picked = await DocumentPicker.getDocumentAsync({
          type: 'application/json',
          copyToCacheDirectory: true,
        });
        if (picked.canceled) return;
        const uri = picked.assets[0]?.uri;
        if (!uri) {
          useToastStore.getState().show('Could not read that file.');
          return;
        }
        const { ingestMetaGlassesJson } = await import('../services/metaGlassesIngest');
        const result = await ingestMetaGlassesJson(uri);

        // ingested:0 with no parse counts ⇒ no active round (the service
        // returns early before populating totalParsed).
        if (result.ingested === 0 && result.totalParsed == null) {
          useToastStore.getState().show('Start a round first — glasses log imports into the active round only.');
          return;
        }

        if (result.ingested === 0) {
          useToastStore.getState().show('No exchanges fell inside this round’s time window.');
          return;
        }

        const extras: string[] = [];
        if (result.outsideWindow) extras.push(`${result.outsideWindow} outside the round`);
        if (result.rejected) extras.push(`${result.rejected} unreadable`);
        const suffix = extras.length ? ` (${extras.join(', ')})` : '';
        useToastStore.getState().show(`Imported ${result.ingested} glasses exchange${result.ingested === 1 ? '' : 's'}${suffix}.`);
      } catch (e) {
        console.log('[settings] Meta glasses import failed:', e);
        useToastStore.getState().show('That file couldn’t be read as a Meta View JSON export.');
      }
    })();
  }, []);

  // 2026-07-07 (Tim — SmartPump third rail) — import a SmartPump golf-workout export
  // (PDF/image AI-parsed server-side, or JSON/CSV parsed on-device). Dated workouts
  // feed the dashboard's TRAINING → PERFORMANCE correlation card.
  const onImportSmartPump = useCallback(() => {
    // 2026-08-22 — the flow itself (and every message the player sees) lives in the service, so the
    // dashboard's TRAIN YOUR SWING card runs the SAME import rather than a second copy of it.
    void (async () => {
      const { importSmartPumpWithFeedback } = await import('../services/smartPumpIngest');
      await importSmartPumpWithFeedback('settings');
    })();
  }, []);

  const [editLimitation, setEditLimitation] = useState(physicalLimitation ?? '');
  const [editBest, setEditBest] = useState(personalBest ? String(personalBest) : '');
  // 2026-06-04 — Personal-best capture for the dashboard Highlights card.
  // longestDrive auto-updates from logShot when a Driver shot beats the
  // current high (see roundStore.logShot); longestPutt is manual until
  // a putt-distance sensor lands. Both clear when the user blanks the
  // input.
  const longestDrive = usePlayerProfileStore(s => s.longestDrive);
  const setLongestDrive = usePlayerProfileStore(s => s.setLongestDrive);
  const longestPutt = usePlayerProfileStore(s => s.longestPutt);
  const setLongestPutt = usePlayerProfileStore(s => s.setLongestPutt);
  const [editLongestDrive, setEditLongestDrive] = useState(longestDrive != null ? String(longestDrive) : '');
  const [editLongestPutt, setEditLongestPutt] = useState(longestPutt != null ? String(longestPutt) : '');

  // 2026-07-01 (Tim — OTA-lag trust fix) — show the LIVE bundle stamp so you can confirm in 2s that
  // you're on the current update before judging a fix. `embedded` = running the build's baked-in JS
  // (no OTA pulled yet); otherwise shows the OTA update id + when it was published.
  const [buildStamp, setBuildStamp] = useState<string>('Loading…');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const Updates = await import('expo-updates');
        const embedded = Updates.isEmbeddedLaunch === true;
        const id = typeof Updates.updateId === 'string' ? Updates.updateId.slice(0, 8) : null;
        const at = Updates.createdAt instanceof Date
          ? Updates.createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : null;
        const ch = typeof Updates.channel === 'string' ? Updates.channel : null;
        const stamp = embedded
          ? `Embedded (no OTA yet)${ch ? ` · ${ch}` : ''}`
          : `${id ?? 'unknown'}${at ? ` · ${at}` : ''}${ch ? ` · ${ch}` : ''}`;
        if (alive) setBuildStamp(stamp);
      } catch {
        if (alive) setBuildStamp('Unavailable');
      }
    })();
    return () => { alive = false; };
  }, []);

  // 2026-05-28 — Fix FB: ScrollView ref so we can scroll back to top on
  // profile save. The collapsed slim card sits at the top of the
  // ScrollView; without the scroll-back, the user is still down at the
  // form's Save button position and visually "where did my form go?"
  // since the slim card is far above the fold.
  const scrollRef = useRef<ScrollView>(null);

  const handleSaveProfile = () => {
    if (editName.trim()) setName(editName.trim());
    const hcp = parseInt(editHandicap, 10);
    if (!isNaN(hcp)) setHandicap(Math.min(54, Math.max(0, hcp)));
    setGoal(editGoal.trim() || null);
    setPhysicalLimitation(editLimitation.trim() || null);
    const best = parseInt(editBest, 10);
    setPersonalBest(!isNaN(best) ? best : null);
    // 2026-06-04 — Personal bests for the dashboard Highlights card.
    const drv = parseInt(editLongestDrive, 10);
    setLongestDrive(!isNaN(drv) && drv > 0 ? drv : null);
    const putt = parseInt(editLongestPutt, 10);
    setLongestPutt(!isNaN(putt) && putt > 0 ? putt : null);
    setProfileExpanded(false);
    // 2026-05-28 — Fix FB: three coordinated changes to make save
    // actually feel like save.
    //   1. Toast instead of blocking Alert — the Alert was sitting on
    //      top of the freshly-collapsed slim card, so the user
    //      dismissed it and was still looking at the (now-cached?)
    //      old form layout. Toast slides in without blocking render.
    //   2. setProfileExpanded(false) above — already was there, but
    //      it never visibly took effect because the Alert blocked.
    //   3. scrollRef.scrollTo({y:0}) below — even with collapse + no
    //      blocking modal, the user's scroll position is mid-page at
    //      the form's Save button. Scrolling back to top puts the
    //      slim card under their eye where they expect.
    useToastStore.getState().show('Profile saved');
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  // 2026-05-18 — Collapsible sections. Settings was ~5 scrolls long;
  // now each section header is a tap target that toggles its card body.
  // All sections default collapsed except Profile (which has its own
  // slim-card-vs-edit-form treatment based on whether a name is saved).
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [profileExpanded, setProfileExpanded] = useState(!name?.trim());
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;
  const isExpanded = (title: string) => expandedSections[title] === true;
  const toggleSection = (title: string) => {
    setExpandedSections(prev => ({ ...prev, [title]: !prev[title] }));
  };
  // 2026-05-18 — Search across section titles + section body text. When
  // a query is active, force-expand sections whose title OR child text
  // contains the query so the user can see the matching control
  // without having to manually expand it.
  const sectionMatchesQuery = (title: string, body: string): boolean => {
    if (!isSearching) return true;
    const q = searchQuery.trim().toLowerCase();
    return title.toLowerCase().includes(q) || body.toLowerCase().includes(q);
  };

  // ─── SUB-COMPONENTS ───────────────────────

  // Computed styles that adapt to the active theme
  const cardStyle    = [styles.card,       { backgroundColor: colors.surface, borderColor: colors.border }];
  const labelStyle   = [styles.rowLabel,   { color: colors.text_primary }];
  const subStyle     = [styles.rowSub,     { color: colors.text_muted }];
  const rowDivStyle  = [styles.row,        { borderBottomColor: colors.border }];
  const inputLblStyle = [styles.inputLabel, { color: colors.text_muted }];
  const inputFldStyle = [styles.input,     { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }];

  const SectionHeader = ({ title }: { title: string }) => (
    <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>{title}</Text>
  );

  // 2026-05-18 — Tappable section header + collapsible body. Renders
  // children inside the standard cardStyle View only when expanded.
  // When a search query is active, the section is force-shown if its
  // title OR child text matches; otherwise the whole section is hidden.
  const CollapsibleSection = ({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ComponentProps<typeof Ionicons>['name'] }) => {
    // Extract plain text from children for search matching. Recursive
    // walk handles nested elements; non-string nodes (icons, etc.) are
    // ignored — matches text content only.
    const extractText = (node: React.ReactNode): string => {
      if (node == null || typeof node === 'boolean') return '';
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(extractText).join(' ');
      if (React.isValidElement(node)) {
        const props = node.props as { children?: React.ReactNode; label?: string; sub?: string };
        return [props.label ?? '', props.sub ?? '', extractText(props.children)].join(' ');
      }
      return '';
    };
    const bodyText = isSearching ? extractText(children) : '';
    const visible = sectionMatchesQuery(title, bodyText);
    if (!visible) return null;
    const open = isSearching ? true : isExpanded(title);
    return (
      <>
        <TouchableOpacity
          onPress={() => !isSearching && toggleSection(title)}
          activeOpacity={isSearching ? 1 : 0.7}
          style={[
            styles.collapsibleHeader,
            {
              backgroundColor: colors.surface_elevated,
              borderColor: open ? colors.accent : colors.border,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${title} section, ${open ? 'expanded' : 'collapsed'}`}
        >
          {icon ? (
            <Ionicons name={icon} size={20} color={open ? colors.accent : colors.text_secondary} style={{ marginRight: 10 }} />
          ) : null}
          <Text style={[styles.collapsibleHeaderText, { color: open ? colors.accent : colors.text_primary, flex: 1 }]}>
            {title}
          </Text>
          {!isSearching && (
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={open ? colors.accent : colors.text_muted}
            />
          )}
        </TouchableOpacity>
        {open ? <View style={cardStyle}>{children}</View> : null}
      </>
    );
  };

  const ToggleRow = ({
    label,
    sub,
    value,
    onValueChange,
    disabled,
  }: {
    label: string;
    sub?: string;
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <View style={[rowDivStyle, disabled && { opacity: 0.55 }]}>
      <View style={styles.rowText}>
        <Text style={labelStyle}>{label}</Text>
        {sub ? <Text style={subStyle}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#ffffff"
      />
    </View>
  );

  const PillRow = ({
    label,
    options,
    value,
    onSelect,
  }: {
    label: string;
    options: { label: string; value: string }[];
    value: string;
    onSelect: (v: string) => void;
  }) => (
    <View style={styles.pillSection}>
      <Text style={[styles.pillLabel, { color: colors.text_secondary }]}>{label}</Text>
      <View style={styles.pillRow}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.pill,
              { borderColor: colors.border, backgroundColor: colors.surface_elevated },
              value === opt.value && { backgroundColor: colors.accent_muted, borderColor: colors.accent },
            ]}
            onPress={() => onSelect(opt.value)}
          >
            <Text style={[
              styles.pillText,
              { color: colors.text_muted },
              value === opt.value && { color: colors.accent, fontWeight: '700' },
            ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // ─── RENDER ───────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 16, 40) }]}
        style={{ backgroundColor: colors.background }}
      >

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.backText, { color: colors.accent }]}>{t('settings.text.back')}</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>{t('settings.text.settings')}</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* 2026-05-18 — Search bar. Filters sections by title + body
            text. When a query is active, matching sections auto-expand
            and chevrons hide. */}
        <View style={[styles.searchWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.text_muted} style={{ marginRight: 8 }} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('settings.placeholder.search_settings')}
            placeholderTextColor={colors.text_muted}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: colors.text_primary }]}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={colors.text_muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* PROFILE — slim card when saved, full edit form when expanded
            (auto-expanded if no name on file). 2026-05-18. */}
        <SectionHeader title={t('settings.title.profile')} />
        {!profileExpanded && name?.trim() ? (
          <View style={[
            styles.profileSlim,
            { backgroundColor: colors.surface_elevated, borderColor: colors.border },
          ]}>
            <View style={[
              styles.profileSlimAvatar,
              { borderColor: colors.accent, backgroundColor: colors.accent_muted },
            ]}>
              <Text style={[styles.profileSlimLetter, { color: colors.accent }]}>
                {name.trim().charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileSlimText}>
              <Text style={[styles.profileSlimName, { color: colors.text_primary }]} numberOfLines={1}>
                {name.trim()}
              </Text>
              <Text style={[styles.profileSlimMeta, { color: colors.text_muted }]} numberOfLines={1}>{t('settings.text.handicap_goal', { handicap: handicapIndex != null ? handicapIndex.toFixed(1) : (handicap || '—'), goal: goal || '—' })}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setProfileExpanded(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('settings.accessibility_label.edit_profile')}
              style={[styles.profileSlimGear, { borderColor: colors.accent }]}
            >
              {/* 2026-05-28 — Fix FB: settings-outline icon to match
                  the dashboard's profileCard gear. Was pencil-outline;
                  swap unifies the two slim cards as visually-same
                  component. Size 18 matches the dashboard's gearBtn
                  icon (was 16). */}
              <Ionicons name="settings-outline" size={18} color={colors.accent} />
            </TouchableOpacity>
          </View>
        ) : (
        <View style={cardStyle}>
          {/* 2026-05-26 — Fix DG: minimize button at top of expanded
              profile form. The form takes 2 scrolls of screen real
              estate; previously the only way to collapse was scrolling
              all the way to the bottom Save/Cancel pair. Top chevron
              gives a one-tap collapse without scrolling. Only renders
              when a name is already on file (otherwise the user MUST
              fill out the form first — collapse would lose data). */}
          {name?.trim() ? (
            <TouchableOpacity
              onPress={() => setProfileExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel={t('settings.accessibility_label.minimize_profile')}
              hitSlop={10}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 1,
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface_elevated,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Ionicons name="chevron-up" size={16} color={colors.accent} />
            </TouchableOpacity>
          ) : null}

          <Text style={inputLblStyle}>{t('settings.text.name')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editName}
            onChangeText={setEditName}
            placeholder={t('settings.placeholder.your_name')}
            placeholderTextColor="#374151"
            autoCapitalize="words"
          />

          <Text style={inputLblStyle}>{t('settings.text.handicap')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editHandicap}
            onChangeText={setEditHandicap}
            keyboardType="numeric"
            placeholder="0–54"
            placeholderTextColor="#374151"
          />

          <Text style={inputLblStyle}>{t('settings.text.personal_best')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editBest}
            onChangeText={setEditBest}
            keyboardType="numeric"
            placeholder={t('settings.placeholder.best_round_score')}
            placeholderTextColor="#374151"
          />

          {/* 2026-06-04 — Personal-best inputs surfaced on the dashboard
              Highlights card. longestDrive auto-updates from logShot when
              a Driver shot beats the current high (see roundStore.logShot);
              longestPutt is manual until a putt-distance source lands. */}
          <Text style={inputLblStyle}>{t('settings.text.longest_drive_yards')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editLongestDrive}
            onChangeText={setEditLongestDrive}
            keyboardType="numeric"
            placeholder="e.g. 280"
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>
            {t('settings.text.updated_automatically_as_you_log')}
          </Text>

          <Text style={inputLblStyle}>{t('settings.text.longest_putt_yards')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editLongestPutt}
            onChangeText={setEditLongestPutt}
            keyboardType="numeric"
            placeholder="e.g. 45"
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>
            {t('settings.text.manual_entry_for_now')}
          </Text>

          <Text style={inputLblStyle}>{t('settings.text.handicap_index_usga')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editIndex}
            onChangeText={(v) => {
              setEditIndex(v);
              const n = parseFloat(v);
              if (Number.isFinite(n)) setHandicapIndex(n);
              else if (v === '') setHandicapIndex(null);
            }}
            keyboardType="decimal-pad"
            placeholder="e.g. 18.0"
            placeholderTextColor="#374151"
          />
          {/* 2026-05-26 — Fix BD: WHS-equivalent index recalculator.
              Rebuilds recent_differentials from the entire roundHistory
              (live rounds + imported screenshots from Batch 28) and
              writes the WHS best-8-of-20 average back to handicap_index.
              Useful for users who have populated their history but
              their index is stale OR was never set. Lives directly
              under the manual index field so the relationship is
              obvious. */}
          <TouchableOpacity
            style={[styles.recalcBtn, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}
            onPress={onRecalculateHandicap}
          >
            <Text style={[styles.recalcBtnText, { color: colors.accent }]}>
              {t('settings.text.recalculate_from_round_history')}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -4, marginBottom: 8 }]}>
            {/* 2026-09-03 — the old copy said "treats every course as 72.0 rating / 113 slope", which
                has been untrue since rebuildDifferentialsFromHistory started reading each round's
                own baseRating and baseSlope. It understated the app's own accuracy to the player, on
                the screen that explains how their handicap is worked out. */}
            {t('settings.text.uses_the_whs_best_8')}
          </Text>

          {/* 2026-05-26 — Fix AB Phase 1: GHIN # capture. We store the
              number now so once USGA business-API credentials land we
              can auto-pull official handicap + posted-scores history.
              Until then it's informational (brain prompt + tournament
              hints). */}
          <Text style={inputLblStyle}>{t('settings.text.ghin_number')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editGhin}
            onChangeText={(v) => {
              setEditGhin(v);
              setGhinNumber(v);
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="e.g. 1234567"
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>
            {t('settings.text.optional_we_ll_pull_your')}
          </Text>

          <Text style={inputLblStyle}>{t('settings.text.account_email')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editEmail}
            onChangeText={(v) => { setEditEmail(v); setAccountEmail(v.trim() || null); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('settings.placeholder.you_email_com')}
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>{isOwnerEmail(editEmail) ? t('settings.text.optional_owner_tools_unlocked') : t('settings.text.optional_owner_devices_enter_your')}</Text>

          <Text style={inputLblStyle}>{t('settings.text.goal')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editGoal}
            onChangeText={setEditGoal}
            placeholder={t('settings.placeholder.e_g_break_90')}
            placeholderTextColor="#374151"
          />

          <Text style={inputLblStyle}>{t('settings.text.physical_note')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editLimitation}
            onChangeText={setEditLimitation}
            placeholder={t('settings.placeholder.e_g_bad_left_knee')}
            placeholderTextColor="#374151"
          />

          <PillRow
            label="I'm a"
            options={[
              { label: 'Golfer', value: 'golfer' },
              { label: 'Instructor', value: 'instructor' },
              { label: 'Student', value: 'student' },
            ]}
            value={role}
            onSelect={(v) => setRole(v as 'golfer' | 'instructor' | 'student')}
          />

          {role === 'instructor' ? (
            <>
              <Text style={inputLblStyle}>{t('settings.text.credentials_shown_on_swing_reports')}</Text>
              <TextInput
                style={inputFldStyle}
                value={editCreds}
                onChangeText={setEditCreds}
                onBlur={() => setCoachCredentials(editCreds)}
                placeholder={t('settings.placeholder.e_g_lpga_class_a')}
                placeholderTextColor={colors.text_muted}
              />
            </>
          ) : null}

          <PillRow
            label={t('settings.label.handedness')}
            options={[
              { label: 'Right', value: 'right' },
              { label: 'Left', value: 'left' },
            ]}
            value={handedness}
            onSelect={(v) => setHandedness(v as 'right' | 'left')}
          />

          <PillRow
            label={t('settings.label.dominant_miss')}
            options={[
              { label: 'Left', value: 'left' },
              { label: 'Straight', value: 'straight' },
              { label: 'Right', value: 'right' },
            ]}
            value={dominantMiss ?? ''}
            onSelect={(v) => setDominantMiss(v as 'left' | 'right' | 'straight')}
          />

          <PillRow
            label={t('settings.label.preferred_tee')}
            options={[
              { label: 'Front', value: 'front' },
              { label: 'Middle', value: 'middle' },
              { label: 'Back', value: 'back' },
            ]}
            value={preferredTee}
            onSelect={(v) => setPreferredTee(v as 'front' | 'middle' | 'back')}
          />

          {/*
            2026-09-10 — the four fields below had LIVE READERS AND NO WRITER until today. Each one
            was permanently null, so every consumer silently took its fallback branch. Placed here,
            in the Profile section, because the comment lower down this file already told readers
            they lived here.
          */}

          {/* Miss Type is richer than Dominant Miss (direction only) and the setter DERIVES
              dominantMiss from it, so setting this keeps the two in step rather than splitting
              them. Read by ball-fit's ball recommendation. */}
          <PillRow
            label={t('settings.label.typical_miss')}
            options={[
              { label: 'Slice', value: 'slice' },
              { label: 'Hook', value: 'hook' },
              { label: 'Pull', value: 'pull' },
              { label: 'Push', value: 'push' },
              { label: 'Thin', value: 'thin' },
              { label: 'Fat', value: 'fat' },
              { label: 'Varies', value: 'varies' },
            ]}
            value={missType ?? ''}
            onSelect={(v) => setMissType(v as 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies')}
          />

          {/* Drives coachingAdaptation's tone + complexity, which until now ALWAYS fell to the
              default branch — the caddie could not adapt how it explained things to anyone. */}
          <PillRow
            label={t('settings.label.where_you_re_at')}
            options={[
              { label: 'Starting', value: 'starting' },
              { label: 'Improving', value: 'improving' },
              { label: 'Returning', value: 'returning' },
              { label: 'Competitive', value: 'competitive' },
            ]}
            value={experienceContext ?? ''}
            onSelect={(v) => setExperienceContext(v as 'starting' | 'improving' | 'returning' | 'competitive')}
          />

          {/**
            * 2026-09-11 (Tim) — THE FIFTH FIELD WITH READERS AND NO WRITER, and by some distance the
            * most expensive one. distanceControl was added to the store with a default and then
            * wired into cnsShotRead's club gapping, the override adjustment and the hole plan — so
            * three features were branching on a value nobody could set, and every player in the app
            * was silently treated as 'some_partials'.
            *
            * Tim describes himself as the opposite: "all I do right now is full swing and not good
            * with dialing down yardages, so I play according to my yardages and feel." He would have
            * got the wrong plan on every hole. This is exactly the class the 2026-09-10 note above
            * was written about, one field later. [[sweep-the-missing-half-not-the-unused-export]]
            */}
          <PillRow
            label={t('settings.label.how_you_cover_a_number')}
            options={[
              { label: 'Full swings', value: 'full_swings' },
              { label: 'Some partials', value: 'some_partials' },
              { label: 'I dial down', value: 'dial_down' },
            ]}
            value={distanceControl ?? ''}
            onSelect={(v) => setDistanceControl(v as 'full_swings' | 'some_partials' | 'dial_down')}
          />

          {/* The mode Kevin assumes when a round starts (contextSynthesizer). */}
          <PillRow
            label={t('settings.label.default_round_mode')}
            options={[
              { label: 'Break 100', value: 'break_100' },
              { label: 'Break 90', value: 'break_90' },
              { label: 'Break 80', value: 'break_80' },
              { label: 'Just play', value: 'free_play' },
            ]}
            value={default_mode ?? ''}
            onSelect={(v) => setDefaultMode(v as 'break_100' | 'break_90' | 'break_80' | 'free_play')}
          />

          {/* Read by play.tsx to default-select your course, by smartvision as a last-resort
              courseId, and by contextSynthesizer. Commits on blur, like Credentials above. */}
          <Text style={inputLblStyle}>{t('settings.text.home_course')}</Text>
          <TextInput
            style={inputFldStyle}
            value={editHomeCourse}
            onChangeText={setEditHomeCourse}
            onBlur={() => setHomeCourse(editHomeCourse.trim() || null)}
            placeholder={t('settings.placeholder.e_g_hemet_golf_club')}
            placeholderTextColor={colors.text_muted}
          />

          {/*
            2026-08-21 — WHICH rating set your course handicap comes from. Courses are rated twice
            and the two sets share yardages: Sharp Park's Blue tees are 6416y at 77.5/135 women's
            and 71.2/125 men's. Course handicap is (Index x Slope/113) + (Rating - Par), so reading
            the wrong set quietly hands out a wrong stroke allowance on a scorecard that looks
            perfectly right. Left unset we don't guess -- we hold to one internally consistent set.
          */}
          <PillRow
            label={t('settings.label.course_rating_set')}
            options={[
              { label: "Men's", value: 'm' },
              { label: "Women's", value: 'f' },
              { label: 'Not set', value: 'x' },
            ]}
            value={handicapGender}
            onSelect={(v) => setHandicapGender(v as 'm' | 'f' | 'x')}
          />

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleSaveProfile}>
              <Text style={styles.saveBtnText}>{t('settings.text.save_profile')}</Text>
            </TouchableOpacity>
            {name?.trim() ? (
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 0, paddingHorizontal: 14, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}
                onPress={() => setProfileExpanded(false)}
              >
                <Text style={[styles.saveBtnText, { color: colors.text_muted }]}>{t('play.cancel')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

        </View>
        )}

        {/* CADDIE TEAM — Phase 105 per-pillar assignments */}
        <CollapsibleSection title={t('settings.title.caddie')} icon="bag-outline">
          <Text style={[styles.sectionIntro, { color: colors.text_muted }]}>
            {t('settings.text.four_caddies_one_team_each')}
          </Text>

          {/* 2026-07-08 (Tim — "it has to be talking to Kevin, not typing on a keyboard")
              — the relationship layer is now a REAL voice conversation, not a form. This
              primes the caddie to interview the golfer warmly and opens the Caddie tab;
              everything you say is ingested into the CNS narrative (narrativeIngest). */}
          <TouchableOpacity
            style={rowDivStyle}
            onPress={() => {
              setScreenContext({ screen: 'getting to know the golfer', focus: GET_TO_KNOW_FOCUS });
              router.push('/(tabs)/caddie' as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.talk_to_your_caddie_so')}
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.settings.let_get_to_know_you', { caddieName })}</Text>
              <Text style={subStyle}>{t('settings.settings.a_short_chat_how_you', { caddieName })}</Text>
            </View>
            <Ionicons name="chatbubbles-outline" size={20} color={colors.accent} />
          </TouchableOpacity>

          <PillRow
            label={t('settings.label.round_on_course_default_kevin')}
            options={[
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
            ]}
            value={caddieAssignments.round}
            onSelect={(v) => setCaddieForPillar('round', v as 'kevin' | 'serena' | 'harry')}
          />

          <PillRow
            label={t('settings.label.practice_default_serena')}
            options={[
              { label: 'Serena', value: 'serena' },
              { label: 'Kevin', value: 'kevin' },
            ]}
            value={caddieAssignments.practice}
            onSelect={(v) => setCaddieForPillar('practice', v as 'kevin' | 'serena' | 'harry')}
          />

          <PillRow
            label={t('settings.label.drills_swinglab_default_serena')}
            options={[
              { label: 'Serena', value: 'serena' },
              { label: 'Kevin', value: 'kevin' },
            ]}
            value={caddieAssignments.drills}
            onSelect={(v) => setCaddieForPillar('drills', v as 'kevin' | 'serena' | 'harry')}
          />

          <PillRow
            label={t('settings.label.play_arena_default_kevin')}
            options={[
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
            ]}
            value={caddieAssignments.play}
            onSelect={(v) => setCaddieForPillar('play', v as 'kevin' | 'serena' | 'harry')}
          />

          <TouchableOpacity onPress={resetCaddieAssignments} style={styles.linkBtn}>
            <Text style={[styles.linkBtnText, { color: colors.accent }]}>{t('settings.text.reset_to_defaults')}</Text>
          </TouchableOpacity>

          {/* Phase 106 — caddie team handoff suggestions */}
          <PillRow
            label={t('settings.label.team_suggestions_default_on')}
            options={[
              { label: 'On', value: 'on' },
              { label: 'Card only', value: 'soft' },
              { label: 'Off', value: 'off' },
            ]}
            value={caddieSuggestions}
            onSelect={(v) => setCaddieSuggestions(v as 'on' | 'soft' | 'off')}
          />
          <Text style={[styles.sectionIntro, { color: colors.text_muted, marginTop: 4 }]}>
            {t('settings.text.when_a_teammate_is_better')}
          </Text>

          {/* Phase 107 — GPS quality debug overlay (dev / Tim only by default) */}
          <PillRow
            label={t('settings.label.gps_quality_overlay_dev_default')}
            options={[
              { label: 'Off', value: 'off' },
              { label: 'On', value: 'on' },
            ]}
            value={gpsQualityDebugOverlay ? 'on' : 'off'}
            onSelect={(v) => setGpsQualityDebugOverlay(v === 'on')}
          />
          <Text style={[styles.sectionIntro, { color: colors.text_muted, marginTop: 4 }]}>
            {t('settings.text.top_left_badge_during_a')}
          </Text>

          {/* 2026-06-10 — caddie persona controls merged in from the old
              "{caddieName}'s Voice" card so every caddie setting lives here. */}
          <Text style={[styles.sectionIntro, { color: colors.text_muted, marginTop: 8 }]}>
            {t('settings.text.manually_override_the_active_caddie')}
          </Text>
          {/* 2026-07-04 (elite-clean audit) — this pill duplicated the Tools-menu
              persona cycler but DIVERGED: it omitted 'custom' and never synced
              setUseCustomCaddie, so switching personas here while the custom caddie
              was active left useCustomCaddie=true → stale avatar/voice overrides.
              Now mirrors the cycler: same ACTIVE_PERSONAS set + the same sync. */}
          <PillRow
            label={t('settings.label.active_caddie')}
            options={[
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
              {
                // 2026-09-01 — one owner for "what do we call this caddie" (caddieResolver).
                label: displayCaddieName('custom'),
                value: 'custom',
              },
            ]}
            value={caddiePersonality}
            onSelect={(v) => {
              setCaddiePersonality(v as 'kevin' | 'serena' | 'custom');
              try {
                usePlayerProfileStore.getState().setUseCustomCaddie(v === 'custom');
              } catch (e) { console.log('[settings] custom-caddie sync failed (non-fatal):', e); }
            }}
          />

          {/**
            * 2026-09-11 (Tim) — ONE CARD, AND IT EXPLAINS ITSELF.
            *
            * "That whole way we originally designed levels — users don't quite understand it,
            * especially looking through the settings, it's not intuitive. That whole premise needs
            * to be simplified into one simple card, or even just dynamically learning user
            * preferences... the caddie can take a hint and adjust accordingly. We wanna be smart,
            * not toggle heavy."
            *
            * So what he has LEARNED leads, in the player's own words — "you asked me to keep it
            * short" — rather than a category they have to decode. The pills stay underneath as a
            * starting point for anyone who wants to set it directly, but they are no longer the
            * main event, and nobody has to find them to be understood.
            */}
          <View style={[styles.styleCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
            <Text style={[styles.styleCardLabel, { color: colors.text_muted }]}>
              {t('settings.text.how_your_caddie_talks')}
            </Text>
            <Text style={[styles.styleCardBody, { color: colors.text_primary }]}>
              {learnedStyleLine ?? t('settings.text.style_not_learned_yet')}
            </Text>
            {learnedStyleLine ? (
              <View style={styles.styleCardFoot}>
                <Text style={[styles.styleCardHint, { color: colors.text_muted }]}>
                  {t('settings.text.style_tell_him_anytime')}
                </Text>
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      const cs = await import('../services/caddieStyle');
                      await cs.saveLearnedStyle(null);
                      setLearnedStyleLine(null);
                    } catch { /* nothing to reset is not an error */ }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.accessibility_label.reset_what_the_caddie_learned')}
                >
                  <Text style={[styles.styleCardReset, { color: colors.accent }]}>{t('settings.text.style_reset')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <PillRow
            label={t('settings.label.response_style')}
            options={[
              { label: 'Brief', value: 'short' },
              { label: 'Normal', value: 'neutral' },
              { label: 'Detailed', value: 'detailed' },
            ]}
            value={responseMode}
            onSelect={(v) => setResponseMode(v as 'short' | 'neutral' | 'detailed')}
          />

          {/* 2026-05-19 — removed duplicate "What ${caddieName} is
              learning" link. The same /kevin-learning surface is
              already exposed via Settings → Owner Tools and is now
              the sole entry point. Surfacing it twice in one screen
              compounds the settings-within-settings fatigue. */}

          <ToggleRow
            label={t('settings.label.greet_me_on_launch')}
            sub={`${caddieName} says hello when you open the app`}
            value={kevinGreetingEnabled}
            onValueChange={confirmToggle('Launch Greeting', setKevinGreetingEnabled)}
          />

        </CollapsibleSection>

        {/* ROUND EXPERIENCE */}
        <CollapsibleSection title={t('settings.title.round_experience')} icon="flag-outline">
          {/* 2026-05-19 — trust slider moved INLINE here. Was a routed
              sub-screen at /settings/trust-level that created the
              settings-within-settings pattern Tim called out. The full
              slider + descriptions now render directly in this card. */}
          <View style={[styles.trustBlock, { borderBottomColor: colors.border }]}>
            <Text style={labelStyle}>{t('settings.settings.s_presence', { caddieName })}</Text>
            <Text style={[subStyle, { marginBottom: 10 }]}>{t('settings.settings.how_present_should_be_during', { caddieName })}</Text>
            <View style={[styles.trustSlider, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {TRUST_LEVEL_SLIDER_ORDER.map((lvl) => {
                const meta = TRUST_LEVEL_META[lvl];
                const active = trustLevel === lvl;
                return (
                  <TouchableOpacity
                    key={lvl}
                    onPress={() => {
                      setTrustLevel(lvl);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                      useToastStore.getState().show(`${caddieName}'s presence: ${meta.label}`);
                    }}
                    style={[
                      styles.trustCell,
                      active && { backgroundColor: colors.accent_muted },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.trustCellLabel,
                        { color: active ? colors.accent : colors.text_muted },
                      ]}
                    >
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.trustOneLiner, { color: colors.text_primary }]}>
              {TRUST_LEVEL_META[trustLevel].one_liner}
            </Text>
          </View>

          <ToggleRow
            label={t('settings.label.skip_pre_round_briefing')}
            sub={`Go straight to the round without ${caddieName}'s intro`}
            value={skip_briefings}
            onValueChange={confirmToggle('Skip Pre-Round Briefing', setSkipBriefings)}
          />
          <ToggleRow
            label={`Proactive ${caddieName}`}
            sub={localMode
              ? `Paused while Local Mode is on (${caddieName} only speaks when asked). Turn off Local Mode to re-enable.`
              : `${caddieName} speaks up between holes — streaks, patterns, ghost updates`}
            value={proactive_kevin_enabled}
            disabled={localMode}
            onValueChange={confirmToggle(`Proactive ${caddieName}`, setProactiveKevinEnabled)}
          />
          <ToggleRow
            label={t('settings.label.riding_in_a_cart')}
            sub="Tunes shot detection for cart play. Walking is the default."
            value={cartMode}
            onValueChange={confirmToggle('Cart Mode', setCartMode)}
          />
          <ToggleRow
            label={t('settings.label.auto_hole_advance')}
            sub="GPS moves you to the next hole automatically. Off = step through yourself."
            value={autoHoleAdvance}
            onValueChange={confirmToggle('Auto Hole Advance', setAutoHoleAdvance)}
          />
          <ToggleRow
            label={t('settings.label.interactive_round')}
            sub="Caddie speaks a read when you stop walking mid-hole. Off (default) = it stays quiet and waits for you to ask; it still auto-briefs at the tee."
            value={interactiveRound}
            onValueChange={confirmToggle('Interactive Round', setInteractiveRound)}
          />
          {/* 2026-08-14 (Tim, after a round where nothing populated) — the toggle was here and fairly
              described, but it never said what you LOSE by leaving it off. Off means no shots are
              recorded unless you log them yourself, so View hole and the recap come up empty and it
              reads like a broken screen rather than a setting. Kept OFF by default — it genuinely can
              over-count on a cart round, and silently flipping a data-quality default the day someone
              plays is worse than telling them plainly. */}
          <ToggleRow
            label={t('settings.label.auto_shot_detection')}
            sub="GPS auto-logs where each shot was hit. OFF by default — it can over-count on cart rounds. Riding in a cart, shots are logged quietly with no club and the caddie never interrupts; walking, it asks what you hit. While it's off, nothing is recorded unless you log shots by voice, so View hole and the round recap will have no shots to show."
            value={autoShotDetection}
            onValueChange={confirmToggle('Auto Shot Detection', setAutoShotDetection)}
          />
        </CollapsibleSection>

        {/* VOICE */}
        {/* 2026-06-04 — "Voice Enabled" toggle removed. Voice presence is
            controlled via the Trust spectrum (L1 Quiet = Cockpit + tap-to-talk,
            L2 Companion = reactive, L3 Active = volunteers). voiceEnabled
            field stays in the store as an internal kill switch. */}
        <CollapsibleSection title={t('settings.title.voice_conversation')} icon="mic-outline">
          {/* 2026-05-30 — Fix FY: Local Mode toggle. Conservation +
              stability mode — proactive speech off, brain calls pinned
              to Haiku (the cheapest/fastest tier), navigation intents
              resolved locally. GPS, yardage, scorecard untouched.
              Honest framing in the sub-line — not a warning. */}
          <ToggleRow
            label={t('settings.label.local_mode')}
            sub={`Battery saver for weak signal. ${caddieName} only speaks when asked; GPS + yardages unchanged.`}
            value={localMode}
            onValueChange={confirmToggle('Local Mode', setLocalMode)}
          />
          <ToggleRow
            label={t('settings.label.active_listening')}
            sub={localMode
              ? `Paused in Local Mode (tap-to-talk only).`
              : `${caddieName} listens automatically during rounds — just talk. Tap the pill to mute.`}
            value={autoListenEnabled}
            disabled={localMode}
            onValueChange={confirmToggle('Active Listening', setAutoListenEnabled)}
          />
          {/* 2026-05-26 — Fix BE: Cecily Mode toggle. When on, the
              caddie answers ANY topic in age-appropriate kid-friendly
              language (Cecily is Tim's granddaughter, bilingual EN/ES).
              Opt-in only; adults using the app are unaffected when off.
              Explicit toggle (not name-detection) so the other family
              members (Bea, Lily, Daniella) don't trip it. */}
          <ToggleRow
            label={t('settings.label.cecily_mode')}
            sub={`Kid-friendly chat for Cecily — any topic, warm and simple.`}
            value={cecilyMode}
            onValueChange={confirmToggle('Cecily Mode', setCecilyMode)}
          />
          {/* 2026-05-26 — Fix AP Phase 2: continuous-conversation
              opt-in toggle. Default off. Safety rails inside the
              loop: 6-turn cap + 120s wall-clock cap + close-intent
              gate + silence-twice cap. Useful for sustained chats
              ("teach me about lag") without re-tapping the mic. */}
          <ToggleRow
            label={t('settings.label.continuous_conversation')}
            sub={`Keeps the mic open between turns so you can talk back without re-tapping. Say "I'm good" to end.`}
            value={continuousConversationMode}
            onValueChange={confirmToggle('Continuous Conversation', setContinuousConversationMode)}
          />
          {/* 2026-05-19 — the "Earbud Tap-to-Talk · Coming soon" row
              moved to the Connected Hardware section below where all
              not-yet-wired hardware integrations are listed together
              with honest copy. Voice section now only carries actually-
              live voice settings. */}
          {/* 2026-08-29 — "Voice on Phone Speaker" RETIRED (Tim). It asked the player to answer a
              question the app can now answer itself, and it had not changed an outcome since
              migration v7 force-set it TRUE for everyone in 2026-05. The app detects the audio route
              for real now; it drives captions, not silence. */}
          {/* 2026-06-10 — Caption moved here from Display (it's about caddie
              speech, and was the only "voice" thing living under Display). */}
          <ToggleRow
            label={t('settings.label.caption_caddie_speech')}
            sub="Show what the caddie is saying on screen during voice playback. Auto-on for Bluetooth audio."
            value={ttsCaptions}
            onValueChange={setTtsCaptions}
          />
        </CollapsibleSection>

        {/* PRACTICE — Phase BL */}
        {/* 2026-06-10 — "Practice" card removed: it only held Auto Club
            Detection, which now lives in Smart Motion (the scan-club tool +
            voice "switching to 6-iron" + the manual picker). The setting still
            persists; it just no longer needs its own settings card. */}

        {/* 2026-05-19 — single-row "Caddie ${caddieName}" section folded
            into the Caddie's Voice card above. The "Greet me on launch"
            toggle now lives there alongside the other persona controls.
            Reduces section count + colocates related settings. */}

        {/* DISPLAY & ACCESSIBILITY (combined 2026-05-19 — the two cards
            below used to live under separate "Display" and
            "Accessibility & Pacing" headers; merged into one header
            since both control how you SEE or HEAR the app. */}
        <CollapsibleSection title={t('settings.title.language_display')} icon="desktop-outline">

          {/* 2026-06-10 — Language moved here from the caddie-voice card: it's
              app-wide (and people look for it under display/language, not voice). */}
          <PillRow
            label={t('settings.label.language')}
            options={[
              { label: 'English', value: 'en' },
              { label: 'Español', value: 'es' },
              { label: '中文', value: 'zh' },
            ]}
            value={language}
            onSelect={(v) => setLanguage(v as 'en' | 'es' | 'zh')}
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -4, marginBottom: 8 }]}>
            {t('settings.text.changes_your_caddie_s_voice')}
          </Text>

          <PillRow
            label={t('settings.label.theme')}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
            value={theme_preference}
            onSelect={(v) => setThemePreference(v as 'system' | 'light' | 'dark')}
          />

          <ToggleRow
            label={t('settings.label.high_contrast')}
            sub="Pure black/white backgrounds + stronger borders for sunlight readability"
            value={highContrast}
            onValueChange={setHighContrast}
          />
          {/* 2026-05-27 — Fix EA: Screenshot mode. Hides the top
              status bar (time / battery / wifi) app-wide so promo,
              App Store, and social screenshots are clean. Not
              persisted — turns OFF on app restart so users don't
              get stuck wondering where the status bar went. Android
              bottom nav bar still shows until next APK build (needs
              expo-navigation-bar native dep, not OTA-able). */}
          <ToggleRow
            label={t('settings.label.screenshot_mode_hide_top_bar')}
            sub={
              Platform.OS === 'android'
                ? 'Hides the top status bar for clean screenshots. The bottom nav bar still shows in this build — crop or wait for the next app update.'
                : 'Hides the top status bar (time, battery, wifi) for clean screenshots. Turns off automatically when you close the app.'
            }
            value={useScreenshotModeStore(s => s.enabled)}
            onValueChange={useScreenshotModeStore(s => s.setEnabled)}
          />
          {/* PGA HOPE follow-up (A1) — large-text upgrade for low-vision
              participants. Bumps caption + briefing font sizes. */}
          <ToggleRow
            label={t('settings.label.large_text')}
            sub="Bigger captions and briefing text — helpful in bright sun or for low-vision users"
            value={largeText}
            onValueChange={setLargeText}
          />

          <ToggleRow
            label={t('settings.label.simple_briefing')}
            sub={
              simpleBriefingUserTouched
                ? 'One card at a time, slower pacing. Larger text on the briefing screen.'
                : 'Auto-on for your first 5 rounds. One card at a time, slower pacing.'
            }
            value={simpleBriefing}
            onValueChange={setSimpleBriefing}
          />

          {/* PER-PERSONA INTENSITY DIAL — one slider per caddie on the roster. */}
          {selectablePersonas().map((p, idx, arr) => {
            // 2026-06-06 — Display the user's chosen custom caddie name
            // here instead of the static "My Caddie" fallback. Also
            // belt-and-suspenders `?? 100` for personaIntensity reads
            // in case a hydrated payload missed the v11 seed.
            const displayName = displayCaddieName(p);
            const intensityVal = personaIntensity[p] ?? 100;
            return (
            <View
              key={p}
              style={[
                styles.row,
                idx < arr.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>{displayName}</Text>
                <Text style={subStyle}>
                  {`Volume + cadence (${intensityVal}/100). Lower = quieter, fewer signature phrases.`}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setPersonaIntensity(p, Math.max(0, intensityVal - 10))}
                  style={[styles.intensityStep, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Lower ${displayName} intensity`}
                >
                  <Text style={[styles.intensityStepText, { color: colors.text_primary }]}>−</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPersonaIntensity(p, Math.min(100, intensityVal + 10))}
                  style={[styles.intensityStep, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Raise ${displayName} intensity`}
                >
                  <Text style={[styles.intensityStepText, { color: colors.text_primary }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            );
          })}

          <PillRow
            label={t('settings.label.distance_unit')}
            options={[
              { label: 'Yards', value: 'yards' },
              { label: 'Meters', value: 'meters' },
            ]}
            value={distance_unit}
            onSelect={(v) => setDistanceUnit(v as 'yards' | 'meters')}
          />
        </CollapsibleSection>

        {/* CONNECTED HARDWARE — every row honestly labels what's actually
            wired vs scaffolded. Tim was getting bitten by toggling
            "Watch Connected" thinking it pulled real Samsung Health data
            when it was sim-only. Now: label is explicit, toggle is
            disabled, and the description names exactly what's missing. */}
        <CollapsibleSection title={t('settings.title.devices_health')} icon="watch-outline">
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{watchBridgeAvailable ? t('settings.text.swing_capture', { watch_device_label: watchDeviceLabel() }) : t('settings.text.swing_capture_needs_latest_build', { watch_device_label: watchDeviceLabel() })}</Text>
              <Text style={subStyle}>
                {/* 2026-08-14 (Tim — "I could not find a spot to turn on catching swing metrics during a
                    live round with my watch"). This copy only ever mentioned Smart Motion, so there was
                    nothing here that looked like the round setting he was hunting for — and no round
                    setting existed to find, because this one already covers it. It captures during
                    rounds too, tagged to the hole you were on; say so. */}
                {/* 2026-09-09 (Tim — "the yardage would not populate on my watch", first Play Store
                    round). This toggle used to gate the caddie bridge too, so pin yardage and the
                    watch mic silently rode on a switch labelled "swing capture" and defaulting off.
                    They are independent now — say so, so nobody goes hunting here for yardage. */}
                {watchBridgeAvailable
                  ? `Captures every swing the watch sees — during a live round (tagged to the hole, shown in View hole and the round recap) and in Smart Motion, where a calibrated capture also reads club speed. Pin yardage and the watch mic do not need this — they work whenever your watch is paired and the SmartPlay watch app is open.${watchConnected ? ' Watch connected.' : ` Open the SmartPlay watch app on your ${watchDeviceLabel()} to start sending.`}`
                  : 'The watch swing-capture module ships in the latest native build — install it, then this turns on.'}
              </Text>
            </View>
            <Switch
              value={watchSwingEnabled}
              onValueChange={(v) => {
                setWatchSwingEnabled(v);
                /**
                 * 2026-09-09 (Tim: "make sure swing capture and yardage do not clash").
                 *
                 * Turning this OFF used to call stopWatchCaddieBridge() — so switching off SWING
                 * CAPTURE also killed pin yardage, the watch mic and the round push for the rest of
                 * the session. That is the same coupling that was just removed from _layout.tsx,
                 * living in a second file: decoupling the startup path alone would have left the
                 * toggle able to re-break it with one tap.
                 *
                 * This switch now owns exactly what it is labelled: swing capture. The caddie bridge
                 * is started on boot whenever the module exists and is left alone here. It is still
                 * ENSURED on the way on, because a user reaching for watch features is a good moment
                 * to make sure the bridge is up, and init is idempotent.
                 */
                if (v) {
                  void initWatchSwingBridge().catch(() => {});
                  void import('../services/watchCaddieBridge').then(m => m.initWatchCaddieBridge()).catch(() => {});
                } else {
                  void stopWatchSwingBridge().catch(() => {});
                }
              }}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
              disabled={!watchBridgeAvailable}
            />
          </View>
          {/* 2026-07-29 (Tim — "trail vs lead arm; my faults are on my trail arm"). Default LEAD (the
              steering wrist → cleaner club-speed); toggle to TRAIL (the release wrist → the better read
              on casting / early release). Set it once — it just tags every swing. */}
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.watch_on_trail_arm')}</Text>
              <Text style={subStyle}>{watchWrist === 'trail' ? t('settings.text.trail_wrist_your_release_side') : t('settings.text.lead_wrist_default_the_steering')}</Text>
            </View>
            <Switch
              value={watchWrist === 'trail'}
              onValueChange={(v) => setWatchWrist(v ? 'trail' : 'lead')}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
            />
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.health_connect_heartbeat')}</Text>
              <Text style={subStyle}>
                {watchHealthSnapshot?.hasData
                  ? `Latest sample: ${watchHealthSnapshot.heartRateAvg != null ? `${watchHealthSnapshot.heartRateAvg} bpm` : 'heart rate unavailable'} · ${watchHealthSnapshot.steps} steps · ${Math.round(watchHealthSnapshot.distanceMeters)} m`
                  : healthDataEnabled
                    ? 'Waiting for a live sample during a round.'
                    : 'Turn on Health Data to read steps and heart rate during rounds.'}
                {watchHealthSyncAt != null
                  ? ` Last sync ${Math.max(1, Math.round((Date.now() - watchHealthSyncAt) / 60_000))} min ago.`
                  : ''}
              </Text>
            </View>
          </View>
          {/* 2026-07-06 — Earbud button tap-to-talk, LIVE. The native media-button
              listener (BluetoothMediaButtonModule via the withBluetoothMediaButton
              plugin, app.json) is compiled into the build and initialized app-wide at
              boot (_layout.tsx initVoiceTriggers), so a tap opens the caddie mic from
              launch, anywhere — no round needed. On by default (hands-free is the
              point); toggle off if it fights your music's play/pause. */}
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.earbud_button_talk_to_caddie')}</Text>
              <Text style={subStyle}>
                {t('settings.text.tap_your_earbud_or_bt')}
              </Text>
            </View>
            <Switch
              value={earbudTapToTalk}
              onValueChange={(v) => {
                setEarbudTapToTalk(v);
                setEarbudEnabled(v);
                void syncBluetoothMediaButtonState(v);
              }}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
            />
          </View>
          {/*
            2026-08-25 (Tim) — "Meta glasses don't have to go in 1.0, but the watch functionality
            does." All three glasses rows hide together: the temple-tap notice, the live POV stream
            and the voice-log import. Corrected 2026-09-01: the reason is the BUILD, not the SDK —
            Meta's DAT is integrated already, and the temple tap does not use it (it arrives as a
            Bluetooth media key, works today, and is not shelved). The DAT paths need the `glasses`
            EAS profile, which build 21 is not, so a player who toggles POV streaming on a standard
            build sees a failure that reads as our bug. The code stays; those three controls go.
            One owner: services/releaseSurface.
          */}
          {!isFeatureShelved('meta_glasses') ? (
            <>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.ray_ban_meta_temple_tap')}</Text>
              <Text style={subStyle}>
                {t('settings.text.2026_09_01_tim_temple')}
              </Text>
            </View>
          </View>
          {/* 2026-07-11 — Ray-Ban Meta glasses LIVE stream (DAT v0.8). Pair the glasses in the Meta AI
              app, then toggle on to stream your POV into the caddie brain (SmartVision / green reads /
              multimodal).
              2026-08-19 — dropped the `Platform.OS === 'android' &&` half of this gate. It dated from
              when the DAT SDK was wired on Android only; the iOS module has since been finished and the
              JS bridge un-gated the same day, so this line was the last thing keeping the control
              hidden on the platform a glasses build actually targets — the bridge would have worked and
              nothing would have offered the toggle.
              isMetaWearablesAvailable() is the correct and sufficient test on its own: it is true only
              when the native module is really present in this binary, which a normal TestFlight/APK
              build (DAT plugin no-op'd) never is. So this stays hidden exactly where it always was. */}
          {isMetaWearablesAvailable() ? (
            <ToggleRow
              label={t('settings.label.connect_ray_ban_glasses')}
              sub={
                glasses.streaming
                  ? `Streaming from ${glasses.device || 'your glasses'} — ${caddieName} sees your point of view.`
                  : 'Pair your Ray-Ban Meta glasses in the Meta AI app, then turn this on to stream your point of view to the caddie for swing and green reads.'
              }
              value={glasses.streaming}
              onValueChange={onToggleGlasses}
            />
          ) : null}
          {/* 2026-06-16 — v1 entry point for the Meta glasses voice-log
              ingest (services/metaGlassesIngest.ts). Picks an exported
              Meta View JSON, attributes each in-window exchange to a hole
              via GPS, and feeds it to the caddie brain as externalContext.
              ACTIVE ROUND only — the service returns ingested:0 when no
              round is live, which we surface as "Start a round first". */}
          <TouchableOpacity
            style={rowDivStyle}
            onPress={onImportMetaGlassesLog}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.import_meta_glasses_voice_log')}
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.import_meta_glasses_voice_log')}</Text>
              <Text style={subStyle}>{t('settings.settings.pick_a_meta_view_json', { caddieName })}</Text>
            </View>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />
          </TouchableOpacity>
            </>
          ) : null}
          {/* 2026-07-07 (Tim — SmartPump third rail) — import a date-stamped golf-workout
              export from SmartPump. PDF/image is AI-parsed server-side; a JSON/CSV export
              is parsed on-device. Dated workouts feed the dashboard's TRAINING →
              PERFORMANCE correlation card (training volume vs. scoring). */}
          <TouchableOpacity
            style={rowDivStyle}
            onPress={onImportSmartPump}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.import_smartpump_golf_workouts')}
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.import_smartpump_golf_workouts')}</Text>
              <Text style={subStyle}>
                {t('settings.text.pick_your_smartpump_workout_export')}
              </Text>
            </View>
            <Ionicons name="barbell-outline" size={20} color={colors.accent} />
          </TouchableOpacity>
          {/* 2026-06-10 — Health Data merged into "Devices & Health" (both are
              external integrations). Master toggle for the Health Connect
              integration + an explicit re-ask button if permissions were
              declined earlier. (Data & Privacy relocated just below.) */}
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.use_health_connect_during_rounds')}</Text>
              <Text style={subStyle}>
                {t('settings.text.reads_step_count_heart_rate')}
              </Text>
            </View>
            <Switch
              value={healthDataEnabled}
              onValueChange={confirmToggle('Health Connect', setHealthDataEnabled)}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
            />
          </View>
          {/* 2026-05-21 — Fix N-3 — explicit tap-to-grant. The original
              "re-ask on next round" row relied on the JIT IIFE in
              roundStore.startRound, which was the prime suspect for the
              Z Fold native crash. JIT removed; permission ask now fires
              ONLY from this button, off the round-start path entirely.
              If the HC native module throws a JNI fatal when probed here,
              it takes down Settings instead of the round — failure mode
              is the user simply can't tap-and-grant on a stubbed-HC
              device, which is the correct degradation. */}
          <TouchableOpacity
            style={rowDivStyle}
            onPress={() => {
              void (async () => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                try {
                  const health = await import('../services/healthData');
                  const available = await health.isHealthAvailable();
                  if (!available) {
                    setHasAskedHealthPermission(true);
                    useToastStore.getState().show('Health Connect not available on this device.');
                    return;
                  }
                  const result = await health.requestHealthPermissions([
                    // 2026-08-12 — 'exercise' dropped: it was requested and never read. Asking for data we
                    // don't touch is exactly what draws a store-review question.
                    'steps', 'distance', 'heartRate', 'activeCalories',
                  ]);
                  setHasAskedHealthPermission(true);
                  if (result.granted.length > 0) {
                    useToastStore.getState().show(`Health Connect linked (${result.granted.length} categories).`);
                  } else {
                    useToastStore.getState().show('Health Connect access not granted.');
                  }
                } catch (e) {
                  console.log('[settings] Health Connect ask failed:', e);
                  useToastStore.getState().show('Could not reach Health Connect on this device.');
                }
              })();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.connect_health_data')}
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.connect_health_data')}</Text>
              <Text style={subStyle}>
                {t('settings.text.tap_to_grant_smartplay_read')}
              </Text>
            </View>
          </TouchableOpacity>
        </CollapsibleSection>

        {/* DEVELOPER TOOLS — dev builds only */}
        {__DEV__ && <DeveloperToolsSection cardStyle={cardStyle} colors={colors} />}

        {/* 2026-05-19 — duplicate "Profile" section header removed.
            The first Profile section near the top of this screen
            already has all the editable fields inline (name, handicap,
            personal best, dominant miss, experience, home course, etc).
            2026-09-10 — that sentence was FALSE for four of them until today.
            experience, home course, typical miss and default round mode had
            live readers and no editor anywhere, and this claim is probably why
            nobody went looking. They exist now; keep this list honest.
            The redundant "Edit Profile →" route to /welcome was leftover
            from a prior flow and contributed to Tim's settings-within-
            settings fatigue. The /welcome single-screen onboarding is
            still reachable via Reset App Data → relaunch for users who
            need the guided re-do. */}

        {/* 2026-06-08 (audit #2, privacy) — plain-language disclosure of what
            leaves the device and where. Relocated below Devices & Health in the
            2026-06-10 settings cleanup. */}
        {/* 2026-07-01 — Backup & Restore. Local file export/import (zero config,
            always works) + optional cloud auto-sync. So a phone swap never wipes
            the player's data. Sits just above Data & Privacy. */}
        {sectionMatchesQuery('Backup & Restore', 'backup restore sync cloud account email file export import') ? <CloudBackupCard /> : null}

        <CollapsibleSection title={t('settings.title.data_privacy')} icon="shield-outline">
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.what_we_send_for_ai')}</Text>
              <Text style={subStyle}>
                {t('settings.text.when_you_talk_to_your')}
              </Text>
            </View>
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>{t('settings.text.stored_on_this_phone')}</Text>
              <Text style={subStyle}>
                {t('settings.text.your_rounds_scores_swing_clips')}
              </Text>
            </View>
          </View>
          {/* 2026-06-24 — Off-device data layer Phase A: anonymous usage
              telemetry. OPT-IN, default OFF. Honest copy: anonymous, no
              fingerprint, isolated from any other data, off unless you turn
              it on. Helps Tim see which features get used. */}
          <ToggleRow
            label={t('settings.label.help_improve_smartplay')}
            sub="Share anonymous usage — which features you use, never your name, scores, or location. Off by default."
            value={analyticsOptIn}
            onValueChange={confirmToggle('Anonymous usage sharing', setAnalyticsOptIn)}
          />
          {/* 2026-07-26 (deep audit S3) — SPLIT the old single toggle into two: course maps (coords only)
              vs. issue reports (which include your email + diagnostics). Previously bundled, so PII rode
              the "course maps" consent silently. Now each is its own honest, separately-controllable toggle. */}
          <ToggleRow
            label={t('settings.label.share_course_maps')}
            sub="Contribute the hole layouts your phone maps so other golfers get them instantly. Coordinates only — never your scores or personal data. On for beta; turn off anytime."
            value={shareCommunityData}
            onValueChange={confirmToggle('Course map sharing', setShareCommunityData)}
          />
          <ToggleRow
            label={t('settings.label.auto_send_my_issue_reports')}
            sub="When you log a bug, send it to the team automatically so it gets fixed faster. Includes your email (so we can follow up) and app diagnostics — never your scores. On for beta; turn off anytime."
            value={shareDiagnostics}
            onValueChange={confirmToggle('Issue report sharing', setShareDiagnostics)}
          />
          {/* 2026-09-03 — invite a friend (app/invite.tsx). Sits here rather than in Help because it
              is a thing the player DOES, not a thing they read. */}
          <TouchableOpacity style={[rowDivStyle, { alignItems: 'center' }]} onPress={() => router.push('/invite' as never)} accessibilityRole="button" accessibilityLabel={t('settings.accessibility_label.invite_a_friend')}>
            <View style={styles.rowText}><Text style={labelStyle}>{t('settings.text.invite_a_friend')}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
          {/* 2026-07-18 — real in-app legal documents (app/legal.tsx). */}
          <TouchableOpacity style={[rowDivStyle, { alignItems: 'center' }]} onPress={() => router.push('/legal?doc=privacy' as never)} accessibilityRole="button">
            <View style={styles.rowText}><Text style={labelStyle}>{t('settings.text.privacy_policy')}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[rowDivStyle, { alignItems: 'center' }]} onPress={() => router.push('/legal?doc=terms' as never)} accessibilityRole="button">
            <View style={styles.rowText}><Text style={labelStyle}>{t('settings.text.terms_of_service')}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </TouchableOpacity>
        </CollapsibleSection>

        {/* Phase AI — Help / Support section. Single canonical contact. */}
        <CollapsibleSection title={t('settings.title.help_about')} icon="help-circle-outline">
          {/* 2026-08-01 (tester — first-run tour). Replay the guided icon-by-icon tour on demand. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => {
              try { require('../store/onboardingTourStore').useOnboardingTourStore.getState().relaunchTour(); } catch { /* non-fatal */ }
              router.push('/(tabs)/caddie' as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.replay_the_guided_tour')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.show_me_around')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.replay_the_tour')}
            </Text>
          </TouchableOpacity>
          {/* Phase 411 — Quick Start Guide. Same content as the PDF
              tester guide, available in-app so testers can refer back
              during use without hunting for the email attachment. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/quick-start' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_the_quick_start_guide')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.quick_start_guide')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.how_to_use_the_app')}
            </Text>
          </TouchableOpacity>
          {/* 2026-06-11 — Round import moved to its proper home: the Profile
              screen (alongside handicap index + GHIN). This Help row now just
              routes there so the old entry point still lands somewhere useful. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.import_past_rounds_from_your')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.import_past_rounds')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.in_profile_history_handicap')}
            </Text>
          </TouchableOpacity>
          {/* 2026-05-22 — Family Coaching roster + library link. Single
              entry into the Family mode (kids, partner, friends). Voice
              flow already works ("record Emma's swing"); this surfaces
              the UI for parents who add via tap. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/family/roster' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_family_coaching')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.family_coaching')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.roster_swing_library')}
            </Text>
          </TouchableOpacity>
          {/* 2026-06-30 (Tim) — minimal in-app messaging.
              2026-07-21 — RELEASE feature, hidden in beta behind MESSAGING_ENABLED. */}
          {MESSAGING_ENABLED && (
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/messages' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_messages')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.messages')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.message_a_golfer')}
            </Text>
          </TouchableOpacity>
          )}
          {/* 2026-05-22 — Captain extension. Surfaces Team Captain mode
              for high-school golfers (e.g. Heritage HS Romoland CA)
              managing teammates + coach contacts. Same store, distinct
              screen, voice flows reused. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/family/captain' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_team_captain')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.team_captain')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.teammates_coaches')}
            </Text>
          </TouchableOpacity>
          {/* Phase 411 — Share Feedback shortcut. Pre-fills email
              client with subject + helpful body prompts so testers
              don't stare at a blank message. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => {
              const url = 'mailto:support@smartplaycaddie.com?subject=' +
                encodeURIComponent('SmartPlay Caddie Beta Feedback') +
                '&body=' +
                encodeURIComponent(
                  "Hi Tim,\n\n" +
                  "What worked:\n\n\n" +
                  "What didn't:\n\n\n" +
                  "What surprised me:\n\n\n" +
                  "Phone / OS:\n" +
                  "Round count so far:\n"
                );
              Linking.openURL(url).catch(() => {
                Alert.alert(
                  t('settings.alert.email'),
                  t('settings.alert.could_not_open_your_email'),
                );
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.share_feedback_with_the_smartplay')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.share_feedback')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.email_with_prompts_pre_filled')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => {
              const url = 'mailto:support@smartplaycaddie.com?subject=' +
                encodeURIComponent('SmartPlay Caddie Pro Support Request');
              Linking.openURL(url).catch(() => {
                Alert.alert(
                  t('settings.alert.email'),
                  t('settings.alert.could_not_open_your_email'),
                );
              });
            }}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.contact_support')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.support_smartplaycaddie_com')}
            </Text>
          </TouchableOpacity>
          {/* Phase 410 — Privacy disclosure. PGA Hope graduates and any
              App Store / Play reviewer will look for this. Currently
              hosted at smartplaycaddie.com/privacy (placeholder URL —
              swap when the real policy is published). */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => {
              Linking.openURL('https://smartplaycaddie.com/privacy').catch(() => {
                Alert.alert(
                  t('settings.alert.privacy_policy'),
                  t('settings.alert.couldn_t_open_the_browser'),
                );
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_privacy_policy')}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.privacy_policy')}</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              {t('settings.text.smartplaycaddie_com_privacy')}
            </Text>
          </TouchableOpacity>

          {/* 2026-06-10 — About merged into Help & About. */}
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.app')}</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>{t('settings.text.smartplay_caddie_pro')}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.version')}</Text>
            {/* 2026-07-04 (elite-clean audit, menu finding #15) — was hardcoded "2.0.0"
                while app.json says 1.0.0. Read the REAL version from the expo config. */}
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>
              {Constants.expoConfig?.version ?? '—'}
            </Text>
          </View>
          {/* 2026-07-01 (Tim) — live OTA bundle stamp so you can confirm you're on the current
              update before judging a fix (OTA lands on cold start; this proves which one you have). */}
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.update')}</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]} selectable>{buildStamp}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.caddie')}</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>
              {caddieName}
            </Text>
          </View>
          {/* 2026-05-24 v1.2 — Company attribution. Built by SmartPlay AI (the company).
              The caddies are equal personas — none is "the face" in the About row. */}
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>{t('settings.text.built_by')}</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>{t('settings.text.smartplay_ai')}</Text>
          </View>
          {/* 2026-08-25 — the fourth glasses surface: one-time Meta View setup instructions in
              Help & About. Shelved with the rest, from the same owner, so the release does not
              document a feature it no longer offers. */}
          {!isFeatureShelved('meta_glasses') ? (
            <>
          {/* 2026-05-24 v1.2.1 — Meta glasses media-ingest setup
              instructions. The capture path is automatic once the
              user has set up Meta View; this section documents the
              one-time iPhone steps required. Localized via i18n
              labels.meta_glasses_setup / .meta_glasses_instructions. */}
          <View style={[styles.aboutRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>
              {t('labels.meta_glasses_setup')}
            </Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary, lineHeight: 18 }]}>
              {t('labels.meta_glasses_instructions')}
            </Text>
          </View>
            </>
          ) : null}

          {/* 2026-06-10 — Beta Feedback (Issue Log) merged into Help & About.
              Issue Log captures voice ("log this: ...") + Export mails the list
              to support@smartplaycaddie.com. Owner gets the Claude triage button
              inside the log itself. */}
          <TouchableOpacity
            style={styles.resetRow}
            onPress={() => router.push('/owner-logs' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_issue_log')}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.issue_log')}</Text>
              <Text style={[styles.rowSub, { color: colors.text_muted }]}>{t('settings.settings.say_log_this_to_capture', { caddieName })}</Text>
            </View>
            <Ionicons name="bug-outline" size={20} color={colors.text_muted} />
          </TouchableOpacity>

          {/* 2026-05-25 — Fix AI: Coach Knowledge entry. Same Beta Feedback section so a
              coach can find their "remember this" captures and export them. */}
          <TouchableOpacity
            style={styles.resetRow}
            onPress={() => router.push('/coach-knowledge' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.open_coach_knowledge')}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.coach_knowledge')}</Text>
              <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                {t('settings.text.coach_refinements_saved_via_remember')}
              </Text>
            </View>
            <Ionicons name="bulb-outline" size={20} color={colors.text_muted} />
          </TouchableOpacity>
        </CollapsibleSection>

        {/* 2026-05-17 — Owner-only tools (Claude triage etc). The Issue
            Log entry was extracted to the public Beta Feedback section
            above so testers can use it too. */}
        {(() => {
          try {
            const profile = usePlayerProfileStore.getState();
            const showOwner = isOwnerEmail(profile.email);
            if (!showOwner) return null;
            return (
              <>
                <CollapsibleSection title={t('settings.title.owner_tools')} icon="construct-outline">
                  {/* 2026-05-24 v1.2.1 — Glasses Mode toggle. Pre-
                      configures the audio session for background
                      Bluetooth so the caddie's voice routes to Ray-Ban
                      Meta glasses when paired. Persisted on settingsStore.
                      Audio mode applied on toggle ON via existing
                      voiceService.configureAudioForSpeech (queued, no
                      race with the rest of voice stack). */}
                  <GlassesModeRow colors={colors} />
                  {/* 2026-06-21 — AI provider A/B toggle. Switch between
                      Gemini 2.5-Flash and OpenAI (gpt-4o) as the caddie
                      brain + reasoning provider. TTS/STT are always OpenAI.
                      Injects X-AI-Provider header on all API calls via
                      services/apiFetch once routes are migrated (Phase 2+). */}
                  <AiProviderRow colors={colors} />
                  {/* 2026-06-15 (Tim) — "Train the Trainer" — the reference-asset
                      authoring tool (capture example pics + narrative for faults
                      like open-face), moved here from the global Tools menu so it's
                      an owner/instructor surface. */}
                  {/* 2026-08-31 (Tim) — the digital business card, in the app. Owner-gated at the
                      SCREEN as well as here, because a route can also be reached by voice. */}
                  {/**
                    * 2026-09-06 (Tim — "I need to make sure I still get notified of errors").
                    *
                    * The issue-log EMAIL was removed today when the log and Sentry were merged into
                    * one system, so Sentry is now the only channel that pings him. That made
                    * "is alerting actually on?" a question with no way to answer it short of waiting
                    * for a real crash — which is exactly the wrong time to find out it is off.
                    *
                    * This fires one real error into Sentry on demand. Owner-gated by the enclosing
                    * block, and it throws asynchronously so it reaches the global handler (the path a
                    * genuine crash takes) rather than being swallowed by React's render try/catch.
                    */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => {
                      const stamp = new Date().toISOString();
                      Alert.alert(
                        t('settings.alert.send_a_test_error'),
                        t('settings.alert.fires_one_real_error_into'),
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Send it',
                            onPress: () => {
                              // Breadcrumb first so the event carries the same shape a real one would.
                              try { Sentry.addBreadcrumb({ category: 'owner', message: 'owner test error requested', level: 'info' }); } catch { /* non-fatal */ }
                              // Thrown out of band: this is how an uncaught async error actually reaches
                              // Sentry. Calling captureException directly would test a different path
                              // than the one a real crash takes.
                              setTimeout(() => {
                                throw new Error(`SmartPlay owner test error · ${stamp}`);
                              }, 0);
                              Alert.alert(
                                t('settings.alert.sent'),
                                t('settings.alert.check_sentry_and_check_whether'),
                              );
                            },
                          },
                        ],
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.send_a_test_error_to')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.send_test_error')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.fires_one_real_error_into')}
                      </Text>
                    </View>
                    <Ionicons name="bug-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-09-10 (Tim — "give me an owners tool toggle that will track a round I play
                      for all key touchpoints to look for errors and issues and opportunities through
                      a full real test round"). Read ONCE at round start, so a field test is a whole
                      round or it is not one. */}
                  <ToggleRow
                    label={t('settings.label.field_test_this_round')}
                    sub="Traces every key touchpoint of your next round — which green tier answered, why a shot was or wasn't logged, why hole advance held — then emails a findings report (errors, issues and opportunities) at the end, with the full timeline underneath. Reads the toggle when you START a round. Costs nothing when off."
                    value={ownerFieldTest}
                    onValueChange={confirmToggle('Field Test', setOwnerFieldTest)}
                  />
                  {/* 2026-09-09 (Tim — "put my checklists of to dos on the phone in owners tool").
                      First row in Owner Tools on purpose: it is the one that has something to say. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/owner-checklist' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_my_checklist')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>
                        Checklist{checklistOpen > 0 ? ` · ${checklistOpen} open` : ''}
                      </Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.field_tests_and_ship_steps')}
                      </Text>
                    </View>
                    <Ionicons name="checkbox-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/owner-card' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_my_digital_business_card')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.my_card')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.your_digital_business_card_qr')}
                      </Text>
                    </View>
                    <Ionicons name="id-card-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/author/reference-assets' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_train_the_trainer_reference')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.train_the_trainer')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.capture_example_photos_narrative_for')}
                      </Text>
                    </View>
                    <Ionicons name="school-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-05-24 — Feel Capture toggle. When ON, every
                      practice swing's clip audio is transcribed via
                      Whisper and stored as feel_narration_transcript
                      paired with perShotAnalysis. Owner-only dataset
                      for future feel-vs-real calibration. Doubly
                      gated (flag + isOwnerEmail) — never fires for
                      production users. Review tuples at /swing-sessions-debug. */}
                  <FeelCaptureRow colors={colors} />
                  <VoiceHitRateRow colors={colors} />
                  {/* 2026-08-22 (Tim — "owner only is me seeing it graphically... not a text line.
                      That's not gonna let me compare anything"). TRAINING vs STRIKE moved out of here
                      and onto the dashboard PROGRESS graph as an owner-only "Strike" source, so it is
                      read the way a player would read it. A text strip cannot answer whether two
                      lines move together. */}

                  {/* 2026-06-16 (Tim — "issue log + harness should be in owner
                      tools") — Issue Log restored HERE in Owner Tools (it also
                      still lives in the public Beta Feedback section above, but Tim
                      expects it alongside the harness). Owner triage lives inside. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/owner-logs' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_issue_log')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.issue_log')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.logged_issues_voice_log_this')}
                      </Text>
                    </View>
                    <Ionicons name="bug-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-05-24 — Scenario harness. Owner-gated test runner
                      for 17 scenarios covering the shipped-unverified items
                      from BUILD-STATE-AUDIT §B. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/harness' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.view_scenario_harness')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.scenario_harness')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.17_scenarios_9_critical_5')}
                      </Text>
                    </View>
                    <Ionicons name="flask-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-06-10 — Caddie Clip Test owner tool removed per Tim. */}
                  {/* 2026-05-23 — Voice coverage log. Every voice command
                      that doesn't match a wired handler (classifier
                      unknown, no handler registered, or handler threw)
                      lands here with transcript + surface + reason. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/voice-misses' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.view_voice_misses_log')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.voice_misses')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.phrasings_that_didn_t_match')}
                      </Text>
                    </View>
                    <Ionicons name="mic-off-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-07-04 (Tim — voice sim round) — tap-start for the narrated
                      SIM round (voice: "start a sim round"). Palms, 9 holes; the
                      round is SIM-tagged and never trains handicap/bag/CNS. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => {
                      try {
                        const sim = require('../services/simRound') as typeof import('../services/simRound');
                        const r = sim.startVoiceSimRound({ nineHoles: true });
                        (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore.getState().show(r.ok ? '🎮 Sim round started — Palms, 9 holes' : r.say);
                        if (r.ok) router.push('/(tabs)/caddie' as never);
                      } catch (e) { console.log('[settings] sim round start failed:', e); }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.start_a_sim_round')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.sim_round_palms_9')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.voice_narrated_practice_round_on')}
                      </Text>
                    </View>
                    <Ionicons name="game-controller-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-09-02 (Tim — "a second option for owner tools sim round that is non
                      voice and goes by user tendencies and data... watch hole transition, scoring").
                      The narrated round above needs him to speak every shot, which is the wrong tool
                      for hunting a scorecard bug. This one plays itself through the same pipeline in
                      seconds, on his own bag and miss, and exports a per-hole report. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/simround-auto' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.auto_sim_round_silent')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.auto_sim_round_silent')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.plays_a_full_round_by')}
                      </Text>
                    </View>
                    <Ionicons name="play-forward-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-07-04 (elite-clean audit, menu finding #10) — the coach
                      tutorial manager (curate + upload instruction videos) was an
                      ORPHANED surface: registered routes reachable only from each
                      other, no entry anywhere. It's coach/owner tooling — its
                      entry lives here. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/swinglab/tutorials' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.manage_coach_tutorials')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.coach_tutorials')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.curate_upload_instruction_videos_for')}
                      </Text>
                    </View>
                    <Ionicons name="school-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-05-24 — Swing-analysis telemetry card. Pairs
                      the client's frames-sent count with the server's
                      echoed image-block count so the multi-frame pipe
                      is verifiable in-app (no Vercel logs). Refreshes
                      on every real swing through SmartMotion. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/swing-analysis-debug' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.view_swing_analysis_telemetry')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.swing_analysis_telemetry')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.last_swing_frames_sent_vs')}
                      </Text>
                    </View>
                    <Ionicons name="film-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-05-24 — Reset Tutorials. Clears every
                      tutorialsSeen flag so the standardized 3-line
                      first-run tutorial replays on next entry of
                      every feature screen (Caddie / SwingLab /
                      SmartMotion / Quick Record / Practice / Coach).
                      Owner test path for the QuickTutorial system. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => {
                      Alert.alert(
                        t('settings.alert.reset_tutorials'),
                        t('settings.alert.every_first_run_tutorial_will'),
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Reset',
                            style: 'destructive',
                            onPress: () => {
                              useSettingsStore.getState().resetTutorials();
                            },
                          },
                        ],
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.reset_all_first_run_tutorials')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.reset_tutorials')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.replay_every_feature_s_3')}
                      </Text>
                    </View>
                    <Ionicons name="refresh-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/gps-test' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_gps_test_bench')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.gps_test_bench')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.drop_an_anchor_at_your')}
                      </Text>
                    </View>
                    <Ionicons name="locate-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-07-06 (elite audit) — /native-modules-debug was a
                      registered route with NO entry point anywhere, yet it's
                      load-bearing: the capture-engine A/B flag is flipped
                      there. Owner tooling — its entry lives here. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/native-modules-debug' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_native_modules_debug')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.native_modules')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.on_device_module_status_the')}
                      </Text>
                    </View>
                    <Ionicons name="hardware-chip-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-07-06 (elite audit) — /swing-sessions-debug is the hub that
                      links out to the other debug screens but was itself
                      unreachable from any menu. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/swing-sessions-debug' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_swing_sessions_debug_hub')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.swing_sessions_debug')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.debug_hub_captured_swing_tuples')}
                      </Text>
                    </View>
                    <Ionicons name="construct-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-08-30 (Tim: "I am not seeing subscription debug in my owners tools") —
                      it WAS reachable, but only as Owner Tools → Swing Sessions Debug → Subscription Debug:
                      two levels deep, behind a hub named after the rig. Nobody looks for
                      subscription state there, and Owner Tools itself listed only swing-analysis,
                      native-modules and swing-sessions-debug. Buried is not the same as missing, but for the
                      person trying to find it the difference does not matter. Direct row, because
                      this is now the screen that reads subscription state, runs the 30-day
                      promotion, and forces the paywall for the App Store review screenshot. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/subscription-debug' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_subscription_debug')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.subscription_debug')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.subscription_trial_state_the_30')}
                      </Text>
                    </View>
                    <Ionicons name="card-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/kevin-learning' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${caddieName} learning log`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.learning', { caddieName })}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>{t('settings.text.vocabulary_has_picked_up_from', { caddieName })}</Text>
                    </View>
                    <Ionicons name="library-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/mark-green' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.accessibility_label.open_mark_location_tool')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.text.mark_location')}</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        {t('settings.text.walk_to_a_tee_box')}
                      </Text>
                    </View>
                    <Ionicons name="location" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                </CollapsibleSection>
              </>
            );
          } catch { return null; }
        })()}

        {/* Reset / Sign Out — until real auth lands, this is the
            functional equivalent for testers who want to start fresh
            (new persona, clear stored profile, fresh trial state). */}
        <CollapsibleSection title={t('settings.title.reset')} icon="refresh-outline">
          <TouchableOpacity
            style={styles.resetRow}
            accessibilityRole="button"
            accessibilityLabel={t('settings.accessibility_label.reset_all_app_data_and')}
            onPress={() => {
              Alert.alert(
                t('settings.alert.reset_app_data'),
                t('settings.alert.this_clears_your_profile_round'),
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Reset everything',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
                        const keys = await AsyncStorage.getAllKeys();
                        await AsyncStorage.multiRemove(keys);
                        Alert.alert(
                          t('settings.alert.reset_complete'),
                          t('settings.alert.force_close_the_app_swipe'),
                          [{ text: 'OK' }],
                        );
                      } catch (e) {
                        Alert.alert(t('settings.alert.reset_failed'), e instanceof Error ? e.message : String(e));
                      }
                    },
                  },
                ],
              );
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: '#f87171' }]}>{t('settings.text.reset_app_data')}</Text>
              <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                {t('settings.text.clear_your_profile_rounds_settings')}
              </Text>
            </View>
            <Ionicons name="trash-outline" size={20} color="#f87171" />
          </TouchableOpacity>
        </CollapsibleSection>

        <View style={{ height: 40 }} />

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── DEVELOPER TOOLS ────────────────────────
// Phase Q.5b — simulated GPS walk picker. Drives services/simulatedGPS.ts
// which feeds smartFinderService cached fix from a pre-built waypoint
// path. Used to verify holeDetection sustained-position transitions
// without requiring a real course visit.

function DeveloperToolsSection({ cardStyle, colors }: { cardStyle: object[]; colors: ThemeColors }) {
  const { t } = useTranslation();
  const walks = getAvailableWalks();
  const [walkState, setWalkState] = useState<SimulatedWalkState | null>(null);
  const [active, setActive] = useState(isSimulatedActive());

  useEffect(() => {
    const unsub = subscribeToWalk(s => {
      setWalkState(s);
      setActive(isSimulatedActive());
    });
    return () => { unsub(); };
  }, []);

  return (
    <>
      <Text style={{
        color: '#F5A623', fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
        textTransform: 'uppercase', paddingHorizontal: 20, marginTop: 20, marginBottom: 8,
      }}>{t('settings.developer_tools_section.developer_tools_dev_build')}</Text>

      <View style={cardStyle}>
        <Text style={{ color: colors.text_primary, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
          {t('settings.developer_tools_section.simulated_gps_walk')}
        </Text>
        <Text style={{ color: colors.text_muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
          {t('settings.developer_tools_section.replaces_the_real_gps_source')}
        </Text>

        {!active ? (
          <View style={{ gap: 8 }}>
            {walks.map(w => (
              <TouchableOpacity
                key={w.id}
                style={{
                  borderColor: colors.border, borderWidth: 1, borderRadius: 10,
                  paddingVertical: 12, paddingHorizontal: 14,
                }}
                onPress={() => startSimulatedWalk(w.id)}
              >
                <Text style={{ color: colors.text_primary, fontSize: 13, fontWeight: '700' }}>{w.display_name}</Text>
                <Text style={{ color: colors.text_muted, fontSize: 11, marginTop: 2 }}>{w.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ backgroundColor: colors.accent_muted, borderColor: colors.accent, borderWidth: 1, borderRadius: 10, padding: 12 }}>
              <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>
                {t('settings.developer_tools_section.sim_active')}
              </Text>
              {walkState ? (
                <>
                  <Text style={{ color: colors.text_primary, fontSize: 12, marginTop: 6 }}>{t('settings.developer_tools_section.waypoint_through', { waypoint_index: walkState.waypoint_index + 1, fraction_through: (walkState.fraction_through * 100).toFixed(0) })}</Text>
                  <Text style={{ color: colors.text_muted, fontSize: 11, marginTop: 2 }}>
                    {walkState.current_lat.toFixed(5)}, {walkState.current_lng.toFixed(5)}
                  </Text>
                  {walkState.next_label && (
                    <Text style={{ color: colors.text_muted, fontSize: 11, marginTop: 2 }}>{t('settings.developer_tools_section.next', { next_label: walkState.next_label })}</Text>
                  )}
                </>
              ) : null}
            </View>
            <TouchableOpacity
              style={{ backgroundColor: colors.surface_elevated, borderColor: colors.error, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              onPress={() => stopSimulatedWalk()}
            >
              <Text style={{ color: colors.error, fontSize: 13, fontWeight: '800' }}>{t('settings.developer_tools_section.stop_simulated_walk')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </>
  );
}

/**
 * 2026-05-24 v1.2.1 — Glasses Mode toggle component.
 *
 * Lives inside Settings → Owner Tools. Switch reflects + writes
 * settingsStore.glassesMode (persisted). On toggle ON:
 *   1. Request mic permission via expo-av. If denied → revert toggle +
 *      surface an Alert with a deep-link to system Settings.
 *   2. Pre-configure the audio session for background Bluetooth via
 *      voiceService.configureAudioForSpeech (already queued + idempotent;
 *      sets staysActiveInBackground:true + DuckOthers, which routes TTS
 *      to BT headset glasses when paired).
 *   3. Show the setup tutorial Alert.
 *
 * Boot-time re-configure lives in app/_layout.tsx (one useEffect that
 * reads settingsStore.glassesMode on mount and calls
 * configureAudioForSpeech if true).
 *
 * NOTE: No new Meta SDK or auto-pair. Ray-Ban Meta is paired by the
 * user in iPhone Settings → Bluetooth one time, then this toggle
 * configures SmartPlay to play nicely with it.
 */
function GlassesModeRow({ colors }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const glassesMode = useSettingsStore((s) => s.glassesMode);
  const setGlassesMode = useSettingsStore((s) => s.setGlassesMode);
  const [busy, setBusy] = useState(false);

  const onToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!next) {
        // Disabling — no permission flow needed, just flip + persist.
        setGlassesMode(false);
        return;
      }

      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('settings.mic_required_title'),
          t('settings.mic_required_body'),
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      // Pre-configure audio session via the existing queued helper.
      try {
        const voice = await import('../services/voiceService');
        await voice.configureAudioForSpeech();
      } catch (e) {
        console.log('[glassesMode] audio config failed (non-fatal):', e);
      }

      setGlassesMode(true);
      Alert.alert(
        t('settings.glasses_tutorial_title'),
        t('settings.glasses_tutorial_body'),
        // 2026-07-04 (elite-clean audit, menu finding #15) — the "Watch Tutorial"
        // button pointed at smartplaygolf.com (wrong domain, dead link). Removed
        // until a real hosted tutorial exists; the alert body carries the setup steps.
        [{ text: 'Got it', style: 'default' }],
      );
    } finally {
      setBusy(false);
    }
  };

  const onTestMic = async () => {
    const { status } = await Audio.getPermissionsAsync();
    Alert.alert(
      t('settings.glasses_mode'),
      status === 'granted' ? t('settings.mic_ready') : t('settings.mic_not_enabled'),
    );
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={styles.resetRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: colors.text_primary }]}>
            🕶️ {t('settings.glasses_mode')}
          </Text>
          <Text style={[styles.rowSub, { color: colors.text_muted }]}>
            {t('settings.glasses_mode_desc')}
          </Text>
          {glassesMode && (
            <Text style={[styles.rowSub, { color: colors.accent, marginTop: 6 }]}>
              ✓ {t('settings.glasses_mode_active')}
            </Text>
          )}
        </View>
        <Switch
          value={glassesMode}
          onValueChange={onToggle}
          disabled={busy}
          trackColor={{ false: '#767577', true: colors.accent }}
        />
      </View>
      {glassesMode && (
        <View
          style={{
            padding: 12,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 10,
            marginTop: 4,
          }}
        >
          <Text style={[styles.rowLabel, { color: colors.text_primary, marginBottom: 6 }]}>
            {t('settings.glasses_how_to_title')}
          </Text>
          <Text style={[styles.rowSub, { color: colors.text_muted, lineHeight: 19 }]}>
            {t('settings.glasses_how_to_body')}
          </Text>
          <TouchableOpacity
            onPress={onTestMic}
            style={{
              marginTop: 10,
              alignSelf: 'flex-start',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: colors.accent,
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.test_microphone')}
          >
            <Text style={{ color: colors.background, fontSize: 12, fontWeight: '800' }}>
              {t('settings.test_microphone')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/**
 * 2026-05-24 — Feel Capture toggle component.
 *
 * Owner-only dev tooling. When ON, every cage swing's clip audio is
 * transcribed via Whisper (existing /api/transcribe) and stored on
 * the shot as `feel_narration_transcript`, paired with the existing
 * perShotAnalysis. Forms labeled tuples {clip, transcript, analysis}
 * for future feel-vs-real calibration. No user surface — only the
 * /swing-sessions-debug viewer surfaces the captured data.
 *
 * Defense-in-depth: the service ALSO checks isOwnerEmail at the call
 * site, so a leaked persisted flag from a previous account doesn't
 * accidentally fire transcription on a non-owner's audio.
 */
// 2026-06-16 (Tim — self-growing agent metric) — the local-first health metric:
// what share of spoken asks the caddie answered ON-DEVICE (instant/offline/0-token)
// vs escalated to the cloud. Should trend UP as the CNS brain grows. Tap to reset.
function VoiceHitRateRow({ colors }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const local = useVoiceHitRateStore((s) => s.local);
  const cloud = useVoiceHitRateStore((s) => s.cloud);
  const reset = useVoiceHitRateStore((s) => s.reset);
  const total = local + cloud;
  const pct = total === 0 ? 0 : Math.round((local / total) * 100);
  return (
    <TouchableOpacity
      style={styles.resetRow}
      onPress={() =>
        Alert.alert(
          t('settings.alert.reset_voice_hit_rate'),
          `Local ${pct}% — ${local} on-device / ${cloud} cloud (${total} asks).`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => reset() },
          ],
        )
      }
      accessibilityRole="button"
      accessibilityLabel={t('settings.accessibility_label.voice_local_hit_rate_tap')}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.voice_hit_rate_row.voice_local_hit_rate')}</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]}>
          {total === 0
            ? 'No voice asks yet. Answered on-device vs escalated to the cloud — should climb as the brain learns.'
            : `${pct}% on-device · ${local} local / ${cloud} cloud (${total} asks). Tap to reset.`}
        </Text>
      </View>
      <Text style={[styles.rowLabel, { color: pct >= 50 ? colors.accent : colors.text_muted, fontVariant: ['tabular-nums'] }]}>{pct}%</Text>
    </TouchableOpacity>
  );
}

function FeelCaptureRow({ colors }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const feelCaptureEnabled = useSettingsStore((s) => s.feelCaptureEnabled);
  const setFeelCaptureEnabled = useSettingsStore((s) => s.setFeelCaptureEnabled);
  return (
    <View style={[styles.resetRow, { marginBottom: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.feel_capture_row.feel_capture_dev')}</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]}>
          {t('settings.feel_capture_row.transcribe_each_swing_s_clip')}
        </Text>
        {feelCaptureEnabled && (
          <Text style={[styles.rowSub, { color: colors.accent, marginTop: 6 }]}>
            {t('settings.feel_capture_row.active_capturing_on_every_practice')}
          </Text>
        )}
      </View>
      <Switch
        value={feelCaptureEnabled}
        onValueChange={setFeelCaptureEnabled}
        trackColor={{ false: '#767577', true: colors.accent }}
      />
    </View>
  );
}

function AiProviderRow({ colors }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const setAiProvider = useSettingsStore((s) => s.setAiProvider);
  const isOpenAI = aiProvider === 'openai';
  return (
    <View style={[styles.resetRow, { marginBottom: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{t('settings.ai_provider_row.ai_brain_provider')}</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]}>{isOpenAI ? t('settings.ai_provider_row.openai_gpt_4o_gpt_4o', { n: '\n' }) : t('settings.ai_provider_row.gemini_2_5_flash_fastest', { n: '\n' })}</Text>
        <Text style={[styles.rowSub, { color: colors.accent, marginTop: 4 }]}>{isOpenAI ? t('settings.ai_provider_row.active_openai') : t('settings.ai_provider_row.active_gemini')}</Text>
      </View>
      <Switch
        value={isOpenAI}
        onValueChange={(v) => setAiProvider(v ? 'openai' : 'gemini')}
        trackColor={{ false: '#767577', true: colors.accent }}
      />
    </View>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  /**
   * 2026-09-11 — the one card that replaces decoding a Trust Spectrum. Colours are theme tokens so
   * it resolves in all five palettes.
   */
  styleCard: { marginHorizontal: 16, marginTop: 6, marginBottom: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  styleCardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 5 },
  styleCardBody: { fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  styleCardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 10 },
  styleCardHint: { fontSize: 11.5, flex: 1 },
  styleCardReset: { fontSize: 12.5, fontWeight: '800' },
  // 2026-05-26 — Fix AB Phase 1: GHIN field helper-text style.
  helperText: {
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
    paddingHorizontal: 4,
  },
  // 2026-05-26 — Fix BD: handicap recalculate button style.
  recalcBtn: {
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  recalcBtnText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // Phase 105 — caddie team intro + reset link.
  sectionIntro: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  linkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  linkBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scroll: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  sectionHeader: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  collapsibleHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
    margin: 0,
  },
  // 2026-05-18 — Slim profile card matching dashboard's profileCard.
  profileSlim: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileSlimAvatar: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  profileSlimLetter: { fontSize: 20, fontWeight: '800' },
  profileSlimText: { flex: 1, minWidth: 0 },
  profileSlimName: { fontSize: 17, fontWeight: '800' },
  profileSlimMeta: { fontSize: 13, marginTop: 2 },
  profileSlimGear: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: '#0d1a0d',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  intensityStep: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  intensityStepText: { fontSize: 18, fontWeight: '900' },
  resetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  // Inline trust-level block in Round Experience.
  trustBlock: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trustSlider: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  trustCell: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  trustCellLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  trustOneLiner: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 18,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
  rowSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  inputLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#060f09',
    borderWidth: 1,
    borderColor: '#1e3a28',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: '#ffffff',
    fontSize: 15,
  },
  pillSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
  },
  pillLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
  },
  pillActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  pillText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#00C896',
  },
  saveBtn: {
    backgroundColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  aboutLabel: {
    color: '#6b7280',
    fontSize: 14,
  },
  aboutValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  watchInfo: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
    gap: 4,
  },
  watchInfoTitle: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  watchInfoBody: {
    color: '#c2cad4',
    fontSize: 12,
    lineHeight: 18,
  },
});
