/**
 * 2026-05-17 — Owner-only issue log viewer.
 *
 * Lists every IssueLogEntry saved via the `log_issue` voice intent OR
 * future surfaces (manual text entry, automatic crash hooks, etc).
 * Newest entries on top. Each row shows the captured text + a tight
 * context strip (timestamp, route/persona/round). Long-press to delete
 * an entry; "Clear all" button at the bottom for a full wipe.
 *
 * The route is gated behind the same isOwnerEmail() check as the
 * Settings entry that links here. Non-owners visiting the URL directly
 * get a polite "this surface is owner-only" placeholder rather than
 * an empty list.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useIssueLogStore } from '../store/issueLogStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function OwnerLogsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const entries = useIssueLogStore(s => s.entries);
  const clearAll = useIssueLogStore(s => s.clearAll);
  const remove = useIssueLogStore(s => s.remove);
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const isOwner = useMemo(() => isOwnerEmail(ownerEmail), [ownerEmail]);

  const onExport = async () => {
    if (entries.length === 0) return;
    const text = entries
      .map(e => {
        const ctx = e.context;
        const ctxLine = `  [${formatTimestamp(e.timestamp)} · ${ctx.persona ?? '—'} · ${ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round'}]`;
        return `• ${e.text}\n${ctxLine}`;
      })
      .join('\n\n');
    try {
      await Share.share({ message: text, title: 'SmartPlay Caddie issue log' });
    } catch (e) {
      console.log('[owner-logs] share failed', e);
    }
  };

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text_primary }]}>Issue Log</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.placeholderWrap}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>Owner-only surface</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            This is a developer feedback log restricted to the app owner&apos;s account.
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
        <Text style={[styles.title, { color: colors.text_primary }]}>Issue Log</Text>
        <TouchableOpacity
          onPress={onExport}
          disabled={entries.length === 0}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Export log"
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
          <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>No entries yet</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            Say &quot;Kevin, log this: &lt;the issue&gt;&quot; or &quot;report a bug: ...&quot;
            and entries land here with context.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            {entries.map(entry => (
              <TouchableOpacity
                key={entry.id}
                style={[styles.entry, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onLongPress={() => {
                  Alert.alert(
                    'Delete entry?',
                    'This removes it from the log.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => remove(entry.id) },
                    ],
                  );
                }}
                delayLongPress={500}
                accessibilityRole="button"
                accessibilityLabel={`Issue: ${entry.text}. Long-press to delete.`}
              >
                <Text style={[styles.entryText, { color: colors.text_primary }]}>{entry.text}</Text>
                <Text style={[styles.entryMeta, { color: colors.text_muted }]}>
                  {formatTimestamp(entry.timestamp)}
                  {entry.context.persona ? ` · ${entry.context.persona}` : ''}
                  {entry.context.isRoundActive
                    ? ` · hole ${entry.context.currentHole ?? '?'}`
                    : ''}
                  {entry.context.courseId ? ` · ${entry.context.courseId}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 80 }} />
          </ScrollView>
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.border }]}
              onPress={() => {
                Alert.alert(
                  'Clear all entries?',
                  `Delete all ${entries.length} entries. This cannot be undone.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear all', style: 'destructive', onPress: () => clearAll() },
                  ],
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear all entries"
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
    gap: 4,
  },
  entryText: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  entryMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
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
