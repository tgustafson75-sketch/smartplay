import React from "react";
import { View, Text } from "react-native";
import { useTheme, Spacing, Typography } from "../theme/brand";
import CaddieMic from "./CaddieMic";
import { BRAND_ACCENT, TAGLINE } from "../constants/branding";

interface BrandBlockProps {
  size?: number;
}

export default function BrandBlock({ size = 40 }: BrandBlockProps) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
      <CaddieMic size={size} />
      <View style={{ marginLeft: Spacing.xs }}>
        <Text
          style={{
            ...Typography.brand,
            fontWeight: Typography.brand.fontWeight,
          }}
        >
          <Text style={{ color: BRAND_ACCENT }}>SmartPlay</Text>
          <Text style={{ color: theme.textPrimary }}> Caddie</Text>
        </Text>
        <Text
          style={{
            ...Typography.tagline,
            color: theme.textSecondary,
            textTransform: "uppercase",
          }}
        >
          {TAGLINE}
        </Text>
      </View>
    </View>
  );
}
