/**
 * 2026-11-12 — Brand line (SmartPlay AI standard): "Veteran Owned and Developed 🇺🇸" shows in
 * Settings → Help & About, under "Built by". Source-level (nothing mounts the Settings screen), plus
 * the real i18next lookup so the key resolves to the exact text in every locale.
 *
 * Break test: remove the row from app/settings.tsx or the key from en.json and this file fails.
 */
import * as fs from 'fs';
import * as path from 'path';
import i18n from 'i18next';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';
import zh from '../../i18n/locales/zh.json';

const LINE = 'Veteran Owned and Developed 🇺🇸';

describe('Veteran line', () => {
  it('renders in Help & About, after Built by', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/settings.tsx'), 'utf8');
    const help = src.indexOf("title={t('settings.title.help_about')}");
    const builtBy = src.indexOf("t('settings.text.built_by')");
    const row = src.indexOf("t('settings.text.veteran_owned')");
    expect(help).toBeGreaterThan(-1);
    expect(builtBy).toBeGreaterThan(help);
    expect(row).toBeGreaterThan(builtBy);
  });

  it('resolves to the exact text in en, and es/zh fall back to it', async () => {
    const inst = i18n.createInstance();
    await inst.init({
      lng: 'en', fallbackLng: 'en',
      resources: { en: { translation: en }, es: { translation: es }, zh: { translation: zh } },
      interpolation: { escapeValue: false },
    });
    for (const lng of ['en', 'es', 'zh']) {
      expect(inst.getFixedT(lng)('settings.text.veteran_owned')).toBe(LINE);
    }
  });
});
