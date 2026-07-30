/**
 * 2026-08-01 (tester — "first 3 uses: a skippable icon-by-icon highlight explanation of the tool and
 * what it does"). A lightweight guided tour: a dim scrim + a glowing highlight ring over the region
 * a step is about + a tooltip card (title/body) with Back / Next / Skip. Auto-shown on the first few
 * opens (see onboardingTourStore), always skippable.
 *
 * Anchors use SCREEN GEOMETRY (bottom bar spans the bottom; tools live top-right) rather than live
 * element measurement — robust across screens with no per-target instrumentation. `center` steps
 * (welcome / closer) draw no ring.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

export type TourAnchor = 'center' | 'bottomBar' | 'micBottomLeft' | 'toolsTopRight';

export interface TourStep {
  key: string;
  title: string;
  body: string;
  anchor: TourAnchor;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

interface Rect { x: number; y: number; w: number; h: number }

export function TourOverlay({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const step = steps[i];
  if (!step) return null;

  // Known-geometry spotlight rects. The bottom bar sits just above the bottom inset; tools top-right.
  const barH = 60;
  const barY = height - insets.bottom - barH - 8;
  const rectFor = (a: TourAnchor): Rect | null => {
    switch (a) {
      case 'bottomBar':     return { x: 10, y: barY, w: width - 20, h: barH };
      case 'micBottomLeft': return { x: 14, y: barY, w: 96, h: barH };
      case 'toolsTopRight': return { x: width - 118, y: insets.top + 6, w: 108, h: 46 };
      default:              return null;
    }
  };
  const rect = rectFor(step.anchor);

  // Place the tooltip on the opposite half of the screen from the ring so it never covers it.
  const tooltipTop = rect ? (rect.y > height * 0.5) : true; // ring low → card high, and vice-versa

  const isLast = i === steps.length - 1;
  const s = makeStyles(colors);

  return (
    <Modal transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={styles.fill} pointerEvents="box-none">
        {/* Scrim */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,7,5,0.82)' }]} />

        {/* Highlight ring over the step's region */}
        {rect && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: rect.x, top: rect.y, width: rect.w, height: rect.h,
              borderRadius: 16, borderWidth: 2.5, borderColor: colors.accent,
              backgroundColor: 'rgba(136,247,0,0.08)',
              shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
            }}
          />
        )}

        {/* Tooltip card */}
        <View
          style={[
            s.card,
            tooltipTop
              ? { top: insets.top + 70 }
              : { bottom: insets.bottom + barH + 70 },
          ]}
        >
          <View style={s.kickerRow}>
            {step.icon ? <Ionicons name={step.icon} size={18} color={colors.accent} /> : null}
            <Text style={s.kicker}>{`STEP ${i + 1} OF ${steps.length}`}</Text>
          </View>
          <Text style={s.title}>{step.title}</Text>
          <Text style={s.body}>{step.body}</Text>

          {/* Progress dots */}
          <View style={s.dots}>
            {steps.map((st, idx) => (
              <View key={st.key} style={[s.dot, idx === i && { backgroundColor: colors.accent, width: 18 }]} />
            ))}
          </View>

          <View style={s.actions}>
            <TouchableOpacity onPress={onDone} accessibilityRole="button" accessibilityLabel="Skip the tour" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.skip}>Skip</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {i > 0 && (
                <TouchableOpacity onPress={() => setI(i - 1)} style={s.backBtn} accessibilityRole="button" accessibilityLabel="Previous">
                  <Text style={s.backText}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => (isLast ? onDone() : setI(i + 1))}
                style={s.nextBtn}
                accessibilityRole="button"
                accessibilityLabel={isLast ? 'Finish the tour' : 'Next'}
              >
                <Text style={s.nextText}>{isLast ? "Got it" : 'Next'}</Text>
                {!isLast && <Ionicons name="arrow-forward" size={15} color="#0d1a0d" />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    card: {
      position: 'absolute', left: 18, right: 18,
      backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
      padding: 18,
      shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    },
    kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    kicker: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    title: { color: colors.text_primary, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 },
    body: { color: colors.text_muted, fontSize: 14.5, lineHeight: 21 },
    dots: { flexDirection: 'row', gap: 5, marginTop: 16, marginBottom: 6 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
    skip: { color: colors.text_muted, fontSize: 14, fontWeight: '600' },
    backBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    backText: { color: colors.text_primary, fontSize: 14, fontWeight: '700' },
    nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.accent },
    nextText: { color: '#0d1a0d', fontSize: 14, fontWeight: '800' },
  });
}

export default TourOverlay;
