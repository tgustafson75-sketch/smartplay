import React from "react";
import { View, ViewProps } from "react-native";
import { useTheme, Spacing } from "../theme/brand";

interface ScreenContainerProps extends ViewProps {
  children: React.ReactNode;
}

export default function ScreenContainer({ children, style, ...rest }: ScreenContainerProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: theme.background,
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.xl,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
