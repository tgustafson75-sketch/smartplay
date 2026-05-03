import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, composeTheme, type ThemeTokens } from '../theme/tokens';
import { useSettingsStore } from '../store/settingsStore';

const ThemeContext = createContext<ThemeTokens>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const themePreference = useSettingsStore(s => s.theme_preference);
  // Phase AP — wire highContrast through the theme so toggling it produces
  // an immediate, visible app-wide change. composeTheme overlays the
  // pure-black/white + stronger-border layer on top of the base palette
  // when highContrast is true.
  const highContrast = useSettingsStore(s => s.highContrast);

  const theme = useMemo(() => {
    const base =
      themePreference === 'light' ? lightTheme :
      themePreference === 'dark' ? darkTheme :
      (systemScheme === 'light' ? lightTheme : darkTheme);
    const isDark = base === darkTheme;
    return composeTheme(base, isDark, highContrast);
  }, [themePreference, systemScheme, highContrast]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
