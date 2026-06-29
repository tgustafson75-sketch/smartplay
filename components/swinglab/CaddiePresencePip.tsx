// 2026-06-29 (Tim) — CADDIE PRESENCE PiP. A small floating, DRAGGABLE corner tile
// that shows the SELECTED caddie during swing review (the "coach reviewing your
// tape" feel). It is a presence surface only: a static avatar, NOT live video and
// NOT voice-wired (voice path is frozen). The selected caddie resolves from the
// same source the rest of the app uses (settingsStore.caddiePersonality → custom
// portrait when 'custom', else the persona avatar, Kevin as the fallback).
import React, { useRef } from 'react';
import { Animated, Image, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useCustomCaddieMediaStore } from '../../store/customCaddieMediaStore';

const AVATARS = {
  kevin: require('../../assets/avatars/kevin_portrait.jpg'),
  serena: require('../../assets/avatars/serena_portrait.jpg'),
  harry: require('../../assets/avatars/harry_portrait.png'),
  tank: require('../../assets/avatars/tank_v2_portrait.png'),
} as const;

type Props = {
  /** Default anchor from the screen's bottom-left (it stays draggable from here). */
  bottom?: number;
  left?: number;
};

export default function CaddiePresencePip({ bottom = 150, left = 12 }: Props) {
  const persona = useSettingsStore((s) => s.caddiePersonality);
  const customName = usePlayerProfileStore((s) => s.customCaddieName);
  const customPortrait = useCustomCaddieMediaStore((s) => s.customCaddiePortraitB64);

  // Drag — translate from the bottom-left anchor; extractOffset keeps each drag
  // relative so the tile stays where you drop it.
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => pan.extractOffset(),
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => pan.flattenOffset(),
    }),
  ).current;

  const source =
    persona === 'custom' && customPortrait
      ? { uri: `data:image/png;base64,${customPortrait}` }
      : persona === 'serena'
        ? AVATARS.serena
        : persona === 'harry'
          ? AVATARS.harry
          : persona === 'tank'
            ? AVATARS.tank
            : AVATARS.kevin;

  const label =
    persona === 'custom'
      ? (customName?.trim() || 'Caddie')
      : persona.charAt(0).toUpperCase() + persona.slice(1);

  return (
    <Animated.View
      style={[styles.pip, { bottom, left, transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
      accessibilityRole="image"
      accessibilityLabel={`${label}, your caddie. Drag to reposition.`}
    >
      <Image source={source} style={styles.img} resizeMode="cover" />
      <View style={styles.labelWrap} pointerEvents="none">
        <Text style={styles.label} numberOfLines={1}>{label.toUpperCase()}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pip: {
    position: 'absolute', width: 88, height: 116, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#88F700', overflow: 'hidden',
    backgroundColor: 'rgba(6,15,9,0.9)', zIndex: 8,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8,
  },
  img: { width: '100%', height: '100%' },
  labelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(6,15,9,0.8)', paddingVertical: 3, alignItems: 'center' },
  label: { color: '#88F700', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
});
