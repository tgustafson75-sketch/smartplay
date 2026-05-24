import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';
// 2026-05-21 — Consolidation 1 / Merge C: watch-connected display
// reads from the dedicated watchStore so all three call sites
// (cage-mode, cage/summary, settings) share one source of truth.
import { useWatchStore } from '../store/watchStore';
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';
import { useToastStore } from '../store/toastStore';
import { useTrustLevelStore, TRUST_LEVEL_META, TRUST_LEVEL_SLIDER_ORDER } from '../store/trustLevelStore';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import type { ThemeColors } from '../theme/tokens';
import { getCaddieName, ACTIVE_PERSONAS } from '../lib/persona';
import { clearMicDenial } from '../services/voicePermissionService';
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

  const {
    voiceEnabled,
    language,
    discreteMode,
    responseMode,
    castMode,
    highContrast,
    autoListenEnabled,
    cartMode,
    skip_briefings,
    proactive_kevin_enabled,
    distance_unit,
    theme_preference,
    fillerEnabled,
    // Phase AC — earbudTapToTalk + setEarbudTapToTalk intentionally
    // dropped from this destructure. The toggle is rendered as a disabled
    // "Coming soon" row because no native media-key listener exists in the
    // build (track-player was removed; see services/mediaKeyBridge.ts).
    voiceOnPhoneSpeaker,
    kevinGreetingEnabled,
    cageAutoClubDetection,
    setCageAutoClubDetection,
    setVoiceOnPhoneSpeaker,
    setKevinGreetingEnabled,
    setVoiceEnabled,
    setLanguage,
    setDiscreteMode,
    setResponseMode,
    setCastMode,
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
    setFillerEnabled,
  } = useSettingsStore();

  // Watch-connected status for the disabled "Galaxy Watch · Not wired"
  // display row. Reads from the dedicated watchStore — stays false
  // until the native SDK lands and flips it.
  const watchConnected = useWatchStore((s) => s.isConnected);

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
    handicap,
    dominantMiss,
    physicalLimitation,
    goal,
    personalBest,
    preferredTee,
    setName,
    setHandicap,
    setDominantMiss,
    setPhysicalLimitation,
    setGoal,
    setPersonalBest,
    setPreferredTee,
  } = usePlayerProfileStore();

  const [editName, setEditName] = useState(name);
  const [editHandicap, setEditHandicap] = useState(String(handicap));
  const [editGoal, setEditGoal] = useState(goal ?? '');
  const handicapIndex = usePlayerProfileStore(s => s.handicap_index);
  const setHandicapIndex = usePlayerProfileStore(s => s.setHandicapIndex);
  const [editIndex, setEditIndex] = useState(handicapIndex != null ? String(handicapIndex) : '');
  const [editLimitation, setEditLimitation] = useState(physicalLimitation ?? '');
  const [editBest, setEditBest] = useState(personalBest ? String(personalBest) : '');

  const handleSaveProfile = () => {
    if (editName.trim()) setName(editName.trim());
    const hcp = parseInt(editHandicap, 10);
    if (!isNaN(hcp)) setHandicap(Math.min(54, Math.max(0, hcp)));
    setGoal(editGoal.trim() || null);
    setPhysicalLimitation(editLimitation.trim() || null);
    const best = parseInt(editBest, 10);
    setPersonalBest(!isNaN(best) ? best : null);
    setProfileExpanded(false);
    Alert.alert('Saved', 'Profile updated.');
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
  const CollapsibleSection = ({ title, children }: { title: string; children: React.ReactNode }) => {
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
          <Text style={[styles.collapsibleHeaderText, { color: open ? colors.accent : colors.text_primary }]}>
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
      <ScrollView
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
              <Ionicons name="pencil-outline" size={16} color={colors.accent} />
            </TouchableOpacity>
          </View>
        ) : (
        <View style={cardStyle}>

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
        <CollapsibleSection title="Caddie Team">
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
        </CollapsibleSection>

        {/* CADDIE — extra controls */}
        <CollapsibleSection title={`${caddieName}'s Voice`}>
          <Text style={[styles.sectionIntro, { color: colors.text_muted }]}>
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
            label="Language"
            options={[
              { label: 'English', value: 'en' },
              { label: 'Español', value: 'es' },
              { label: '中文', value: 'zh' },
            ]}
            value={language}
            onSelect={(v) => setLanguage(v as 'en' | 'es' | 'zh')}
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
        <CollapsibleSection title="Round Experience">
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
            label="Voice Filler"
            sub={`${caddieName} fills the pause while thinking — 'let me see', 'hmm...'`}
            value={fillerEnabled}
            onValueChange={confirmToggle('Voice Filler', setFillerEnabled)}
          />
          <ToggleRow
            label="Riding in a cart"
            sub="Tunes shot detection for cart play — shorter at-ball pause, suppresses only while the cart is moving (not for ~12s after it stops). Walking default is more conservative."
            value={cartMode}
            onValueChange={confirmToggle('Cart Mode', setCartMode)}
          />
        </CollapsibleSection>

        {/* VOICE */}
        <CollapsibleSection title="Voice">
          <ToggleRow
            label="Voice Enabled"
            sub={`${caddieName} speaks responses aloud`}
            value={voiceEnabled}
            onValueChange={confirmToggle('Voice', (v) => {
              setVoiceEnabled(v);
              // Phase A.4: re-enabling voice clears any prior mic denial so prompts
              // resume in subsequent rounds.
              if (v) clearMicDenial();
            })}
          />
          <ToggleRow
            label="Discrete Mode"
            sub="Haptic only — no audio"
            value={discreteMode}
            onValueChange={confirmToggle('Discrete Mode', setDiscreteMode)}
          />
          <ToggleRow
            label="Active Listening"
            sub={`${caddieName} listens automatically during rounds. Just talk. Tap the pill on the Caddie tab to mute, or say "${caddieName}, turn off active listening".`}
            value={autoListenEnabled}
            onValueChange={confirmToggle('Active Listening', setAutoListenEnabled)}
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
        </CollapsibleSection>

        {/* PRACTICE — Phase BL */}
        <CollapsibleSection title="Practice">
          <ToggleRow
            label="Auto Club Detection"
            sub={'Show the camera button in cage sessions to read the number stamped on a club’s sole. Voice ("switching to 6-iron") and the manual picker still work either way.'}
            value={cageAutoClubDetection}
            onValueChange={setCageAutoClubDetection}
          />
        </CollapsibleSection>

        {/* 2026-05-19 — single-row "Caddie ${caddieName}" section folded
            into the Caddie's Voice card above. The "Greet me on launch"
            toggle now lives there alongside the other persona controls.
            Reduces section count + colocates related settings. */}

        {/* DISPLAY & ACCESSIBILITY (combined 2026-05-19 — the two cards
            below used to live under separate "Display" and
            "Accessibility & Pacing" headers; merged into one header
            since both control how you SEE or HEAR the app. */}
        <CollapsibleSection title="Display & Accessibility">

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
            label="Cast Mode"
            sub="Mirror to TV or display"
            value={castMode}
            onValueChange={setCastMode}
          />
          <ToggleRow
            label="High Contrast"
            sub="Pure black/white backgrounds + stronger borders for sunlight readability"
            value={highContrast}
            onValueChange={setHighContrast}
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
            label="Caption caddie speech"
            sub="Show what the caddie is saying on screen during voice playback. Auto-on for Bluetooth audio."
            value={ttsCaptions}
            onValueChange={setTtsCaptions}
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
          {ACTIVE_PERSONAS.map((p, idx, arr) => (
            <View
              key={p}
              style={[
                styles.row,
                idx < arr.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>{getCaddieName(p)}</Text>
                <Text style={subStyle}>
                  {`Volume + cadence (${personaIntensity[p]}/100). Lower = quieter, fewer signature phrases.`}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setPersonaIntensity(p, Math.max(0, personaIntensity[p] - 10))}
                  style={[styles.intensityStep, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Lower ${getCaddieName(p)} intensity`}
                >
                  <Text style={[styles.intensityStepText, { color: colors.text_primary }]}>−</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPersonaIntensity(p, Math.min(100, personaIntensity[p] + 10))}
                  style={[styles.intensityStep, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Raise ${getCaddieName(p)} intensity`}
                >
                  <Text style={[styles.intensityStepText, { color: colors.text_primary }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

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
        <CollapsibleSection title="Connected Hardware">
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Samsung Galaxy Watch · Not wired</Text>
              <Text style={subStyle}>
                Samsung Health SDK integration is a native module that ships in a future APK build. The toggle is parked in simulation mode for dev testing only — it does not pull real tempo / club-speed data from your watch today.
              </Text>
            </View>
            <Switch
              value={watchConnected}
              onValueChange={() => {}}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
              disabled
            />
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Earbud / BT remote tap · Not wired</Text>
              <Text style={subStyle}>
                Hardware play/pause press for tap-to-talk needs a native media-key listener (react-native-track-player or equivalent) that was stripped earlier for New-Arch compat. Requires a new APK build to re-enable.
              </Text>
            </View>
            <Switch
              value={false}
              onValueChange={() => {}}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
              disabled
            />
          </View>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Ray-Ban Meta temple tap · Blocked</Text>
              <Text style={subStyle}>
                Meta has not exposed an SDK that lets third-party apps subscribe to the glasses' touchpad / temple-tap events. Until that ships, glasses-as-mic + Active Listening is the path: pair the glasses for Bluetooth audio and the caddie hears you hands-free.
              </Text>
            </View>
          </View>
        </CollapsibleSection>

        {/* 2026-05-17 — Phase 413 — Health Data privacy section.
            Master toggle for the Health Connect integration plus an
            explicit re-ask button if the user wants to grant
            permissions after declining them earlier. */}
        <CollapsibleSection title="Health Data">
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

        {/* Phase AI — Help / Support section. Single canonical contact. */}
        <CollapsibleSection title="Help">
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
        </CollapsibleSection>

        <CollapsibleSection title="About">
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>App</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>SmartPlay Caddie Pro</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Version</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>2.0.0</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Caddie</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>
              {caddieName}
            </Text>
          </View>
        </CollapsibleSection>

        {/* 2026-05-17 — Owner-only Issue Log. Tim asked for a way to
            voice-capture app feedback during testing ("Kevin, log this:
            ..."). Surface shown only when the active profile email
            matches the owner allow-list (isOwnerEmail). Tappable row
            opens the log viewer at /owner-logs. */}
        {(() => {
          try {
            const profile = usePlayerProfileStore.getState();
            const showOwner = isOwnerEmail(profile.email);
            if (!showOwner) return null;
            return (
              <>
                <CollapsibleSection title="Owner Tools">
                  <TouchableOpacity
                    style={styles.resetRow}
                    onPress={() => router.push('/owner-logs' as never)}
                    accessibilityRole="button"
                    accessibilityLabel="View owner issue log"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Issue Log</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Say &quot;{caddieName}, log this: ...&quot; or &quot;report a bug: ...&quot; to capture feedback.
                        Tap to review the running log.
                      </Text>
                    </View>
                    <Ionicons name="bug-outline" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
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
                    accessibilityLabel="Open Mark Green tool"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.text_primary }]}>Mark Green</Text>
                      <Text style={[styles.rowSub, { color: colors.text_muted }]}>
                        Walk to a green center, capture its real GPS coords. Fixes yardages for any course that ships with placeholder data (Sunnyvale, SJ Muni).
                      </Text>
                    </View>
                    <Ionicons name="flag" size={20} color={colors.text_muted} />
                  </TouchableOpacity>
                </CollapsibleSection>
              </>
            );
          } catch { return null; }
        })()}

        {/* Reset / Sign Out — until real auth lands, this is the
            functional equivalent for testers who want to start fresh
            (new persona, clear stored profile, fresh trial state). */}
        <CollapsibleSection title="Reset">
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

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
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
