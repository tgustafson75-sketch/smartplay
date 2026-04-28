import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type ThemeTokens } from '../theme/tokens';
import { useSettingsStore } from '../store/settingsStore';

const ThemeContext = createContext<ThemeTokens>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const themePreference = useSettingsStore(s => s.theme_preference);

  const theme = useMemo(() => {
    if (themePreference === 'light') return lightTheme;
    if (themePreference === 'dark') return darkTheme;
    return systemScheme === 'light' ? lightTheme : darkTheme;
  }, [themePreference, systemScheme]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
