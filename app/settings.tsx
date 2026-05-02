import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useTheme } from '../contexts/ThemeContext';
import { clearMicDenial } from '../services/voicePermissionService';

export default function Settings() {
  const router = useRouter();

  const { colors } = useTheme();

  const {
    voiceEnabled,
    voiceGender,
    language,
    discreteMode,
    responseMode,
    castMode,
    highContrast,
    watchConnected,
    autoListenEnabled,
    skip_briefings,
    proactive_kevin_enabled,
    distance_unit,
    theme_preference,
    fillerEnabled,
    earbudTapToTalk,
    voiceOnPhoneSpeaker,
    setEarbudTapToTalk,
    setVoiceOnPhoneSpeaker,
    setVoiceEnabled,
    setVoiceGender,
    setLanguage,
    setDiscreteMode,
    setResponseMode,
    setCastMode,
    setHighContrast,
    setWatchConnected,
    setAutoListenEnabled,
    setSkipBriefings,
    setProactiveKevinEnabled,
    setDistanceUnit,
    setThemePreference,
    setFillerEnabled,
  } = useSettingsStore();

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
  }: {
    label: string;
    sub?: string;
    value: boolean;
    onValueChange: (v: boolean) => void;
  }) => (
    <View style={rowDivStyle}>
      <View style={styles.rowText}>
        <Text style={labelStyle}>{label}</Text>
        {sub ? <Text style={subStyle}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
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
        contentContainerStyle={styles.scroll}
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

        {/* CADDIE */}
        <SectionHeader title="Caddie" />
        <View style={cardStyle}>

          <PillRow
            label="Your Caddie"
            options={[
              { label: 'Kevin', value: 'male' },
              { label: 'Serena', value: 'female' },
            ]}
            value={voiceGender}
            onSelect={(v) => setVoiceGender(v as 'male' | 'female')}
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
              <Text style={labelStyle}>What Kevin's learning</Text>
              <Text style={subStyle}>Phrases Kevin has picked up from you</Text>
            </View>
            <Text style={[styles.rowSub, { color: colors.text_muted }]}>›</Text>
          </TouchableOpacity>

        </View>

        {/* ROUND EXPERIENCE */}
        <SectionHeader title="Round Experience" />
        <View style={cardStyle}>
          <ToggleRow
            label="Skip Pre-Round Briefing"
            sub="Go straight to the round without Kevin's intro"
            value={skip_briefings}
            onValueChange={setSkipBriefings}
          />
          <ToggleRow
            label="Proactive Kevin"
            sub="Kevin speaks up between holes — streaks, patterns, ghost updates"
            value={proactive_kevin_enabled}
            onValueChange={setProactiveKevinEnabled}
          />
          <ToggleRow
            label="Voice Filler"
            sub="Kevin fills the pause while thinking — 'let me see', 'hmm...'"
            value={fillerEnabled}
            onValueChange={setFillerEnabled}
          />
        </View>

        {/* VOICE */}
        <SectionHeader title="Voice" />
        <View style={cardStyle}>
          <ToggleRow
            label="Voice Enabled"
            sub="Kevin speaks responses aloud"
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
            label="Auto-Listen During Round"
            sub="Kevin listens automatically. Just talk."
            value={autoListenEnabled}
            onValueChange={setAutoListenEnabled}
          />
          <ToggleRow
            label="Earbud Tap-to-Talk"
            sub="Single-tap your earbuds to open Kevin's listening"
            value={earbudTapToTalk}
            onValueChange={setEarbudTapToTalk}
          />
          <ToggleRow
            label="Voice on Phone Speaker"
            sub="Allow Kevin's voice when no earbuds are connected"
            value={voiceOnPhoneSpeaker}
            onValueChange={setVoiceOnPhoneSpeaker}
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
            sub="Increased text contrast"
            value={highContrast}
            onValueChange={setHighContrast}
          />
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
              trackColor={{ false: colors.border, true: '#60a5fa' }}
              thumbColor="#ffffff"
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

        {/* ABOUT */}
        <SectionHeader title="About" />
        <View style={cardStyle}>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>App</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>SmartPlay Caddie</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Version</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>2.0.0</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: colors.text_muted }]}>Caddie</Text>
            <Text style={[styles.aboutValue, { color: colors.text_primary }]}>
              {voiceGender === 'female' ? 'Serena' : 'Kevin'}
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
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
