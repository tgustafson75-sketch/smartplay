/**
 * Global Tools menu — single source of truth.
 *
 * One sectioned bottom-sheet modal mounted once at app/_layout.tsx.
 * Replaces both the prior flat GlobalToolsMenu and the Caddie tab's
 * local showMoreMenu modal. Tim 2026-05-15: "we need to have a
 * universal tools menu across the app ... reformat it by topic or
 * element so that it is very intuitive."
 *
 * Sections (top → bottom):
 *   PRESENCE & VOICE   mode cycler, Quiet/Resume, persona, voice, cast
 *   GPS & ROUND        GPS refresh, yardage mode*, end round*
 *   PRACTICE           SwingLab, Cage, SmartVision, SmartFinder
 *   HELP               Custom caddie, Tutorials, Rules, YouTube
 *   APP                Settings, App Refresh
 *
 * Items marked * only render during an active round.
 *
 * Each item closes the modal + fires haptic + (where state-changing)
 * shows a brief toast. Persona cycler / mode cycler navigate to the
 * Caddie tab so the user lands on the screen where the change is
 * visible.
 */

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { useToolsMenuStore } from '../../store/toolsMenuStore';
import {
  useTrustLevelStore,
  TRUST_LEVEL_META,
  TRUST_LEVEL_SLIDER_ORDER,
} from '../../store/trustLevelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useToastStore } from '../../store/toastStore';
import { getCaddieName, ACTIVE_PERSONAS, type Persona } from '../../lib/persona';
import { recalibrateGps } from '../../services/gpsManager';
import { markGpsRefreshNow, useLastGpsRefresh, formatRefreshAge } from '../../services/lastGpsRefresh';
import { forceMarkPosition } from '../../services/positionMarkBus';
import { canAccess, type FeatureKey } from '../../services/featureAccess';
import { triggerPaywall } from '../../services/paywallGuard';
import { openYouTubeChannel } from '../../services/youtubeLinks';

export function GlobalToolsMenu() {
  const router = useRouter();
  const { colors } = useTheme();
  const isOpen = useToolsMenuStore((s) => s.isOpen);
  const close = useToolsMenuStore((s) => s.close);
  const lastGpsRefreshAt = useLastGpsRefresh();

  // Trust + persona
  const trustLevel = useTrustLevelStore((s) => s.level);
  const setTrustLevel = useTrustLevelStore((s) => s.setLevel);
  const caddiePersonality = useSettingsStore((s) => s.caddiePersonality);
  const setCaddiePersonality = useSettingsStore((s) => s.setCaddiePersonality);
  const caddieName = getCaddieName(caddiePersonality);
  // Toggles
  const voiceEnabled = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const castMode = useSettingsStore((s) => s.castMode);
  const setCastMode = useSettingsStore((s) => s.setCastMode);
  const yardageMode = useSettingsStore((s) => s.yardageMode);
  const setYardageMode = useSettingsStore((s) => s.setYardageMode);
  // 2026-05-16 — surface Active Listening one tap away from the Tools
  // menu (was previously buried in Settings, leading to Tim's "Kevin is
  // responding to my TV and I can't find the mute" report).
  const autoListenEnabled = useSettingsStore((s) => s.autoListenEnabled);
  const setAutoListenEnabled = useSettingsStore((s) => s.setAutoListenEnabled);
  // Round
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const endRound = useRoundStore((s) => s.endRound);
  // Feature gate (subscription_status lives in playerProfileStore)
  const subscription_status = usePlayerProfileStore((s) => s.subscription_status);

  // ─── Action helpers — all close menu + haptic, optional toast/nav ─

  const fire = (next: () => void | Promise<void>) => {
    void Haptics.selectionAsync().catch(() => undefined);
    close();
    void Promise.resolve(next()).catch((e) => console.log('[tools] action threw', e));
  };

  const cycleMode = () => {
    const cur = TRUST_LEVEL_SLIDER_ORDER.indexOf(trustLevel);
    const next = TRUST_LEVEL_SLIDER_ORDER[(cur + 1) % TRUST_LEVEL_SLIDER_ORDER.length];
    setTrustLevel(next);
    useToastStore.getState().show(`Now in ${TRUST_LEVEL_META[next].label}`);
    fire(() => router.push('/(tabs)/caddie' as never));
  };

  const toggleQuiet = () => {
    const next = trustLevel === 1 ? 2 : 1;
    setTrustLevel(next);
    useToastStore.getState().show(trustLevel === 1 ? 'Resumed' : 'Quiet Mode on');
    fire(() => undefined);
  };

  const cyclePersona = () => {
    const list = ACTIVE_PERSONAS as readonly Persona[];
    const idx = list.indexOf(caddiePersonality as Persona);
    const next = list[(Math.max(idx, -1) + 1) % list.length];
    setCaddiePersonality(next);
    useToastStore.getState().show(`Caddie: ${getCaddieName(next)}`);
    fire(() => undefined);
  };

  const toggleVoice = () => {
    setVoiceEnabled(!voiceEnabled);
    useToastStore.getState().show(voiceEnabled ? 'Voice off' : 'Voice on');
    fire(() => undefined);
  };

  const toggleCast = () => {
    setCastMode(!castMode);
    useToastStore.getState().show(castMode ? 'Cast Mode off' : 'Cast Mode on');
    fire(() => undefined);
  };

  const toggleActiveListening = () => {
    setAutoListenEnabled(!autoListenEnabled);
    useToastStore.getState().show(autoListenEnabled ? 'Active Listening off' : 'Active Listening on');
    fire(() => undefined);
  };

  const toggleYardageMode = () => {
    const next = yardageMode === 'live' ? 'preround' : 'live';
    setYardageMode(next);
    useToastStore.getState().show(next === 'live' ? 'Yardage: LIVE (GPS)' : 'Yardage: PRE-ROUND');
    fire(() => undefined);
  };

  const refreshGps = () => fire(async () => {
    try {
      const fix = await recalibrateGps();
      void forceMarkPosition().catch(() => undefined);
      if (fix?.accuracy_m != null) {
        void markGpsRefreshNow();
        Alert.alert('GPS refreshed', `Fresh fix at ±${Math.round(fix.accuracy_m)}m.`);
      } else if (fix) {
        void markGpsRefreshNow();
        Alert.alert('GPS refreshed', 'Fresh fix acquired.');
      } else {
        Alert.alert('GPS Refresh', "Couldn't get a fresh fix. Step into the open and try again.");
      }
    } catch {
      Alert.alert('GPS refresh failed', 'Step into open sky and try again.');
    }
  });

  const endRoundAction = () => fire(() => {
    // 2026-05-17 — offer Save vs Discard at end-of-round. Save path
    // appends to roundHistory + pushes differential + routes to recap.
    // Discard path resets everything without persisting.
    Alert.alert(
      'End round?',
      'Save the scorecard to your history, or discard everything?',
      [
        { text: 'Keep playing', style: 'cancel' },
        {
          text: 'Save & end',
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
            const roundId = endRound();
            useToastStore.getState().show('Round saved');
            try { router.push(`/recap/${roundId}` as never); }
            catch (e) { console.log('[tools] recap nav failed', e); }
          },
        },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Discard this round?',
              'All shots, scores, and plans from this round will be deleted. This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Discard everything',
                  style: 'destructive',
                  onPress: () => {
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
                    useRoundStore.getState().discardRound();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  });

  const navOrPaywall = (feature: FeatureKey, path: string) => fire(() => {
    if (!canAccess(feature, subscription_status)) {
      void triggerPaywall(feature, () => router.push('/paywall' as never));
      return;
    }
    router.push(path as never);
  });

  const nav = (path: string) => fire(() => router.push(path as never));

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <Pressable
          onPress={() => undefined}
          style={[styles.sheet, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text_muted }]}>TOOLS</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* ─── PRESENCE & VOICE ─────────────────────────────── */}
            <SectionHeader colors={colors}>PRESENCE & VOICE</SectionHeader>
            <Row
              icon="options-outline"
              label={`${caddieName}'s Presence: ${TRUST_LEVEL_META[trustLevel].label}`}
              sub={`${TRUST_LEVEL_META[trustLevel].one_liner} · Tap to cycle`}
              onPress={cycleMode}
              colors={colors}
            />
            <Row
              icon={trustLevel === 1 ? 'volume-high-outline' : 'volume-mute-outline'}
              label={trustLevel === 1 ? `Resume ${caddieName}` : 'Quiet Mode'}
              sub={trustLevel === 1 ? `Bring ${caddieName} back to Companion` : `Mute ${caddieName} until I'm ready`}
              onPress={toggleQuiet}
              colors={colors}
            />
            <Row
              icon="people-outline"
              label={`Caddie: ${caddieName}`}
              sub={`Tap to cycle · ${ACTIVE_PERSONAS.map((p) => getCaddieName(p)).join(' · ')}`}
              onPress={cyclePersona}
              colors={colors}
            />
            <Row
              icon={voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
              label={voiceEnabled ? 'Voice: ON' : 'Voice: OFF'}
              sub={voiceEnabled ? 'Caddie speaks responses aloud' : 'Caddie is silent — tap to enable'}
              onPress={toggleVoice}
              colors={colors}
            />
            <Row
              icon={autoListenEnabled ? 'mic' : 'mic-off-outline'}
              label={autoListenEnabled ? 'Active Listening: ON' : 'Active Listening: OFF'}
              sub={autoListenEnabled
                ? `${caddieName} listens automatically during rounds. Tap to mute.`
                : `Tap so ${caddieName} listens for voice commands during rounds.`}
              onPress={toggleActiveListening}
              colors={colors}
            />
            <Row
              icon={castMode ? 'tv' : 'tv-outline'}
              label={castMode ? 'Cast Mode: ON' : 'Cast Mode: OFF'}
              sub={castMode ? 'Large-text display for casting' : 'Switch to large-text TV-casting layout'}
              onPress={toggleCast}
              colors={colors}
            />

            {/* ─── GPS & ROUND ──────────────────────────────────── */}
            <SectionHeader colors={colors}>GPS & ROUND</SectionHeader>
            <Row
              icon="compass-outline"
              label="GPS Refresh"
              sub={`Last refresh: ${formatRefreshAge(lastGpsRefreshAt)}`}
              onPress={refreshGps}
              colors={colors}
            />
            {isRoundActive && (
              <>
                <Row
                  icon={yardageMode === 'live' ? 'navigate-circle' : 'navigate-circle-outline'}
                  label={`Yardage: ${yardageMode === 'live' ? 'LIVE (GPS)' : 'PRE-ROUND (static)'}`}
                  sub={yardageMode === 'live' ? 'Tap to switch to scorecard yardages' : 'Tap to refresh GPS and go live'}
                  onPress={toggleYardageMode}
                  colors={colors}
                />
                <Row
                  icon="flag-outline"
                  label="End Round"
                  sub="Finish and save the scorecard"
                  onPress={endRoundAction}
                  colors={colors}
                />
              </>
            )}

            {/* ─── PRACTICE ────────────────────────────────────── */}
            <SectionHeader colors={colors}>PRACTICE</SectionHeader>
            <Row
              icon="golf-outline"
              label="Practice"
              sub="SwingLab · drills · range"
              onPress={() => nav('/(tabs)/swinglab')}
              colors={colors}
            />
            <Row
              icon="videocam-outline"
              label="Cage Mode"
              sub="Multi-shot session"
              onPress={() => navOrPaywall('cage_mode', '/cage')}
              colors={colors}
            />
            <Row
              icon="flash-outline"
              label="SmartMotion"
              sub="Quick swing capture · acoustic auto-stop"
              onPress={() => nav('/smartmotion-quick')}
              colors={colors}
            />
            <Row
              icon="construct-outline"
              label="Reference Authoring"
              sub="Internal · capture instructor reference assets"
              onPress={() => nav('/author/reference-assets')}
              colors={colors}
            />
            <Row
              icon="telescope-outline"
              label="SmartVision"
              sub="Analyze the hole"
              onPress={() => navOrPaywall('smartvision', '/smartvision')}
              colors={colors}
            />
            <Row
              icon="locate-outline"
              label="SmartFinder"
              sub="Tap-to-lock rangefinder"
              onPress={() => navOrPaywall('smartfinder', '/smartfinder')}
              colors={colors}
            />

            {/* ─── HELP ────────────────────────────────────────── */}
            <SectionHeader colors={colors}>HELP</SectionHeader>
            <Row
              icon="sparkles-outline"
              label="Your Caddie"
              sub="Selfie → AI portrait + voice"
              onPress={() => nav('/profile/custom-caddie')}
              colors={colors}
            />
            <Row
              icon="library-outline"
              label="Tutorials"
              sub="How each tool works"
              onPress={() => nav('/tutorials')}
              colors={colors}
            />
            <Row
              icon="book-outline"
              label="Rules & Handicap"
              sub="Quick reference + WHS calculator"
              onPress={() => nav('/reference')}
              colors={colors}
            />
            <Row
              icon="logo-youtube"
              label="YouTube Channel"
              sub="@smartplaycaddie"
              onPress={() => fire(() => { void openYouTubeChannel('@smartplaycaddie').catch(() => undefined); })}
              colors={colors}
            />

            {/* ─── APP ─────────────────────────────────────────── */}
            <SectionHeader colors={colors}>APP</SectionHeader>
            <Row
              icon="settings-outline"
              label="Settings"
              sub="Profile, voice, language, theme"
              onPress={() => nav('/settings')}
              colors={colors}
            />
            <Row
              icon="cloud-download-outline"
              label="App Refresh"
              sub="Pull the latest fix from the preview channel"
              onPress={() => fire(async () => {
                try {
                  const Updates = await import('expo-updates');
                  if (!Updates.isEnabled) {
                    Alert.alert('App Refresh', 'Updates are not enabled in this build. Reinstall the latest APK to start receiving over-the-air updates.');
                    return;
                  }
                  const result = await Updates.checkForUpdateAsync();
                  if (!result.isAvailable) {
                    Alert.alert('App Refresh', "You're on the latest build. Nothing to fetch.");
                    return;
                  }
                  await Updates.fetchUpdateAsync();
                  Alert.alert(
                    'App Refresh',
                    'A new bundle was downloaded. Restart now to apply it?',
                    [
                      { text: 'Later', style: 'cancel' },
                      { text: 'Restart now', style: 'default', onPress: () => { void Updates.reloadAsync(); } },
                    ],
                  );
                } catch {
                  Alert.alert('App Refresh', 'Refresh failed. Try again in a moment.');
                }
              })}
              colors={colors}
            />
          </ScrollView>

          <Pressable
            onPress={close}
            style={({ pressed }) => [
              styles.closeBtn,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.closeText, { color: colors.text_muted }]}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Internal components ───────────────────────────────────────────

function SectionHeader({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.sectionHeaderWrap}>
      <Text style={[styles.sectionHeader, { color: colors.accent }]}>{children}</Text>
    </View>
  );
}

interface RowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sub: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}

function Row({ icon, label, sub, onPress, colors }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.accent} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text_primary }]}>{label}</Text>
        <Text style={[styles.rowSub, { color: colors.text_muted }]} numberOfLines={2}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.text_muted} />
    </Pressable>
  );
}

export default GlobalToolsMenu;

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    paddingBottom: 6,
  },
  sectionHeaderWrap: {
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowIcon: { width: 28 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  closeBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  closeText: { fontSize: 13, fontWeight: '700' },
});
