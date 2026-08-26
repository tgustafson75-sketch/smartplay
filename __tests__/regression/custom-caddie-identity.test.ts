/**
 * 2026-08-26 (Tim — "double check my caddie setup… the twenty-somethings actually love that
 * feature").
 *
 * A CUSTOM CADDIE WAS WEARING SOMEBODY ELSE'S NAME TAG. It keeps its own name and inherits a base
 * persona's character, and api/kevin pasted that persona's spec in verbatim under "You are <name>".
 * KEVIN_CHARACTER_SPEC names Kevin thirty-five times, and the roster block directly above lists
 * Kevin as a DIFFERENT caddie you could switch to. So a player who built "Ace" got a prompt that
 * said it was Ace, described it at length as Kevin, and offered Kevin as an alternative.
 *
 * No single sentence comes out obviously wrong, which is why it could sit there — it just makes the
 * caddie the player built feel not-quite-theirs.
 */
import { getCharacterSpec, getCaddieName } from '../../lib/persona';

describe('a custom caddie is described by its own name', () => {
  const rename = (spec: string, from: string, to: string) => spec.split(from).join(to);

  it('the base spec really does name its persona repeatedly — the thing being fixed', () => {
    const spec = getCharacterSpec('kevin');
    expect(spec.split('Kevin').length - 1).toBeGreaterThan(20);
  });

  it('renaming leaves no trace of the base persona', () => {
    const renamed = rename(getCharacterSpec('kevin'), getCaddieName('kevin'), 'Ace');
    expect(renamed).not.toMatch(/\bKevin\b/);
    expect(renamed.split('Ace').length - 1).toBeGreaterThan(20);
    // and it must still be the same character sheet, not a truncated one
    expect(renamed.length).toBeGreaterThan(1000);
  });

  it('works for every base persona a custom caddie may inherit', () => {
    for (const base of ['kevin', 'serena', 'harry'] as const) {
      const name = getCaddieName(base);
      const renamed = rename(getCharacterSpec(base), name, 'Ace');
      expect([base, new RegExp(`\\b${name}\\b`).test(renamed)]).toEqual([base, false]);
    }
  });

  it('the matched voice reaches the SERVER, so both speech paths use one voice', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const root = path.resolve(__dirname, '../../');
    const builder = fs.readFileSync(path.join(root, 'services/caddieRequestBody.ts'), 'utf-8');
    const kevin = fs.readFileSync(path.join(root, 'api/kevin.ts'), 'utf-8');
    const voice = fs.readFileSync(path.join(root, 'services/voiceService.ts'), 'utf-8');
    // The client already applied it on its own TTS fallback...
    expect(voice).toMatch(/pp\.customCaddieVoice/);
    // ...so the SERVER, which renders the audio on the primary path, must be told too.
    expect(builder).toMatch(/customCaddieVoice: safe\(/);
    expect(kevin).toMatch(/customCaddieVoice = null,/);
    expect(kevin).toMatch(/const ttsVoice = matched \?\?/);
    // and it must be allow-listed, not passed through to a paid API
    expect(kevin).toMatch(/OPENAI_VOICES as readonly string\[\]\)\.includes\(customCaddieVoice\)/);
  });

  it('api/kevin performs the substitution, and only when the name differs', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const kevin = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf-8');
    expect(kevin).toMatch(/const baseName = getCaddieName\(personaInput\)/);
    expect(kevin).toMatch(/caddieName !== baseName/);
    expect(kevin).toMatch(/rawSpec\.split\(baseName\)\.join\(caddieName\)/);
  });
});
