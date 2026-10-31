/**
 * 2026-10-31 (caddie-voice CAD-LANG-1) — AN ES OR ZH PLAYER IS NOT GIVEN ENGLISH, OR SILENCE, WHEN THE CADDIE HAS NOTHING TO ANSWER.
 *
 * The bare "didn't catch that" notice was one English string for every player, and the offline clip cache
 * held no Spanish or Chinese "didn't catch that" and no Spanish or Chinese mic-trouble line. A Spanish player
 * on a warmed cache heard the English clip; a Spanish player whose mic never opened heard nothing. Every
 * notice the caddie can speak in those two moments now exists in every language, and each one has a cached
 * persona-voice clip for that language, so a missing es or zh clip fails here instead of going silent.
 * Break-test: restore the single-string notice (or drop an es/zh slug) and these fail.
 */
import { CADDIE_NOTICE_DIDNT_CATCH, CADDIE_NOTICE_MIC_TROUBLE } from '../../services/caddieAckLines';

jest.setTimeout(120_000);

describe('the no-answer notices are in the player\'s language and have a cached clip in it', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('expo-file-system', () => ({
      File: class { exists = false; size = 0; },
      Paths: { cache: '/tmp/cache' },
    }));
  });

  // Typed as the per-language record on purpose: the notice must be read per language, and a single string
  // (the pre-fix shape) fails on its own values rather than on a compile error.
  type ByLang = Record<'en' | 'es' | 'zh', string>;
  const NOTICES: Record<string, ByLang> = {
    didnt_catch: CADDIE_NOTICE_DIDNT_CATCH as unknown as ByLang,
    mic_trouble: CADDIE_NOTICE_MIC_TROUBLE,
  };

  it('every notice has a non-blank line for each of en, es and zh, and es and zh are not the English wording', () => {
    for (const [name, notice] of Object.entries(NOTICES)) {
      expect(Object.keys(notice).sort()).toEqual(['en', 'es', 'zh']);
      for (const lang of ['en', 'es', 'zh'] as const) {
        expect([name, lang, notice[lang].trim().length > 0]).toEqual([name, lang, true]);
      }
      expect(notice.es).not.toBe(notice.en);
      expect(notice.zh).not.toBe(notice.en);
    }
    expect(/[一-鿿]/.test(NOTICES.didnt_catch.zh)).toBe(true);
  });

  it('every es and zh notice line is pre-rendered by the offline cache under its own language', () => {
    const cache = require('../../services/offlineVoiceCache') as typeof import('../../services/offlineVoiceCache');
    const cached = new Set(cache.OFFLINE_LINES.map((l) => `${l.language}:${l.text}`));
    for (const notice of Object.values(NOTICES)) {
      for (const lang of ['en', 'es', 'zh'] as const) {
        expect([lang, cached.has(`${lang}:${notice[lang]}`)]).toEqual([lang, true]);
      }
    }
  });

  it('each cached notice clip has its own slug, so an es line cannot shadow an English one', () => {
    const cache = require('../../services/offlineVoiceCache') as typeof import('../../services/offlineVoiceCache');
    const slugs = cache.OFFLINE_LINES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
