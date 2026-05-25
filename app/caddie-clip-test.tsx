/**
 * 2026-05-25 — Owner-only debug screen for the canonical Kevin clip set.
 * Lists all 11 caddie slots; tap a slot to play its bundled clip in the
 * shared top player. Slots whose D-ID clip hasn't landed (hasCaddieClip
 * returns false) render disabled with "TODO" so missing-content slots
 * are visible without crashing on a null require.
 *
 * Owner-gated via isOwnerEmail so beta testers don't see this; ships
 * harmlessly in the OTA but stays invisible to non-owner accounts. The
 * route is reachable via the URL /caddie-clip-test in dev menu OR by
 * future Settings → Owner Tools wiring (separate task).
 *
 * Self-contained: imports only @/services/getCaddieClip + the existing
 * playerProfileStore owner gate. No edits to existing app code, no
 * router changes, no Settings entry.
 */

import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import {
  getCaddieClip,
  hasCaddieClip,
  ALL_CADDIE_SLOTS,
  type CaddieSlot,
} from '@/services/getCaddieClip';
import { isOwnerEmail, usePlayerProfileStore } from '@/store/playerProfileStore';

export default function CaddieClipTestScreen() {
  const email = usePlayerProfileStore(s => s.email);
  const [selected, setSelected] = useState<CaddieSlot | null>(null);
  const videoRef = useRef<Video>(null);

  // Owner-only gate. Non-owners render null so the route exists but
  // shows nothing — keeps the bundle simple without route guards.
  if (!isOwnerEmail(email)) return null;

  const currentSource = selected ? getCaddieClip('kevin', selected) : null;

  const handlePlay = async (slot: CaddieSlot) => {
    if (!hasCaddieClip('kevin', slot)) return; // TODO slot — button is also disabled
    setSelected(slot);
    // Video re-mounts on source change; small delay before explicit play
    // for reliability across iOS / Android source-swap timing.
    setTimeout(async () => {
      try {
        await videoRef.current?.playFromPositionAsync(0);
      } catch (e) {
        console.log('[caddie-clip-test] play failed:', e);
      }
    }, 50);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Caddie Clip Test — Kevin</Text>
        <Text style={styles.subtitle}>
          Owner-only · {ALL_CADDIE_SLOTS.length} slots · tap a row to play
        </Text>
      </View>

      {/* 2026-05-25 — Player frame swapped from 16:9 full-width to a
          centered max-width 9:16 portrait frame. D-ID clips are
          portrait, and on Z Fold open (~2200px wide) a 16:9 full-width
          frame made CONTAIN-fit shrink the video to a tiny strip in the
          middle with huge black bars. The centered portrait frame
          matches the source aspect ratio and reads correctly on phone,
          fold-closed, and fold-open. */}
      <View style={styles.playerOuter}>
        <View style={styles.playerFrame}>
          {currentSource ? (
            // 2026-05-25 — D-ID watermark mask (matches greeting.tsx).
            // Container aspect (~0.5) is narrower than the video's ~0.5625,
            // so ResizeMode.COVER scales the video to fill HEIGHT and
            // crops the sides — pushing D-ID's side watermark panels
            // outside the visible frame. transform: scale 1.3 zooms a
            // touch more in case the host platform ignores aspect-based
            // cropping subtlety. overflow:'hidden' on playerFrame
            // clips the now-overflowing edges.
            <Video
              ref={videoRef}
              source={currentSource}
              style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.5 }] }]}
              resizeMode={ResizeMode.COVER}
              useNativeControls
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]}>
              <Text style={styles.placeholderText}>Tap a slot below to play</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {ALL_CADDIE_SLOTS.map(slot => {
          const wired = hasCaddieClip('kevin', slot);
          const isActive = selected === slot;
          return (
            <TouchableOpacity
              key={slot}
              style={[
                styles.row,
                isActive && styles.rowActive,
                !wired && styles.rowDisabled,
              ]}
              onPress={() => { void handlePlay(slot); }}
              disabled={!wired}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Play caddie clip: ${slot}`}
              accessibilityState={{ disabled: !wired }}
            >
              <Text style={[
                styles.slotName,
                !wired && styles.slotNameDisabled,
              ]}>{slot}</Text>
              <Text style={[
                styles.slotStatus,
                wired ? styles.slotStatusReady : styles.slotStatusTodo,
              ]}>
                {wired ? (isActive ? '▶ playing' : 'play') : 'TODO'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e3a28' },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  // 2026-05-25 — Centered portrait player. Outer flexes the available
  // width; inner is the actual video frame capped + centered.
  playerOuter: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingVertical: 8,
  },
  playerFrame: {
    width: '100%',
    maxWidth: 280,            // phone-portrait sweet spot; narrower than greeting circle
    aspectRatio: 0.5,         // intentionally NARROWER than D-ID 9:16 so COVER mode crops the side watermark panels
    backgroundColor: '#000',
    borderRadius: 14,
    overflow: 'hidden',       // required for Android to actually clip the transform-scaled video to the frame
    position: 'relative',
  },
  playerPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#475569', fontSize: 13 },
  list: { padding: 12, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: '#0d2418',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  rowActive:   { borderColor: '#00C896' },
  rowDisabled: { backgroundColor: '#0a0f0c', borderColor: '#1e2a20', opacity: 0.6 },
  slotName:         { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  slotNameDisabled: { color: '#6b7280' },
  slotStatus:       { fontSize: 12, fontWeight: '700' },
  slotStatusReady:  { color: '#00C896' },
  slotStatusTodo:   { color: '#f59e0b' },
});
