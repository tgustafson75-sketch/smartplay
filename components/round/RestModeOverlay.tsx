import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useRestModeStore } from '../../store/restModeStore';
import { useRoundStore } from '../../store/roundStore';

/**
 * 2026-06-13 — Round Rest overlay (Tim #8 battery drain).
 *
 * Auto-engages after IDLE_MS of no touch DURING AN ACTIVE ROUND, painting the
 * screen near-pure-black. On the Z Fold's OLED that turns most of the panel
 * physically OFF — big battery savings — while gpsManager, voice, and the round
 * keep running underneath at full speed. Any touch (captured app-wide in
 * _layout → noteActivity) wakes it instantly; tapping the overlay does too.
 *
 * Only the few lit pixels (dim hole label + GPS-live reassurance) draw power, and
 * they're kept low-opacity on purpose. Mounted once, globally, in _layout.
 */

const IDLE_MS = 60_000; // 1 min of no touch during a round → rest

// Holding keep-awake only while resting guarantees the screen never sleeps
// (which would drop GPS) even if rest was entered from a non-round screen.
function RestKeepAwake() {
  useKeepAwake('round-rest');
  return null;
}

export function RestModeOverlay() {
  const active = useRestModeStore((s) => s.active);
  const enterRest = useRestModeStore((s) => s.enterRest);
  const exitRest = useRestModeStore((s) => s.exitRest);
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const currentHole = useRoundStore((s) => s.currentHole);

  // Idle watcher: poll once a second; engage rest after IDLE_MS still + in-round.
  // Reads lastActivityAt off the store imperatively so this effect doesn't churn.
  const [, force] = useState(0);
  const tickRef = useRef(0);
  useEffect(() => {
    if (!isRoundActive) {
      if (useRestModeStore.getState().active) exitRest();
      return;
    }
    const id = setInterval(() => {
      const { active: isResting, lastActivityAt } = useRestModeStore.getState();
      if (!isResting && Date.now() - lastActivityAt >= IDLE_MS) {
        enterRest();
        force((n) => n + 1);
      }
      tickRef.current += 1;
    }, 1000);
    return () => clearInterval(id);
  }, [isRoundActive, enterRest, exitRest]);

  if (!active || !isRoundActive) return null;

  return (
    <Pressable
      style={styles.fill}
      onPress={exitRest}
      accessibilityRole="button"
      accessibilityLabel="Rest screen — tap to wake. GPS and your round are still running."
    >
      <RestKeepAwake />
      <View style={styles.center}>
        <View style={styles.gpsRow}>
          <View style={styles.gpsDot} />
          <Text style={styles.gpsText}>GPS LIVE · RESTING</Text>
        </View>
        {currentHole ? <Text style={styles.hole}>HOLE {currentHole}</Text> : null}
        <Text style={styles.hint}>Tap anywhere to wake</Text>
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
  gpsDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(0,200,150,0.55)' },
  gpsText: { color: 'rgba(0,200,150,0.5)', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  // Dim on purpose — few lit pixels, low power.
  hole: { color: 'rgba(255,255,255,0.18)', fontSize: 40, fontWeight: '900', letterSpacing: 1 },
  hint: { color: 'rgba(255,255,255,0.16)', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
});
