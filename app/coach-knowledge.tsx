/**
 * 2026-05-25 — Fix AI: Coach Knowledge review + export surface.
 *
 * Owner-only screen showing every coach refinement Marc/Tank has saved
 * via the "remember this" voice trigger. Tim reviews refinements
 * offline and decides which become canonical (Tim's words: "balance
 * between the caddy brain and tank's input. That's why it's gonna be
 * exportable to me").
 *
 * Same export model as the Issue Log:
 *   - Per-entry mail button → opens mailto: with one entry
 *   - Header export-all button → opens mailto: with the full list
 *   - Both addressed to support@smartplaycaddie.com
 *   - Falls back to native Share when mailto isn't supported
 *
 * Reachable via Settings → Beta Feedback. Non-owners see a polite
 * "this is an owner review surface" placeholder (the refinements
 * themselves live on the COACH'S device per the existing
 * coachKnowledgeStore; this is the owner-side review tool — coaches
 * will eventually sync their entries up).
 */

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  Share, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import {
  useCoachKnowledgeStore,
  type CoachKnowledgeEntry,
} from '../store/coachKnowledgeStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';

function formatTimestamp(ts: number): string {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function entryToBody(entry: CoachKnowledgeEntry): string {
  const parts: string[] = [];
  parts.push(`Topic: ${entry.topic}`);
  parts.push(`Captured: ${formatTimestamp(entry.timestamp)}`);
  if (entry.authoredByEmail) parts.push(`Coach: ${entry.authoredByEmail}`);
  parts.push('');
  parts.push('Refinement:');
  parts.push(entry.refinement);
  if (entry.prior_question) {
    parts.push('');
    parts.push(`Prior question: ${entry.prior_question}`);
  }
  if (entry.caddie_original_answer) {
    parts.push('');
    parts.push('Caddie original answer (for comparison):');
    parts.push(entry.caddie_original_answer);
  }
  return parts.join('\n');
}

export default function CoachKnowledgeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const isOwner = isOwnerEmail(ownerEmail);
  const entries = useCoachKnowledgeStore(s => s.entries);
  const remove = useCoachKnowledgeStore(s => s.remove);

  const exportSingle = async (entry: CoachKnowledgeEntry) => {
    const subject = `SmartPlay coach refinement — ${entry.topic}`;
    const body = entryToBody(entry) + `\n\n— Sent from SmartPlay Caddie Coach Knowledge (${Platform.OS})`;
    const mailto = `mailto:support@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      const can = await Linking.canOpenURL(mailto).catch(() => false);
      if (can) { await Linking.openURL(mailto); return; }
      await Share.share({ message: `support@smartplaycaddie.com\n\n${body}`, title: subject });
    } catch (e) {
      console.log('[coach-knowledge] single export failed', e);
    }
  };

  const exportAll = async () => {
    if (entries.length === 0) return;
    const sections = entries.map(entryToBody).join('\n\n— — — — — —\n\n');
    const subject = `SmartPlay coach refinements — ${entries.length} entries`;
    const body = `${entries.length} coach refinements from this device:\n\n${sections}\n\n— Sent from SmartPlay Caddie Coach Knowledge (${Platform.OS})`;
    const mailto = `mailto:support@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      const can = await Linking.canOpenURL(mailto).catch(() => false);
      if (can) { await Linking.openURL(mailto); return; }
      await Share.share({ message: `support@smartplaycaddie.com\n\n${body}`, title: subject });
    } catch (e) {
      console.log('[coach-knowledge] bulk export failed', e);
    }
  };

  const onLongPressRemove = (entry: CoachKnowledgeEntry) => {
    Alert.alert(
      'Delete refinement?',
      `"${entry.refinement.slice(0, 80)}${entry.refinement.length > 80 ? '…' : ''}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove(entry.id) },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Coach Knowledge</Text>
        <TouchableOpacity
          onPress={exportAll}
          disabled={entries.length === 0}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Export all to support"
        >
          <Ionicons name="mail-outline" size={22} color={entries.length === 0 ? colors.text_muted : colors.accent} />
        </TouchableOpacity>
      </View>

      {!isOwner ? (
        <View style={styles.placeholderWrap}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>Owner review surface</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            Coach refinements you save with &quot;remember this&quot; live on your device. The owner reviews them here to decide what becomes canonical in the brain.
          </Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.placeholderWrap}>
          <Ionicons name="bulb-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>No refinements yet</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            Ask a topic question (&quot;what is smash factor&quot;), then say &quot;remember this&quot; to capture your refined explanation. It lands here and ships into the brain context.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.map(entry => (
            <View key={entry.id} style={[styles.entry, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onLongPress={() => onLongPressRemove(entry)}
                  delayLongPress={500}
                  accessibilityRole="button"
                  accessibilityLabel={`Refinement on ${entry.topic}. Long-press to delete.`}
                >
                  <Text style={[styles.topic, { color: colors.accent }]}>{entry.topic.toUpperCase()}</Text>
                  <Text style={[styles.refinement, { color: colors.text_primary }]}>{entry.refinement}</Text>
                  <Text style={[styles.meta, { color: colors.text_muted }]}>
                    {formatTimestamp(entry.timestamp)}
                    {entry.authoredByEmail ? ` · ${entry.authoredByEmail}` : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { void exportSingle(entry); }}
                  style={{ paddingLeft: 8, paddingTop: 2 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Email this refinement to support"
                >
                  <Ionicons name="mail-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: '800' },
  placeholderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  placeholderTitle: { fontSize: 16, fontWeight: '800' },
  placeholderBody: { fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  list: { padding: 12 },
  entry: {
    borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10,
  },
  topic: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  refinement: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  meta: { fontSize: 11, marginTop: 8 },
});
