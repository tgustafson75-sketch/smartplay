/**
 * 2026-09-03 — Invite a friend. Tim: "a referral link. If a friend signs up, user gets 30 days."
 *
 * Two halves on one screen because they are two ends of the same thing: the link you SEND, and the
 * code you ENTER when someone sent you one.
 *
 * WHY A CODE AND NOT JUST A LINK. Deferred deep linking does not work without a third-party
 * attribution SDK: a friend who taps the link, installs from the store and opens the app arrives
 * with no memory of ever having tapped anything. A short code they can read and type works every
 * time, on both platforms, with nothing new in the build. The link still carries the code — it is
 * printed on the landing page — so the flow is "tap, install, type six-ish characters", not "tap
 * and hope". [[hands-free-zero-setup-is-the-product]]
 *
 * The rules live server-side (api/referral.ts). This screen holds no policy: it shows what the
 * server says and never computes a reward itself.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Share, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { SUBSCRIPTIONS_ENABLED } from '../services/featureAccess';
import {
  getMyReferralLink,
  fetchReferralStatus,
  claimReferralCode,
  type ReferralStatus,
  type ClaimResult,
} from '../services/billing/referral';

const CLAIM_MESSAGE: Record<ClaimResult, string> = {
  claimed: "You're in — thank your friend. They'll be rewarded once you've played a round.",
  already_claimed: "You've already used an invite code on this device.",
  self_referral: "That's your own code — you'll need a friend's.",
  bad_code: "That code doesn't look right. Check it and try again.",
  failed: "Couldn't reach the server. Try again when you have signal.",
};

export default function InviteScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [s, l] = await Promise.all([fetchReferralStatus(), getMyReferralLink()]);
      if (!alive) return;
      setStatus(s);
      setLink(l);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const onShare = useCallback(async () => {
    if (!link) return;
    try {
      await Share.share({
        message:
          `I've been using SmartPlay Caddie — it actually watches your swing and caddies for you on the course. ` +
          `Grab it here and use my code:\n\n${link}`,
      });
    } catch { /* the share sheet being dismissed is not an error */ }
  }, [link]);

  const onClaim = useCallback(async () => {
    setClaiming(true);
    setClaimMsg(null);
    const result = await claimReferralCode(entry);
    setClaimMsg(CLAIM_MESSAGE[result]);
    if (result === 'claimed') setEntry('');
    setClaiming(false);
  }, [entry]);

  const days = status?.rewardDays ?? 30;
  /**
   * 1.0 ships with the paywall off, so "you get 30 days of Pro" would be describing a reward against
   * a period the player already has for free. The days are still EARNED — the server holds them
   * unredeemed until a build exists that can spend them — so the honest line says banked, not
   * granted. [[illustration-data-points]]
   */
  const rewardLine = SUBSCRIPTIONS_ENABLED
    ? `When a friend plays their first round, you get ${days} days of Pro. Free.`
    : `When a friend plays their first round, you bank ${days} days of Pro — applied the moment subscriptions begin.`;

  const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
    title: { color: colors.text_primary, fontSize: 18, fontWeight: '800' },
    body: { padding: 16, paddingBottom: 48 },
    lead: { color: colors.text_primary, fontSize: 16, lineHeight: 23, fontWeight: '600', marginBottom: 6 },
    sub: { color: colors.text_muted, fontSize: 13, lineHeight: 19, marginBottom: 18 },
    card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 },
    label: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
    code: { color: colors.text_primary, fontSize: 26, fontWeight: '900', letterSpacing: 4, textAlign: 'center', marginBottom: 14 },
    btn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    btnText: { color: '#04140d', fontSize: 15, fontWeight: '800' },
    btnDisabled: { opacity: 0.45 },
    counts: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 14 },
    countItem: { alignItems: 'center' },
    countVal: { color: colors.text_primary, fontSize: 20, fontWeight: '900' },
    countLbl: { color: colors.text_muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 },
    input: {
      backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
      color: colors.text_primary, fontSize: 18, fontWeight: '700', letterSpacing: 3, textAlign: 'center',
      paddingVertical: 13, marginBottom: 12,
    },
    msg: { color: colors.text_muted, fontSize: 13, lineHeight: 19, marginTop: 10, textAlign: 'center' },
    offline: { color: colors.text_muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  });

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => safeBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={s.title}>Invite a friend</Text>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.lead}>{rewardLine}</Text>
        <Text style={s.sub}>
          They have to actually get out and play — an install on its own doesn&apos;t count, which is what keeps
          this fair for everyone.
        </Text>

        <View style={s.card}>
          <Text style={s.label}>YOUR CODE</Text>
          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : status?.code ? (
            <>
              <Text style={s.code} selectable>{status.code}</Text>
              <TouchableOpacity style={[s.btn, !link && s.btnDisabled]} onPress={onShare} disabled={!link} accessibilityRole="button">
                <Text style={s.btnText}>Share my invite</Text>
              </TouchableOpacity>
              <View style={s.counts}>
                <View style={s.countItem}>
                  <Text style={s.countVal}>{status.qualified}</Text>
                  <Text style={s.countLbl}>PLAYED</Text>
                </View>
                <View style={s.countItem}>
                  <Text style={s.countVal}>{status.pending}</Text>
                  <Text style={s.countLbl}>NOT YET</Text>
                </View>
              </View>
            </>
          ) : (
            // No code means no signal or the feature is off server-side. Say so plainly rather than
            // showing an empty box that reads as a broken screen.
            <Text style={s.offline}>Your invite code will appear here once you&apos;re back online.</Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.label}>GOT A CODE?</Text>
          <TextInput
            style={s.input}
            value={entry}
            onChangeText={(t) => setEntry(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
            placeholder="ABC123XYZ0"
            placeholderTextColor={colors.text_muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
            accessibilityLabel="Invite code"
          />
          <TouchableOpacity
            style={[s.btn, (entry.length !== 10 || claiming) && s.btnDisabled]}
            onPress={onClaim}
            disabled={entry.length !== 10 || claiming}
            accessibilityRole="button"
          >
            <Text style={s.btnText}>{claiming ? 'One moment…' : 'Use this code'}</Text>
          </TouchableOpacity>
          {claimMsg && <Text style={s.msg}>{claimMsg}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
