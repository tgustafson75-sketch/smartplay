/**
 * CaddieToolsStrip — collapsible horizontal tools row for the Caddie tab.
 *
 * Closed by default: just a chevron pill on the right.
 * Tapping the chevron expands a horizontal row to the left revealing four tools:
 *   • SmartFinder  → AR rangefinder route (camera-based)
 *   • Pointfinder  → point-to-point GPS measurement modal
 *   • SmartVision  → SmartVision pre-round planner
 *   • SwingLab     → /tabs/swinglab practice tab
 *
 * Animation is width-only, native-driver false (width interpolation requires
 * the JS driver). All four actions are passed in via props so callers retain
 * full control of side-effects (analytics, voice cues, etc.).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { Palette, Radius } from '../constants/theme';
import { SmartVisionIcon, SwingLabIcon } from './icons/IconBase';

const ICON_RANGEFINDER = require('../assets/images/icon-rangefinder.png');

interface Props {
  onOpenSmartFinder: () => void;
  onOpenPointfinder: () => void;
  onOpenSmartVision: () => void;
  onOpenSwingLab:    () => void;
}

const COLLAPSED_WIDTH = 40;
const EXPANDED_WIDTH  = 264;
const ANIM_DURATION   = 220;

export default function CaddieToolsStrip({
  onOpenSmartFinder,
  onOpenPointfinder,
  onOpenSmartVision,
  onOpenSwingLab,
}: Props) {
  const [open, setOpen] = useState(false);
  const widthAnim = useRef(new Animated.Value(COLLAPSED_WIDTH)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue:  open ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
      duration: ANIM_DURATION,
      easing:   Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open, widthAnim]);

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.strip, { width: widthAnim }]}>
        {/* Tools — only rendered when expanded so they don't capture taps while collapsed */}
        {open && (
          <View style={styles.toolsInner} pointerEvents="auto">
            <Pressable
              onPress={onOpenSmartFinder}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="SmartFinder rangefinder"
            >
              <Image source={ICON_RANGEFINDER} style={styles.rangefinderImg} resizeMode="contain" />
              <Text style={styles.toolLabel}>SmartFinder</Text>
            </Pressable>

            <Pressable
              onPress={onOpenPointfinder}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="Pointfinder point-to-point measurement"
            >
              <MCIcon name="map-marker-distance" size={14} color={Palette.positive} />
              <Text style={styles.toolLabel}>Pointfinder</Text>
            </Pressable>

            <Pressable
              onPress={onOpenSmartVision}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="SmartVision pre-round planner"
            >
              <SmartVisionIcon size={14} active />
              <Text style={styles.toolLabel}>Vision</Text>
            </Pressable>

            <Pressable
              onPress={onOpenSwingLab}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="SwingLab practice"
            >
              <SwingLabIcon size={14} active />
              <Text style={styles.toolLabel}>SwingLab</Text>
            </Pressable>
          </View>
        )}

        {/* Chevron toggle — always rendered, anchors to the right edge */}
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={10}
          style={styles.chevronBtn}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Collapse tools' : 'Expand tools'}
          accessibilityState={{ expanded: open }}
        >
          <MCIcon
            name={open ? 'chevron-right' : 'chevron-left'}
            size={20}
            color={Palette.positive}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  strip: {
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(6,15,10,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  toolsInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    gap: 2,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  rangefinderImg: {
    width: 14,
    height: 14,
    tintColor: Palette.positive,
  },
  toolLabel: {
    color: '#A7F3D0',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chevronBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
