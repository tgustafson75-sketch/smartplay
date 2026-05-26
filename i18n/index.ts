/**
 * 2026-05-24 — i18n bootstrap (English + Spanish v1.2).
 *
 * Source-of-truth: settingsStore.language. expo-localization is consulted
 * only as a one-time hint at boot BEFORE settings has hydrated (defensive
 * import — works on builds without the native module, falls through to
 * fallbackLng on the existing OTA bundle).
 *
 * After init, language is kept in sync via a settingsStore.subscribe in
 * app/_layout.tsx — calling i18n.changeLanguage on every settings change
 * so voice "switch to Spanish" / Settings picker / device-locale all
 * funnel through the same store, and UI text + voice TTS stay aligned.
 *
 * Why settings, not device locale, is primary:
 *   - The user might have a Spanish-locale phone but want English voice
 *     (or vice versa). Settings expresses preference; device locale is
 *     just a guess.
 *   - The existing voice + TTS pipeline already reads settingsStore.language.
 *     Routing i18n through the same store keeps a single source of truth.
 *
 * OTA safety: expo-localization is a native module. On a build cut
 * without it (current OTA), the dynamic require throws and we fall back
 * to settings.language → 'en'. No crash.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
// 2026-05-26 — Fix BC: zh resource file added. Without it, Chinese
// users silently fell back to English even for keys that exist (Tank
// rules, button labels, settings — all the strings already in en.json
// and es.json). Translations here are an MVP starting point; the
// broader UI translation pass (full screen-by-screen) is queued
// post-beta.
import zh from './locales/zh.json';

// Try to read device locale; fall through if expo-localization isn't
// present in the bundled native modules (older OTA build).
function detectDeviceLanguage(): 'en' | 'es' | 'zh' {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Localization = require('expo-localization');
    // expo-localization v15+ uses getLocales(); older exposes `locale`.
    const locales = typeof Localization.getLocales === 'function' ? Localization.getLocales() : null;
    const code: string | undefined =
      (locales && locales[0]?.languageCode) ||
      (typeof Localization.locale === 'string' ? Localization.locale.split('-')[0] : undefined);
    if (code === 'es') return 'es';
    if (code === 'zh') return 'zh';
    return 'en';
  } catch {
    return 'en';
  }
}

// Settings store has 'en' | 'es' | 'zh'. All three resources are
// loaded; missing keys fall back to en.
function detectInitialLanguage(): 'en' | 'es' | 'zh' {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('../store/settingsStore') as typeof import('../store/settingsStore');
    const lang = useSettingsStore.getState().language;
    if (lang === 'es') return 'es';
    if (lang === 'zh') return 'zh';
    if (lang === 'en') return 'en';
    // Unset → device-locale hint.
    return detectDeviceLanguage();
  } catch {
    return detectDeviceLanguage();
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    zh: { translation: zh },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // React Native doesn't need Suspense for translations.
  react: { useSuspense: false },
});

export default i18n;
