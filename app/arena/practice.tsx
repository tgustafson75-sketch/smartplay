/**
 * Arena Practice Drills — 3-card list (Phase v3-port 5/5).
 *
 * Ported from v3's Arena screen. Three indoor/range drills that work
 * standalone — no TopGolf bay or watch required:
 *   - Bag Distances — log shots per club; average updates the bag
 *   - Tempo Trainer — 3:1 backswing-to-downswing metronome
 *   - Putting Clock — 12 putts at varied distances around the cup
 *
 * Routing:
 *   - SwingLab tab → Arena card → /arena/practice (this screen)
 *   - Each card here taps into a dedicated drill screen.
 *
 * Status:
 *   - The three drill screens are stubs in this commit (they'll show
 *     a "Coming soon" alert when tapped). Building the metronome /
 *     putting clock logic is a separate scope. This commit only
 *     delivers the v3-style navigation surface so the SwingLab
 *     Arena card has a polished destination today.
 *
 * Pro's existing Arena (CTP / Scramble / Sim Round / Skills) at
 * /arena remains intact — different concept (gameplay challenges
 * vs solo practice drills). No code there was changed.
 */

import React from 'react';
import { View, Text, Image, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

interface DrillCardSpec {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  sub: string;
}

const DRILLS: DrillCardSpec[] = [
  {
    key: 'bag',
    icon: 'stats-chart',
    title: 'Bag Distances',
    sub: 'Log shots per club; average updates your bag the Caddie reasons over.',
  },
  {
    key: 'tempo',
    icon: 'pulse',
    title: 'Tempo Trainer',
    sub: '3:1 backswing-to-downswing metronome. Haptic cues.',
  },
  {
    key: 'putting',
    icon: 'locate',
    title: 'Putting Clock',
    sub: '12 putts at varied distances around the cup. Record made / missed.',
  },
];

export default function ArenaPractice() {
  const router = useRouter();
  const { colors } = useTheme();

  const handleCard = (key: string) => {
    // Stub: the three drill experiences (bag-distances logging,
    // metronome, putting clock) aren't built in this commit. Show a
    // friendly note so the user knows the UI is ready but the drill
    // engine itself is forthcoming.
    Alert.alert(
      'Coming soon',
      'This practice drill is on the build list. The launcher is wired so it lands here without extra work when the drill ships.',
      [{ text: 'OK', style: 'default' }],
    );
    // No-op route for now; future work replaces with:
    //   router.push(`/arena/practice/${key}` as never);
    void router;
    void key;
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* HEADER */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to SwingLab"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.accent} />
          <Text style={[styles.backText, { color: colors.accent }]}>SwingLab</Text>
        </Pressable>
        <Image
          source={require('../../assets/avatars/smartplay_caddie_badge.png')}
          style={styles.headerBadge}
          resizeMode="contain"
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>ARENA</Text>
        <Text style={[styles.title, { color: colors.text_primary }]}>Practice Drills</Text>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          Indoor or range drills that work standalone — no TopGolf bay or watch required.
          Build your bag distances, lock in tempo, drill the cup.
        </Text>

        {DRILLS.map((drill) => (
          <Pressable
            key={drill.key}
            onPress={() => handleCard(drill.key)}
            accessibilityRole="button"
            accessibilityLabel={`${drill.title}. ${drill.sub}`}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: colors.surface_elevated,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.iconBox, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
              <Ionicons name={drill.icon} size={24} color={colors.accent} />
            </View>
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{drill.title}</Text>
              <Text style={[styles.cardSub, { color: colors.text_muted }]} numberOfLines={2}>
                {drill.sub}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
          </Pressable>
        ))}

        {/* Footer link to Pro's existing Arena (gameplay challenges).
            Keeps that surface discoverable from the v3-style screen. */}
        <Pressable
          onPress={() => router.push('/arena' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open Arena challenges (CTP, Scramble, Sim Round, Skills)"
          style={({ pressed }) => [styles.gameLink, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.gameLinkText, { color: colors.accent }]}>
            Looking for game challenges? Open Arena →
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', padding: 4 },
  backText: { fontSize: 17, fontWeight: '700' },
  headerBadge: { width: 40, height: 40, borderRadius: 20 },
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  title: { fontSize: 32, fontWeight: '900', marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  cardSub: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  gameLink: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  gameLinkText: { fontSize: 13, fontWeight: '700' },
});
