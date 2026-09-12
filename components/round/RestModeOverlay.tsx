import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';

/**
 * 2026-09-12 (Tim) — "need the neon outline logo we use for text box added large to the rest screen.
 * Words are hard to see alone many times."
 *
 * The rest screen was three lines of dim type on pure black. On a bag clip in daylight that is a
 * blank phone with some grey text on it — you cannot tell at a glance that the app is alive, which
 * is the ONE thing this screen exists to say. The mark reads from much further away than the words
 * do, and it is the same neon caddie that sits in the ask bar, so the resting app still looks like
 * the app. Same asset, one source: assets/icons/caddie/mic-caddie.png.
 */
const REST_MARK = require('../../assets/icons/caddie/mic-caddie.png');
import { usePathname } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRestModeStore } from '../../store/restModeStore';
import { useRoundStore } from '../../store/roundStore';
import { useTranslation } from 'react-i18next';

/**
 * 2026-06-13 — Rest overlay (Tim #8 battery drain). 2026-07-24 — extended to EVERY screen (Tim:
 * "add the same screen timeout to all screens" for battery), not just an active round.
 *
 * Auto-engages after IDLE_MS of no touch, painting the screen near-pure-black. On OLED that turns most
 * of the panel physically OFF — big battery savings — while GPS / voice / the round keep running
 * underneath. Any touch (captured app-wide in _layout → noteActivity) wakes it; tapping does too.
 *
 * NEVER engages on the live-camera screens (SUPPRESS_ROUTES) — a golfer stands DEAD STILL over the ball
 * on Smart Motion / TightLie / SmartFinder, so an idle-timer black-out there would be a regression. It
 * also honors suppressCount (a playing swing video, an active capture — via useRestSuppress). SmartMotion
 * battery is handled by throttling the camera/pose when idle, not by dimming (see battery pass).
 */

const IDLE_MS = 60_000; // 1 min of no touch → rest (same as the on-course timeout)

// Live-camera / stand-still screens: auto-rest would black out a golfer addressing the ball. Never rest.
const SUPPRESS_ROUTES = ['/swinglab/smartmotion', '/swinglab/coach-lesson', '/lie-analysis', '/smartfinder'];

// Holding keep-awake only while resting guarantees the screen never sleeps
// (which would drop GPS) even if rest was entered from a non-round screen.
function RestKeepAwake() {
  useKeepAwake('round-rest');
  return null;
}

export function RestModeOverlay() {
  const { t } = useTranslation();
  const active = useRestModeStore((s) => s.active);
  const enterRest = useRestModeStore((s) => s.enterRest);
  const exitRest = useRestModeStore((s) => s.exitRest);
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const currentHole = useRoundStore((s) => s.currentHole);
  const pathname = usePathname() ?? '';

  // Route suppression must be readable inside the interval without re-creating it each nav.
  const routeSuppressedRef = useRef(false);
  routeSuppressedRef.current = SUPPRESS_ROUTES.some((p) => pathname.startsWith(p));

  // Idle watcher: poll once a second; engage rest after IDLE_MS of no touch on ANY screen, unless a
  // suppressor is active (playing video / capture) or we're on a live-camera route. Reads state
  // imperatively so the effect doesn't churn on every activity bump.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const { active: isResting, lastActivityAt, suppressCount } = useRestModeStore.getState();
      if (routeSuppressedRef.current || suppressCount > 0) {
        if (isResting) { exitRest(); force((n) => n + 1); } // never rest here — wake if we were
        return;
      }
      if (!isResting && Date.now() - lastActivityAt >= IDLE_MS) {
        enterRest();
        force((n) => n + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [enterRest, exitRest]);

  // Leaving onto a suppressed route while resting → wake immediately.
  useEffect(() => {
    if (routeSuppressedRef.current && useRestModeStore.getState().active) exitRest();
  }, [pathname, exitRest]);

  if (!active) return null;

  return (
    <Pressable
      style={styles.fill}
      onPress={exitRest}
      accessibilityRole="button"
      accessibilityLabel={isRoundActive
        ? 'Rest screen — tap to wake. GPS and your round are still running.'
        : 'Rest screen — tap to wake.'}
    >
      <RestKeepAwake />
      <View style={styles.center}>
        {/* Outline art on a pure-black ground: the lit pixels are the neon lines only, so this costs
            almost nothing on OLED — which is the whole point of the rest screen. */}
        <Image source={REST_MARK} style={styles.mark} resizeMode="contain" accessible={false} />
        <View style={styles.gpsRow}>
          <View style={styles.gpsDot} />
          <Text style={styles.gpsText}>{isRoundActive ? 'GPS LIVE · RESTING' : 'RESTING · TAP TO WAKE'}</Text>
        </View>
        {isRoundActive && currentHole ? <Text style={styles.hole}>{t('round_rest_mode_overlay.rest_mode_overlay.hole', { currentHole })}</Text> : null}
        <Text style={styles.hint}>{t('round_rest_mode_overlay.rest_mode_overlay.tap_anywhere_to_wake')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // zIndex/elevation max so it covers every screen + the data strip.
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  // 470×250 source, held to its aspect. Large enough to read across a fairway, not a flashlight.
  mark: { width: 240, height: 128, opacity: 0.9, marginBottom: 6 },
  gpsDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(0,200,150,0.55)' },
  gpsText: { color: 'rgba(0,200,150,0.5)', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  // Dim on purpose — few lit pixels, low power.
  hole: { color: 'rgba(255,255,255,0.6)', fontSize: 40, fontWeight: '900', letterSpacing: 1 },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
});
