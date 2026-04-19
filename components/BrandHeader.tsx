/**
 * BrandHeader
 * Matches marketing exactly:
 *   [circular logo]  SmartPlay Caddie
 *                    REAL-TIME CADDIE INTELLIGENCE
 * Left-aligned. Zero variation across screens.
 * Optional `rightSlot` renders a right-aligned element (e.g. tools pill).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme, Spacing } from "../theme/brand";
import CaddieMicButton from "./CaddieMicButton";

interface BrandHeaderProps {
  /** Optional element rendered right-aligned in the header row (e.g. tools pill). */
  rightSlot?: React.ReactNode;
}

export default function BrandHeader({ rightSlot }: BrandHeaderProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { borderBottomColor: theme.divider, backgroundColor: theme.background }]}>
      {/* Logo as live caddie mic */}
      <CaddieMicButton size={44} showLabel={false} />

      {/* Wordmark + tagline */}
      <View style={styles.text}>
        <Text style={styles.wordmark}>
          <Text style={{ color: theme.accentSoft }}>SmartPlay</Text>
          <Text style={{ color: theme.textPrimary }}> Caddie</Text>
        </Text>
        <Text style={[styles.tagline, { color: theme.textSecondary }]}>REAL-TIME CADDIE INTELLIGENCE</Text>
      </View>

      {/* Right slot — spacer fills remaining room, slot renders flush right */}
      {rightSlot != null && (
        <>
          <View style={{ flex: 1 }} />
          {rightSlot}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  text: {
    gap: 2,
  },
  wordmark: {
    fontSize: 18,
    fontWeight: "800" as const,
    letterSpacing: 1.5,
    lineHeight: 20,
  },
  tagline: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
