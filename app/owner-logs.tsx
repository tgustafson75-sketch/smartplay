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
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share, ActivityIndicator, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useIssueLogStore, type IssueLogKind } from '../store/issueLogStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
// 2026-05-22 — Path 1 (Owner Triage) — pulls last 50 harness events
// from the synthetic GPS bench so an issue captured mid-harness has
// the same recent-event context the post-run review would use.
import { subscribeHarnessEvents } from '../services/simulatedGPS';
import { getApiBaseUrl } from '../services/apiBase';

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function kindLabel(kind: IssueLogKind): string {
  switch (kind) {
    case 'voice_error':       return 'KEVIN';
    case 'voice_silent_fail': return 'SPEAK';
    case 'transcribe_error':  return 'TRANSCRIBE';
    case 'gps_error':         return 'GPS';
    case 'analysis_error':    return 'ANALYSIS';
    case 'voice_miss':        return 'MISS';
    case 'app_error':         return 'APP';
    case 'user':              return 'USER';
  }
}

function kindColor(kind: IssueLogKind): string {
  switch (kind) {
    case 'voice_error':       return '#ef4444'; // red — Kevin/brain failed
    case 'voice_silent_fail': return '#f59e0b'; // amber — TTS silent fail
    case 'transcribe_error':  return '#8b5cf6'; // purple — Whisper failed
    case 'gps_error':         return '#06b6d4'; // cyan — GPS/location failure
    case 'analysis_error':    return '#10b981'; // green — swing/frame analysis failure
    case 'voice_miss':        return '#eab308'; // yellow — command not understood/handled
    case 'app_error':         return '#f97316'; // orange — other app failure
    case 'user':              return '#6b7280';
  }
}

type FilterTab = 'all' | 'user' | 'voice';

export default function OwnerLogsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ send?: string }>();
  const { colors } = useTheme();
  const allEntries = useIssueLogStore(s => s.entries);
  const clearAll = useIssueLogStore(s => s.clearAll);
  const remove = useIssueLogStore(s => s.remove);
  const ownerEmail = usePlayerProfileStore(s => s.email);
  const isOwner = useMemo(() => isOwnerEmail(ownerEmail), [ownerEmail]);

  // 2026-06-04 — Voice tab. Voice-pipeline failures (speak silent-fails,
  // /api/transcribe errors, /api/kevin snags) land here as structured
  // entries so Tim + beta testers can diagnose snags without ADB.
  const [tab, setTab] = useState<FilterTab>('all');
  const voiceEntryCount = useMemo(
    () => allEntries.filter(e => e.kind && e.kind !== 'user').length,
    [allEntries],
  );
  const userEntryCount = useMemo(
    () => allEntries.filter(e => !e.kind || e.kind === 'user').length,
    [allEntries],
  );
  const entries = useMemo(() => {
    if (tab === 'user') return allEntries.filter(e => !e.kind || e.kind === 'user');
    if (tab === 'voice') return allEntries.filter(e => e.kind && e.kind !== 'user');
    return allEntries;
  }, [allEntries, tab]);

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
    const entry = allEntries.find(e => e.id === entryId);
    if (!entry) return;
    setTriageLoadingId(entryId);
    try {
      const apiUrl = getApiBaseUrl();
      const settings = useSettingsStore.getState();
      const round = useRoundStore.getState();
      const Updates = await import('expo-updates');
      const settingsSnapshot = {
        caddiePersonality: settings.caddiePersonality,
        voiceEnabled: settings.voiceEnabled,
        voiceOnPhoneSpeaker: settings.voiceOnPhoneSpeaker,
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
      const recentIssues = allEntries
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

  // 2026-05-25 — Fix AI: per-entry export helper. Mailto with just
  // one entry's text + context; same recipient + subject pattern as
  // the bulk export for consistency.
  const onExportSingle = async (entryId: string) => {
    const entry = allEntries.find(e => e.id === entryId);
    if (!entry) return;
    const ctx = entry.context;
    const ctxLine = `[${formatTimestamp(entry.timestamp)} · ${ctx.persona ?? '—'} · ${ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round'}]`;
    const detailsLine = entry.details && Object.keys(entry.details).length > 0
      ? `\n${Object.entries(entry.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}`
      : '';
    const reporter = ownerEmail || 'beta tester';
    const subject = `SmartPlay Caddie issue — ${reporter}`;
    const body = `Reporter: ${reporter}\nDevice: ${Platform.OS}\n\n${entry.text}\n${ctxLine}${detailsLine}\n\n— Sent from SmartPlay Caddie Issue Log`;
    const mailto = `mailto:support@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      const can = await Linking.canOpenURL(mailto).catch(() => false);
      if (can) { await Linking.openURL(mailto); return; }
      await Share.share({ message: `support@smartplaycaddie.com\n\n${body}`, title: subject });
    } catch (e) {
      console.log('[owner-logs] single export failed', e);
    }
  };

  const onExport = async () => {
    if (entries.length === 0) return;
    const text = entries
      .map(e => {
        const ctx = e.context;
        const ctxLine = `  [${formatTimestamp(e.timestamp)} · ${ctx.persona ?? '—'} · ${ctx.isRoundActive ? `hole ${ctx.currentHole ?? '?'} @ ${ctx.courseId ?? '?'}` : 'no round'}]`;
        // 2026-06-28 — include the details object (pingOk/pingMs/elapsedMs/source/…)
        // so exported logs carry the diagnostic fields, not just the title. Mirrors
        // the on-screen details render so "stop guessing" actually has the data.
        const detailsLine = e.details && Object.keys(e.details).length > 0
          ? `\n  ${Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}`
          : '';
        return `• ${e.text}\n${ctxLine}${detailsLine}`;
      })
      .join('\n\n');

    // 2026-05-25 — Fix AE: pre-fill email to support@smartplaycaddie.com
    // via mailto: link. Opens the user's default mail client with the
    // full log body and a sensible subject. Falls back to the native
    // Share sheet if mailto isn't supported (rare on phones, common on
    // tablets without a mail app configured).
    const reporter = ownerEmail || 'beta tester';
    const subject = `SmartPlay Caddie issue log — ${reporter}`;
    const body =
      `Reporter: ${reporter}\nEntries: ${entries.length}\nDevice: ${Platform.OS}\n\n${text}\n\n— Sent from SmartPlay Caddie Issue Log`;
    const mailto = `mailto:support@smartplaycaddie.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      const can = await Linking.canOpenURL(mailto).catch(() => false);
      if (can) {
        await Linking.openURL(mailto);
        return;
      }
      // Fallback — native share sheet (user can pick mail / messages /
      // copy / etc.). Tester can paste the body into an email to
      // support@smartplaycaddie.com manually.
      await Share.share({
        message: `support@smartplaycaddie.com\n\n${body}`,
        title: subject,
      });
    } catch (e) {
      console.log('[owner-logs] export failed', e);
      Alert.alert(
        'Export failed',
        `Email support@smartplaycaddie.com directly with the log below:\n\n${text}`,
      );
    }
  };

  // 2026-05-25 — Fix AE: Issue Log is now visible to ALL beta testers
  // so they can capture issues with voice ("log this: ...") and export
  // the list to Tim. Only the "Triage with Claude" button stays owner-
  // only (that hits /api/owner-triage and burns API credit). Removing
  // the wholesale owner-gate that used to lock the screen.

  // 2026-05-26 — Fix DW: voice "send / email issue log" navigates here
  // with ?send=1 and we auto-fire the mailto export once. Guarded so
  // re-renders or back-nav into the same route don't re-fire. Empty
  // log: silently no-op (matches the disabled state of the share btn).
  const autoSentRef = React.useRef(false);
  // onExport intentionally omitted from deps — it isn't memoized and
  // adding it would re-fire on every render. The autoSentRef guard
  // above already prevents double-firing.
  React.useEffect(() => {
    if (autoSentRef.current) return;
    if (params.send !== '1') return;
    if (entries.length === 0) return;
    autoSentRef.current = true;
    void onExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.send, entries.length]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
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

      {/* 2026-06-04 — Three-tab filter. Voice tab surfaces structured
          speak/transcribe/kevin failures captured by services/voiceErrorLog.
          Counts reflect the FULL entry pool so the user can see at a
          glance which side is generating noise. */}
      <View style={styles.tabsRow}>
        {([
          { id: 'all' as const,   label: 'All',    count: allEntries.length },
          { id: 'user' as const,  label: 'Issues', count: userEntryCount },
          { id: 'voice' as const, label: 'Voice',  count: voiceEntryCount },
        ]).map(t => {
          const active = tab === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[
                styles.tabBtn,
                { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${t.label} tab — ${t.count} entries`}
            >
              <Text style={[styles.tabText, { color: active ? colors.background : colors.text_primary }]}>
                {t.label} · {t.count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {entries.length === 0 ? (
        <View style={styles.placeholderWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.text_muted} />
          <Text style={[styles.placeholderTitle, { color: colors.text_primary }]}>No entries yet</Text>
          <Text style={[styles.placeholderBody, { color: colors.text_muted }]}>
            {tab === 'voice'
              ? 'Voice failures (TTS silent fails, transcribe errors, Kevin snags) land here as they happen.'
              : 'Say "Kevin, log this: <the issue>" or "report a bug: ..." and entries land here with context.'}
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
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
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
                    {/* Voice events get a colored kind chip so the eye
                        can scan a long list and pick the failures out. */}
                    {entry.kind && entry.kind !== 'user' ? (
                      <View style={styles.kindRow}>
                        <View style={[styles.kindChip, { backgroundColor: kindColor(entry.kind) }]}>
                          <Text style={styles.kindChipText}>{kindLabel(entry.kind)}</Text>
                        </View>
                        {entry.stage ? (
                          <Text style={[styles.stageText, { color: colors.text_primary }]}>{entry.stage}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={[styles.entryText, { color: colors.text_primary }]}>{entry.text}</Text>
                    {entry.details ? (
                      <Text style={[styles.detailsText, { color: colors.text_muted }]} numberOfLines={4}>
                        {Object.entries(entry.details)
                          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                          .join(' · ')}
                      </Text>
                    ) : null}
                    <Text style={[styles.entryMeta, { color: colors.text_muted }]}>
                      {formatTimestamp(entry.timestamp)}
                      {entry.context.persona ? ` · ${entry.context.persona}` : ''}
                      {entry.context.isRoundActive
                        ? ` · hole ${entry.context.currentHole ?? '?'}`
                        : ''}
                      {entry.context.courseId ? ` · ${entry.context.courseId}` : ''}
                    </Text>
                  </TouchableOpacity>
                  {/* 2026-05-25 — Fix AI: per-entry email export. Tap
                      opens a mailto: pre-filled with this single entry
                      addressed to support@smartplaycaddie.com — pairs
                      with the screen-level export-all button so users
                      can send a SINGLE issue (the one that just happened)
                      without batching the whole log. */}
                  <TouchableOpacity
                    onPress={() => { void onExportSingle(entry.id); }}
                    style={{ paddingLeft: 8, paddingTop: 2 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Email this entry to support"
                  >
                    <Ionicons name="mail-outline" size={18} color={colors.accent} />
                  </TouchableOpacity>
                  {/* 2026-05-26 — Fix CR: visible per-row trash icon
                      so delete is discoverable. Long-press still works
                      for power users; this is the obvious tap path
                      Tim was asking for. */}
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        'Delete entry?',
                        'This removes it from the log.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => remove(entry.id) },
                        ],
                      );
                    }}
                    style={{ paddingLeft: 8, paddingTop: 2 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Delete this entry"
                  >
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>

                {/* 2026-05-22 — Path 1 (Owner Triage). Button posts the
                    entry + context to /api/owner-triage; Claude returns
                    a hypothesis (root cause, where to look, severity).
                    Read-only — no code changes ship from this surface.
                    2026-05-25 — Fix AE: gated to owner only. Beta
                    testers see only the entry + the screen-level Export
                    button; they DON'T see the Claude triage button (that
                    burns API credit + isn't useful to them). */}
                {isOwner && (
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
                )}

                {isOwner && triageById[entry.id] ? (
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
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  tabBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  tabText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  kindChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kindChipText: { color: '#ffffff', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  stageText: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  detailsText: { fontSize: 11, lineHeight: 15, fontFamily: 'monospace', marginTop: 2 },
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
