/**
 * 2026-09-23 (Tim) — "put a card in my owners tools and I can export to smartmanage".
 *
 * App usage from the opted-in data the backend already holds (services/ownerUsage → api/owner-usage),
 * and one Export that mails the report to the inbox SmartManage ingests. Owner-only at the route
 * (app/_layout DEBUG_ROUTES) and at the render.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import {
  fetchOwnerUsage, getOwnerKey, setOwnerKey, exportUsageToSmartManage, EXPORT_TO, type FetchResult,
} from '../services/ownerUsage';

export default function OwnerUsage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isOwner = isOwnerEmail(usePlayerProfileStore((s) => s.email));
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setExported(null);
    const r = await fetchOwnerUsage();
    setResult(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void getOwnerKey().then((k) => { setHasKey(!!k); if (k) void load(); });
  }, [isOwner, load]);

  const saveKey = useCallback(async () => {
    if (!keyDraft.trim()) return;
    await setOwnerKey(keyDraft);
    setKeyDraft('');
    setHasKey(true);
    void load();
  }, [keyDraft, load]);

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.screen, { justifyContent: 'center' }]} edges={['top', 'bottom']}>
        <Text style={styles.muted}>This screen is owner-only.</Text>
      </SafeAreaView>
    );
  }

  const report = result?.ok ? result.report : null;
  const o = report?.opted_in;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={styles.title}>App usage</Text>
        <TouchableOpacity onPress={() => void load()} disabled={loading || !hasKey} accessibilityRole="button" accessibilityLabel="Refresh" hitSlop={12}>
          <Ionicons name="refresh" size={22} color={hasKey ? colors.accent : colors.text_muted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!hasKey || (result?.ok === false && result.reason === 'unauthorized') ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Owner key</Text>
            <Text style={styles.muted}>
              {result?.ok === false && result.reason === 'unauthorized'
                ? 'That key was not accepted. Paste it again.'
                : 'Paste the owner key once. It stays on this phone.'}
            </Text>
            <TextInput
              style={styles.input}
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder="Owner key"
              placeholderTextColor={colors.text_muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={() => void saveKey()} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>Save key</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : null}
        {!loading && result?.ok === false && result.reason !== 'unauthorized' && result.reason !== 'no_key' ? (
          <Text style={styles.muted}>{result.message}</Text>
        ) : null}

        {!loading && report && o ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Active installs (opted-in)</Text>
              <View style={styles.statRow}>
                <Stat label="Today" value={o.active_installs.d1} styles={styles} />
                <Stat label="7 days" value={o.active_installs.d7} styles={styles} />
                <Stat label="30 days" value={o.active_installs.d30} styles={styles} />
              </View>
              {o.daily_active_7d.map((d) => (
                <Text key={d.day} style={styles.line}>{d.day}  ·  {d.installs}</Text>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top activity, 30 days</Text>
              {o.top_events_30d.length === 0 ? <Text style={styles.muted}>None recorded yet.</Text> : null}
              {o.top_events_30d.map((e) => (
                <Text key={e.event} style={styles.line}>{e.event}  ·  {e.count}</Text>
              ))}
              <Text style={styles.muted}>{o.events_30d} events{o.truncated ? ' (capped, more exist)' : ''}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Backups and referrals</Text>
              <Text style={styles.line}>Cloud backups: {report.backups.total ?? 'unknown'} total · {report.backups.updated_7d ?? 'unknown'} updated this week</Text>
              <Text style={styles.line}>Referrals: {report.referrals.claimed ?? 'unknown'} claimed · {report.referrals.qualified ?? 'unknown'} qualified</Text>
            </View>

            <Text style={styles.muted}>Not visible here: {report.cannot_see}</Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => void exportUsageToSmartManage(report).then((r) => setExported(r === 'sent' ? `Opened a mail to ${EXPORT_TO} (SmartManage inbox).` : 'Export failed — try again.'))}
              accessibilityRole="button"
            >
              <Ionicons name="share-outline" size={18} color={colors.surface} />
              <Text style={styles.primaryBtnText}>Export to SmartManage</Text>
            </TouchableOpacity>
            {exported ? <Text style={styles.muted}>{exported}</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, styles }: { label: string; value: number; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
    title: { fontSize: 18, fontWeight: '800', color: c.text_primary },
    body: { padding: 16, gap: 12, paddingBottom: 48 },
    card: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
    cardTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, color: c.text_primary, marginBottom: 4 },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    stat: { alignItems: 'center', flex: 1 },
    statValue: { fontSize: 26, fontWeight: '800', color: c.accent },
    statLabel: { fontSize: 12, color: c.text_muted },
    line: { fontSize: 14, color: c.text_primary },
    muted: { fontSize: 13, color: c.text_muted, lineHeight: 18 },
    input: { borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text_primary, marginTop: 6 },
    primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
    primaryBtnText: { color: c.surface, fontWeight: '900', fontSize: 15 },
  });
}
