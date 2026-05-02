import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import {
  shouldShowVocabBanner,
  getVocabBannerCount,
  markVocabBannerSeen,
} from '../services/voiceOnboardingService';

interface Props {
  /** Optional style override (e.g. positioning offset). */
  style?: object;
}

/**
 * Vocabulary profile preview banner. Surfaces once when the user has logged
 * enough voice-tagged shots that there's something visibly worth showing on
 * the /kevin-learning screen. Dismissable; never shows twice.
 */
export default function VocabBanner({ style }: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);
  const fade = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (shouldShowVocabBanner()) {
      setCount(getVocabBannerCount());
      setVisible(true);
      Animated.timing(fade, { toValue: 1, duration: 380, useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    markVocabBannerSeen();
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setVisible(false);
    });
  };

  const open = () => {
    markVocabBannerSeen();
    setVisible(false);
    router.push('/kevin-learning' as never);
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: colors.surface, borderColor: colors.accent, opacity: fade },
        style,
      ]}
    >
      <TouchableOpacity onPress={open} activeOpacity={0.85} style={styles.bannerContent}>
        <Text style={[styles.bannerText, { color: colors.text_primary }]}>
          Kevin learned {count} of your phrases — see what he picked up.
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.accent} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={dismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.dismissBtn}
      >
        <Ionicons name="close" size={16} color={colors.text_muted} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
  },
  bannerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerText: { fontSize: 13, fontWeight: '500', flex: 1, marginRight: 8 },
  dismissBtn: { paddingHorizontal: 6, marginLeft: 4 },
});
