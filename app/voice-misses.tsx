/**
 * Owner-only Voice Misses viewer.
 *
 * Sibling to /owner-logs (the spoken-issue log). This surface lists every
 * voice command that DIDN'T get a wired handler: classifier returned
 * 'unknown' or low confidence, intent_type had no registered handler,
 * or a handler threw during execute(). Captured automatically by
 * services/voiceCommandRouter.dispatch() — see store/voiceMissStore.ts.
 *
 * Use case: Tank's broad voice testing surfaces the gaps — every
 * phrasing he tries that doesn't work lands here with transcript +
 * surface + reason. Tim reviews the list and decides what to wire.
 *
 * Gated to the owner email via isOwnerEmail() so non-owner installs
 * see a polite placeholder rather than the list.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useVoiceMissStore, type VoiceMissEntry, type VoiceMissType } from '../store/voiceMissStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function missTypeLabel(t: VoiceMissType): string {
  if (t === 'classifier_unknown') return 'No intent match';
  if (t === 'no_handler') return 'No handler wired';
  return 'Handler error';
}

function missTypeColor(t: VoiceMissType, accent: string): string {
  if (t === 'handler_error') return '#ef4444';
  if (t === 'no_handler') return '#fbbf24';
  return accent;
}

export default function VoiceMissesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const entries = useVoiceMissStore(s => s.entries);
  const clearAll = useVoiceMissStore(s => s.clearAll);
  const remove = useVoiceMissStore(s => s.remove);
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const isOwner = useMemo(() => isOwnerEmail(ownerEmail), [ownerEmail]);

  const onExport = async () => {
    if (entries.length === 0) return;
    const text = entries
      .map((e: VoiceMissEntry) => {
        const meta = `  [${formatTimestamp(e.timestamp)} · ${missTypeLabel(e.missType)}${e.intent_type ? ' · ' + e.intent_type : ''}${e.surface ? ' · ' + e.surface : ''}]`;
        const err = e.error_message ? `\n  error: ${e.error_message}` : '';
        return `• "${e.transcript}"\n${meta}${err}`;
      })
      .join('\n\n');
    try {
      await Share.share({ message: text, title: 'SmartPlay voice misses' });
    } catch (e) {
      console.log('[voice-misses] share failed', e);
    }
  };

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Voice Misses</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.placeholderWrap}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>Owner-only surface</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            Voice coverage log restricted to the app owner&apos;s account.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Voice Misses</Text>
        <TouchableOpacity
          onPress={onExport}
          disabled={entries.length === 0}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Export voice misses"
        >
          <Ionicons
            name="share-outline"
            size={22}
            color={entries.length === 0 ? colors.text_muted : colors.accent}
          />
        </TouchableOpacity>
      </View>

      {entries.length === 0 ? (
        <View style={styles.placeholderWrap}>
          <Ionicons name="mic-off-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>No misses logged</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            Voice commands that don&apos;t match a wired handler will land here with the transcript,
            surface, and reason. The user still hears the honest fallback.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            {entries.map((entry: VoiceMissEntry) => {
              const badgeColor = missTypeColor(entry.missType, colors.accent);
              return (
                <View
                  key={entry.id}
                  style={[styles.entry, { borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }]}
                >
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onLongPress={() => {
                      Alert.alert(
                        'Delete miss?',
                        'This removes it from the log.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => remove(entry.id) },
                        ],
                      );
                    }}
                    delayLongPress={500}
                    accessibilityRole="button"
                    accessibilityLabel={`Miss: ${entry.transcript}. Long-press or tap trash to delete.`}
                  >
                  <Text style={[styles.entryText, { color: colors.text_primary }]} numberOfLines={3}>
                    &ldquo;{entry.transcript}&rdquo;
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { borderColor: badgeColor }]}>
                      <Text style={[styles.badgeText, { color: badgeColor }]}>
                        {missTypeLabel(entry.missType)}
                      </Text>
                    </View>
                    {entry.intent_type ? (
                      <Text style={[styles.entryMeta, { color: colors.text_muted }]}>
                        {entry.intent_type}
                      </Text>
                    ) : null}
                    {entry.surface ? (
                      <Text style={[styles.entryMeta, { color: colors.text_muted }]}>
                        · {entry.surface}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.entryMeta, { color: colors.text_muted }]}>
                    {formatTimestamp(entry.timestamp)}
                    {entry.context.persona ? ` · ${entry.context.persona}` : ''}
                    {entry.context.isRoundActive
                      ? ` · hole ${entry.context.currentHole ?? '?'}`
                      : ''}
                  </Text>
                  {entry.error_message ? (
                    <Text style={[styles.errorText, { color: '#ef4444' }]} numberOfLines={3}>
                      {entry.error_message}
                    </Text>
                  ) : null}
                  </TouchableOpacity>
                  {/* 2026-05-26 — Fix CR: visible per-row trash icon
                      so delete is one tap, not a hidden long-press. */}
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        'Delete miss?',
                        'This removes it from the log.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => remove(entry.id) },
                        ],
                      );
                    }}
                    style={{ paddingTop: 2 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Delete this miss"
                  >
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              );
            })}
            <View style={{ height: 80 }} />
          </ScrollView>
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.border }]}
              onPress={() => {
                Alert.alert(
                  'Clear all misses?',
                  `Delete all ${entries.length} entries. This cannot be undone.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear all', style: 'destructive', onPress: () => clearAll() },
                  ],
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear all misses"
            >
              <Ionicons name="trash-outline" size={18} color="#ef4444" style={{ marginRight: 6 }} />
              <Text style={styles.clearBtnText}>Clear all</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  list: { padding: 12, gap: 8 },
  entry: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  entryText: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  entryMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  errorText: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    borderTopWidth: 1,
    padding: 12,
    paddingBottom: 24,
    alignItems: 'center',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
  },
  clearBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  placeholderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  placeholderTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  placeholderBody: { fontSize: 14, textAlign: 'center', lineHeight: 21, maxWidth: 320 },
});
