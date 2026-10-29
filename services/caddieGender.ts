/**
 * 2026-08-31 (OPEN-ITEMS §22c) — THE ONE OWNER OF "what gender is the caddie".
 *
 * Three writers used to answer this and they disagreed, specifically for the CUSTOM caddie:
 *
 *   settingsStore.setCaddiePersonality   `p === 'serena' ? 'female' : 'male'`  → always MALE
 *   voiceService.speak (effectiveGender) from customCaddieBasePersona          → FEMALE if base is Serena
 *   app/_layout.tsx boot reconcile       from customCaddieGender               → whatever was picked
 *
 * `customCaddieGender` and `customCaddieBasePersona` were two independent user-set fields, so all
 * three could differ at once. Symptoms, all real: activating a female custom caddie wrote `male`,
 * and the boot reconcile silently corrected it — so the caddie's gender CHANGED at the next app
 * restart. The cloud voice and the device-TTS fallback could disagree on the same turn. And the
 * `custom → kevin` reconcile branch set the persona without the gender, so Kevin inherited the
 * custom caddie's.
 *
 * WHY BASE PERSONA WINS. `customCaddieBasePersona` is what actually drives the voice: voiceService
 * always sends an explicit `voice` for custom, and api/voice resolves `clientVoice ?? personaVoice
 * ?? gender`, so the gender argument never reached the custom caddie's cloud voice at all. Deriving
 * gender from anything else would mean the pronoun and the voice could disagree by construction.
 *
 * `customCaddieGender` is therefore DELETED rather than reconciled — its own picker was labelled
 * "Default voice ... male → Kevin's voice, female → Serena's", which is precisely what the base
 * persona control does, with Harry as well. Two controls for one question is where this started.
 * [[two-owners-is-the-root-cause]]
 *
 * Pure and sync: no store writes, no imports at module scope that could cycle back into settings.
 */
export type CaddieGender = 'male' | 'female';

/** The set of base personas, borrowed from the store that owns it — never restated here. */
type CustomBasePersona = ReturnType<
  typeof import('../store/playerProfileStore').usePlayerProfileStore.getState
>['customCaddieBasePersona'];

/**
 * The base persona a custom caddie inherits its voice — and therefore its gender — from.
 *
 * 2026-08-31 — the first version of this function RE-TYPED the list `['kevin','serena','harry']`
 * to validate the store value, and a guard caught it: that would have been the SIXTH list owning a
 * persona question, in a week when five lists owning ONE question was the defect being fixed. The
 * store validates its own field (`setCustomCaddieBasePersona`) and its migration maps the retired
 * value away, so there is nothing here to re-check. The type is borrowed from the store rather than
 * restated, which means adding a base persona there cannot leave this file behind.
 * [[two-owners-is-the-root-cause]]
 */
export function customBasePersona(): CustomBasePersona {
  try {
    const pp = (require('../store/playerProfileStore') as typeof import('../store/playerProfileStore')).usePlayerProfileStore.getState();
    return pp.customCaddieBasePersona ?? 'kevin';
  } catch {
    return 'kevin';
  }
}

/**
 * The caddie's gender, derived from the persona and nothing else. `voiceGender` in settingsStore is
 * a MIRROR of this, never a source — see setCaddiePersonality.
 */
export function genderForPersona(persona: string | null | undefined): CaddieGender {
  if (persona === 'serena') return 'female';
  if (persona === 'custom') return customBasePersona() === 'serena' ? 'female' : 'male';
  return 'male';
}

/**
 * 2026-10-28 (recheck VC-2) — THE VOICE THE CUSTOM CADDIE SPEAKS IN, with one owner.
 *
 * speak() spelled this ladder inline, and the offline clip warm (offlineVoiceCache) did not spell it
 * at all: it sent no `voice`, so api/voice fell to the gender default and every cue, ack and failure
 * line of a Harry-based or photo-matched custom caddie came back in onyx/nova while the answer
 * between them came in fable or sage — two caddies in one turn. Both now ask here.
 *
 * Order: the photo-matched / hand-picked voice (customCaddieVoice), else the base persona's voice.
 * Null for a built-in persona — the server's persona map owns those, so nothing is sent.
 */
const BASE_PERSONA_VOICE: Record<string, string> = { kevin: 'onyx', serena: 'nova', harry: 'fable' };
export function ttsVoiceForPersona(persona: string | null | undefined): string | null {
  if (persona !== 'custom') return null;
  try {
    const pp = (require('../store/playerProfileStore') as typeof import('../store/playerProfileStore')).usePlayerProfileStore.getState();
    if (typeof pp.customCaddieVoice === 'string' && pp.customCaddieVoice) return pp.customCaddieVoice;
  } catch { /* not hydrated — the base persona's voice is the honest answer */ }
  return BASE_PERSONA_VOICE[customBasePersona()] ?? BASE_PERSONA_VOICE.kevin;
}
