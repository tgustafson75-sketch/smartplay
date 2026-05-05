import { KEVIN_CHARACTER_SPEC } from '../constants/kevinCharacter';
import { SERENA_CHARACTER_SPEC } from '../constants/serenaCharacter';
import { HARRY_CHARACTER_SPEC } from '../constants/harryCharacter';
import { TANK_CHARACTER_SPEC } from '../constants/tankCharacter';

export type VoiceGender = 'male' | 'female';
export type Persona = 'kevin' | 'serena' | 'harry' | 'tank';

const PERSONA_NAMES: Record<Persona, string> = {
  kevin: 'Kevin',
  serena: 'Serena',
  harry: 'Harry',
  tank: 'Tank',
};

const PERSONA_SPECS: Record<Persona, string> = {
  kevin: KEVIN_CHARACTER_SPEC,
  serena: SERENA_CHARACTER_SPEC,
  harry: HARRY_CHARACTER_SPEC,
  tank: TANK_CHARACTER_SPEC,
};

const PERSONA_GENDERS: Record<Persona, VoiceGender> = {
  kevin: 'male',
  serena: 'female',
  harry: 'male',
  tank: 'male',
};

const PERSONA_PRONOUNS: Record<Persona, { subject: string; object: string; possessive: string }> = {
  kevin:  { subject: 'he', object: 'him', possessive: 'his' },
  serena: { subject: 'she', object: 'her', possessive: 'her' },
  harry:  { subject: 'he', object: 'him', possessive: 'his' },
  tank:   { subject: 'he', object: 'him', possessive: 'his' },
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
  if (input === 'kevin' || input === 'serena' || input === 'harry' || input === 'tank') return input;
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

export const ALL_PERSONAS: readonly Persona[] = ['kevin', 'serena', 'harry', 'tank'] as const;

// Audit 101 / B4 — server-side request body persona resolver. Prefer the
// newer `persona` field; fall back to the legacy `voiceGender` field. This
// closes the F13 server-side gap where ~20 api/* routes called
// getCaddieName(voiceGender) and collapsed Tank/Harry to Kevin in their
// system prompts and responses, even when the client sent persona='tank'.
export function getCaddieNameFor(body: { persona?: unknown; voiceGender?: unknown } | null | undefined): string {
  if (!body) return getCaddieName(null);
  const personaLike = (typeof body.persona === 'string' ? body.persona : body.voiceGender) as
    Persona | VoiceGender | undefined;
  return getCaddieName(personaLike);
}

// Same shape, returns the character spec string. Used by api/* routes that
// embed the Persona's voice/style spec into the system prompt.
export function getCharacterSpecFor(body: { persona?: unknown; voiceGender?: unknown } | null | undefined): string {
  if (!body) return getCharacterSpec(null);
  const personaLike = (typeof body.persona === 'string' ? body.persona : body.voiceGender) as
    Persona | VoiceGender | undefined;
  return getCharacterSpec(personaLike);
}
