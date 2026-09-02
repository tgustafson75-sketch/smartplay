import { KEVIN_CHARACTER_SPEC } from '../constants/kevinCharacter';
import { SERENA_CHARACTER_SPEC } from '../constants/serenaCharacter';
import { HARRY_CHARACTER_SPEC } from '../constants/harryCharacter';

export type VoiceGender = 'male' | 'female';
// 2026-06-06 — 'custom' added as 5th persona for the user's
// self-generated caddie (selfie portrait + recorded voice clips +
// chosen name). All maps below carry a 'custom' entry that defaults
// to Kevin-equivalent values so anything downstream that doesn't
// know about 'custom' degrades gracefully (same fallback strategy
// resolvePersona has used for unknown strings). The user's chosen
// NAME lives in playerProfileStore.customCaddieName; UI surfaces
// that want to show it pull from there directly. getCaddieName
// returns 'My Caddie' as the static fallback.
export type Persona = 'kevin' | 'serena' | 'harry' | 'custom';

const PERSONA_NAMES: Record<Persona, string> = {
  kevin: 'Kevin',
  serena: 'Serena',
  harry: 'Harry',
  custom: 'My Caddie',
};

const PERSONA_SPECS: Record<Persona, string> = {
  kevin: KEVIN_CHARACTER_SPEC,
  serena: SERENA_CHARACTER_SPEC,
  harry: HARRY_CHARACTER_SPEC,
  // Custom caddie inherits Kevin's neutral spec — server-side TTS
  // and brain text fall back to Kevin's voice when the client
  // doesn't have a user-recorded clip for the response. Local
  // recorded-clip playback overrides this whenever a clip exists.
  custom: KEVIN_CHARACTER_SPEC,
};

const PERSONA_GENDERS: Record<Persona, VoiceGender> = {
  kevin: 'male',
  serena: 'female',
  harry: 'male',
  // Default gender for server-TTS fallback only. The user's own
  // recorded voice plays from local clips when available.
  custom: 'male',
};

const PERSONA_PRONOUNS: Record<Persona, { subject: string; object: string; possessive: string }> = {
  kevin:  { subject: 'he', object: 'him', possessive: 'his' },
  serena: { subject: 'she', object: 'her', possessive: 'her' },
  harry:  { subject: 'he', object: 'him', possessive: 'his' },
  // Gender-neutral pronouns for the user's custom caddie — works
  // for any user-chosen identity without forcing a male/female
  // assumption.
  custom: { subject: 'they', object: 'them', possessive: 'their' },
};

// Resolve a Persona | VoiceGender input to a canonical Persona.
// Back-compat: legacy callers that pass 'male' or 'female' are mapped to
// their default persona (Kevin / Serena), so older code paths keep working
// without per-call-site changes.
// Audit 101 / B4 — accept arbitrary strings (callers commonly read from
// untyped request bodies). Unrecognised strings fall through to 'kevin',
// matching the legacy default.
type PersonaInput = Persona | VoiceGender | string | undefined | null;

function resolvePersona(input: PersonaInput): Persona {
  if (input === 'kevin' || input === 'serena' || input === 'harry' || input === 'custom') return input;
  // 2026-08-25 — a persisted or server-sent 'tank' now falls through to Kevin below, matching the
  // settings v22 migration, so an old payload can never resolve to a persona that no longer exists.
  if (input === 'female') return 'serena';
  return 'kevin';
}

export function getCaddieName(input: PersonaInput): string {
  return PERSONA_NAMES[resolvePersona(input)];
}

export function getCharacterSpec(input: PersonaInput): string {
  return PERSONA_SPECS[resolvePersona(input)];
}

export function personaToVoiceGender(p: Persona): VoiceGender {
  return PERSONA_GENDERS[p];
}

export function getCaddieSubject(input: PersonaInput): string {
  return PERSONA_PRONOUNS[resolvePersona(input)].subject;
}

export function getCaddieObject(input: PersonaInput): string {
  return PERSONA_PRONOUNS[resolvePersona(input)].object;
}

export function getCaddiePossessive(input: PersonaInput): string {
  return PERSONA_PRONOUNS[resolvePersona(input)].possessive;
}

export const ALL_PERSONAS: readonly Persona[] = ['kevin', 'serena', 'harry', 'custom'] as const;

/**
 * Personas exposed in the user-facing UI right now. Harry is currently
 * dormant (Tim's call — overlaps Kevin's arc too closely). The character
 * spec, voice config, avatars, and routing all stay in place so re-enable
 * is one line: add `'harry'` back here. Settings store v6 migrate maps any
 * persisted Harry assignment to Kevin so existing users don't get stuck.
 *
 * Drives every UI surface that lists pickable caddies (Settings rows,
 * intro picker, suggestion targets). Anything in ALL_PERSONAS but not in
 * ACTIVE_PERSONAS is dormant — type-valid, never shown.
 */
/**
 * 2026-08-25 (Tim) — TANK IS REMOVED FROM THE SHIPPING APP.
 *
 * The persona was modelled on a real person, and Tim has asked for every reference stripped before
 * submission.
 *
 * TO BE ACCURATE ABOUT THE KNOWLEDGE BASE, because the opposite is easy to assume and I assumed it
 * first: the coaching entries are ORIGINAL material. They were deliberately HEDGED against his
 * input rather than transcribed from it — the register he brought was too "range rat" for this
 * app's voice. So there is no third-party IP in the KB and nothing there needs removing; what goes
 * is the persona and the name.
 *
 * Removed the same way Harry was: dropped from ACTIVE_PERSONAS, with a settings migration mapping
 * any persisted 'tank' assignment to Kevin so no existing user is stranded on a hidden persona.
 * The type and routing stay valid so nothing breaks mid-removal; the deeper scrub (KB entries,
 * tankAnswer fields, assets) follows.
 */
export const ACTIVE_PERSONAS: readonly Persona[] = ['kevin', 'serena', 'custom'] as const;

export function isActivePersona(p: Persona): boolean {
  return (ACTIVE_PERSONAS as readonly Persona[]).includes(p);
}

/**
 * 2026-08-07 (Tim — "you can STILL toggle to Tank; how the fuck is that hidden?"). Tank is OWNER-GATED, so
 * EVERY surface that lists/cycles pickable caddies (the tools-menu cycler, the persona-intensity list, the
 * onboarding intro pickers) must drop Tank when it's disabled — not just the Settings pillar pickers. This
 * is the single gated list those surfaces should render instead of ACTIVE_PERSONAS directly.
 */
export function selectablePersonas(_legacyFlag?: boolean): readonly Persona[] {
  // 2026-08-25 — the persona this gated is gone, so the flag no longer selects anything. The
  // parameter is kept (optional, ignored) purely so the several call sites that still pass a
  // setting keep compiling; they can drop the argument at leisure. Returning ACTIVE_PERSONAS
  // directly means there is now exactly ONE list of pickable caddies.
  return ACTIVE_PERSONAS;
}

/**
 * Audit 101 / B4 — server-side request body persona resolver. Prefer the newer `persona` field; fall
 * back to the legacy `voiceGender` field. This closes the F13 server-side gap where api/* routes
 * called getCaddieName(voiceGender) and collapsed a non-Serena persona to Kevin in their system
 * prompts, even when the client sent persona='harry'.
 *
 * 2026-09-01 — THE EXTRACTION IS NOW OWNED HERE, and this is the point of the function.
 *
 * Fourteen call sites across twelve routes each wrote the same three lines by hand:
 *
 *     const voiceGender: VoiceGender = (body.voiceGender as VoiceGender | undefined) ?? 'male';
 *     const personaInput = (typeof body.persona === 'string' ? (body.persona as string) : voiceGender)
 *       as Persona | VoiceGender;
 *
 * Every one of them happened to be correct — this was audited on 09-01 and no route was dropping
 * `persona`. That is the argument FOR consolidating, not against it: correctness that depends on
 * fourteen independent copies staying identical is correctness on loan. The next route to be written
 * copies whichever neighbour its author happened to open, and the failure is silent — the caddie
 * simply answers as Kevin, in Kevin's voice, and nobody files a bug about a caddie that spoke.
 * [[two-owners-is-the-root-cause]]
 *
 * Precedence note, since it is the whole behaviour: a `persona` STRING wins, whatever it says —
 * an unrecognised one resolves to Kevin inside resolvePersona rather than falling through to
 * voiceGender, because a client that sent a persona field has stated an intent, and silently
 * reinterpreting it as a gender is how 'tank' became Kevin-with-Serena's-voice once already.
 */
export function personaInputFrom(
  body: { persona?: unknown; voiceGender?: unknown } | null | undefined,
): Persona | VoiceGender | undefined {
  if (!body) return undefined;
  return (typeof body.persona === 'string' ? body.persona : body.voiceGender) as
    | Persona
    | VoiceGender
    | undefined;
}

/** The caddie's NAME for a request body. Prefer this over getCaddieName(personaInputFrom(body)). */
export function getCaddieNameFor(body: { persona?: unknown; voiceGender?: unknown } | null | undefined): string {
  return getCaddieName(personaInputFrom(body));
}

/** The character spec for a request body — what api/* routes embed in the system prompt. */
export function getCharacterSpecFor(body: { persona?: unknown; voiceGender?: unknown } | null | undefined): string {
  return getCharacterSpec(personaInputFrom(body));
}
