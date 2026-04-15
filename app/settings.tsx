import { View, Text, ScrollView, Pressable, SafeAreaView, Switch, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSettingsStore, PlayerMode, RiskDefault, VoiceStyle } from '../store/settingsStore';

// ─── helpers ────────────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <Text style={styles.sectionLabel}>{text}</Text>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function RowLabel({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.rowLabel}>{text}</Text>
      {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
    </View>
  );
}

type PillGroupProps<T extends string> = {
  value: T;
  options: { value: T; label: string; emoji?: string; color: string }[];
  onSelect: (v: T) => void;
};
function PillGroup<T extends string>({ value, options, onSelect }: PillGroupProps<T>) {
  return (
    <View style={styles.pillRow}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            style={[
              styles.pill,
              active && { borderColor: o.color, backgroundColor: `${o.color}22` },
            ]}
          >
            {o.emoji ? <Text style={styles.pillEmoji}>{o.emoji}</Text> : null}
            <Text style={[styles.pillText, active && { color: o.color }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── screen ─────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();

  const {
    voiceEnabled,   setVoiceEnabled,
    voiceStyle,     setVoiceStyle,
    voiceGender,    setVoiceGender,
    playerMode,     setPlayerMode,
    riskDefault,    setRiskDefault,
    highContrast,   setHighContrast,
  } = useSettingsStore();

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── VOICE ──────────────────────────────────────────────── */}
        <SectionLabel text="VOICE" />

        <View style={styles.card}>
          {/* Voice on/off */}
          <Row>
            <RowLabel text="Voice caddie" sub="Speak club, aim and miss advice" />
            <Switch
              value={voiceEnabled}
              onValueChange={setVoiceEnabled}
              trackColor={{ false: '#333', true: '#14532d' }}
              thumbColor={voiceEnabled ? '#4ade80' : '#888'}
            />
          </Row>

          <View style={styles.divider} />

          {/* Voice style */}
          <Row>
            <RowLabel text="Voice style" sub="Tone of caddie messages" />
          </Row>
          <PillGroup<VoiceStyle>
            value={voiceStyle}
            onSelect={setVoiceStyle}
            options={[
              { value: 'calm',       label: 'Calm',       emoji: '🧘', color: '#4ade80' },
              { value: 'aggressive', label: 'Aggressive',  emoji: '🔥', color: '#ef4444' },
            ]}
          />

          <View style={styles.divider} />

          {/* Voice gender */}
          <Row>
            <RowLabel text="Caddie voice" sub="Male or female voice model" />
          </Row>
          <PillGroup<'male' | 'female'>
            value={voiceGender}
            onSelect={setVoiceGender}
            options={[
              { value: 'male',   label: 'Male',   emoji: '♂', color: '#60a5fa' },
              { value: 'female', label: 'Female', emoji: '♀', color: '#f472b6' },
            ]}
          />
        </View>

        {/* ── PLAYER MODE ────────────────────────────────────────── */}
        <SectionLabel text="PLAYER MODE" />

        <View style={styles.card}>
          <Row>
            <RowLabel
              text="Skill level"
              sub="Adjusts aggressiveness and messaging throughout the round"
            />
          </Row>
          <PillGroup<PlayerMode>
            value={playerMode}
            onSelect={setPlayerMode}
            options={[
              { value: 'beginner', label: 'Beginner', emoji: '🌱', color: '#66bb6a' },
              { value: 'break90',  label: 'Break 90', emoji: '🎯', color: '#2196f3' },
              { value: 'break80',  label: 'Break 80', emoji: '🔥', color: '#f59e0b' },
            ]}
          />
          <View style={styles.modeDesc}>
            {playerMode === 'beginner' && (
              <Text style={styles.modeDescText}>
                Safe targets, no hero shots. Avoid big numbers and enjoy the round.
              </Text>
            )}
            {playerMode === 'break90' && (
              <Text style={styles.modeDescText}>
                Controlled aggression. Attack short approaches, play smart from distance.
              </Text>
            )}
            {playerMode === 'break80' && (
              <Text style={styles.modeDescText}>
                Attack mode. Fire at flags under 130 yards. Commit to every shot.
              </Text>
            )}
          </View>
        </View>

        {/* ── RISK DEFAULT ───────────────────────────────────────── */}
        <SectionLabel text="RISK DEFAULT" />

        <View style={styles.card}>
          <Row>
            <RowLabel
              text="Default strategy"
              sub="Starting point each hole — overridden by in-round adaptation"
            />
          </Row>
          <PillGroup<RiskDefault>
            value={riskDefault}
            onSelect={setRiskDefault}
            options={[
              { value: 'safe',    label: '🛡 Safe',    color: '#4ade80' },
              { value: 'neutral', label: '⚖️ Neutral', color: '#94a3b8' },
              { value: 'attack',  label: '🔥 Attack',  color: '#f87171' },
            ]}
          />
          <View style={styles.modeDesc}>
            {riskDefault === 'safe' && (
              <Text style={styles.modeDescText}>Center green, avoid trouble. Bogey is fine.</Text>
            )}
            {riskDefault === 'neutral' && (
              <Text style={styles.modeDescText}>Context-driven — the caddie reads the hole and adapts.</Text>
            )}
            {riskDefault === 'attack' && (
              <Text style={styles.modeDescText}>Flag hunting. Pick aggressive lines and commit every shot.</Text>
            )}
          </View>
        </View>

        {/* ── DISPLAY ────────────────────────────────────────────── */}
        <SectionLabel text="DISPLAY" />

        <View style={styles.card}>
          <Row>
            <RowLabel
              text="High contrast"
              sub="Brighter text and borders for outdoor sunlight visibility"
            />
            <Switch
              value={highContrast}
              onValueChange={setHighContrast}
              trackColor={{ false: '#333', true: '#78350f' }}
              thumbColor={highContrast ? '#fbbf24' : '#888'}
            />
          </Row>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  backBtn: {
    width: 36,
    alignItems: 'center',
  },
  backArrow: {
    color: '#4ade80',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sectionLabel: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 8,
    marginTop: 20,
    marginLeft: 2,
  },
  card: {
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#1e1e1e',
    marginVertical: 2,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  pillEmoji: {
    fontSize: 14,
  },
  pillText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  modeDesc: {
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 2,
  },
  modeDescText: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
  },
});
