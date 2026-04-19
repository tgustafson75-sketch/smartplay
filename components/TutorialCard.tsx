/**
 * TutorialCard
 * Centered focus panel — single card shown at a time in TutorialScreen.
 */
import React, { useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import Icon from "./Icon";
import type { IconName } from "./Icon";
import { useTheme, Spacing } from "../theme/brand";

interface TutorialCardProps {
  icon: IconName;
  title: string;
  description: string;
  /** Optional local require() image shown above the icon */
  image?: number;
}

export default function TutorialCard({ icon, title, description, image }: TutorialCardProps) {
  const theme = useTheme();
  const isBright = String(theme.background) === "#FFFFFF";
  const [imgError, setImgError] = useState(false);
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.cardBorder,
          // Remove glass shadow in bright mode — clean flat card
          shadowOpacity: isBright ? 0 : 0.45,
          elevation: isBright ? 0 : 6,
        },
      ]}
    >
      {image && !imgError && (
        <Image
          source={image}
          style={styles.stepImage}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      )}
      <View style={[styles.iconWrap, { backgroundColor: theme.accent }]}>
        <Icon name={icon} size={36} active />
      </View>
      <Text style={[styles.title, { color: theme.textPrimary, fontWeight: isBright ? "700" : "700" }]}>{title}</Text>
      <Text style={[styles.desc, { color: theme.textSecondary, fontWeight: isBright ? "600" : "400" }]}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    shadowColor: "#1F6F54",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 20,
    overflow: "hidden",
  },
  stepImage: {
    width: "100%",
    height: 160,
    borderRadius: 14,
    marginBottom: Spacing.xs,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: 20,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
