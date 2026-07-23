/**
 * 2026-07-23 (Tim — "nothing in settings is arbitrary; touching voice must not be a crisis").
 *
 * PURE map of the settings the voice BRAIN needs. It lives in its own dependency-free module (no
 * store/RN imports) for two reasons:
 *   1. It's UNIT-TESTABLE — brainSettings.test.ts asserts every brain-bound field is forwarded, so a
 *      new toggle that someone forgets to send FAILS A TEST instead of silently dying on the live
 *      path. That silent-death class is exactly what made cecilyMode / responseMode / personaIntensity
 *      / tankSoftIntro dead for so long.
 *   2. It's the SINGLE choke point — every setting the brain reads flows through here, so wiring one
 *      is a one-line, obviously-safe change (buildPipecatContext spreads it; pipecat-turn consumes it).
 *
 * `Persona` is imported type-only (erased at runtime), so this module stays pure.
 */
import type { Persona } from '../../store/settingsStore';

export type BrainSettings = {
  language: 'en' | 'es' | 'zh';
  aiProvider: 'anthropic';
  continuousConversationMode: boolean;
  responseMode: 'short' | 'neutral' | 'detailed';
  cecilyMode: boolean;
  /** The ACTIVE persona's 0–100 intensity dial (pipecat-turn / kevin.ts scale cadence off this). */
  personaIntensity: number;
  tankSoftIntro: boolean;
};

export function brainSettings(s: {
  language?: 'en' | 'es' | 'zh' | string;
  continuousConversationMode?: boolean;
  responseMode?: 'short' | 'neutral' | 'detailed';
  cecilyMode?: boolean;
  personaIntensity?: Record<string, number> | null;
  tankSoftIntro?: boolean;
  caddiePersonality: Persona;
}): BrainSettings {
  const lang = s.language === 'es' || s.language === 'zh' ? s.language : 'en';
  const intensity = s.personaIntensity?.[s.caddiePersonality];
  return {
    language: lang,
    aiProvider: 'anthropic',
    continuousConversationMode: s.continuousConversationMode ?? false,
    responseMode: s.responseMode ?? 'neutral',
    cecilyMode: s.cecilyMode ?? false,
    personaIntensity: typeof intensity === 'number' && Number.isFinite(intensity) ? intensity : 100,
    tankSoftIntro: s.tankSoftIntro ?? false,
  };
}
