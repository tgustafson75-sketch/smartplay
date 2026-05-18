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
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';
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
    watchConnected,
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
    setWatchConnected,
    setAutoListenEnabled,
    setCartMode,
    setSkipBriefings,
    setProactiveKevinEnabled,
    setDistanceUnit,
    setThemePreference,
    setFillerEnabled,
  } = useSettingsStore();

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
    Alert.alert('Saved', 'Profile updated.');
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

        {/* PROFILE */}
        <SectionHeader title="Profile" />
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

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile}>
            <Text style={styles.saveBtnText}>Save Profile</Text>
          </TouchableOpacity>

        </View>

        {/* CADDIE TEAM — Phase 105 per-pillar assignments */}
        <SectionHeader title="Caddie Team" />
        <View style={cardStyle}>
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
        </View>

        {/* CADDIE — extra controls */}
        <SectionHeader title={`${caddieName}'s Voice`} />
        <View style={cardStyle}>
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

          <TouchableOpacity
            style={rowDivStyle}
            onPress={() => router.push('/kevin-learning' as never)}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>What {caddieName}&apos;s learning</Text>
              <Text style={subStyle}>Phrases {caddieName} has picked up from you</Text>
            </View>
            <Text style={[styles.rowSub, { color: colors.text_muted }]}>›</Text>
          </TouchableOpacity>

        </View>

        {/* ROUND EXPERIENCE */}
        <SectionHeader title="Round Experience" />
        <View style={cardStyle}>
          {/* Trust Spectrum entry — five modes (Quiet, Cockpit, Companion,
              Active, Full). Was previously only reachable from inside Cockpit,
              which made it impossible to find Cockpit in the first place. */}
          <TouchableOpacity
            style={rowDivStyle}
            onPress={() => router.push('/settings/trust-level' as never)}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={labelStyle}>{caddieName}&apos;s presence</Text>
              <Text style={subStyle}>Quiet · Cockpit · Companion · Active · Full</Text>
            </View>
            <Text style={[styles.rowSub, { color: colors.text_muted }]}>›</Text>
          </TouchableOpacity>

          <ToggleRow
            label="Skip Pre-Round Briefing"
            sub={`Go straight to the round without ${caddieName}'s intro`}
            value={skip_briefings}
            onValueChange={setSkipBriefings}
          />
          <ToggleRow
            label={`Proactive ${caddieName}`}
            sub={`${caddieName} speaks up between holes — streaks, patterns, ghost updates`}
            value={proactive_kevin_enabled}
            onValueChange={setProactiveKevinEnabled}
          />
          <ToggleRow
            label="Voice Filler"
            sub={`${caddieName} fills the pause while thinking — 'let me see', 'hmm...'`}
            value={fillerEnabled}
            onValueChange={setFillerEnabled}
          />
          <ToggleRow
            label="Riding in a cart"
            sub="Tunes shot detection for cart play — shorter at-ball pause, suppresses only while the cart is moving (not for ~12s after it stops). Walking default is more conservative."
            value={cartMode}
            onValueChange={setCartMode}
          />
        </View>

        {/* VOICE */}
        <SectionHeader title="Voice" />
        <View style={cardStyle}>
          <ToggleRow
            label="Voice Enabled"
            sub={`${caddieName} speaks responses aloud`}
            value={voiceEnabled}
            onValueChange={(v) => {
              setVoiceEnabled(v);
              // Phase A.4: re-enabling voice clears any prior mic denial so prompts
              // resume in subsequent rounds.
              if (v) clearMicDenial();
            }}
          />
          <ToggleRow
            label="Discrete Mode"
            sub="Haptic only — no audio"
            value={discreteMode}
            onValueChange={setDiscreteMode}
          />
          <ToggleRow
            label="Active Listening"
            sub={`${caddieName} listens automatically during rounds. Just talk. Tap the pill on the Caddie tab to mute, or say "${caddieName}, turn off active listening".`}
            value={autoListenEnabled}
            onValueChange={setAutoListenEnabled}
          />
          <ToggleRow
            label="Earbud Tap-to-Talk · Coming soon"
            sub={`OS-level Bluetooth media-key support is on the roadmap. For now, tap ${caddieName}'s badge on the Caddie tab to talk.`}
            value={false}
            onValueChange={() => {}}
            disabled
          />
          <ToggleRow
            label="Voice on Phone Speaker"
            sub={`Allow ${caddieName}'s voice when no earbuds are connected`}
            value={voiceOnPhoneSpeaker}
            onValueChange={setVoiceOnPhoneSpeaker}
          />
        </View>

        {/* PRACTICE — Phase BL */}
        <SectionHeader title="Practice" />
        <View style={cardStyle}>
          <ToggleRow
            label="Auto Club Detection"
            sub={'Show the camera button in cage sessions to read the number stamped on a club’s sole. Voice ("switching to 6-iron") and the manual picker still work either way.'}
            value={cageAutoClubDetection}
            onValueChange={setCageAutoClubDetection}
          />
        </View>

        {/* CADDIE */}
        <SectionHeader title={caddieName} />
        <View style={cardStyle}>
          <ToggleRow
            label="Greet me on launch"
            sub={`${caddieName} says hello when you open the app`}
            value={kevinGreetingEnabled}
            onValueChange={setKevinGreetingEnabled}
          />
        </View>

        {/* DISPLAY */}
        <SectionHeader title="Display" />
        <View style={cardStyle}>

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
        </View>

        {/* ACCESSIBILITY — captions, simpler briefings, and the
            per-persona intensity dial all live together so participants
            and pros can find them in one place. */}
        <SectionHeader title="Accessibility & Pacing" />
        <View style={cardStyle}>
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
        </View>

        {/* PER-PERSONA INTENSITY DIAL — slider per caddie. Default Tank=70,
            Harry=90, Kevin/Serena=100. Floor 0, ceiling 100. */}
        <SectionHeader title="Caddie Intensity" />
        <View style={cardStyle}>
          {/* Drives off ACTIVE_PERSONAS so dormant personas (Harry) don't
              show up here. The persisted intensity entry stays — see
              settingsStore migrate v6 — so re-enabling Harry restores
              his slider untouched. */}
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
        </View>

        {/* MEASUREMENT */}
        <SectionHeader title="Measurement" />
        <View style={cardStyle}>
          <PillRow
            label="Distance Unit"
            options={[
              { label: 'Yards', value: 'yards' },
              { label: 'Meters', value: 'meters' },
            ]}
            value={distance_unit}
            onSelect={(v) => setDistanceUnit(v as 'yards' | 'meters')}
          />
        </View>

        {/* GALAXY WATCH */}
        <SectionHeader title="Galaxy Watch" />
        <View style={cardStyle}>
          <View style={rowDivStyle}>
            <View style={styles.rowText}>
              <Text style={labelStyle}>Watch Connected</Text>
              <Text style={subStyle}>
                {watchConnected
                  ? 'Tempo + transition tracking active'
                  : 'Connect for swing tempo analysis'}
              </Text>
            </View>
            <Switch
              value={watchConnected}
              onValueChange={setWatchConnected}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text_primary}
            />
          </View>

          {watchConnected && (
            <View style={styles.watchInfo}>
              <Text style={styles.watchInfoTitle}>What Watch Tracking Adds</Text>
              <Text style={styles.watchInfoBody}>Tempo ratio — backswing to downswing timing.</Text>
              <Text style={styles.watchInfoBody}>Transition detection — early or on time.</Text>
              <Text style={styles.watchInfoBody}>Estimated club head speed.</Text>
              <Text style={[styles.watchInfoBody, { color: '#6b7280', marginTop: 8, fontStyle: 'italic' }]}>
                Samsung Health SDK integration coming soon. Currently runs in simulation mode for testing.
              </Text>
            </View>
          )}
        </View>

        {/* DEVELOPER TOOLS — dev builds only */}
        {__DEV__ && <DeveloperToolsSection cardStyle={cardStyle} colors={colors} />}

        {/* ABOUT */}
        {/* Phase 410 — Profile section. Edit Profile routes to the
            single-screen welcome that captures name + caddie +
            optional handicap. Discoverable affordance for testers
            who want to update; replaces the prior "edit each field
            individually" hunt-and-peck. */}
        <SectionHeader title="Profile" />
        <View style={cardStyle}>
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/welcome' as never)}
            accessibilityRole="button"
            accessibilityLabel="Edit your profile"
          >
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Edit Profile</Text>
            <Text style={[styles.aboutValue, { color: colors.accent }]}>
              Name · Caddie · Handicap →
            </Text>
          </TouchableOpacity>
        </View>

        {/* Phase AI — Help / Support section. Single canonical contact. */}
        <SectionHeader title="Help" />
        <View style={cardStyle}>
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
        </View>

        <SectionHeader title="About" />
        <View style={cardStyle}>
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
        </View>

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
                <SectionHeader title="Owner Tools" />
                <View style={cardStyle}>
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
                </View>
              </>
            );
          } catch { return null; }
        })()}

        {/* Reset / Sign Out — until real auth lands, this is the
            functional equivalent for testers who want to start fresh
            (new persona, clear stored profile, fresh trial state). */}
        <SectionHeader title="Reset" />
        <View style={cardStyle}>
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
        </View>

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
