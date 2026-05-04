/**
 * CaddieToolsStrip — collapsible horizontal tools row for the Caddie tab.
 *
 * Closed by default: just a chevron pill on the right.
 * Tapping the chevron expands a horizontal row to the left revealing seven tools:
 *   • SmartFinder  → AR rangefinder route (camera-based)
 *   • Pointfinder  → point-to-point GPS measurement modal
 *   • SmartVision  → SmartVision pre-round planner
 *   • SwingLab     → /tabs/swinglab practice tab
 *   • Round        → tools / round-options menu
 *   • Shot Card    → shot card modal
 *   • More         → catch-all more menu
 *
 * Animation is width-only, native-driver false (width interpolation requires
 * the JS driver). All actions are passed in via props so callers retain
 * full control of side-effects (analytics, voice cues, etc.).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { Palette, Radius } from '../constants/theme';
import { SmartVisionIcon, SwingLabIcon } from './icons/IconBase';

const ICON_RANGEFINDER = require('../assets/images/icon-rangefinder.png');

interface Props {
  onOpenSmartFinder: () => void;
  onOpenPointfinder: () => void;
  onOpenSmartVision: () => void;
  onOpenSwingLab:    () => void;
  onOpenRound:       () => void;
  onOpenShotCard:    () => void;
  onOpenMore:        () => void;
}

const SCREEN_WIDTH    = Dimensions.get('window').width;
const COLLAPSED_WIDTH = 48;
// Expanded width must never exceed the on-screen container. The Caddie tab's
// ScrollView uses 12-16px horizontal padding (depending on breakpoint), so
// reserve 24px each side worst-case. Cap at 320px on roomy phones so the
// chevron stays close to the avatar's right edge instead of stretching.
const EXPANDED_WIDTH  = Math.min(320, SCREEN_WIDTH - 48);
const ANIM_DURATION   = 220;

export default function CaddieToolsStrip({
  onOpenSmartFinder,
  onOpenPointfinder,
  onOpenSmartVision,
  onOpenSwingLab,
  onOpenRound,
  onOpenShotCard,
  onOpenMore,
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
              <Text style={styles.toolLabel}>Finder</Text>
            </Pressable>

            <Pressable
              onPress={onOpenPointfinder}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="Pointfinder point-to-point measurement"
            >
              <MCIcon name="map-marker-distance" size={18} color={Palette.positive} />
              <Text style={styles.toolLabel}>Point</Text>
            </Pressable>

            <Pressable
              onPress={onOpenSmartVision}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="SmartVision pre-round planner"
            >
              <SmartVisionIcon size={18} active />
              <Text style={styles.toolLabel}>Vision</Text>
            </Pressable>

            <Pressable
              onPress={onOpenSwingLab}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="SwingLab practice"
            >
              <SwingLabIcon size={18} active />
              <Text style={styles.toolLabel}>SwingLab</Text>
            </Pressable>

            <Pressable
              onPress={onOpenRound}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="Round options"
            >
              <MCIcon name="golf" size={18} color={Palette.positive} />
              <Text style={styles.toolLabel}>Round</Text>
            </Pressable>

            <Pressable
              onPress={onOpenShotCard}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="Shot card"
            >
              <MCIcon name="card-bulleted-outline" size={18} color={Palette.positive} />
              <Text style={styles.toolLabel}>Shot</Text>
            </Pressable>

            <Pressable
              onPress={onOpenMore}
              hitSlop={6}
              style={styles.toolBtn}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <MCIcon name="dots-horizontal" size={18} color={Palette.positive} />
              <Text style={styles.toolLabel}>More</Text>
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
            name={open ? 'chevron-left' : 'chevron-right'}
            size={26}
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
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(6,15,10,0.92)',
    borderWidth: 1.5,
    borderColor: 'rgba(46,204,113,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  toolsInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
    gap: 0,
  },
  toolBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2,
    paddingVertical: 2,
    minWidth: 38,
  },
  rangefinderImg: {
    width: 18,
    height: 18,
    tintColor: Palette.positive,
  },
  toolLabel: {
    color: '#A7F3D0',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chevronBtn: {
    width: 48,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
