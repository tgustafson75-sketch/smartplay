/**
 * One-time core permissions pre-flight.
 *
 * Tim's complaint that prompted this: every camera-using surface was
 * asking for permission individually, and tapping "Allow" silently
 * failed in some Android states. Result: stuck on a permission screen
 * with no way out.
 *
 * Fix: ONE friendly screen at first launch (after the intro video,
 * before onboarding) that requests every permission the app needs in
 * one batch. After that, every tool checks the granted state and uses
 * it directly — no per-tool dialog.
 *
 * 2026-09-15 — APP REVIEW, GUIDELINE 5.1.1(iv). Rejected on two counts,
 * both about this screen:
 *
 *   - the primary button used the word Apple's own dialog uses, which reads as
 *     the app telling the user how to answer that dialog. It says "Continue"
 *     now: the words on OUR button describe leaving OUR screen, and the verb
 *     of consent belongs to the system prompt.
 *   - a postpone button let the user close the explanation and never reach the
 *     request. A primer may explain a permission request; it may not stand in
 *     for one. That button is gone, and Continue ALWAYS asks.
 *
 * (Both rejected strings are deliberately not quoted here — a release grep for
 * them should come back clean on this file.)
 *
 * Removing Skip removed the escape hatch this screen was built around. Tim's
 * call on the replacement (2026-09-15): FIX BY REMOVING — no banner, no toast,
 * no second state. So the screen still exits on its own the moment the OS is
 * done, whatever the answers were; declining every dialog is a complete, valid
 * finish, not an error worth a screen of its own.
 *
 * The recovery path for a denial already exists and is not duplicated here:
 * components/PermissionBanner (location, on the Caddie tab), app/lie-analysis
 * and hooks/useVoiceCaddie (camera and mic) each show their own notice with a
 * Linking.openSettings link WHEN the feature is opened — which is both where it
 * is useful and, per Apple's own guidance, the only place a Settings link
 * belongs. It must never appear before the request.
 *
 * What is left carrying the no-strand property is invisible and has no UI:
 * requestCorePermissions is raced against ASK_TIMEOUT_MS, and a throw exits.
 * Without those, "no way past the prompt" could become "no way out at all".
 *
 * The tutorialsSeen flag flips on exit by ANY route, so we never re-ask on the
 * next cold launch. [[reachable-not-just-wired]]
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { requestCorePermissions, getCorePermissionsState, corePermissionsRequested, type CorePermissionsResult } from '../services/permissionsManager';
import { useSettingsStore } from '../store/settingsStore';
import { useTranslation } from 'react-i18next';

const PERMISSIONS = [
  {
    icon: 'camera-outline' as const,
    label: 'Camera',
    why: 'For SmartVision hole reads, swing recordings in SmartMotion, lie analysis, SmartFinder, and round photos.',
  },
  {
    icon: 'mic-outline' as const,
    label: 'Microphone',
    why: 'For voice-mode caddie conversations and auto-detecting swings in SmartMotion.',
  },
  {
    icon: 'location-outline' as const,
    label: 'Location',
    why: 'For GPS yardages, hole detection, SmartFinder, and shot tracking. Required for almost everything during a round.',
  },
  {
    icon: 'images-outline' as const,
    label: 'Photo Library',
    why: 'For Space Scan and Tutorial Upload when you pick a photo or video instead of capturing one fresh.',
  },
];
// 2026-07-18 — background ("Allow all the time") location is NOT requested here anymore; it's
// asked just-in-time when a round starts (store-compliant). See services/permissionsManager.ts.

/**
 * A hung permission request used to be survivable because a postpone button was still on screen.
 * It isn't any more, so the hang itself has to be impossible: whatever the OS does or fails to do,
 * this screen ends. Long enough that a slow Android multi-dialog sequence finishes normally and
 * nobody is bounced mid-prompt, short enough that nobody thinks the app is dead.
 */
const ASK_TIMEOUT_MS = 30_000;

export default function PermissionsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CorePermissionsResult | null>(null);

  // If the user has already been through this screen on a prior launch,
  // skip straight to the next step — never re-prompt unless reset.
  useEffect(() => {
    if (corePermissionsRequested()) {
      void exit('already-asked');
      return;
    }
    // Fetch current state so the UI shows what's already granted (e.g.
    // user manually granted in Settings before reaching this screen).
    void getCorePermissionsState().then(setResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single exit point — flips the tutorial flag (so we never re-ask
  // automatically) and routes back through index for the next step.
  // Using router.replace so the user can't swipe back into this screen.
  const exit = async (reason: 'asked' | 'already-asked' | 'ask-timed-out' | 'ask-failed') => {
    try { useSettingsStore.getState().markTutorialSeen('core_permissions_requested'); } catch {}
    console.log('[permissions] exit:', reason);
    try { router.replace('/'); } catch {}
  };

  /**
   * Continue — the only control on the screen, and it always makes the request.
   *
   * Every finish is the same finish: ask, show the checks land for a beat, leave. A partial or
   * total denial is NOT treated as a failure and gets no extra state — the tools that need each
   * permission carry their own notice, and the player meets it when they open one.
   */
  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Raced, not awaited bare: see ASK_TIMEOUT_MS. The loser of the race is discarded, so a late
      // reply cannot re-enter and move the screen under the user.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([
        requestCorePermissions(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ASK_TIMEOUT_MS); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!r) {
        // The OS never came back. Leave rather than hold the player on a screen with one dead
        // button — the per-tool permission UX is downstream either way.
        console.log('[permissions] requestCorePermissions timed out after', ASK_TIMEOUT_MS, 'ms');
        void exit('ask-timed-out');
        return;
      }
      setResult(r);
      // Long enough to see the checks land, then out — whatever the answers were.
      setTimeout(() => { void exit('asked'); }, 600);
    } catch (e) {
      console.log('[permissions] requestCorePermissions threw', e);
      // Never strand the user. Tools fall back to per-call permission UX.
      void exit('ask-failed');
    } finally {
      setBusy(false);
    }
  };

  const renderStateIcon = (granted: boolean | undefined) => {
    if (granted === true) return <Ionicons name="checkmark-circle" size={20} color="#00C896" />;
    return <Ionicons name="ellipse-outline" size={20} color="#6b7280" />;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Ionicons name="shield-checkmark-outline" size={36} color="#00C896" />
          <Text style={styles.title}>{t('permissions.permissions_screen.quick_setup')}</Text>
          <Text style={styles.subtitle}>
            {t('permissions.permissions_screen.we_only_ask_once_allow')}
          </Text>
        </View>

        <View style={styles.list}>
          {PERMISSIONS.map((p, i) => {
            const granted = result
              ? (i === 0 ? result.camera.granted
                : i === 1 ? result.microphone.granted
                : i === 2 ? result.location.granted
                : result.mediaLibrary.granted)
              : undefined;
            return (
              <View key={p.label} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons name={p.icon} size={22} color="#00C896" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{p.label}</Text>
                  <Text style={styles.rowWhy}>{p.why}</Text>
                </View>
                {renderStateIcon(granted)}
              </View>
            );
          })}
        </View>

        <Text style={styles.foot}>
          {t('permissions.permissions_screen.when_you_start_a_round')}
        </Text>

        {/**
          * GUIDELINE 5.1.1(iv) — ONE control, and it always reaches the system dialogs.
          *
          * There is deliberately nothing else on this screen: no skip, no "not now", no Settings
          * shortcut. A Settings link here would be the same defect wearing a different label — the
          * player leaves the explanation without ever meeting the request. It belongs downstream,
          * on the feature that needs the permission, which is where the app already puts it.
          *
          * The label says "Continue" because it describes leaving OUR screen. "Allow" is the OS
          * dialog's word, and putting it on our button is what the rejection was about.
          */}
        <TouchableOpacity
          style={[styles.allowBtn, busy && styles.allowBtnBusy]}
          onPress={handleContinue}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('permissions.accessibility_label.continue_to_the_permission_requests')}
        >
          <Text style={styles.allowBtnText}>{busy ? 'Asking…' : t('permissions.permissions_screen.continue')}</Text>
        </TouchableOpacity>

        <Text style={styles.foot}>{t('permissions.permissions_screen.you_can_change_any_of')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  scroll: { padding: 24, gap: 18 },
  header: { alignItems: 'center', gap: 8, marginTop: 12 },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '900', marginTop: 8 },
  subtitle: { color: '#c2cad4', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12 },
  list: { gap: 12, marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, padding: 14,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: 'rgba(0,200,150,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  rowWhy: { color: '#c2cad4', fontSize: 12, marginTop: 4, lineHeight: 17 },
  allowBtn: {
    backgroundColor: '#00C896', borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginTop: 6,
  },
  allowBtnBusy: { opacity: 0.6 },
  allowBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },
  foot: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 12 },
});
