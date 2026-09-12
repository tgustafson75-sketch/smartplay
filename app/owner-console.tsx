/**
 * 2026-09-11 (Tim) — ONE OWNER CONSOLE, NOT A HUNT THROUGH SUBCARDS.
 *
 * "We have multiple platforms for harnesses and issue logs and things like that. Do we need to
 *  condense this for me into one card, like that's more dashboard style, that I can go to that isn't
 *  finding what subcard I'm looking for. And then probably start to hide ones that aren't active."
 *
 * Owner Tools had grown to SIXTEEN separate route pushes inside a collapsible section, plus six more
 * debug screens that nothing linked to at all. Finding the right one meant remembering which of them
 * it was — which is not a tool, it is a filing cabinet.
 *
 * So: status first, then the tools grouped by what you are actually doing. The top strip exists to
 * answer "does anything need me?" without opening anything — an open checklist, unsent issues, a
 * voice path degrading to cloud. If all three are quiet you can leave.
 *
 * WHAT IS NOT HERE, DELIBERATELY:
 *  - Mark Green / Mark Tee / location sub-menus. Tim: "When I say a marker green or a location or a
 *    tee box, I'm gonna do it verbally. I'm not going to a sub menu to mark fucking locations
 *    anymore." The voice path owns that now; a menu for it is a worse version of a feature we have.
 *  - Three screens untouched since May sit under Archived rather than in the grid, because a tool
 *    you have not opened in four months is noise in the one place you go when something is wrong.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { useOwnerChecklistStore } from '../store/ownerChecklistStore';
import { useIssueLogStore } from '../store/issueLogStore';
import { useVoiceHitRateStore } from '../store/voiceHitRateStore';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';

type Tool = { label: string; sub: string; route: string; icon: React.ComponentProps<typeof Ionicons>['name'] };

const GROUPS: { title: string; tools: Tool[] }[] = [
  {
    title: 'FIELD TEST',
    tools: [
      { label: 'Checklist', sub: 'Field tests and ship steps', route: '/owner-checklist', icon: 'checkbox-outline' },
      { label: 'Issue Log', sub: 'Everything logged by voice or tap', route: '/owner-logs', icon: 'document-text-outline' },
      { label: 'Shot Log', sub: 'Every shot this round, with numbers', route: '/shot-log', icon: 'list-outline' },
      { label: 'Owner Card', sub: 'The one-page state of the app', route: '/owner-card', icon: 'card-outline' },
    ],
  },
  {
    title: 'DIAGNOSTICS',
    tools: [
      { label: 'GPS Bench', sub: 'Fix quality, drift, hole detection', route: '/gps-test', icon: 'navigate-outline' },
      { label: 'Native Modules', sub: 'What loaded and what did not', route: '/native-modules-debug', icon: 'hardware-chip-outline' },
      { label: 'API', sub: 'Routes, latency, providers', route: '/api-debug', icon: 'cloud-outline' },
      { label: 'Voice', sub: 'Recognition path and failures', route: '/voice-debug', icon: 'mic-outline' },
      { label: 'Voice Misses', sub: 'What he heard wrong', route: '/voice-misses', icon: 'ear-outline' },
      { label: 'Patterns', sub: 'What the engine has inferred', route: '/patterns-debug', icon: 'analytics-outline' },
    ],
  },
  {
    title: 'HARNESS',
    tools: [
      { label: 'Scenario Harness', sub: 'Run the on-device scenarios', route: '/harness', icon: 'flask-outline' },
      { label: 'Auto Sim Round', sub: 'The app plays itself and reports', route: '/simround-auto', icon: 'play-circle-outline' },
      { label: 'Swing Sessions', sub: 'Captured sessions and analyses', route: '/swing-sessions-debug', icon: 'videocam-outline' },
      { label: 'Ghost', sub: 'Ghost round state', route: '/ghost-debug', icon: 'person-outline' },
    ],
  },
  {
    title: 'CONTENT',
    tools: [
      { label: 'Reference Assets', sub: 'Train the trainer', route: '/author/reference-assets', icon: 'images-outline' },
      { label: 'Tutorials', sub: 'Swing Lab tutorial content', route: '/swinglab/tutorials', icon: 'school-outline' },
      { label: 'What He Is Learning', sub: 'The caddie’s own notes on you', route: '/kevin-learning', icon: 'bulb-outline' },
      { label: 'Subscription', sub: 'Entitlement and trial state', route: '/subscription-debug', icon: 'pricetag-outline' },
    ],
  },
];

/**
 * Owner ACTIONS — things that DO something rather than open somewhere. They lived as rows in the
 * settings section alongside the navigation, which is part of why finding anything there meant
 * reading all of it. Destructive or noisy ones confirm first.
 */
type Action = { label: string; sub: string; icon: React.ComponentProps<typeof Ionicons>['name']; run: () => void };

/** Untouched since May. Kept reachable, kept out of the way. */
const ARCHIVED: Tool[] = [
  { label: 'Battery + GPS', sub: 'Last touched May', route: '/battery-debug', icon: 'battery-half-outline' },
  { label: 'SmartFinder', sub: 'Last touched May', route: '/smartfinder-debug', icon: 'locate-outline' },
  { label: 'Swing Analysis', sub: 'Last touched May', route: '/swing-analysis-debug', icon: 'body-outline' },
];

export default function OwnerConsole() {
  const { colors } = useTheme();
  const router = useRouter();
  const [showArchived, setShowArchived] = React.useState(false);
  /**
   * Owner-only at the RENDER as well as at the route. app/_layout.tsx gates '/owner-console', but a
   * route is reachable by voice, deep link, or typing it, and this screen is the front door to every
   * other owner surface — so it is gated at least as tightly as the tightest thing it reaches.
   */
  const isOwner = isOwnerEmail(usePlayerProfileStore((s) => s.email));

  // Select the array itself and count outside: a selector that allocates re-runs on every store
  // write, and `.filter()` inside one is the shape a-selector-must-not-build-what-it-returns forbids.
  const checklistItems = useOwnerChecklistStore((s) => s.items);
  const checklistOpen = useMemo(
    () => checklistItems.reduce((n, i) => (i.done ? n : n + 1), 0),
    [checklistItems],
  );
  const issueCount = useIssueLogStore((s) => s.entries.length);
  const local = useVoiceHitRateStore((s) => s.local);
  const cloud = useVoiceHitRateStore((s) => s.cloud);
  const resetVoiceRate = useVoiceHitRateStore((s) => s.reset);

  /**
   * The three numbers worth knowing before you open anything. Each is stated as a FACT with its own
   * tone — amber when it wants attention — so "does anything need me?" is answered by colour, not by
   * reading. A zero here is good news and says so quietly.
   */
  const status = useMemo(() => {
    const total = local + cloud;
    const localPct = total === 0 ? null : Math.round((local / total) * 100);
    return [
      { k: 'Checklist', v: checklistOpen === 0 ? 'clear' : `${checklistOpen} open`, warn: checklistOpen > 0, onPress: undefined as (() => void) | undefined },
      { k: 'Issues', v: issueCount === 0 ? 'none' : String(issueCount), warn: issueCount > 0, onPress: undefined as (() => void) | undefined },
      {
        k: 'Voice on-device',
        v: localPct == null ? '—' : `${localPct}%`,
        warn: localPct != null && localPct < 50,
        /**
         * The settings row this replaced carried the local/cloud split and a reset, so the cell
         * keeps both rather than dropping to a bare percentage. A rate you cannot reset stops being
         * a measurement of anything after the first bad week.
         */
        onPress: () => Alert.alert(
          'Reset voice hit rate?',
          total === 0
            ? 'No voice asks yet. Answered on-device vs escalated to the cloud — should climb as the brain learns.'
            : `Local ${localPct}% — ${local} on-device / ${cloud} cloud (${total} asks).`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: () => resetVoiceRate() },
          ],
        ),
      },
    ];
  }, [checklistOpen, issueCount, local, cloud, resetVoiceRate]);

  const build = `${Constants.expoConfig?.version ?? '?'} · ${(Constants.expoConfig as { ios?: { buildNumber?: string } } | null)?.ios?.buildNumber ?? ''}`;

  const ACTIONS: Action[] = [
    {
      label: 'Sim Round',
      sub: 'Palms, 9 holes, voice-narrated',
      icon: 'game-controller-outline',
      run: () => {
        try {
          const sim = require('../services/simRound') as typeof import('../services/simRound');
          const r = sim.startVoiceSimRound({ nineHoles: true });
          (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore
            .getState().show(r.ok ? '🎮 Sim round started — Palms, 9 holes' : r.say);
          if (r.ok) router.push('/(tabs)/caddie' as never);
        } catch (e) { console.log('[owner-console] sim round start failed:', e); }
      },
    },
    {
      label: 'Send Test Error',
      sub: 'Fires one real error into Sentry',
      icon: 'bug-outline',
      run: () => {
        const stamp = new Date().toISOString();
        Alert.alert('Send a test error?', 'Fires one real error into Sentry.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send it',
            onPress: () => {
              try { Sentry.addBreadcrumb({ category: 'owner', message: 'owner test error requested', level: 'info' }); } catch { /* non-fatal */ }
              /**
               * Thrown OUT OF BAND on purpose: this is the path an uncaught async error actually
               * takes to Sentry. captureException would exercise a different one and prove less.
               */
              setTimeout(() => { throw new Error(`SmartPlay owner test error · ${stamp}`); }, 0);
              Alert.alert('Sent', 'Check Sentry.');
            },
          },
        ]);
      },
    },
    {
      label: 'Reset Tutorials',
      sub: 'Every first-run tutorial plays again',
      icon: 'refresh-outline',
      run: () => {
        Alert.alert('Reset tutorials?', 'Every first-run tutorial will play again.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: () => useSettingsStore.getState().resetTutorials() },
        ]);
      },
    },
  ];

  const Tile = ({ t }: { t: Tool }) => (
    <TouchableOpacity
      style={[styles.tile, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
      onPress={() => router.push(t.route as never)}
      accessibilityRole="button"
      accessibilityLabel={t.label}
    >
      <Ionicons name={t.icon} size={18} color={colors.accent} />
      <Text style={[styles.tileLabel, { color: colors.text_primary }]} numberOfLines={1}>{t.label}</Text>
      <Text style={[styles.tileSub, { color: colors.text_muted }]} numberOfLines={2}>{t.sub}</Text>
    </TouchableOpacity>
  );

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.denied}>
          <Text style={[styles.tileSub, { color: colors.text_muted }]}>Owner tools only.</Text>
          <TouchableOpacity onPress={() => safeBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={{ color: colors.accent }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Owner Console</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={[styles.statusCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}>
          {status.map((s) => (
            <TouchableOpacity
              key={s.k}
              style={styles.statusCell}
              onPress={s.onPress}
              disabled={!s.onPress}
              accessibilityRole={s.onPress ? 'button' : undefined}
              accessibilityLabel={`${s.k}: ${s.v}`}
            >
              <Text style={[styles.statusValue, { color: s.warn ? colors.accent_amber : colors.accent }]} numberOfLines={1}>{s.v}</Text>
              <Text style={[styles.statusKey, { color: colors.text_muted }]} numberOfLines={1}>{s.k}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.buildLine, { color: colors.text_muted }]}>Build {build}</Text>

        {GROUPS.map((g) => (
          <View key={g.title}>
            <Text style={[styles.groupTitle, { color: colors.text_primary }]}>{g.title}</Text>
            <View style={styles.grid}>{g.tools.map((t) => <Tile key={t.route} t={t} />)}</View>
          </View>
        ))}

        <Text style={[styles.groupTitle, { color: colors.text_primary }]}>ACTIONS</Text>
        <View style={styles.grid}>
          {ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.label}
              style={[styles.tile, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
              onPress={a.run}
              accessibilityRole="button"
              accessibilityLabel={a.label}
            >
              <Ionicons name={a.icon} size={18} color={colors.accent_amber} />
              <Text style={[styles.tileLabel, { color: colors.text_primary }]} numberOfLines={1}>{a.label}</Text>
              <Text style={[styles.tileSub, { color: colors.text_muted }]} numberOfLines={2}>{a.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => setShowArchived((v) => !v)}
          style={styles.archiveToggle}
          accessibilityRole="button"
          accessibilityLabel={showArchived ? 'Hide archived tools' : 'Show archived tools'}
        >
          <Text style={[styles.groupTitle, { color: colors.text_muted, marginBottom: 0 }]}>
            ARCHIVED{showArchived ? '' : ` · ${ARCHIVED.length}`}
          </Text>
          <Ionicons name={showArchived ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text_muted} />
        </TouchableOpacity>
        {showArchived ? <View style={styles.grid}>{ARCHIVED.map((t) => <Tile key={t.route} t={t} />)}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  statusCard: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 6,
    borderRadius: 12, borderWidth: 1, paddingVertical: 12,
  },
  statusCell: { flex: 1, alignItems: 'center', gap: 3 },
  statusValue: { fontSize: 17, fontWeight: '900' },
  statusKey: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  buildLine: { fontSize: 10.5, textAlign: 'center', marginTop: 6 },
  groupTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginHorizontal: 16, marginTop: 20, marginBottom: 9 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, paddingHorizontal: 16 },
  tile: { width: '48%', borderRadius: 12, borderWidth: 1, padding: 11, gap: 3, minHeight: 78 },
  tileLabel: { fontSize: 13, fontWeight: '800' },
  tileSub: { fontSize: 11, lineHeight: 14 },
  archiveToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 22, marginBottom: 8 },
});
