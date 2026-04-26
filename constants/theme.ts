import { Platform } from 'react-native';

export const Colors = {
  dark: {
    background: '#060f09',
    card: '#0d2418',
    cardAlt: '#0a1a0a',
    border: '#1e3a28',
    activeBackground: '#003d20',
    primary: '#00C896',
    text: '#ffffff',
    textMuted: '#6b7280',
    tint: '#00C896',
    icon: '#6b7280',
    tabIconDefault: '#6b7280',
    tabIconSelected: '#00C896',
  },
  light: {
    // SmartPlay is always dark — these alias to dark values
    background: '#060f09',
    card: '#0d2418',
    cardAlt: '#0a1a0a',
    border: '#1e3a28',
    activeBackground: '#003d20',
    primary: '#00C896',
    text: '#ffffff',
    textMuted: '#6b7280',
    tint: '#00C896',
    icon: '#6b7280',
    tabIconDefault: '#6b7280',
    tabIconSelected: '#00C896',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
