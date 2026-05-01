import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useVocabularyProfileStore, type VocabularyEntry } from '../store/vocabularyProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';

interface DecodedMeaning {
  club: string | null;
  direction: string | null;
  outcome: string | null;
  distance: string | null;
}

function decodeSignature(sig: string): DecodedMeaning {
  const [club, direction, outcome, distance] = sig.split('|');
  const norm = (v: string | undefined) => (v && v !== '-' ? v : null);
  return { club: norm(club), direction: norm(direction), outcome: norm(outcome), distance: norm(distance) };
}

function meaningSummary(meaning: DecodedMeaning): string {
  const parts: string[] = [];
  if (meaning.club) parts.push(meaning.club);
  if (meaning.distance) parts.push(meaning.distance + ' yds');
  if (meaning.direction) parts.push(meaning.direction);
  if (meaning.outcome) parts.push(meaning.outcome);
  return parts.length > 0 ? parts.join(' · ') : 'untagged';
}

export default function KevinLearningScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width: W } = useWindowDimensions();
  const isFold = W < 380;

  const entries = useVocabularyProfileStore(s => s.entries);
  const totalShotsParsed = useVocabularyProfileStore(s => s.totalShotsParsed);
  const recordCorrection = useVocabularyProfileStore(s => s.recordCorrection);
  const reset = useVocabularyProfileStore(s => s.reset);
  const roundsTogether = useRelationshipStore(s => s.roundsTogether);

  const sortedEntries: VocabularyEntry[] = useMemo(() => {
    return Object.values(entries)
      .sort((a, b) => b.count - a.count || b.last_used - a.last_used)
      .slice(0, 20);
  }, [entries]);

  const phraseCount = Object.keys(entries).length;

  const handleForget = (phrase: string) => {
    Alert.alert(
      'Forget this phrase?',
      `Kevin will stop weighting "${phrase}" toward its current meaning.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: () => recordCorrection(phrase) },
      ],
    );
  };

  const handleResetAll = () => {
    Alert.alert(
      'Reset Kevin\'s vocabulary?',
      'This wipes all phrases Kevin has learned from you. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => reset() },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Kevin's Learning</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* HERO STAT */}
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.heroNumber, { color: colors.accent }]}>
            {phraseCount}
          </Text>
          <Text style={[styles.heroLabel, { color: colors.text_primary }]}>
            {phraseCount === 1 ? 'phrase' : 'phrases'} learned
          </Text>
          <Text style={[styles.heroSub, { color: colors.text_muted }]}>
            from {totalShotsParsed} shots {roundsTogether > 0 ? `across ${roundsTogether} ${roundsTogether === 1 ? 'round' : 'rounds'}` : ''}
          </Text>
          {phraseCount === 0 && (
            <Text style={[styles.heroEmpty, { color: colors.text_muted }]}>
              Once you start logging shots by voice, Kevin will start picking up the words you actually use.
            </Text>
          )}
        </View>

        {/* TOP PHRASES */}
        {sortedEntries.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.text_muted }]}>Top phrases</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {sortedEntries.map((entry, i) => {
                const meaning = decodeSignature(entry.meaning_signature);
                const summary = meaningSummary(meaning);
                return (
                  <View
                    key={entry.phrase}
                    style={[
                      styles.row,
                      { borderBottomColor: colors.border },
                      i === sortedEntries.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.phrase, { color: colors.text_primary }, isFold && { fontSize: 14 }]} numberOfLines={2}>
                        "{entry.phrase}"
                      </Text>
                      <Text style={[styles.meaning, { color: colors.text_muted }]} numberOfLines={1}>
                        {summary}{entry.was_corrected ? ' · corrected' : ''} · said {entry.count}×
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleForget(entry.phrase)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.forgetBtn}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={colors.text_muted} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* RESET ALL — only when there's something to reset */}
        {phraseCount > 0 && (
          <TouchableOpacity
            style={[styles.resetBtn, { borderColor: colors.border }]}
            onPress={handleResetAll}
          >
            <Text style={[styles.resetText, { color: '#ef4444' }]}>Reset all learned phrases</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.footer, { color: colors.text_muted }]}>
          Kevin uses these phrases to understand your specific way of describing shots. Forgetting a phrase removes its weight; the next time you say it, Kevin parses it fresh.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  hero: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 24,
  },
  heroNumber: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
  },
  heroLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: -4,
  },
  heroSub: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  heroEmpty: {
    fontSize: 13,
    marginTop: 14,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 12,
  },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, marginRight: 8 },
  phrase: { fontSize: 15, fontWeight: '600' },
  meaning: { fontSize: 12, marginTop: 3 },
  forgetBtn: { padding: 4 },

  resetBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 18,
  },
  resetText: { fontSize: 13, fontWeight: '600' },

  footer: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
