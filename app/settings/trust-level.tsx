import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTrustLevelStore, TRUST_LEVEL_META, type TrustLevel } from '../../store/trustLevelStore';

/**
 * Phase E — Trust Spectrum slider screen.
 *
 * Four labeled positions (Quiet / Companion / Active / Full). Mike sees plain
 * language, never "Trust Spectrum" or "L2." Default for new users is Companion.
 *
 * Selection persists immediately via the store.
 */
export default function TrustLevelScreen() {
  const router = useRouter();
  const level = useTrustLevelStore(s => s.level);
  const setLevel = useTrustLevelStore(s => s.setLevel);
  const [showAbout, setShowAbout] = useState(false);

  const levels: TrustLevel[] = [1, 2, 3, 4];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Kevin's presence</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.subtitle}>How present should Kevin be?</Text>

        <View style={styles.slider}>
          {levels.map((l, i) => {
            const meta = TRUST_LEVEL_META[l];
            const active = level === l;
            return (
              <TouchableOpacity
                key={l}
                onPress={() => setLevel(l)}
                style={[
                  styles.cell,
                  i === 0 && styles.cellLeft,
                  i === levels.length - 1 && styles.cellRight,
                  active && styles.cellActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.cellLabel, active && styles.cellLabelActive]}>{meta.label}</Text>
                {active && <View style={styles.activeDot} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.descriptionBlock}>
          <Text style={styles.activeOneLiner}>{TRUST_LEVEL_META[level].one_liner}</Text>
          {level === 2 && <Text style={styles.recommendedTag}>Recommended for most.</Text>}
        </View>

        <TouchableOpacity onPress={() => setShowAbout(!showAbout)} style={styles.aboutToggle}>
          <Text style={styles.aboutToggleText}>
            {showAbout ? '− About these' : '+ About these'}
          </Text>
        </TouchableOpacity>

        {showAbout && (
          <View style={styles.aboutBlock}>
            <AboutRow label="Quiet" body="Kevin's reachable on tap, but he stays out of the way. Just the SmartPlay logo and a mic button — no avatar, no advice card. Pick this on focused range sessions or when you want silence." />
            <AboutRow label="Companion" body="Kevin's there at the bottom of your home screen, ready when you need him. Voice is opt-in, advice is offered, never pushed." />
            <AboutRow label="Active" body="Split screen — Kevin top, your yardages bottom. He'll chime in between shots and ride along through the round." />
            <AboutRow label="Full" body="Kevin centered, voice on by default. He's right there with you, hands-free. Like having a real caddie on the bag." />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AboutRow({ label, body }: { label: string; body: string }) {
  return (
    <View style={styles.aboutRow}>
      <Text style={styles.aboutLabel}>{label}</Text>
      <Text style={styles.aboutBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  scroll: { padding: 16 },
  subtitle: { color: '#e8f5e9', fontSize: 16, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  slider: {
    flexDirection: 'row',
    backgroundColor: '#0a1e12',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    overflow: 'hidden',
  },
  cell: { flex: 1, paddingVertical: 14, alignItems: 'center', backgroundColor: 'transparent' },
  cellLeft: {},
  cellRight: {},
  cellActive: { backgroundColor: '#003d20' },
  cellLabel: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  cellLabelActive: { color: '#00C896' },
  activeDot: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: '#00C896', marginTop: 4,
  },
  descriptionBlock: { alignItems: 'center', paddingVertical: 18 },
  activeOneLiner: { color: '#e8f5e9', fontSize: 14, fontWeight: '600' },
  recommendedTag: { color: '#00C896', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 6 },
  aboutToggle: { alignSelf: 'flex-start', paddingVertical: 8 },
  aboutToggleText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  aboutBlock: { gap: 16, marginTop: 8 },
  aboutRow: {},
  aboutLabel: { color: '#00C896', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  aboutBody: { color: '#9ca3af', fontSize: 13, lineHeight: 19 },
});
