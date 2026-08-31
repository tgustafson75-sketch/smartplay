/**
 * 2026-08-31 (Tim) — THE DIGITAL BUSINESS CARD, in the app, askable from the caddie.
 *
 * Built NATIVELY rather than as a WebView over the original HTML, deliberately. A WebView would have
 * been a faithful pixel copy and a worse card: the phone number would not dial, the address would not
 * open Mail, the QR could not be shared to a text message, and none of it would survive being handed
 * to someone in bright sun on a first tee. Rebuilt in real components, every row is a real action.
 *
 * The design is Tim's, kept: dark ground, the QR on a WHITE PLATE because that is what a phone camera
 * needs outdoors, and tap targets at 48px because this gets used one-handed wearing a glove.
 *
 * OTA-SAFE: no new dependency. The QR ships as an asset (assets/images/owner-card-qr.png), and assets
 * travel over the air. [[ota-must-work-on-the-shipped-ios-build]]
 *
 * OWNER-GATED at the screen, not just hidden in the menu — a route can be reached by voice, by deep
 * link, or by typing it, so the gate has to live where the render is.
 */
import React, { useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Linking, Share, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isOwnerEmail, usePlayerProfileStore } from '../store/playerProfileStore';
import { CARD, shareTextFor, telUriFor } from '../services/ownerCard';

/** The card's own palette — a committed look, independent of the app theme, exactly as designed. */
const INK = '#080E0B';
const RAISE = '#0E1714';
const RULE = '#1D2C25';
const GREEN = '#00C853';
const FG = '#F2F5F3';
const MUTED = '#8FA79A';

export default function OwnerCard() {
  const router = useRouter();
  const email = usePlayerProfileStore((s) => s.email);
  const isOwner = isOwnerEmail(email);

  const open = useCallback((url: string) => {
    // Never throws at the caller: a device with no mail client is not a crash.
    Linking.openURL(url).catch(() => { /* no handler for this scheme on this device */ });
  }, []);

  const onShare = useCallback(() => {
    Share.share(
      Platform.OS === 'ios'
        ? { message: shareTextFor(), url: CARD.download }
        : { message: shareTextFor() },
    ).catch(() => { /* the sheet was dismissed */ });
  }, []);

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.screen, { justifyContent: 'center' }]} edges={['top', 'bottom']}>
        <Text style={styles.gated}>This card is owner-only.</Text>
        <TouchableOpacity style={styles.gatedBtn} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.gatedBtnText}>Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const Row = ({ icon, label, sub, onPress, primary }: {
    icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void; primary?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.link, primary && styles.linkPrimary]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
    >
      <Ionicons name={icon} size={20} color={primary ? INK : GREEN} />
      <Text style={[styles.linkLabel, primary && styles.linkLabelPrimary]}>{label}</Text>
      {sub ? <Text style={[styles.linkSub, primary && styles.linkSubPrimary]} numberOfLines={1}>{sub}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={GREEN} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onShare} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Share card">
          <Ionicons name="share-outline" size={22} color={GREEN} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.card} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Text style={styles.name}>{CARD.name}</Text>
          <Text style={styles.role}>{CARD.role}</Text>
          <Text style={styles.co}>{CARD.company}</Text>
        </View>

        {/* WHITE PLATE, deliberately: a phone camera needs the quiet zone and the contrast to
            lock a QR in direct sun. This is the one element that must not follow the dark theme. */}
        <View style={styles.qrWrap}>
          <Image
            source={require('../assets/images/owner-card-qr.png')}
            style={styles.qr}
            resizeMode="contain"
            accessibilityLabel="QR code to download SmartPlay Caddie"
          />
        </View>
        <Text style={styles.scan}>Scan to get the app</Text>

        <View style={styles.pitch}>
          <Text style={styles.pitchTitle}>SmartPlay Caddie</Text>
          <Text style={styles.pitchBody}>{CARD.pitch}</Text>
        </View>

        <View style={styles.links}>
          <Row icon="download-outline" label="Get SmartPlay Caddie" onPress={() => open(CARD.download)} primary />
          <Row icon="call-outline" label="Call" sub={CARD.phone} onPress={() => open(telUriFor())} />
          <Row icon="mail-outline" label="Email" sub={CARD.email} onPress={() => open(`mailto:${CARD.email}`)} />
          <Row icon="globe-outline" label="Website" sub="smartplaycaddie.com" onPress={() => open(CARD.website)} />
          <Row icon="logo-instagram" label="Instagram" sub={CARD.instagram} onPress={() => open(CARD.instagramUrl)} />
        </View>

        <Text style={styles.footer}>{CARD.tagline}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  card: { paddingHorizontal: 22, paddingBottom: 44, gap: 22, maxWidth: 460, width: '100%', alignSelf: 'center' },
  top: { alignItems: 'center', gap: 2 },
  name: { color: FG, fontSize: 27, fontWeight: '800', letterSpacing: -0.5 },
  role: { color: MUTED, fontSize: 15 },
  co: { color: GREEN, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginTop: 8, fontWeight: '600' },
  qrWrap: { backgroundColor: '#fff', borderRadius: 18, padding: 14 },
  qr: { width: '100%', aspectRatio: 1, borderRadius: 6 },
  scan: { color: MUTED, fontSize: 13, textAlign: 'center', marginTop: -10 },
  pitch: { gap: 6 },
  pitchTitle: { color: FG, fontSize: 18, fontWeight: '700' },
  pitchBody: { color: MUTED, fontSize: 14, lineHeight: 21 },
  links: { gap: 10 },
  link: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: RAISE, borderWidth: 1, borderColor: RULE },
  linkPrimary: { backgroundColor: GREEN, borderColor: GREEN },
  linkLabel: { color: FG, fontSize: 15, fontWeight: '600' },
  linkLabelPrimary: { color: INK },
  linkSub: { color: MUTED, fontSize: 13, marginLeft: 'auto' },
  linkSubPrimary: { color: INK, opacity: 0.75 },
  footer: { color: GREEN, fontSize: 12, letterSpacing: 2.5, textTransform: 'uppercase', textAlign: 'center', fontWeight: '700', marginTop: 6 },
  gated: { color: MUTED, textAlign: 'center', fontSize: 15 },
  gatedBtn: { alignSelf: 'center', marginTop: 16, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: RAISE, borderWidth: 1, borderColor: RULE },
  gatedBtnText: { color: FG, fontWeight: '600' },
});
