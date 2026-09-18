import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';

/**
 * 2026-09-12 (Tim) — "need the neon outline logo we use for text box added large to the rest screen.
 * Words are hard to see alone many times."
 *
 * The rest screen was three lines of dim type on pure black. On a bag clip in daylight that is a
 * blank phone with some grey text on it — you cannot tell at a glance that the app is alive, which
 * is the ONE thing this screen exists to say. The mark reads from much further away than the words
 * do.
 *
 * 2026-09-12 (later, Tim) — "this is the correct resting screen logo." The neon outline that was
 * here (mic-caddie.png) was the wrong mark AND a bad crop: two head profiles bleeding off both edges
 * of a 240x128 landscape box. This is the caddie mark — cap, bag, and the waves.
 *
 * THE BACKDROP WAS REMOVED RATHER THAN SHIPPED. The source arrived 1024x1024 with `hasAlpha: no` and
 * a near-black backdrop baked in (measured luminance ~27, peak 32). This screen paints PURE #000 on
 * purpose — on OLED that turns the panel physically off, which is the entire reason it exists — so a
 * baked backdrop would have shown as a faintly lighter square AND lit every pixel inside it, working
 * against the one job the screen has. The background is flood-filled from the borders, not keyed by
 * luminance, so the dark outlines INSIDE the mark (bag strap, shoulder seam) stay opaque instead of
 * being punched through; edge pixels get partial alpha so there is no dark halo. Then cropped to its
 * own content, so it fills the box rather than floating in a fifth of empty frame.
 */
import { usePathname } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRestModeStore } from '../../store/restModeStore';
import { useRestReadoutStore, freshReadout } from '../../store/restReadoutStore';
import { useRoundStore } from '../../store/roundStore';
import { useTranslation } from 'react-i18next';

// The rest mark is a require() rather than an import so the asset resolves through Metro's asset
// pipeline; it lives BELOW the imports so it does not split them (import/first).
const REST_MARK = require('../../assets/icons/caddie/rest-caddie.png');

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
  /**
   * 2026-09-17 (Tim) — THE YARDAGE STAYS UP.
   *
   * "My daughter is using 18Birdies for one reason and one reason only: on their rest screen she can
   * still see the yardage." She is right and it is nearly free — GPS and the resolver never stop
   * during rest, so the number was being computed and then painted over.
   *
   * Selected field-by-field rather than as an object: a selector returning a fresh object re-renders
   * on every store write, and this component is mounted over every screen in the app.
   */
  const readYardage = useRestReadoutStore((s) => s.yardage);
  const readPlaysLike = useRestReadoutStore((s) => s.playsLike);
  const readUpdatedAt = useRestReadoutStore((s) => s.updatedAt);
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

  // Computed after the early return so a non-resting app never pays for it.
  const yardageReadout = isRoundActive
    ? freshReadout({ yardage: readYardage, playsLike: readPlaysLike, hole: currentHole ?? null, updatedAt: readUpdatedAt })
    : null;

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
        {/**
          * The number, when there IS an honest number. freshReadout returns null for a stale or
          * absent publish — rest engages on any route after a minute idle, including ones reached
          * without ever opening the caddie tab, and a yardage from three holes ago shown with
          * nothing on screen to contradict it is worse than no yardage at all.
          *
          * Plain text on pure #000, no blur and no Pressable: the whole screen is one "tap to wake"
          * target, and a lit panel behind the digits would undo the reason this screen exists. The
          * caddie strip itself is deliberately NOT reused — it carries BlurView, haptics and
          * hole-stepper touch targets, none of which belong here.
          */}
        {yardageReadout ? (
          <View style={styles.yardageBlock}>
            <Text style={styles.yards}>{yardageReadout.yardage}</Text>
            <Text style={styles.yardsLabel}>
              {yardageReadout.playsLike != null && yardageReadout.playsLike !== yardageReadout.yardage
                ? `YDS · PLAYS ${yardageReadout.playsLike}`
                : 'YDS'}
            </Text>
          </View>
        ) : null}
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
  // 2026-09-12 (Tim — "just dim it out a bit"). 0.9 → 0.7. Deliberately a nudge, not a fade: the
  // mark exists because three lines of dim type on black do not tell you at a glance that the app is
  // alive on a bag clip in daylight, so dimming it far enough to lose that would undo the reason it
  // is here. Pure #000 around it is load-bearing too — on OLED those pixels are physically off.
  //
  // SQUARE, because the mark is (626x626 after crop). The old 240x128 box was cut for the landscape
  // outline; leaving it would have shrunk this one to 128px tall inside a 240-wide box under
  // resizeMode="contain" — the logo arriving and getting SMALLER.
  mark: { width: 200, height: 200, opacity: 0.7, marginBottom: 10 },
  gpsDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(0,200,150,0.55)' },
  gpsText: { color: 'rgba(0,200,150,0.5)', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  // Dim on purpose — few lit pixels, low power.
  hole: { color: 'rgba(255,255,255,0.6)', fontSize: 40, fontWeight: '900', letterSpacing: 1 },
  // The reason this screen now has a number on it. Brighter than HOLE because it is the thing being
  // glanced at from a cart, but still flat text on black — a few hundred lit pixels.
  yardageBlock: { alignItems: 'center', gap: 2 },
  yards: { color: 'rgba(255,255,255,0.92)', fontSize: 64, fontWeight: '900', letterSpacing: -1 },
  yardsLabel: { color: 'rgba(0,200,150,0.75)', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
});
