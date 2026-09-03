import React, { useEffect, useRef, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AppIcon, { type IconName } from '../components/AppIcon';
import { usePlayerProfileStore, isOwnerEmail } from '../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import { track } from '../services/analytics';
import { PRICING, paywallHeadline, PAYWALL_SUBHEAD } from '../lib/pricing';
import { safeBack } from '../services/safeBack';
import { getCaddieName } from '../lib/persona';
import { SUBSCRIPTIONS_ENABLED } from '../services/featureAccess';
import { getApiBaseUrl } from '../services/apiBase';
import {
  getPackages,
  purchasePackage,
  restorePurchases,
  billingAvailable,
} from '../services/billing/purchases';
import { currentTrialExtensionOffer } from '../services/billing/trialExtensionOffer';
import { describeTrialExtension, TRIAL_EXTENSION_DAYS } from '../services/billing/trialUsage';

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const fadeIn = useRef(new Animated.Value(0)).current;
  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const apiUrl = getApiBaseUrl();
  const { subscription_status, setSubscriptionStatus, setTrialStartedAt, email, grantTrialExtension } = usePlayerProfileStore();
  /**
   * 2026-09-03 (Tim) — the light-use extension.
   *
   * Evaluated ONCE on mount, deliberately. It reads the round and swing histories, and it must not
   * re-decide underneath the player: a card that appears or vanishes while they are reading it is
   * worse than either answer on its own. The eligibility rule itself lives in trialUsage.
   */
  const [extension] = useState(() => {
    try { return currentTrialExtensionOffer(); } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  /**
   * 2026-08-30 — OWNER PREVIEW, so this screen can be photographed.
   *
   * App Store Connect requires a Review Screenshot of the purchase screen for every subscription,
   * and there was no way to reach this screen on a device: the kill-switch bounces it, and
   * forcePaywall suppressed itself on the same flag, so the debug "Force Paywall Now" button did
   * nothing. Flipping SUBSCRIPTIONS_ENABLED to take one photograph would gate features and start
   * every tester's trial clock.
   *
   * Owner-gated on the SAME email allow-list the debug routes use, not on the query param alone —
   * a bare `?preview=1` that anyone could type would put a subscription screen in front of a
   * reviewer while subscriptions are off, which is the confusion this whole switch exists to avoid.
   */
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  const previewing = preview === '1' && isOwnerEmail(email);

  const caddieName = getCaddieName(caddiePersonality);
  const FEATURES: { icon: IconName; label: string; sub: string }[] = [
    { icon: 'golf-outline',         label: `${caddieName} on every hole`, sub: 'Real-time caddie advice, club selection, and course strategy' },
    { icon: 'telescope-outline',    label: 'SmartVision',         sub: 'AI hole analysis from satellite and on-course images' },
    { icon: 'videocam-outline',     label: 'SmartMotion',           sub: 'Camera + auto-detect + Phase K analysis · drill picker baked in' },
    { icon: 'mic-outline',          label: 'Voice caddie',        sub: 'Hands-free operation during your round' },
    { icon: 'stats-chart-outline',  label: 'Round intelligence',  sub: 'Post-round recap, scoring trends, and ghost mode' },
  ];

  useEffect(() => {
    // Subscriptions kill-switch: if anyone navigates here directly while
    // disabled (e.g. via subscription-debug or a stale route), bounce
    // immediately so the paywall surface never renders. Re-enable by
    // flipping SUBSCRIPTIONS_ENABLED in services/featureAccess.ts.
    if (!SUBSCRIPTIONS_ENABLED && !previewing) {
      safeBack();
      return;
    }
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    track('paywall_viewed', { subscription_status });

    if (voiceEnabled) {
      const delay = setTimeout(async () => {
        await configureAudioForSpeech();
        await speak(
          `Full ${caddieName} for ${PRICING.monthly.displayPrice} a month, or ${PRICING.annual.displayPrice} a year. ${PRICING.trialDays} days on me.`,
          voiceGender, language, apiUrl,
          { userInitiated: true },
        );
      }, 800);
      return () => clearTimeout(delay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hard-stop render when disabled — covers the moment between mount and
  // the safeBack() above unwinding the route.
  if (!SUBSCRIPTIONS_ENABLED && !previewing) return null;

  /**
   * 2026-08-29 — this popped "Stripe checkout will be available in the next update".
   *
   * Wrong twice over: Stripe cannot sell an in-app subscription at all (guideline 3.1.1), and a
   * Subscribe button that opens an apology is not a paywall. Unreachable while the kill-switch is
   * off, which is exactly why it survived — it would have gone live the day the switch flipped.
   *
   * The App Store presents its own sheet; we never see a card. Everything below distinguishes the
   * three outcomes that need different words: bought, backed out, and genuinely broken.
   */
  const handleSubscribe = async () => {
    if (busy) return;
    track('subscribe_tapped', { subscription_status });
    if (!billingAvailable()) {
      // Honest, not a fake success. This is the state on a binary built before the billing module.
      Alert.alert(
        'Not available yet',
        'Subscriptions need the latest version of the app. Update from TestFlight and try again.',
        [{ text: 'OK' }],
      );
      return;
    }
    setBusy(true);
    try {
      const packages = await getPackages();
      /**
       * Default to the MONTHLY package — it is what the headline, the pricing card and the spoken
       * line all quote, so buying anything else would contradict what the player was just told.
       *
       * 2026-08-30 — matched on RevenueCat's `packageType` FIRST, falling back to the App Store
       * product id. Matching only on the product id worked against App Store Connect and found
       * nothing against RevenueCat's Test Store, whose products are named `monthly` / `yearly` /
       * `lifetime`. It would have silently fallen through to packages[0] — which is whatever the
       * offering happens to list first, and could be the lifetime product. Selling someone a
       * lifetime plan because a string did not match is not a fallback, it is a wrong charge.
       * packageType is the store-agnostic answer and is what the SDK is built around.
       */
      const byType = packages.find(
        (p) => (p as { packageType?: string })?.packageType === 'MONTHLY',
      );
      const byProductId = packages.find(
        (p) => (p as { product?: { identifier?: string } })?.product?.identifier === PRICING.monthly.productId,
      );
      const pkg = byType ?? byProductId ?? packages[0];
      if (!pkg) {
        Alert.alert('Not available yet', 'The subscription is not on sale in your region yet.', [{ text: 'OK' }]);
        return;
      }
      const result = await purchasePackage(pkg, subscription_status);
      if (result.ok) {
        // The trial's clock starts NOW, at the purchase — not when the app was first opened.
        if (result.trialStartedAt != null) setTrialStartedAt(result.trialStartedAt);
        setSubscriptionStatus(result.status);
        track('subscribe_succeeded', { status: result.status });
        safeBack();
        return;
      }
      // A player who backed out of Apple's sheet chose that. Showing them an error reads as a bug.
      if (result.reason === 'cancelled') {
        track('subscribe_cancelled');
        return;
      }
      track('subscribe_failed', { reason: result.reason });
      Alert.alert(
        "That didn't go through",
        'Nothing was charged. Give it another go, or check your payment method in Settings.',
        [{ text: 'OK' }],
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Apple REQUIRES a working restore on any screen selling a subscription — a paywall without one is
   * a rejection, not a missing nicety. This used to hardcode "No active subscription found", which
   * would have told a paying customer on a new phone that their subscription did not exist.
   */
  const handleRestore = async () => {
    if (busy) return;
    track('restore_tapped');
    if (!billingAvailable()) {
      Alert.alert(
        'Not available yet',
        'Restoring needs the latest version of the app. Update from TestFlight and try again.',
        [{ text: 'OK' }],
      );
      return;
    }
    setBusy(true);
    try {
      const result = await restorePurchases(subscription_status);
      if (result.ok && (result.status === 'active' || result.status === 'trial' || result.status === 'lifetime')) {
        if (result.trialStartedAt != null) setTrialStartedAt(result.trialStartedAt);
        setSubscriptionStatus(result.status);
        track('restore_succeeded', { status: result.status });
        Alert.alert('Restored', `You're all set — full ${caddieName} is back.`, [{ text: 'Great' }]);
        safeBack();
        return;
      }
      if (result.ok) {
        setSubscriptionStatus(result.status);
        Alert.alert('Nothing to restore', 'No active subscription on this Apple ID.', [{ text: 'OK' }]);
        return;
      }
      Alert.alert("Couldn't check", 'We could not reach the store just now. Try again in a moment.', [{ text: 'OK' }]);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    safeBack();
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
            source={
              caddiePersonality === 'serena' ? require('../assets/avatars/serena_portrait.jpg')
              : caddiePersonality === 'harry' ? require('../assets/avatars/harry_portrait.jpg')
              : require('../assets/avatars/kevin_portrait.jpg')
            }
            style={styles.avatar}
            resizeMode="cover"
          />

          <Text style={styles.headline}>{paywallHeadline(caddieName)}</Text>
          <Text style={styles.subhead}>
            {PAYWALL_SUBHEAD}{'\n'}
            {PRICING.trialDays}-day free trial. Cancel anytime.
          </Text>

          {/* The player who never got out. Placed ahead of the price on purpose: the offer is the
              point of this screen for them, and a week of golf is the thing being decided, not a
              subscription. Falls through to the normal paywall for everyone else. */}
          {extension?.eligible && (
            <View style={styles.extensionCard}>
              <Text style={styles.extensionLabel}>ON THE HOUSE</Text>
              <Text style={styles.extensionBody}>{describeTrialExtension(extension.activeDays)}</Text>
              <TouchableOpacity
                style={styles.extensionBtn}
                activeOpacity={0.88}
                disabled={busy}
                onPress={() => {
                  // One call: the comp and the once-only stamp land in the same write.
                  grantTrialExtension(TRIAL_EXTENSION_DAYS);
                  track('trial_extension_accepted', { activeDays: extension.activeDays, days: TRIAL_EXTENSION_DAYS });
                  safeBack();
                }}
              >
                <Text style={styles.extensionBtnText}>Give me another {TRIAL_EXTENSION_DAYS} days</Text>
              </TouchableOpacity>
              <Text style={styles.extensionFootnote}>No card, no charge. Subscribe whenever you're ready.</Text>
            </View>
          )}

          <View style={styles.featureList}>
            {FEATURES.map(f => (
              <View key={f.label} style={styles.featureRow}>
                <AppIcon name={f.icon} size={24} color="#00C896" />
                <View style={styles.featureText}>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                  <Text style={styles.featureSub}>{f.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.pricingCard}>
            <Text style={styles.pricingTitle}>SmartPlay Caddie Pro</Text>
            <Text style={styles.pricingPrice}>{PRICING.monthly.displayPrice} / {PRICING.monthly.period}</Text>
            <Text style={styles.pricingTrial}>
              or {PRICING.annual.displayPrice}/{PRICING.annual.period} — save {PRICING.annual.savingsPct}%
            </Text>
            <Text style={styles.pricingTrial}>Free for {PRICING.trialDays} days</Text>
          </View>

          <TouchableOpacity style={styles.ctaBtn} onPress={handleSubscribe} activeOpacity={0.88} disabled={busy}>
            <Text style={styles.ctaText}>{busy ? 'One moment…' : 'Start Free Trial'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={busy}>
            <Text style={styles.restoreText}>Restore Purchase</Text>
          </TouchableOpacity>

          {/* 2026-08-30 — guideline 3.1.2 wants both documents reachable from the screen that sells
              the subscription, and this was the only purchase-adjacent surface without them.
              app/legal.tsx has rendered both from constants/legalText.ts since 2026-07-18; settings
              and welcome already route here. Same styling as Restore Purchase above — this is a
              wire-up, not a new surface. */}
          <View style={styles.legalLinksRow}>
            <TouchableOpacity onPress={() => router.push('/legal?doc=privacy' as never)} accessibilityRole="button">
              <Text style={styles.restoreText}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={styles.legalLinkSep}>·</Text>
            <TouchableOpacity onPress={() => router.push('/legal?doc=terms' as never)} accessibilityRole="button">
              <Text style={styles.restoreText}>Terms of Service</Text>
            </TouchableOpacity>
          </View>

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
  extensionCard: {
    marginHorizontal: 4, marginBottom: 18, padding: 16,
    backgroundColor: '#0d2418', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#00C896',
  },
  extensionLabel: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  extensionBody: { color: '#e5e7eb', fontSize: 15, lineHeight: 21, fontWeight: '600', marginBottom: 14 },
  extensionBtn: {
    backgroundColor: '#00C896', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  extensionBtnText: { color: '#04140d', fontSize: 15, fontWeight: '800' },
  extensionFootnote: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 9 },
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
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  legalLinkSep: {
    color: '#6b7280',
    fontSize: 13,
    marginHorizontal: 10,
  },
  legalText: {
    color: '#374151',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
