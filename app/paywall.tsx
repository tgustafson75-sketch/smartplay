import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Animated,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import { track } from '../services/analytics';

const FEATURES = [
  { icon: '🏌️', label: 'Kevin on every hole', sub: 'Real-time caddie advice, club selection, and course strategy' },
  { icon: '🔭', label: 'SmartVision', sub: 'AI hole analysis from satellite and on-course images' },
  { icon: '⛳', label: 'Cage Mode', sub: 'Structured range sessions with pattern detection' },
  { icon: '🎙️', label: 'Voice caddie', sub: 'Hands-free operation during your round' },
  { icon: '📊', label: 'Round intelligence', sub: 'Post-round recap, scoring trends, and ghost mode' },
];

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const { subscription_status, setSubscriptionStatus } = usePlayerProfileStore();

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    track('paywall_viewed', { subscription_status });

    if (voiceEnabled) {
      const delay = setTimeout(async () => {
        await configureAudioForSpeech();
        await speak(
          "Everything you need to play better golf. Seven days on me — no card required.",
          voiceGender, language, apiUrl,
        );
      }, 800);
      return () => clearTimeout(delay);
    }
  }, []);

  const handleSubscribe = () => {
    // Stripe integration wired in Wrap Layer 2B
    track('subscribe_tapped', { subscription_status });
    Alert.alert(
      'Coming Soon',
      'Stripe checkout will be available in the next update. Your trial continues.',
      [{ text: 'Got it', style: 'default' }],
    );
  };

  const handleRestore = () => {
    track('restore_tapped');
    Alert.alert('Restore Purchase', 'No active subscription found.', [{ text: 'OK' }]);
  };

  const handleClose = () => {
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TouchableOpacity
        style={[styles.closeBtn, { top: insets.top + 12 }]}
        onPress={handleClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="close" size={22} color="#6b7d72" />
      </TouchableOpacity>

      <Animated.View style={[styles.content, { opacity: fadeIn }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

          <Image
            source={require('../assets/avatars/kevin_portrait.jpg')}
            style={styles.avatar}
            resizeMode="cover"
          />

          <Text style={styles.headline}>Your caddie is ready.</Text>
          <Text style={styles.subhead}>
            7-day free trial. Cancel anytime.{'\n'}No credit card required to start.
          </Text>

          <View style={styles.featureList}>
            {FEATURES.map(f => (
              <View key={f.label} style={styles.featureRow}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
                <View style={styles.featureText}>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                  <Text style={styles.featureSub}>{f.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.pricingCard}>
            <Text style={styles.pricingTitle}>SmartPlay Caddie Pro</Text>
            <Text style={styles.pricingPrice}>$9.99 / month</Text>
            <Text style={styles.pricingTrial}>Free for 7 days, then $9.99/mo</Text>
          </View>

          <TouchableOpacity style={styles.ctaBtn} onPress={handleSubscribe} activeOpacity={0.88}>
            <Text style={styles.ctaText}>Start Free Trial</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore}>
            <Text style={styles.restoreText}>Restore Purchase</Text>
          </TouchableOpacity>

          <Text style={styles.legalText}>
            Subscription automatically renews unless cancelled at least 24 hours before the end of the trial period.
          </Text>

        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  closeBtn: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    padding: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#00C896',
    marginBottom: 24,
  },
  headline: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subhead: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  featureList: {
    width: '100%',
    gap: 4,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  featureIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  featureSub: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
  pricingCard: {
    width: '100%',
    backgroundColor: '#0d2418',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 20,
    alignItems: 'center',
    gap: 6,
    marginBottom: 24,
  },
  pricingTitle: {
    color: '#00C896',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  pricingPrice: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  pricingTrial: {
    color: '#6b7280',
    fontSize: 13,
  },
  ctaBtn: {
    width: '100%',
    backgroundColor: '#00C896',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  ctaText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  restoreBtn: {
    paddingVertical: 10,
    marginBottom: 24,
  },
  restoreText: {
    color: '#6b7280',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  legalText: {
    color: '#374151',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
