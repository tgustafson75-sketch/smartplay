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
  // 2026-06-04 — Coach Mode toggle moved into this central tool menu
  // (was an L4 dropdown icon + an overlay badge on Kevin's box). When
  // ON, Caddie tab + Dashboard surface the shared-session entry; when
  // OFF, both hide regardless of roster.
  const coachModeEnabled = useSettingsStore((s) => s.coachModeEnabled);
  const setCoachModeEnabled = useSettingsStore((s) => s.setCoachModeEnabled);
  // Round
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const endRound = useRoundStore((s) => s.endRound);
  // Feature gate (subscription_status lives in playerProfileStore)
  const subscription_status = usePlayerProfileStore((s) => s.subscription_status);
  // 2026-06-15 (Tim) — Reference Authoring relocated to Settings → Owner Tools
  // as "Train the Trainer"; the owner gate (isOwnerEmail) moved with it.

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
    useToastStore.getState().show(trustLevel === 1 ? 'Back to Companion' : 'Cockpit on');
    fire(() => undefined);
  };

  const cyclePersona = () => {
    const list = ACTIVE_PERSONAS as readonly Persona[];
    const idx = list.indexOf(caddiePersonality as Persona);
    const next = list[(Math.max(idx, -1) + 1) % list.length];
    setCaddiePersonality(next);
    // 2026-06-06 — Custom-caddie sync. Selecting 'custom' in the cycler
    // IS the way to activate the user's self-generated caddie; flip the
    // existing useCustomCaddie boolean so the existing avatar-swap +
    // voice-clip override paths (caddie.tsx, voiceService) fire. When
    // leaving 'custom' for any other persona, flip it off so the
    // standard persona's portrait + voice resume cleanly.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const profileMod = require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore');
      profileMod.usePlayerProfileStore.getState().setUseCustomCaddie(next === 'custom');
    } catch (e) {
      console.log('[cyclePersona] custom sync failed (non-fatal):', e);
    }
    // Display the user's chosen name when they pick custom (or
    // "My Caddie" if they haven't named it yet).
    let displayName = getCaddieName(next);
    if (next === 'custom') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const profileMod = require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore');
        const name = profileMod.usePlayerProfileStore.getState().customCaddieName;
        if (name && name.trim()) displayName = name.trim();
      } catch { /* fallback already set */ }
    }
    useToastStore.getState().show(`Caddie: ${displayName}`);
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
            {/* ─── PRESENCE & VOICE ───────────────────────────────
                2026-05-28 — Fix FK: subtext tightened across the six
                rows. Prior copy ("Caddie speaks responses aloud",
                "Switch to large-text TV-casting layout", full persona
                roster joined with dots, etc.) read as paragraphs in a
                menu that's meant to scan in one glance. Now each row
                is icon + state + one short hint. */}
            <SectionHeader colors={colors}>PRESENCE & VOICE</SectionHeader>
            <Row
              icon="options-outline"
              label={`Presence: ${TRUST_LEVEL_META[trustLevel].label}`}
              sub="Tap to cycle modes"
              onPress={cycleMode}
              colors={colors}
            />
            <Row
              icon={trustLevel === 1 ? 'volume-high-outline' : 'speedometer-outline'}
              label={trustLevel === 1 ? 'Exit Cockpit' : 'Cockpit Mode'}
              sub={trustLevel === 1 ? `Back to ${caddieName}` : "Harry's cockpit · tap to talk"}
              onPress={toggleQuiet}
              colors={colors}
            />
            <Row
              icon="people-outline"
              label={`Caddie: ${caddieName}`}
              sub="Tap to switch personas"
              onPress={cyclePersona}
              colors={colors}
            />
            <Row
              icon={voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
              label={voiceEnabled ? 'Voice: ON' : 'Voice: OFF'}
              sub={voiceEnabled ? 'Speaking aloud' : 'Silent — tap to enable'}
              onPress={toggleVoice}
              colors={colors}
            />
            <Row
              icon={autoListenEnabled ? 'mic' : 'mic-off-outline'}
              label={autoListenEnabled ? 'Active Listening: ON' : 'Active Listening: OFF'}
              sub={autoListenEnabled ? 'Hot mic during rounds' : 'Tap to enable hot mic'}
              onPress={toggleActiveListening}
              colors={colors}
            />
            <Row
              icon={castMode ? 'tv' : 'tv-outline'}
              label={castMode ? 'Cast Mode: ON' : 'Cast Mode: OFF'}
              sub={castMode ? 'Large-text TV layout' : 'Tap for large-text TV layout'}
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
                  label={`Yardage: ${yardageMode === 'live' ? 'LIVE' : 'PRE-ROUND'}`}
                  sub={yardageMode === 'live' ? 'Tap for scorecard yardages' : 'Tap to go live on GPS'}
                  onPress={toggleYardageMode}
                  colors={colors}
                />
                <Row
                  icon="location-outline"
                  label="Mark Location"
                  sub="Capture real GPS for this hole"
                  onPress={() => {
                    useToolsMenuStore.getState().close();
                    try { router.push('/mark-green' as never); }
                    catch (e) { console.log('[tools] mark-location nav failed', e); }
                  }}
                  colors={colors}
                />
                {/* 2026-05-28 — Fix FK: Shot Log relocated from PRACTICE
                    to here. It's round-context only; living under
                    PRACTICE made it look like a between-rounds tool. */}
                <Row
                  icon="list-outline"
                  label="Shot Log"
                  sub="Every shot this round"
                  onPress={() => nav('/shot-log')}
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

            {/* ─── PRACTICE ──────────────────────────────────────
                2026-05-28 — Fix FK: Cage Mode + SmartMotion + Shot Log
                rows trimmed/relocated. Cage Mode used to route to the
                legacy /cage flow (wrong tool); the SwingLab tab card
                is the canonical Pro entry, so this section now points
                at the launcher rather than duplicating the cards.
                SmartVision + SmartFinder stay because they're routinely
                opened mid-round from this menu (not via SwingLab). */}
            <SectionHeader colors={colors}>PRACTICE</SectionHeader>
            <Row
              icon="golf-outline"
              label="SwingLab"
              sub="Cage Mode · SmartMotion · drills · library"
              onPress={() => nav('/(tabs)/swinglab')}
              colors={colors}
            />
            {/* 2026-06-15 (Tim) — "Reference Authoring" moved to Settings → Owner
                Tools as "Train the Trainer" (instructor surface). Removed here to
                avoid a duplicate owner entry. */}
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
              sub="Rangefinder · tap to lock distance"
              onPress={() => navOrPaywall('smartfinder', '/smartfinder')}
              colors={colors}
            />
            {/* 2026-06-17 — Smart Play tap shortcut mirrors the voice trigger
                "Hey Caddy, what's the smart play?" → SmartFinder + autoread.
                Opens the same screen as SmartFinder but auto-fires the caddie
                scene read so the user doesn't need to tap the eye button. */}
            <Row
              icon="eye-outline"
              label="Smart Play"
              sub="What's the smart play? · caddie reads the scene"
              onPress={() => navOrPaywall('smartfinder', '/smartfinder?autoread=1')}
              colors={colors}
            />
            {/* 2026-06-04 — Coach Mode toggle. Tap the row to flip the
                setting (no nav). When ON, shared-session surfaces appear
                on Caddie + Dashboard; when OFF, both hide. Sub-label
                reflects current state so users see what they're flipping. */}
            <Row
              icon={coachModeEnabled ? 'people' : 'people-outline'}
              label="Coach Mode"
              sub={coachModeEnabled ? 'On — shared sessions visible' : 'Off — tap to enable shared sessions'}
              onPress={() => fire(() => {
                setCoachModeEnabled(!coachModeEnabled);
                useToastStore.getState().show(coachModeEnabled ? 'Coach Mode off' : 'Coach Mode on');
              })}
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
              sub="Check for and apply the latest OTA update"
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
      // 2026-06-05 — Explicit accessibilityRole + label so screen
      // readers announce "<label>, <sub>, button" instead of just
      // reading the visible Text children sequentially. hitSlop gives
      // off-target taps on fold-open / landscape a safety margin
      // since paddingVertical alone is only 12pt.
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sub}`}
      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
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
