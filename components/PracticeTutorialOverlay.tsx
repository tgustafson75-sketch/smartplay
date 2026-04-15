import { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  Animated,
  Dimensions,
  StyleSheet,
} from 'react-native';

// ─── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  {
    icon: '📱',
    title: 'Camera Position',
    body: 'Place your phone behind you (down-the-line), chest height, 8–10 feet back.',
  },
  {
    icon: '🎯',
    title: 'Show the Target',
    body: 'Make sure your net target is clearly visible. Add a bright marker if needed.',
  },
  {
    icon: '📏',
    title: 'Alignment Stick',
    body: 'Place a stick on the ground pointing at your target.',
  },
  {
    icon: '🔄',
    title: 'Consistency',
    body: 'Keep camera and target in same position every session for best results.',
  },
  {
    icon: '⛳',
    title: 'Start Swing Lab',
    body: null, // replaced by Begin Practice button on this step
  },
] as const;

const { width: SCREEN_W } = Dimensions.get('window');
const STEP_COUNT = STEPS.length;

// ─── Props ────────────────────────────────────────────────────────────────────
interface PracticeTutorialOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PracticeTutorialOverlay({ visible, onDismiss }: PracticeTutorialOverlayProps) {
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const isLast = step === STEP_COUNT - 1;

  // Animate a brief fade during step transitions for polish
  const animateTo = (nextStep: number) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setStep(nextStep);
    scrollRef.current?.scrollTo({ x: nextStep * SCREEN_W, animated: false });
  };

  const handleNext = () => { if (!isLast) animateTo(step + 1); };
  const handleBack = () => { if (step > 0) animateTo(step - 1); };
  const handleDotPress = (i: number) => animateTo(i);

  const handleDismiss = () => {
    // Reset to step 0 for next open
    setStep(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
    onDismiss();
  };

  const current = STEPS[step];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      {/* Dim backdrop — tap outside content to dismiss */}
      <Pressable style={styles.backdrop} onPress={handleDismiss}>
        {/* Card — stop event propagation so inner taps don't dismiss */}
        <Pressable style={styles.card} onPress={() => { /* noop — stop backdrop tap */ }}>

          {/* ── Step content ─────────────────────────────────────────────── */}
          <Animated.View style={[styles.contentArea, { opacity: fadeAnim }]}>
            <Text style={styles.icon}>{current.icon}</Text>
            <Text style={styles.stepLabel}>Step {step + 1} of {STEP_COUNT}</Text>
            <Text style={styles.title}>{current.title}</Text>
            {current.body ? (
              <Text style={styles.body}>{current.body}</Text>
            ) : (
              /* Step 5 — Begin Practice */
              <Pressable style={styles.beginBtn} onPress={handleDismiss}>
                <Text style={styles.beginBtnText}>Begin Practice</Text>
              </Pressable>
            )}
          </Animated.View>

          {/* ── Dot indicators ───────────────────────────────────────────── */}
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <Pressable key={i} onPress={() => handleDotPress(i)} hitSlop={8}>
                <View style={[styles.dot, i === step && styles.dotActive]} />
              </Pressable>
            ))}
          </View>

          {/* ── Navigation row ───────────────────────────────────────────── */}
          <View style={styles.navRow}>
            {/* Back */}
            <Pressable
              onPress={handleBack}
              disabled={step === 0}
              style={[styles.navBtn, step === 0 && styles.navBtnDisabled]}
            >
              <Text style={[styles.navBtnText, step === 0 && styles.navBtnTextDisabled]}>← Back</Text>
            </Pressable>

            {/* Skip / Close */}
            <Pressable onPress={handleDismiss} style={styles.skipBtn}>
              <Text style={styles.skipBtnText}>Skip</Text>
            </Pressable>

            {/* Next */}
            {!isLast && (
              <Pressable onPress={handleNext} style={styles.nextBtn}>
                <Text style={styles.nextBtnText}>Next →</Text>
              </Pressable>
            )}
            {isLast && (
              /* On the final step the primary CTA is Begin Practice above;
                 provide a plain "Done" so keyboard navigation still works */
              <Pressable onPress={handleDismiss} style={styles.nextBtn}>
                <Text style={styles.nextBtnText}>Done</Text>
              </Pressable>
            )}
          </View>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0d2318',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1a4a2e',
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 16,
  },
  contentArea: {
    alignItems: 'center',
    minHeight: 180,
    width: '100%',
    marginBottom: 24,
  },
  icon: {
    fontSize: 48,
    marginBottom: 12,
  },
  stepLabel: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#A7F3D0',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  body: {
    color: '#d1fae5',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  beginBtn: {
    marginTop: 8,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#4ade80',
    shadowColor: '#4ade80',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  beginBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2d4a35',
    borderWidth: 1,
    borderColor: '#1a4a2e',
  },
  dotActive: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
    width: 22,
    borderRadius: 4,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  navBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1a2e1a',
    borderWidth: 1,
    borderColor: '#2a4a2a',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnText: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: '600',
  },
  navBtnTextDisabled: {
    color: '#4a6a4a',
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  skipBtnText: {
    color: '#6b7280',
    fontSize: 13,
  },
  nextBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#143d22',
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  nextBtnText: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '700',
  },
});
