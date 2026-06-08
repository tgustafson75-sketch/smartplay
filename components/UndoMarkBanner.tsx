/**
 * 2026-05-24 — Undo affordance for silent tee Marks (Flow C).
 *
 * Renders a floating pill at the top of the screen when the
 * undoMarkStore has a fresh entry (within UNDO_WINDOW_MS). Tap to
 * revert: restores the previous tee override if there was one,
 * clears it otherwise. Auto-dismisses when the window expires or
 * after the user confirms the revert.
 *
 * Mounted once at app/_layout.tsx (sibling to <GlobalToast />) so
 * any screen surfaces the affordance during the undo window.
 *
 * Pure UI — does not edit handlers. The undo write reuses the same
 * Mark publish API (setTeeOverride / clearTeeOverride) the
 * declare-hole handler called, so override-aware yardage consumers
 * (Flow A, smart finder, mark-tee screen) pick up the revert
 * automatically.
 */

import React, { useEffect, useState } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useUndoMarkStore, UNDO_WINDOW_MS } from '../store/undoMarkStore';
import { setTeeOverride, clearTeeOverride } from '../services/courseTeeOverrides';
import { useToastStore } from '../store/toastStore';

const FADE_MS = 200;

export function UndoMarkBanner() {
  const insets = useSafeAreaInsets();
  const current = useUndoMarkStore(s => s.current);
  const clear = useUndoMarkStore(s => s.clear);
  // Tick state forces a re-render to dismiss the banner when the
  // visibility window elapses without the user tapping undo.
  const [, setTick] = useState(0);

  // Window-expiration timer. Subscribed to the markedAt field so each
  // new Mark resets the timeout. When the window expires we trigger a
  // re-render via setTick; the banner then evaluates as not-visible
  // and hides itself.
  useEffect(() => {
    if (!current) return;
    const remaining = UNDO_WINDOW_MS - (Date.now() - current.markedAt);
    if (remaining <= 0) return;
    const t = setTimeout(() => setTick(n => n + 1), remaining + 50);
    return () => clearTimeout(t);
    // Intentionally keyed on markedAt only — we re-arm the timer when a
    // NEW mark lands, not on every unrelated field change of `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.markedAt]);

  // Pull active inside render so window-expiration also hides it
  // naturally (getActive returns null past the window).
  const active = useUndoMarkStore.getState().getActive();

  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(-12)).current;
  useEffect(() => {
    if (active) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -12, duration: FADE_MS, useNativeDriver: true }),
      ]).start();
    }
  }, [active, opacity, translateY]);

  if (!active) return null;

  const onUndo = async () => {
    const { courseId, hole, prevOverride } = active;
    try {
      if (prevOverride) {
        // Restore the previous override exactly.
        await setTeeOverride(courseId, hole, { lat: prevOverride.lat, lng: prevOverride.lng });
      } else {
        // No previous override existed — wipe the silent Mark.
        await clearTeeOverride(courseId, hole);
      }
      useToastStore.getState().show(`Undid Mark on hole ${hole}.`);
    } catch (e) {
      console.log('[undoMarkBanner] revert failed (non-fatal):', e);
      useToastStore.getState().show(`Couldn't undo Mark — try the Mark Tee screen.`);
    } finally {
      clear();
    }
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top: insets.top + 8, opacity, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.pill}>
        <Ionicons name="flag-outline" size={16} color="#F5A623" style={{ marginRight: 8 }} />
        <Text style={styles.message} numberOfLines={2}>
          Marked tee on hole {active.hole} ({active.delta_yards}y off)
        </Text>
        <TouchableOpacity
          onPress={onUndo}
          style={styles.undoBtn}
          accessibilityRole="button"
          accessibilityLabel={`Undo Mark on hole ${active.hole}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.undoText}>UNDO</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 50,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: 480,
    gap: 6,
  },
  message: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  undoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F5A623',
  },
  undoText: {
    color: '#0d0d0d',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
});
