/**
 * 2026-08-30 — VOICE MAY NOT OFFER A CADDIE THE APP HAS REMOVED.
 *
 * settingsStore's v6 migration exists for one reason, in its own words: move any persisted Harry
 * assignment to Kevin "so existing users on 'harry' don't get stuck on a hidden persona". Harry is
 * out of ACTIVE_PERSONAS and out of the settings picker.
 *
 * Voice put them right back. Three separate places each kept their own list:
 *   - services/intents/changeSettingHandler.ts  ['kevin','serena','harry','custom']
 *   - services/localIntentPrecheck.ts           /(kevin|serena|harry)/
 *   - api/voice-intent.ts                       "caddie_persona (kevin/serena/harry)"
 * So "switch to Harry" was accepted, loaded his portrait and his voice, and left the picker showing
 * nothing selected — the exact state the migration was written to prevent.
 *
 * And isActivePersona(), the function built to be the single owner of this question, was ORPHANED.
 * Nothing imported it. [[two-owners-is-the-root-cause]] [[orphan-export-sweep-finds-half-builds]]
 *
 * What is pinned here is DERIVATION, not a blocklist. Asserting "harry is rejected" would pass again
 * the moment someone retires Serena the same way. Every ACTIVE persona must be reachable and every
 * inactive one refused, so the check follows the list instead of restating it.
 */

import { ACTIVE_PERSONAS, ALL_PERSONAS, isActivePersona, type Persona } from '../../lib/persona';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';

/** Personas the type still supports but the app no longer offers. Derived, never typed out. */
const RETIRED: Persona[] = ALL_PERSONAS.filter(p => !ACTIVE_PERSONAS.includes(p));

describe('the retired personas are real, or this whole file proves nothing', () => {
  it('has at least one retired persona to test against', () => {
    expect(RETIRED.length).toBeGreaterThan(0);
    // Harry today. If he is ever restored, this file keeps working against whoever replaces him.
    expect(ALL_PERSONAS.length).toBeGreaterThan(ACTIVE_PERSONAS.length);
  });
});

describe('the local precheck follows ACTIVE_PERSONAS', () => {
  it.each(ACTIVE_PERSONAS.filter(p => p !== 'custom'))('routes "switch to %s"', (persona) => {
    const got = precheckLocalIntent(`switch to ${persona}`);
    expect(got?.intent_type).toBe('change_setting');
    expect(got?.parameters).toMatchObject({ setting_name: 'caddie_persona', new_value: persona });
  });

  it.each(RETIRED)('does NOT treat "switch to %s" as a persona switch', (persona) => {
    // THE REGRESSION. This matched, and handed the player a persona the picker hides.
    const got = precheckLocalIntent(`switch to ${persona}`);
    expect(got?.parameters?.setting_name).not.toBe('caddie_persona');
  });

  it.each(RETIRED)('does NOT match "put %s in charge" either', (persona) => {
    const got = precheckLocalIntent(`put ${persona} in charge`);
    expect(got?.parameters?.setting_name).not.toBe('caddie_persona');
  });
});

describe('isActivePersona is the owner, and is actually wired', () => {
  it.each(ACTIVE_PERSONAS)('accepts %s', (p) => expect(isActivePersona(p)).toBe(true));
  it.each(RETIRED)('rejects %s', (p) => expect(isActivePersona(p)).toBe(false));

  it('is imported by the handler that validates a spoken persona change', () => {
    // A COMPILE-TIME-ish reference is not available across a file boundary, so this reads the
    // import. Prose-reading is normally forbidden here, and the exception is narrow and deliberate:
    // the defect was that NOTHING imported this function, which is a fact about the import graph
    // and cannot be observed any other way. It is pinned to the exact call, not to a comment.
    // [[three-ways-a-guard-is-worthless]]
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/intents/changeSettingHandler.ts'), 'utf8');
    expect(src).toContain("from '../../lib/persona'");
    expect(src).toMatch(/if \(!isActivePersona\(/);
    // And the old hardcoded list is gone rather than merely bypassed.
    expect(src).not.toMatch(/const valid: Persona\[\] = \[/);
  });
});

describe('the BRAIN tool path obeys the same list', () => {
  it('validates switch_caddie against ACTIVE_PERSONAS, not its own array', () => {
    // FOUND BY THE FULL AUDIT, after four other surfaces were already unified. This is the path the
    // brain drives: a `switch_caddie` tool action checked its own ['kevin','serena','harry','custom']
    // and called setCaddiePersonality directly — so ASKING the caddie to switch to a removed persona
    // still worked, while the same words on the intent path were correctly refused. Same words, two
    // outcomes, depending on which route the utterance happened to take.
    // [[no-half-fixes-enforce-every-surface]]
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/voice/conversationalToolDispatch.ts'), 'utf8');
    expect(src).toMatch(/const PERSONAS = ACTIVE_PERSONAS;/);
    expect(src).not.toMatch(/const PERSONAS = \['kevin'/);
  });

  it('has no shipped persona validator left that names a retired caddie', () => {
    // The sweep itself, pinned. Migrations are exempt and must be: repairing old persisted data
    // REQUIRES naming the old value, which is the same carve-out the Tank guard makes.
    const { execSync } = require('child_process');
    const root = require('path').join(__dirname, '../..');
    const hits = execSync(
      `grep -rn "\\['kevin'" --include=*.ts --include=*.tsx app services store lib components || true`,
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // lib/persona.ts owns both lists by definition.
      .filter((l: string) => !l.startsWith('lib/persona.ts'))
      // Comments describing the defect are not validators.
      .filter((l: string) => !/^\S+:\d+:\s*(\*|\/\/)/.test(l))
      // Persisted-data migrations must name historical values to migrate away from them.
      .filter((l: string) => !/settingsStore\.ts|playerProfileStore\.ts|voiceService\.ts/.test(l));
    expect(hits).toEqual([]);
  });
});

describe('the server prompt does not name a removed caddie', () => {
  it('never tells the model to emit a retired persona', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../api/voice-intent.ts'), 'utf8');
    for (const p of RETIRED) {
      expect(src).not.toMatch(new RegExp(`new_value:\\s*"${p}"`, 'i'));
    }
  });

  it('does not map a Kevin request onto Serena', () => {
    // A separate, real defect found in the same block: one example line listed "switch to Serena",
    // "change caddie to Harry" and "put Kevin in" as alternates that ALL resolved to serena.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../api/voice-intent.ts'), 'utf8');
    const kevinLines = src.split('\n').filter((l: string) => /put Kevin in|give me Kevin/.test(l));
    expect(kevinLines.length).toBeGreaterThan(0);
    for (const line of kevinLines) expect(line).toMatch(/new_value: "kevin"/);
  });
});
