import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';
// 2026-05-21 — Consolidation 1 / Merge C: watch-connected display
// reads from the dedicated watchStore so all three call sites
// (cage-mode, cage/summary, settings) share one source of truth.
import { useWatchStore } from '../store/watchStore';
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
import CloudBackupCard from '../components/settings/CloudBackupCard';
import type { ThemeColors } from '../theme/tokens';
import { getCaddieName, ACTIVE_PERSONAS } from '../lib/persona';
import {
  startSimulatedWalk, stopSimulatedWalk, getAvailableWalks,
  subscribeToWalk, isSimulatedActive, type SimulatedWalkState,
} from '../services/simulatedGPS';

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
    earbudTapToTalk,
    setEarbudTapToTalk,
    cartMode,
    skip_briefings,
    proactive_kevin_enabled,
    distance_unit,
    theme_preference,
    // Phase AC — earbudTapToTalk + setEarbudTapToTalk intentionally
    // dropped from this destructure. The toggle is rendered as a disabled
    // "Coming soon" row because no native media-key listener exists in the
    // build (track-player was removed; see services/mediaKeyBridge.ts).
    voiceOnPhoneSpeaker,
    kevinGreetingEnabled,
    setVoiceOnPhoneSpeaker,
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
    tankSoftIntro,
    setTankSoftIntro,
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
  // 2026-06-30 (Tim — "turning on the watch is blocked") — the Galaxy Watch swing-IMU bridge
  // shipped in the native build, so this is a REAL toggle now. Available only when the native
  // module is linked (latest build); on an older binary it stays disabled with a clear note.
  const watchSwingEnabled = useSettingsStore((s) => s.watchSwingEnabled);
  const setWatchSwingEnabled = useSettingsStore((s) => s.setWatchSwingEnabled);
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
  const setAutoShotDetection = useSettingsStore(s => s.setAutoShotDetection);
  const autoHoleAdvance = useSettingsStore(s => s.autoHoleAdvance);
  const setAutoHoleAdvance = useSettingsStore(s => s.setAutoHoleAdvance);
  // 2026-06-24 — Off-device data layer Phase A: usage telemetry opt-in.
  const analyticsOptIn = useSettingsStore(s => s.analyticsOptIn);
  const setAnalyticsOptIn = useSettingsStore(s => s.setAnalyticsOptIn);

  // Persona-aware display name. Settings labels reference the active caddie
  // by name (Kevin / Serena / Harry / Tank) consistently with the rest of the app.
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

  const [editName, setEditName] = useState(name);
  const [editHandicap, setEditHandicap] = useState(String(handicap));
  const [editCreds, setEditCreds] = useState(coachCredentials ?? '');
  const [editGoal, setEditGoal] = useState(goal ?? '');
  const handicapIndex = usePlayerProfileStore(s => s.handicap_index);
  const setHandicapIndex = usePlayerProfileStore(s => s.setHandicapIndex);
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const roundMod = require('../store/roundStore') as typeof import('../store/roundStore');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const calcMod = require('../services/handicapCalculator') as typeof import('../services/handicapCalculator');
      const rounds = roundMod.useRoundStore.getState().roundHistory;
      // 2026-06-06 — Phase 6.1 followup: match the rebuild filter
      // (exactly 9 OR exactly 18 holes — no partial 10-17). Previously
      // partials passed the gate then got silently dropped by
      // rebuildDifferentialsFromHistory, surfacing as "Could not
      // compute" with no explanation.
      const eligible = rounds.filter(
        r => (r.holesPlayed === 9 || r.holesPlayed === 18) && r.totalScore > 0,
      );
      if (eligible.length < 3) {
        Alert.alert(
          'Need more rounds',
          `Recalculation needs at least 3 complete 9- or 18-hole rounds. You have ${eligible.length}. Play more rounds or import past rounds (Settings → Help → Import Past Round). Partial rounds (10-17 holes) aren't counted.`,
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
        Alert.alert(
          'Handicap Updated',
          `New Index: ${result.newIndex.toFixed(1)}\n\n${result.estimateNote}`,
        );
      } else {
        Alert.alert('Could not compute', result.estimateNote);
      }
    } catch (e) {
      console.log('[settings] recalculate handicap threw:', e);
      Alert.alert('Recalculation failed', e instanceof Error ? e.message : String(e));
    }
  }, []);
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
            <Text style={[styles.backText, { color: colors.accent }]}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Settings</Text>
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
            placeholder="Search settings"
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
        <SectionHeader title="Profile" />
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
              <Text style={[styles.profileSlimMeta, { color: colors.text_muted }]} numberOfLines={1}>
                Handicap {handicapIndex != null ? handicapIndex.toFixed(1) : (handicap || '—')} · Goal {goal || '—'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setProfileExpanded(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
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
              accessibilityLabel="Minimize profile"
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

          <Text style={inputLblStyle}>Name</Text>
          <TextInput
            style={inputFldStyle}
            value={editName}
            onChangeText={setEditName}
            placeholder="Your name"
            placeholderTextColor="#374151"
            autoCapitalize="words"
          />

          <Text style={inputLblStyle}>Handicap</Text>
          <TextInput
            style={inputFldStyle}
            value={editHandicap}
            onChangeText={setEditHandicap}
            keyboardType="numeric"
            placeholder="0–54"
            placeholderTextColor="#374151"
          />

          <Text style={inputLblStyle}>Personal Best</Text>
          <TextInput
            style={inputFldStyle}
            value={editBest}
            onChangeText={setEditBest}
            keyboardType="numeric"
            placeholder="Best round score"
            placeholderTextColor="#374151"
          />

          {/* 2026-06-04 — Personal-best inputs surfaced on the dashboard
              Highlights card. longestDrive auto-updates from logShot when
              a Driver shot beats the current high (see roundStore.logShot);
              longestPutt is manual until a putt-distance source lands. */}
          <Text style={inputLblStyle}>Longest Drive (yards)</Text>
          <TextInput
            style={inputFldStyle}
            value={editLongestDrive}
            onChangeText={setEditLongestDrive}
            keyboardType="numeric"
            placeholder="e.g. 280"
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>
            Updated automatically as you log Driver shots.
          </Text>

          <Text style={inputLblStyle}>Longest Putt (yards)</Text>
          <TextInput
            style={inputFldStyle}
            value={editLongestPutt}
            onChangeText={setEditLongestPutt}
            keyboardType="numeric"
            placeholder="e.g. 45"
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>
            Manual entry for now.
          </Text>

          <Text style={inputLblStyle}>Handicap Index (USGA)</Text>
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
              Recalculate from Round History
            </Text>
          </TouchableOpacity>
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -4, marginBottom: 8 }]}>
            Uses the WHS best-8-of-20 average across your last 20 rounds (live + imported). Treats every course as 72.0 rating / 113 slope — close to GHIN but not exact.
          </Text>

          {/* 2026-05-26 — Fix AB Phase 1: GHIN # capture. We store the
              number now so once USGA business-API credentials land we
              can auto-pull official handicap + posted-scores history.
              Until then it's informational (brain prompt + tournament
              hints). */}
          <Text style={inputLblStyle}>GHIN Number</Text>
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
            Optional. We&apos;ll pull your official handicap + score history once GHIN integration ships.
          </Text>

          <Text style={inputLblStyle}>Account email</Text>
          <TextInput
            style={inputFldStyle}
            value={editEmail}
            onChangeText={(v) => { setEditEmail(v); setAccountEmail(v.trim() || null); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="you@email.com"
            placeholderTextColor="#374151"
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -8, marginBottom: 8 }]}>
            Optional. {isOwnerEmail(editEmail) ? '✓ Owner Tools unlocked.' : 'Owner devices: enter your owner email to unlock Owner Tools.'}
          </Text>

          <Text style={inputLblStyle}>Goal</Text>
          <TextInput
            style={inputFldStyle}
            value={editGoal}
            onChangeText={setEditGoal}
            placeholder="e.g. Break 90"
            placeholderTextColor="#374151"
          />

          <Text style={inputLblStyle}>Physical Note</Text>
          <TextInput
            style={inputFldStyle}
            value={editLimitation}
            onChangeText={setEditLimitation}
            placeholder="e.g. Bad left knee"
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
              <Text style={inputLblStyle}>Credentials (shown on swing reports you send)</Text>
              <TextInput
                style={inputFldStyle}
                value={editCreds}
                onChangeText={setEditCreds}
                onBlur={() => setCoachCredentials(editCreds)}
                placeholder="e.g. LPGA Class A · 25 yrs"
                placeholderTextColor={colors.text_muted}
              />
            </>
          ) : null}

          <PillRow
            label="Handedness"
            options={[
              { label: 'Right', value: 'right' },
              { label: 'Left', value: 'left' },
            ]}
            value={handedness}
            onSelect={(v) => setHandedness(v as 'right' | 'left')}
          />

          <PillRow
            label="Dominant Miss"
            options={[
              { label: 'Left', value: 'left' },
              { label: 'Straight', value: 'straight' },
              { label: 'Right', value: 'right' },
            ]}
            value={dominantMiss ?? ''}
            onSelect={(v) => setDominantMiss(v as 'left' | 'right' | 'straight')}
          />

          <PillRow
            label="Preferred Tee"
            options={[
              { label: 'Front', value: 'front' },
              { label: 'Middle', value: 'middle' },
              { label: 'Back', value: 'back' },
            ]}
            value={preferredTee}
            onSelect={(v) => setPreferredTee(v as 'front' | 'middle' | 'back')}
          />

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleSaveProfile}>
              <Text style={styles.saveBtnText}>Save Profile</Text>
            </TouchableOpacity>
            {name?.trim() ? (
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 0, paddingHorizontal: 14, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}
                onPress={() => setProfileExpanded(false)}
              >
                <Text style={[styles.saveBtnText, { color: colors.text_muted }]}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>

        </View>
        )}

        {/* CADDIE TEAM — Phase 105 per-pillar assignments */}
        <CollapsibleSection title="Caddie" icon="bag-outline">
          <Text style={[styles.sectionIntro, { color: colors.text_muted }]}>
            Four caddies, one team. Each part of your game can have a different caddie. We&apos;ve set sensible defaults — change anything anytime.
          </Text>

          <PillRow
            label="Round (on-course)  ·  default Kevin"
            options={[
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
              { label: 'Tank', value: 'tank' },
            ]}
            value={caddieAssignments.round}
            onSelect={(v) => setCaddieForPillar('round', v as 'kevin' | 'serena' | 'harry' | 'tank')}
          />

          <PillRow
            label="Cage Mode  ·  default Tank"
            options={[
              { label: 'Tank', value: 'tank' },
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
            ]}
            value={caddieAssignments.cage}
            onSelect={(v) => setCaddieForPillar('cage', v as 'kevin' | 'serena' | 'harry' | 'tank')}
          />

          <PillRow
            label="Drills (SwingLab)  ·  default Serena"
            options={[
              { label: 'Serena', value: 'serena' },
              { label: 'Kevin', value: 'kevin' },
              { label: 'Tank', value: 'tank' },
            ]}
            value={caddieAssignments.drills}
            onSelect={(v) => setCaddieForPillar('drills', v as 'kevin' | 'serena' | 'harry' | 'tank')}
          />

          <PillRow
            label="Play / Arena  ·  default Kevin"
            options={[
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
              { label: 'Tank', value: 'tank' },
            ]}
            value={caddieAssignments.play}
            onSelect={(v) => setCaddieForPillar('play', v as 'kevin' | 'serena' | 'harry' | 'tank')}
          />

          <TouchableOpacity onPress={resetCaddieAssignments} style={styles.linkBtn}>
            <Text style={[styles.linkBtnText, { color: colors.accent }]}>Reset to defaults</Text>
          </TouchableOpacity>

          {/* Phase 106 — caddie team handoff suggestions */}
          <PillRow
            label="Team suggestions  ·  default On"
            options={[
              { label: 'On', value: 'on' },
              { label: 'Card only', value: 'soft' },
              { label: 'Off', value: 'off' },
            ]}
            value={caddieSuggestions}
            onSelect={(v) => setCaddieSuggestions(v as 'on' | 'soft' | 'off')}
          />
          <Text style={[styles.sectionIntro, { color: colors.text_muted, marginTop: 4 }]}>
            When a teammate is better suited, your active caddie can suggest a handoff. &quot;Card only&quot; shows the visual offer without a voice line. &quot;Off&quot; disables suggestions entirely.
          </Text>

          {/* Phase 107 — GPS quality debug overlay (dev / Tim only by default) */}
          <PillRow
            label="GPS quality overlay (dev)  ·  default Off"
            options={[
              { label: 'Off', value: 'off' },
              { label: 'On', value: 'on' },
            ]}
            value={gpsQualityDebugOverlay ? 'on' : 'off'}
            onSelect={(v) => setGpsQualityDebugOverlay(v === 'on')}
          />
          <Text style={[styles.sectionIntro, { color: colors.text_muted, marginTop: 4 }]}>
            Top-left badge during a round showing live accuracy + GPS mode + outlier count. Use during the Garmin comparison test.
          </Text>

          {/* 2026-06-10 — caddie persona controls merged in from the old
              "{caddieName}'s Voice" card so every caddie setting lives here. */}
          <Text style={[styles.sectionIntro, { color: colors.text_muted, marginTop: 8 }]}>
            Manually override the active caddie (the team auto-selects per pillar — this picks who speaks right now).
          </Text>
          <PillRow
            label="Active Caddie"
            options={[
              { label: 'Kevin', value: 'kevin' },
              { label: 'Serena', value: 'serena' },
              { label: 'Tank', value: 'tank' },
            ]}
            value={caddiePersonality}
            onSelect={(v) => setCaddiePersonality(v as 'kevin' | 'serena' | 'harry' | 'tank')}
          />

          <PillRow
            label="Response Style"
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
            label="Greet me on launch"
            sub={`${caddieName} says hello when you open the app`}
            value={kevinGreetingEnabled}
            onValueChange={confirmToggle('Launch Greeting', setKevinGreetingEnabled)}
          />

        </CollapsibleSection>

        {/* ROUND EXPERIENCE */}
        <CollapsibleSection title="Round Experience" icon="flag-outline">
          {/* 2026-05-19 — trust slider moved INLINE here. Was a routed
              sub-screen at /settings/trust-level that created the
              settings-within-settings pattern Tim called out. The full
              slider + descriptions now render directly in this card. */}
          <View style={[styles.trustBlock, { borderBottomColor: colors.border }]}>
            <Text style={labelStyle}>{caddieName}&apos;s presence</Text>
            <Text style={[subStyle, { marginBottom: 10 }]}>How present should {caddieName} be during your round?</Text>
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
            label="Skip Pre-Round Briefing"
            sub={`Go straight to the round without ${caddieName}'s intro`}
            value={skip_briefings}
            onValueChange={confirmToggle('Skip Pre-Round Briefing', setSkipBriefings)}
          />
          <ToggleRow
            label={`Proactive ${caddieName}`}
            sub={`${caddieName} speaks up between holes — streaks, patterns, ghost updates`}
            value={proactive_kevin_enabled}
            onValueChange={confirmToggle(`Proactive ${caddieName}`, setProactiveKevinEnabled)}
          />
          <ToggleRow
            label="Riding in a cart"
            sub="Tunes shot detection for cart play — shorter at-ball pause, suppresses only while the cart is moving (not for ~12s after it stops). Walking default is more conservative."
            value={cartMode}
            onValueChange={confirmToggle('Cart Mode', setCartMode)}
          />
          <ToggleRow
            label="Auto Hole Advance"
            sub="Advances to the next hole automatically as GPS moves you to the next tee. On by default — turn off to step through holes yourself."
            value={autoHoleAdvance}
            onValueChange={confirmToggle('Auto Hole Advance', setAutoHoleAdvance)}
          />
          <ToggleRow
            label="Auto Shot Detection"
            sub="GPS auto-logs each shot's location during the round. Off by default — manual entry (stepper or voice) is the safe default; auto-detect can over-count strokes on cart rounds. Advanced."
            value={autoShotDetection}
            onValueChange={confirmToggle('Auto Shot Detection', setAutoShotDetection)}
          />
        </CollapsibleSection>

        {/* VOICE */}
        {/* 2026-06-04 — "Voice Enabled" toggle removed. Voice presence is
            controlled via the Trust spectrum (L1 Quiet = Cockpit + tap-to-talk,
            L2 Companion = reactive, L3 Active = volunteers). voiceEnabled
            field stays in the store as an internal kill switch. */}
        <CollapsibleSection title="Voice & Conversation" icon="mic-outline">
          {/* 2026-05-30 — Fix FY: Local Mode toggle. Conservation +
              stability mode — proactive speech off, brain calls pinned
              to Haiku (the cheapest/fastest tier), navigation intents
              resolved locally. GPS, yardage, scorecard untouched.
              Honest framing in the sub-line — not a warning. */}
          <ToggleRow
            label="Local Mode"
            sub={`Conserves battery + handles weak signal cleanly. ${caddieName} only speaks when you ask. Tap-to-talk uses the fastest brain. GPS + yardages unchanged.`}
            value={localMode}
            onValueChange={confirmToggle('Local Mode', setLocalMode)}
          />
          <ToggleRow
            label="Active Listening"
            sub={`${caddieName} listens automatically during rounds. Just talk. Tap the pill on the Caddie tab to mute, or say "${caddieName}, turn off active listening".`}
            value={autoListenEnabled}
            onValueChange={confirmToggle('Active Listening', setAutoListenEnabled)}
          />
          {/* 2026-05-26 — Fix BE: Cecily Mode toggle. When on, the
              caddie answers ANY topic in age-appropriate kid-friendly
              language (Cecily is Tim's granddaughter, bilingual EN/ES).
              Opt-in only; adults using the app are unaffected when off.
              Explicit toggle (not name-detection) so the other family
              members (Bea, Lily, Daniella) don't trip it. */}
          <ToggleRow
            label="Cecily Mode"
            sub={`Kid-friendly free-topic chat for Cecily Rose. ${caddieName} answers any question in warm, simple language. Honors the active language setting.`}
            value={cecilyMode}
            onValueChange={confirmToggle('Cecily Mode', setCecilyMode)}
          />
          {/* 2026-05-26 — Fix AP Phase 2: continuous-conversation
              opt-in toggle. Default off. Safety rails inside the
              loop: 6-turn cap + 120s wall-clock cap + close-intent
              gate + silence-twice cap. Useful for sustained chats
              ("teach me about lag") without re-tapping the mic. */}
          <ToggleRow
            label="Continuous Conversation"
            sub={`${caddieName} keeps the mic open between turns so you can talk back without re-tapping. Caps at 6 turns or 2 minutes per session. Say "I'm good" any time to end.`}
            value={continuousConversationMode}
            onValueChange={confirmToggle('Continuous Conversation', setContinuousConversationMode)}
          />
          {/* 2026-05-19 — the "Earbud Tap-to-Talk · Coming soon" row
              moved to the Connected Hardware section below where all
              not-yet-wired hardware integrations are listed together
              with honest copy. Voice section now only carries actually-
              live voice settings. */}
          <ToggleRow
            label="Voice on Phone Speaker"
            sub={`Allow ${caddieName}'s voice when no earbuds are connected`}
            value={voiceOnPhoneSpeaker}
            onValueChange={confirmToggle('Voice on Phone Speaker', setVoiceOnPhoneSpeaker)}
          />
          {/* 2026-06-10 — Caption moved here from Display (it's about caddie
              speech, and was the only "voice" thing living under Display). */}
          <ToggleRow
            label="Caption caddie speech"
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
        <CollapsibleSection title="Language & Display" icon="desktop-outline">

          {/* 2026-06-10 — Language moved here from the caddie-voice card: it's
              app-wide (and people look for it under display/language, not voice). */}
          <PillRow
            label="Language"
            options={[
              { label: 'English', value: 'en' },
              { label: 'Español', value: 'es' },
              { label: '中文', value: 'zh' },
            ]}
            value={language}
            onSelect={(v) => setLanguage(v as 'en' | 'es' | 'zh')}
          />
          <Text style={[styles.helperText, { color: colors.text_muted, marginTop: -4, marginBottom: 8 }]}>
            Changes your caddie&apos;s voice + responses now. On-screen text is still being translated and stays in English for the moment.
          </Text>

          <PillRow
            label="Theme"
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
            value={theme_preference}
            onSelect={(v) => setThemePreference(v as 'system' | 'light' | 'dark')}
          />

          <ToggleRow
            label="High Contrast"
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
            label="Screenshot mode (hide top bar)"
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
            label="Large Text"
            sub="Bigger captions and briefing text — helpful in bright sun or for low-vision users"
            value={largeText}
            onValueChange={setLargeText}
          />

          <ToggleRow
            label="Simple briefing"
            sub={
              simpleBriefingUserTouched
                ? 'One card at a time, slower pacing. Larger text on the briefing screen.'
                : 'Auto-on for your first 5 rounds. One card at a time, slower pacing.'
            }
            value={simpleBriefing}
            onValueChange={setSimpleBriefing}
          />
          <ToggleRow
            label="Tank soft-intro"
            sub="Tank drops Marine cadence for his first three turns with you, then unlocks. Auto-clears after one full round."
            value={tankSoftIntro}
            onValueChange={setTankSoftIntro}
          />

          {/* PER-PERSONA INTENSITY DIAL — slider per caddie. Default Tank=70,
              Harry=90, Kevin/Serena=100. */}
          {ACTIVE_PERSONAS.map((p, idx, arr) => {
            // 2026-06-06 — Display the user's chosen custom caddie name
            // here instead of the static "My Caddie" fallback. Also
            // belt-and-suspenders `?? 100` for personaIntensity reads
            // in case a hydrated payload missed the v11 seed.
            const customName = p === 'custom'
              ? (usePlayerProfileStore.getState().customCaddieName ?? 'My Caddie')
              : null;
            const displayName = customName ?? getCaddieName(p);
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
            label="Distance Unit"
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
        <CollapsibleSection title="Devices & Health" icon="watch-outline">
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>
                Galaxy Watch swing capture{watchBridgeAvailable ? '' : ' · needs latest build'}
              </Text>
              <Text style={subStyle}>
                {watchBridgeAvailable
                  ? `Streams swing tempo + club speed from the watch's motion sensor into Smart Motion as a truth-grade reading.${watchConnected ? ' Watch connected.' : ' Open the SmartPlay watch app on your Galaxy Watch to start sending.'}`
                  : 'The watch swing-capture module ships in the latest native build — install it, then this turns on.'}
              </Text>
            </View>
            <Switch
              value={watchSwingEnabled}
              onValueChange={(v) => {
                setWatchSwingEnabled(v);
                if (v) void initWatchSwingBridge().catch(() => {});
                else void stopWatchSwingBridge().catch(() => {});
              }}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
              disabled={!watchBridgeAvailable}
            />
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Health Connect heartbeat</Text>
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
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Earbud / BT remote tap</Text>
              <Text style={subStyle}>
                Off by default to reduce startup risk. Turn it on only if you want to test tap-to-talk with a build that has a native media-key listener.
              </Text>
            </View>
            <Switch
              value={earbudTapToTalk}
              onValueChange={confirmToggle('Earbud tap-to-talk', setEarbudTapToTalk)}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#ffffff"
            />
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Ray-Ban Meta temple tap · Blocked</Text>
              <Text style={subStyle}>
                Meta has not exposed an SDK that lets third-party apps subscribe to the glasses&apos; touchpad / temple-tap events. Until that ships, glasses-as-mic + Active Listening is the path: pair the glasses for Bluetooth audio and the caddie hears you hands-free.
              </Text>
            </View>
          </View>
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
            accessibilityLabel="Import Meta glasses voice log"
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>Import Meta glasses voice log</Text>
              <Text style={subStyle}>
                Pick a Meta View JSON export of your &quot;Hey Meta&quot; voice exchanges. We match each one to the hole you were on so {caddieName} can recall what the glasses said during this round. Start a round first — only exchanges inside the active round&apos;s window are imported.
              </Text>
            </View>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />
          </TouchableOpacity>
          {/* 2026-06-10 — Health Data merged into "Devices & Health" (both are
              external integrations). Master toggle for the Health Connect
              integration + an explicit re-ask button if permissions were
              declined earlier. (Data & Privacy relocated just below.) */}
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Use Health Connect during rounds</Text>
              <Text style={subStyle}>
                Reads step count, heart rate, distance walked, and active calories during your round (Galaxy Watch, Fitbit, or phone pedometer via Android Health Connect). Used for the walking-vs-cart detector, automatic shot detection, and round-summary stats. All data stays on your phone unless you opt into backend sync. Android only today; iOS / HealthKit comes later.
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
                    'steps', 'distance', 'heartRate', 'exercise', 'activeCalories',
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
            accessibilityLabel="Connect Health Data"
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>Connect Health Data</Text>
              <Text style={subStyle}>
                Tap to grant SmartPlay read access to your Health Connect data (steps, heart rate, distance, calories). Required for the walking-vs-cart detector to use real step counts. If you skip this, cart/walk detection still works using GPS + your manual Cart Mode toggle.
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
            The redundant "Edit Profile →" route to /welcome was leftover
            from a prior flow and contributed to Tim's settings-within-
            settings fatigue. The /welcome single-screen onboarding is
            still reachable via Reset App Data → relaunch for users who
            need the guided re-do. */}

        {/* 2026-06-08 (audit #2, privacy) — plain-language disclosure of what
            leaves the device and where. Relocated below Devices & Health in the
            2026-06-10 settings cleanup. */}
        {/* 2026-07-01 — Cloud Backup & Sync (email OTP). Self-contained card so a
            phone swap never wipes the player's data. Sits just above Data & Privacy. */}
        {sectionMatchesQuery('Cloud Backup & Sync', 'backup restore sync cloud account email') ? <CloudBackupCard /> : null}

        <CollapsibleSection title="Data & Privacy" icon="shield-outline">
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>What we send for AI coaching</Text>
              <Text style={subStyle}>
                When you talk to your caddie, we send your message plus your first name, handicap, and (if set) GHIN to the AI service that powers the coaching, so the advice is personalized. We send your GPS location to a weather service to factor wind and temperature into yardages. We don’t sell your data.
              </Text>
            </View>
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Stored on this phone</Text>
              <Text style={subStyle}>
                Your rounds, scores, swing clips, bag distances, and profile live on this device. Your GHIN number is kept in memory for the session only — it isn’t written to disk — until encrypted-at-rest storage ships.
              </Text>
            </View>
          </View>
          {/* 2026-06-24 — Off-device data layer Phase A: anonymous usage
              telemetry. OPT-IN, default OFF. Honest copy: anonymous, no
              fingerprint, isolated from any other data, off unless you turn
              it on. Helps Tim see which features get used. */}
          <ToggleRow
            label="Help improve SmartPlay"
            sub="Share anonymous usage (which features you use — never your name, scores, or location). A random ID, not a device fingerprint. Off by default; turn off any time."
            value={analyticsOptIn}
            onValueChange={confirmToggle('Anonymous usage sharing', setAnalyticsOptIn)}
          />
        </CollapsibleSection>

        {/* Phase AI — Help / Support section. Single canonical contact. */}
        <CollapsibleSection title="Help & About" icon="help-circle-outline">
          {/* Phase 411 — Quick Start Guide. Same content as the PDF
              tester guide, available in-app so testers can refer back
              during use without hunting for the email attachment. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/quick-start' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open the Quick Start Guide"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Quick Start Guide</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              How to use the app →
            </Text>
          </TouchableOpacity>
          {/* 2026-06-11 — Round import moved to its proper home: the Profile
              screen (alongside handicap index + GHIN). This Help row now just
              routes there so the old entry point still lands somewhere useful. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel="Import past rounds from your Profile"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Import Past Rounds</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              In Profile · history + handicap →
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
            accessibilityLabel="Open Family Coaching"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Family Coaching</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              Roster + Swing Library →
            </Text>
          </TouchableOpacity>
          {/* 2026-06-30 (Tim) — minimal in-app messaging (Tim ↔ Tank to start). */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/messages' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open Messages"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Messages</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              Message a golfer →
            </Text>
          </TouchableOpacity>
          {/* 2026-05-22 — Captain extension. Surfaces Team Captain mode
              for high-school golfers (e.g. Heritage HS Romoland CA)
              managing teammates + coach contacts. Same store, distinct
              screen, voice flows reused. */}
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/family/captain' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open Team Captain"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Team Captain</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              Teammates + Coaches →
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
                  'Email',
                  'Could not open your email client. Reach support at support@smartplaycaddie.com',
                );
              });
            }}
            accessibilityRole="button"
            accessibilityLabel="Share feedback with the SmartPlay Caddie team"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Share Feedback</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              Email with prompts pre-filled →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => {
              const url = 'mailto:support@smartplaycaddie.com?subject=' +
                encodeURIComponent('SmartPlay Caddie Pro Support Request');
              Linking.openURL(url).catch(() => {
                Alert.alert(
                  'Email',
                  'Could not open your email client. Reach support at support@smartplaycaddie.com',
                );
              });
            }}
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Contact Support</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              support@smartplaycaddie.com →
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
                  'Privacy Policy',
                  'Couldn\'t open the browser. Visit smartplaycaddie.com/privacy from any browser.',
                );
              });
            }}
            accessibilityRole="button"
            accessibilityLabel="Open privacy policy"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Privacy Policy</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              smartplaycaddie.com/privacy →
            </Text>
          </TouchableOpacity>

          {/* 2026-06-10 — About merged into Help & About. */}
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>App</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>SmartPlay Caddie Pro</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Version</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>2.0.0</Text>
          </View>
          {/* 2026-07-01 (Tim) — live OTA bundle stamp so you can confirm you're on the current
              update before judging a fix (OTA lands on cold start; this proves which one you have). */}
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Update</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]} selectable>{buildStamp}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Caddie</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>
              {caddieName}
            </Text>
          </View>
          {/* 2026-05-24 v1.2 — Company attribution. Built by SmartPlay
              AI (the company). All four caddies (Kevin / Serena / Tank
              / Harry) are equal personas — none is "the face" in the
              About row. Tank is named only where his feature scope
              requires it (ask_golf_father). */}
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Built by</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>SmartPlay AI</Text>
          </View>
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

          {/* 2026-06-10 — Beta Feedback (Issue Log) merged into Help & About.
              Issue Log captures voice ("log this: ...") + Export mails the list
              to support@smartplaycaddie.com. Owner gets the Claude triage button
              inside the log itself. */}
          <TouchableOpacity
            style={styles.resetRow}
            onPress={() => router.push('/owner-logs' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open Issue Log"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Issue Log</Text>
              <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                Say &quot;{caddieName}, log this: ...&quot; to capture an issue.
                Tap to review + export the log to support@smartplaycaddie.com.
              </Text>
            </View>
            <Ionicons name="bug-outline" size={20} color={colors.text_muted} />
          </TouchableOpacity>

          {/* 2026-05-25 — Fix AI: Coach Knowledge entry. Same Beta
              Feedback section so coaches (Marc/Tank) can find their
              "remember this" captures and export them to Tim. */}
          <TouchableOpacity
            style={styles.resetRow}
            onPress={() => router.push('/coach-knowledge' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open Coach Knowledge"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Coach Knowledge</Text>
              <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                Coach refinements saved via &quot;remember this&quot; voice trigger.
                Per-entry + bulk export to support@smartplaycaddie.com.
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
                <CollapsibleSection title="Owner Tools" icon="construct-outline">
                  {/* 2026-05-24 v1.2.1 — Glasses Mode toggle. Pre-
                      configures the audio session for background
                      Bluetooth so Tank's voice routes to Ray-Ban Meta
                      glasses when paired. Persisted on settingsStore.
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
                      an owner/instructor surface Tim can point Tank to. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/author/reference-assets' as never)}
                    accessibilityRole="button"
                    accessibilityLabel="Open Train the Trainer reference authoring"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Train the Trainer</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Capture example photos + narrative for fault references (open face, over-the-top, etc.) that train the analysis.
                      </Text>
                    </View>
                    <Ionicons name="school-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-05-24 — Feel Capture toggle. When ON, every
                      cage swing's clip audio is transcribed via
                      Whisper and stored as feel_narration_transcript
                      paired with perShotAnalysis. Owner-only dataset
                      for future feel-vs-real calibration. Doubly
                      gated (flag + isOwnerEmail) — never fires for
                      production users. Review tuples at /cage-debug. */}
                  <FeelCaptureRow colors={colors} />
                  <VoiceHitRateRow colors={colors} />

                  {/* 2026-06-16 (Tim — "issue log + harness should be in owner
                      tools") — Issue Log restored HERE in Owner Tools (it also
                      still lives in the public Beta Feedback section above, but Tim
                      expects it alongside the harness). Owner triage lives inside. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/owner-logs' as never)}
                    accessibilityRole="button"
                    accessibilityLabel="Open Issue Log"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Issue Log</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Logged issues (voice &quot;log this: …&quot; + manual). Owner Claude-triage + export inside.
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
                    accessibilityLabel="View scenario harness"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Scenario Harness</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        17 scenarios (9 critical + 5 high-value + 3 nice-to-have) — exercises real stores via the production voice router.
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
                    accessibilityLabel="View voice misses log"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Voice Misses</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Phrasings that didn&apos;t match a handler. Tank&apos;s testing surfaces the gaps here for review.
                      </Text>
                    </View>
                    <Ionicons name="mic-off-outline" size={20} color={colors.text_muted} />
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
                    accessibilityLabel="View swing analysis telemetry"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Swing Analysis Telemetry</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Last swing: frames sent vs. server image blocks. PASS proves the multi-frame pipe end-to-end.
                      </Text>
                    </View>
                    <Ionicons name="film-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  {/* 2026-05-24 — Reset Tutorials. Clears every
                      tutorialsSeen flag so the standardized 3-line
                      first-run tutorial replays on next entry of
                      every feature screen (Caddie / SwingLab /
                      SmartMotion / Quick Record / Cage / Coach).
                      Owner test path for the QuickTutorial system. */}
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => {
                      Alert.alert(
                        'Reset Tutorials',
                        'Every first-run tutorial will replay on next entry. Continue?',
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
                    accessibilityLabel="Reset all first-run tutorials"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Reset Tutorials</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Replay every feature&apos;s 3-line first-run tutorial on next entry. Owner test path.
                      </Text>
                    </View>
                    <Ionicons name="refresh-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/gps-test' as never)}
                    accessibilityRole="button"
                    accessibilityLabel="Open GPS Test Bench"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>GPS Test Bench</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Drop an anchor at your current position, walk, watch the yards tick.
                        Use this in a parking lot to verify GPS independent of course geometry.
                      </Text>
                    </View>
                    <Ionicons name="locate-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/kevin-learning' as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${caddieName} learning log`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{caddieName} Learning</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Vocabulary {caddieName} has picked up from your shot phrasing. Review entries, correct miscoded meanings.
                      </Text>
                    </View>
                    <Ionicons name="library-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/mark-green' as never)}
                    accessibilityRole="button"
                    accessibilityLabel="Open Mark Location tool"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Mark Location</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Walk to a tee box OR green center and capture its real GPS coords. Toggle inside picks which one. Fixes yardages for any hole shipping with placeholder data.
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
        <CollapsibleSection title="Reset" icon="refresh-outline">
          <TouchableOpacity
            style={styles.resetRow}
            accessibilityRole="button"
            accessibilityLabel="Reset all app data and start fresh"
            onPress={() => {
              Alert.alert(
                'Reset App Data',
                'This clears your profile, round history, settings, cage sessions, and saved swings. Your installed app stays — you start fresh on next open. Continue?',
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
                          'Reset complete',
                          'Force-close the app (swipe out of recents) and reopen to start fresh.',
                          [{ text: 'OK' }],
                        );
                      } catch (e) {
                        Alert.alert('Reset failed', e instanceof Error ? e.message : String(e));
                      }
                    },
                  },
                ],
              );
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: '#f87171' }]}>Reset App Data</Text>
              <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                Clear your profile, rounds, settings, and saved swings. Use this to start fresh.
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
      }}>Developer Tools (dev build)</Text>

      <View style={cardStyle}>
        <Text style={{ color: colors.text_primary, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
          Simulated GPS Walk
        </Text>
        <Text style={{ color: colors.text_muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
          Replaces the real GPS source with a pre-built waypoint trace. Use to verify hole detection + distance calculations without driving to a course. Console logs every waypoint reached.
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
                ● SIM ACTIVE
              </Text>
              {walkState ? (
                <>
                  <Text style={{ color: colors.text_primary, fontSize: 12, marginTop: 6 }}>
                    Waypoint {walkState.waypoint_index + 1} · {(walkState.fraction_through * 100).toFixed(0)}% through
                  </Text>
                  <Text style={{ color: colors.text_muted, fontSize: 11, marginTop: 2 }}>
                    {walkState.current_lat.toFixed(5)}, {walkState.current_lng.toFixed(5)}
                  </Text>
                  {walkState.next_label && (
                    <Text style={{ color: colors.text_muted, fontSize: 11, marginTop: 2 }}>
                      Next: {walkState.next_label}
                    </Text>
                  )}
                </>
              ) : null}
            </View>
            <TouchableOpacity
              style={{ backgroundColor: colors.surface_elevated, borderColor: colors.error, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              onPress={() => stopSimulatedWalk()}
            >
              <Text style={{ color: colors.error, fontSize: 13, fontWeight: '800' }}>Stop Simulated Walk</Text>
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
        [
          { text: 'Got it', style: 'default' },
          {
            text: 'Watch Tutorial',
            onPress: () => Linking.openURL('https://smartplaygolf.com/glasses-setup').catch(() => {}),
          },
        ],
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
 * /cage-debug viewer surfaces the captured data.
 *
 * Defense-in-depth: the service ALSO checks isOwnerEmail at the call
 * site, so a leaked persisted flag from a previous account doesn't
 * accidentally fire transcription on a non-owner's audio.
 */
// 2026-06-16 (Tim — self-growing agent metric) — the local-first health metric:
// what share of spoken asks the caddie answered ON-DEVICE (instant/offline/0-token)
// vs escalated to the cloud. Should trend UP as the CNS brain grows. Tap to reset.
function VoiceHitRateRow({ colors }: { colors: ThemeColors }) {
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
          'Reset voice hit-rate?',
          `Local ${pct}% — ${local} on-device / ${cloud} cloud (${total} asks).`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => reset() },
          ],
        )
      }
      accessibilityRole="button"
      accessibilityLabel="Voice local hit-rate; tap to reset"
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Voice Local Hit-Rate</Text>
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
  const feelCaptureEnabled = useSettingsStore((s) => s.feelCaptureEnabled);
  const setFeelCaptureEnabled = useSettingsStore((s) => s.setFeelCaptureEnabled);
  return (
    <View style={[styles.resetRow, { marginBottom: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Feel Capture (dev)</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]}>
          Transcribe each swing&apos;s clip audio + pair with the analysis. Owner-only — never fires on production users. Review tuples at /cage-debug.
        </Text>
        {feelCaptureEnabled && (
          <Text style={[styles.rowSub, { color: colors.accent, marginTop: 6 }]}>
            ✓ Active — capturing on every cage swing
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
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const setAiProvider = useSettingsStore((s) => s.setAiProvider);
  const isOpenAI = aiProvider === 'openai';
  return (
    <View style={[styles.resetRow, { marginBottom: 8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>AI Brain Provider</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]}>
          {isOpenAI
            ? 'OpenAI (gpt-4o / gpt-4o-mini) — strong reasoning, single vendor.'
            : 'Gemini 2.5 Flash — fastest vision path, Google Search grounding.'}
          {'\n'}TTS and STT always use OpenAI regardless of this setting.
        </Text>
        <Text style={[styles.rowSub, { color: colors.accent, marginTop: 4 }]}>
          Active: {isOpenAI ? 'OpenAI' : 'Gemini'}
        </Text>
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
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
  },
});
