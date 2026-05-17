import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import {
  applyUpdate,
  checkAndFetchUpdate,
  subscribeToUpdates,
  type UpdateStatus,
} from '../services/autoUpdate';
import { useRoundStore } from '../store/roundStore';
import { useListeningSessionStore } from '../store/listeningSessionStore';

/**
 * Auto-update banner. Ported from V3 components/UpdateAvailableBanner.
 *
 * Mounts at root layout, slides in from the top safe area when EAS
 * Update reports a newer JS bundle is downloaded and ready to apply.
 * Tap "Update" to reload. Dismissable, reappears on next boot until
 * the update is actually applied.
 *
 * Suppressed mid-round (so a player isn't yanked off mid-hole) and
 * while voice is active (listening / thinking / responding) so a
 * conversation isn't interrupted by a banner.
 */
export function UpdateAvailableBanner() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const inRound = useRoundStore((s) => s.isRoundActive);
  const voiceState = useListeningSessionStore((s) => s.state);
  const voiceActive = voiceState !== 'idle';

  useEffect(() => {
    void checkAndFetchUpdate();
    return subscribeToUpdates((s) => setStatus(s));
  }, []);

  const slide = useState(() => new Animated.Value(-120))[0];
  const visible = status?.ready === true && !dismissed && !inRound && !voiceActive;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : -120,
      useNativeDriver: true,
      friction: 8,
      tension: 60,
    }).start();
  }, [visible, slide]);

  if (!status?.ready && !dismissed) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + 8,
          transform: [{ translateY: slide }],
        },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface_elevated,
            borderColor: colors.accent,
            shadowColor: colors.accent,
          },
        ]}
      >
        <Ionicons name="cloud-download-outline" size={20} color={colors.accent} />
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text_primary }]}>Update ready</Text>
          <Text style={[styles.sub, { color: colors.text_muted }]}>
            Tap to reload with the latest fixes.
          </Text>
        </View>
        <Pressable
          onPress={() => void applyUpdate()}
          style={[styles.applyBtn, { backgroundColor: colors.accent }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Apply update now"
        >
          <Text style={[styles.applyText, { color: '#000' }]}>Update</Text>
        </Pressable>
        <Pressable
          onPress={() => setDismissed(true)}
          hitSlop={10}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss update banner"
        >
          <Ionicons name="close" size={18} color={colors.text_muted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 100,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2 },
  applyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  applyText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  dismissBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
