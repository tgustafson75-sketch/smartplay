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

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useIssueLogStore } from '../store/issueLogStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
// 2026-05-22 — Path 1 (Owner Triage) — pulls last 50 harness events
// from the synthetic GPS bench so an issue captured mid-harness has
// the same recent-event context the post-run review would use.
import { subscribeHarnessEvents } from '../services/simulatedGPS';

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

  // 2026-05-22 — Path 1 (Owner Triage). Per-entry triage hypothesis
  // from Claude Sonnet via /api/owner-triage. Bundles the entry +
  // settings snapshot + last 50 harness events + last 5 issue log
  // entries so the model has the same context Tim would paste into
  // a Claude session. READ-ONLY — never mutates anything, never
  // commits, never patches. Output is text the owner reads on the
  // phone to decide what to do.
  const [triageById, setTriageById] = useState<Record<string, string>>({});
  const [triageLoadingId, setTriageLoadingId] = useState<string | null>(null);
  // Last-50 harness events captured live via the existing subscriber
  // so a Triage tap during/after a synthetic run includes the right
  // recent-context window.
  const [harnessEvents, setHarnessEvents] = React.useState<unknown[]>([]);
  React.useEffect(() => {
    const unsub = subscribeHarnessEvents((events) => {
      setHarnessEvents(events);
    });
    return () => unsub();
  }, []);

  const requestTriage = async (entryId: string) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    setTriageLoadingId(entryId);
    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
      const settings = useSettingsStore.getState();
      const round = useRoundStore.getState();
      const Updates = await import('expo-updates');
      const settingsSnapshot = {
        caddiePersonality: settings.caddiePersonality,
        voiceEnabled: settings.voiceEnabled,
        voiceOnPhoneSpeaker: settings.voiceOnPhoneSpeaker,
        discreteMode: settings.discreteMode,
        skip_briefings: settings.skip_briefings,
        language: settings.language,
        responseMode: settings.responseMode,
        cartMode: settings.cartMode,
        smartVisionImagery: settings.smartVisionImagery,
        yardageMode: settings.yardageMode,
        isRoundActive: round.isRoundActive,
        currentHole: round.isRoundActive ? round.currentHole : null,
        activeCourseId: round.activeCourseId,
      };
      const recentIssues = entries
        .filter(e => e.id !== entryId)
        .slice(0, 5)
        .map(e => ({ text: e.text, timestamp: e.timestamp }));
      const bundleInfo = {
        updateId: (Updates.updateId as string | null) ?? null,
        createdAt: Updates.createdAt instanceof Date ? Updates.createdAt.toISOString() : null,
      };
      const res = await fetch(`${apiUrl}/api/owner-triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry: {
            id: entry.id,
            text: entry.text,
            timestamp: entry.timestamp,
            context: entry.context,
          },
          recentEvents: harnessEvents,
          settingsSnapshot,
          recentIssues,
          bundleInfo,
        }),
      });
      const data = (await res.json()) as { triage?: string; error?: string };
      const text = data.triage ?? data.error ?? 'Triage returned no text.';
      setTriageById(prev => ({ ...prev, [entryId]: text }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTriageById(prev => ({ ...prev, [entryId]: `Triage request failed: ${msg}` }));
    } finally {
      setTriageLoadingId(null);
    }
  };

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
              <View
                key={entry.id}
                style={[styles.entry, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <TouchableOpacity
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

                {/* 2026-05-22 — Path 1 (Owner Triage). Button posts the
                    entry + context to /api/owner-triage; Claude returns
                    a hypothesis (root cause, where to look, severity).
                    Read-only — no code changes ship from this surface. */}
                <View style={styles.triageRow}>
                  <TouchableOpacity
                    style={[styles.triageBtn, { borderColor: colors.accent }]}
                    onPress={() => requestTriage(entry.id)}
                    disabled={triageLoadingId === entry.id}
                    accessibilityRole="button"
                    accessibilityLabel="Triage this entry with Claude"
                  >
                    {triageLoadingId === entry.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <Ionicons name="sparkles-outline" size={14} color={colors.accent} style={{ marginRight: 4 }} />
                        <Text style={[styles.triageBtnText, { color: colors.accent }]}>
                          {triageById[entry.id] ? 'Re-run triage' : 'Triage with Claude'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                  {triageById[entry.id] ? (
                    <TouchableOpacity
                      onPress={() => {
                        void Share.share({
                          message: `Issue: ${entry.text}\n\n${triageById[entry.id]}`,
                          title: 'SmartPlay triage',
                        }).catch(() => {});
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Share triage"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="share-outline" size={16} color={colors.text_muted} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {triageById[entry.id] ? (
                  <View style={[styles.triageResult, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <Text style={[styles.triageResultText, { color: colors.text_primary }]}>
                      {triageById[entry.id]}
                    </Text>
                  </View>
                ) : null}
              </View>
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
  triageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  triageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  triageBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  triageResult: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  triageResultText: { fontSize: 12, lineHeight: 17, fontFamily: 'monospace' },
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
