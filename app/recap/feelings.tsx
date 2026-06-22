import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRoundStore } from '../../store/roundStore';

// ─── Chip row data ─────────────────────────────────────────────────────────────

const ENERGY_OPTIONS = ['High', 'Medium', 'Low'] as const;
const FOCUS_OPTIONS  = ['Locked In', 'OK', 'Off'] as const;
const VIBE_OPTIONS   = ['Great', 'Solid', 'Rough'] as const;
const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Windy', 'Hot', 'Cold'] as const;

type EnergyOption  = typeof ENERGY_OPTIONS[number];
type FocusOption   = typeof FOCUS_OPTIONS[number];
type VibeOption    = typeof VIBE_OPTIONS[number];
type WeatherOption = typeof WEATHER_OPTIONS[number];

// ─── Chip component ────────────────────────────────────────────────────────────

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FeelingsScreen() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const router = useRouter();
  const updateRoundRecord = useRoundStore(s => s.updateRoundRecord);

  const [energy, setEnergy]   = useState<EnergyOption | null>(null);
  const [focus, setFocus]     = useState<FocusOption | null>(null);
  const [vibe, setVibe]       = useState<VibeOption | null>(null);
  const [weather, setWeather] = useState<WeatherOption | null>(null);

  function navigateToRecap() {
    if (roundId) {
      router.replace(`/recap/${roundId}` as never);
    } else {
      router.replace('/(tabs)/caddie' as never);
    }
  }

  function handleSave() {
    if (roundId && (energy || focus || vibe || weather)) {
      updateRoundRecord(roundId, {
        postRoundFeelings: {
          energy: energy ?? undefined,
          focus: focus ?? undefined,
          vibe: vibe ?? undefined,
          weather: weather ?? undefined,
        },
      });
    }
    navigateToRecap();
  }

  function handleSkip() {
    navigateToRecap();
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>How'd it feel out there?</Text>
        <Text style={styles.subtitle}>Optional — helps your caddie personalize feedback.</Text>

        {/* Energy */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ENERGY</Text>
          <View style={styles.chipRow}>
            {ENERGY_OPTIONS.map(opt => (
              <Chip
                key={opt}
                label={opt}
                selected={energy === opt}
                onPress={() => setEnergy(prev => prev === opt ? null : opt)}
              />
            ))}
          </View>
        </View>

        {/* Focus */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FOCUS</Text>
          <View style={styles.chipRow}>
            {FOCUS_OPTIONS.map(opt => (
              <Chip
                key={opt}
                label={opt}
                selected={focus === opt}
                onPress={() => setFocus(prev => prev === opt ? null : opt)}
              />
            ))}
          </View>
        </View>

        {/* Vibe */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VIBE</Text>
          <View style={styles.chipRow}>
            {VIBE_OPTIONS.map(opt => (
              <Chip
                key={opt}
                label={opt}
                selected={vibe === opt}
                onPress={() => setVibe(prev => prev === opt ? null : opt)}
              />
            ))}
          </View>
        </View>

        {/* Weather — optional */}
        <View style={styles.section}>
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>WEATHER</Text>
            <Text style={styles.optionalTag}>OPTIONAL</Text>
          </View>
          <View style={styles.chipRow}>
            {WEATHER_OPTIONS.map(opt => (
              <Chip
                key={opt}
                label={opt}
                selected={weather === opt}
                onPress={() => setWeather(prev => prev === opt ? null : opt)}
              />
            ))}
          </View>
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel="Save post-round feelings and view recap"
        >
          <Text style={styles.saveBtnText}>Save &amp; See Recap</Text>
        </TouchableOpacity>

        {/* Skip link */}
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip and go straight to recap"
        >
          <Text style={styles.skipBtnText}>Skip</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 48,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 28,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 10,
  },
  optionalTag: {
    color: '#374151',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#0d2418',
  },
  chipSelected: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  chipText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#00C896',
  },
  saveBtn: {
    marginTop: 12,
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#060f09',
    fontSize: 16,
    fontWeight: '900',
  },
  skipBtn: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipBtnText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
});
