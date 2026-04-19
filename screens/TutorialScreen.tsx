/**
 * TutorialScreen — SmartPlay Caddie onboarding (3 pages)
 *
 * Page 1 : Hero     — "Play every shot with confidence."  + Sign In link
 * Page 2 : Features — condensed 3-feature grid
 * Page 3 : Closing  — "Let''s Play Smart." CTA → /(tabs)/play
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import type { ViewToken } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";

const { width: SW, height: SH } = Dimensions.get("window");

export const TUTORIAL_COMPLETE_KEY = "tutorialComplete";

// ─────────────────────────────────────────────────────────────────────────────
// Images
// ─────────────────────────────────────────────────────────────────────────────
const heroImg     = require("../assets/tutorial/hero.jpg");
const analystImg  = require("../assets/tutorial/analyst.jpg");
const presenceImg = require("../assets/tutorial/presence.jpg");

const ALL_IMAGES = [heroImg, analystImg, presenceImg];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface FeatureIcon { icon: string; label: string; sub: string }
interface TutorialCard {
  id: number;
  type: "hero" | "features" | "closing";
  headline: string;
  headlineAccent: string;
  body: string;
  features?: FeatureIcon[];
  image: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-page card data
// ─────────────────────────────────────────────────────────────────────────────
const tutorialCards: TutorialCard[] = [
  {
    id: 0,
    type: "hero",
    headline: "Play every shot",
    headlineAccent: "with confidence.",
    body: "Real-time advice. Smarter decisions.\nBetter scores.",
    image: heroImg,
  },
  {
    id: 1,
    type: "features",
    headline: "Your caddie.",
    headlineAccent: "Always on.",
    body: "Everything you need on the course.",
    features: [
      { icon: "📍", label: "Course Intel",    sub: "Hole maps & hazards"     },
      { icon: "🏌️", label: "Shot Planning",  sub: "Wind, lie & distance"    },
      { icon: "📊", label: "Track & Improve", sub: "Trends after every round" },
    ],
    image: analystImg,
  },
  {
    id: 2,
    type: "closing",
    headline: "Let''s Play",
    headlineAccent: "Smart.",
    body: "Your game. Your caddie.\nBetter together.",
    image: presenceImg,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// KenBurnsImage — UI-thread scale + pan, active card only
// ─────────────────────────────────────────────────────────────────────────────
interface KenBurnsImageProps { source: number; isActive: boolean; onError: () => void }

function KenBurnsImage({ source, isActive, onError }: KenBurnsImageProps) {
  const scale      = useSharedValue(1);
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      scale.value = withRepeat(
        withTiming(1.04, { duration: 5000, easing: Easing.out(Easing.cubic) }),
        -1, true,
      );
      translateX.value = withRepeat(
        withTiming(6, { duration: 5000, easing: Easing.linear }),
        -1, true,
      );
    } else {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      scale.value      = withTiming(1, { duration: 300 });
      translateX.value = withTiming(0, { duration: 300 });
    }
  }, [isActive]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: translateX.value }],
  }));

  return (
    <Animated.Image
      source={source}
      style={[StyleSheet.absoluteFill, animStyle]}
      resizeMode="cover"
      onError={onError}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CardSlide — shared shell for all 3 pages
// ─────────────────────────────────────────────────────────────────────────────
function CardSlide({
  item,
  isActive,
  footer,
}: {
  item: TutorialCard;
  isActive: boolean;
  footer: React.ReactNode;
}) {
  const [imgError, setImgError] = useState(false);
  return (
    <View style={{ width: SW, height: SH, backgroundColor: "#000", overflow: "hidden" }}>
      {!imgError && (
        <KenBurnsImage source={item.image} isActive={isActive} onError={() => setImgError(true)} />
      )}
      <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="none" />
      {footer}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 1 — Hero
// ─────────────────────────────────────────────────────────────────────────────
function HeroCard({ item, isActive, onSignIn }: { item: TutorialCard; isActive: boolean; onSignIn: () => void }) {
  return (
    <CardSlide item={item} isActive={isActive} footer={
      <View style={styles.heroContent}>
        {/* Brand lockup */}
        <View style={styles.brand}>
          <Image
            source={require("../assets/images/logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.wordmark}>
              <Text style={{ color: "#FFFFFF" }}>Smart</Text>
              <Text style={{ color: "#A7F3D0" }}>Play</Text>
              <Text style={{ color: "#FFFFFF" }}> Caddie</Text>
            </Text>
            <Text style={styles.tagline}>REAL-TIME CADDIE INTELLIGENCE</Text>
          </View>
        </View>

        {/* Headline */}
        <View style={{ gap: 0, marginTop: "auto" }}>
          <Text style={styles.hWhite}>{item.headline}</Text>
          <Text style={styles.hGreen}>{item.headlineAccent}</Text>
          <View style={styles.divider} />
          <Text style={styles.body}>{item.body}</Text>
        </View>

        {/* Sign In link */}
        <Pressable onPress={onSignIn} hitSlop={12} style={styles.signInLink}>
          <Text style={styles.signInText}>Already have an account?{" "}
            <Text style={styles.signInAccent}>Sign In</Text>
          </Text>
        </Pressable>
      </View>
    } />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 2 — Features
// ─────────────────────────────────────────────────────────────────────────────
function FeaturesCard({ item, isActive }: { item: TutorialCard; isActive: boolean }) {
  return (
    <CardSlide item={item} isActive={isActive} footer={
      <View style={styles.featContent}>
        <Text style={styles.hWhite}>{item.headline}</Text>
        <Text style={styles.hGreen}>{item.headlineAccent}</Text>
        <View style={styles.divider} />
        {item.features && (
          <View style={styles.featGrid}>
            {item.features.map((f) => (
              <View key={f.label} style={styles.featItem}>
                <View style={styles.featIconWrap}>
                  <Text style={styles.featIcon}>{f.icon}</Text>
                </View>
                <Text style={styles.featLabel}>{f.label}</Text>
                <Text style={styles.featSub}>{f.sub}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    } />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 3 — Closing
// ─────────────────────────────────────────────────────────────────────────────
function ClosingCard({ item, isActive }: { item: TutorialCard; isActive: boolean }) {
  return (
    <CardSlide item={item} isActive={isActive} footer={
      <View style={styles.closingContent}>
        <Text style={styles.hWhite}>{item.headline}</Text>
        <Text style={styles.hGreen}>{item.headlineAccent}</Text>
        <View style={styles.divider} />
        <Text style={styles.body}>{item.body}</Text>
      </View>
    } />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TutorialScreen
// ─────────────────────────────────────────────────────────────────────────────
export default function TutorialScreen() {
  const router    = useRouter();
  const listRef   = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);
  const isLast    = index === tutorialCards.length - 1;

  // Prefetch all tutorial images on mount
  useEffect(() => {
    ALL_IMAGES.forEach((src) => {
      const uri = Image.resolveAssetSource(src)?.uri;
      if (uri) Image.prefetch(uri).catch(() => {});
    });
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const finish = async () => {
    await AsyncStorage.setItem(TUTORIAL_COMPLETE_KEY, "true");
    router.replace("/(tabs)/caddie");
  };

  const handleSkip   = useCallback(() => { void finish(); }, []);
  const handleSignIn = useCallback(() => { router.push("/auth"); }, []);
  const handleNext   = useCallback(() => {
    if (isLast) { void finish(); return; }
    const next = index + 1;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  }, [isLast, index]);

  const renderItem = useCallback(
    ({ item, index: i }: { item: TutorialCard; index: number }) => {
      const active = i === index;
      if (item.type === "hero")     return <HeroCard     item={item} isActive={active} onSignIn={handleSignIn} />;
      if (item.type === "features") return <FeaturesCard item={item} isActive={active} />;
      return <ClosingCard item={item} isActive={active} />;
    },
    [index, handleSignIn],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <FlatList
        ref={listRef}
        data={tutorialCards}
        renderItem={renderItem}
        keyExtractor={(c) => String(c.id)}
        horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        scrollEventThrottle={16}
        bounces={false}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
      />

      {/* Dot indicators */}
      <View style={styles.dots} pointerEvents="none">
        {tutorialCards.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      {/* Navigation bar */}
      <View style={styles.nav}>
        <Pressable onPress={handleSkip} style={styles.skipBtn} hitSlop={16}>
          <Text style={styles.skipText}>{isLast ? "" : "Skip"}</Text>
        </Pressable>
        <Pressable
          onPress={handleNext}
          style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.nextText}>{isLast ? "Start Round" : "Next →"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldShowTutorial — called from _layout auth flow
// ─────────────────────────────────────────────────────────────────────────────
export async function shouldShowTutorial(): Promise<boolean> {
  const done = await AsyncStorage.getItem(TUTORIAL_COMPLETE_KEY);
  return done !== "true";
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050d08" },

  overlay: { backgroundColor: "rgba(0,0,0,0.45)" },

  // ── Hero card ──────────────────────────────────────────────────────────────
  heroContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 130,
    justifyContent: "flex-start",
    gap: 0,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo:  { width: 46, height: 46, borderRadius: 23 },
  wordmark: { fontSize: 18, fontWeight: "800", letterSpacing: 0.3 },
  tagline:  { fontSize: 9,  color: "rgba(255,255,255,0.55)", fontWeight: "600", letterSpacing: 2 },

  // ── Shared headline styles ─────────────────────────────────────────────────
  hWhite: { fontSize: 40, fontWeight: "700", color: "#FFFFFF",  lineHeight: 46 },
  hGreen: { fontSize: 40, fontWeight: "700", color: "#A7F3D0",  lineHeight: 46 },
  divider: { width: 44, height: 3, backgroundColor: "#A7F3D0", borderRadius: 2, marginTop: 14, marginBottom: 14 },
  body:   { fontSize: 17, color: "rgba(255,255,255,0.80)", lineHeight: 26 },

  // ── Sign In link ───────────────────────────────────────────────────────────
  signInLink: { marginTop: 24 },
  signInText: { fontSize: 14, color: "rgba(255,255,255,0.60)" },
  signInAccent: { color: "#A7F3D0", fontWeight: "700" },

  // ── Features card ─────────────────────────────────────────────────────────
  featContent: {
    position: "absolute",
    bottom: 130,
    left: 28,
    right: 28,
  },
  featGrid: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  featItem: { alignItems: "center", flex: 1 },
  featIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(167,243,208,0.12)",
    borderWidth: 1, borderColor: "rgba(167,243,208,0.35)",
    alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  featIcon:  { fontSize: 18 },
  featLabel: { fontSize: 11, color: "#FFFFFF", fontWeight: "600", textAlign: "center" },
  featSub:   { fontSize: 10, color: "rgba(255,255,255,0.50)", textAlign: "center", marginTop: 1 },

  // ── Closing card ──────────────────────────────────────────────────────────
  closingContent: {
    position: "absolute",
    bottom: 130,
    left: 28,
    right: 28,
  },

  // ── Dots ──────────────────────────────────────────────────────────────────
  dots: {
    position: "absolute", bottom: 92, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 7,
  },
  dot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.30)" },
  dotActive: { backgroundColor: "#A7F3D0", width: 14 },

  // ── Navigation bar ────────────────────────────────────────────────────────
  nav: {
    position: "absolute", bottom: 32, left: 24, right: 24,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  skipBtn:  { paddingVertical: 10 },
  skipText: { fontSize: 15, color: "rgba(255,255,255,0.55)", fontWeight: "500" },
  nextBtn: {
    backgroundColor: "#A7F3D0",
    paddingHorizontal: 26, paddingVertical: 13,
    borderRadius: 30,
  },
  nextText: { fontSize: 15, fontWeight: "700", color: "#071A0D" },
});
