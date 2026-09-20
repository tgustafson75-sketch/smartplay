/**
 * 2026-09-20 (Tim's wife) — "for the custom caddie, lets make it so you dont have to do a selfie,
 * you can upload a photo or just give description for what you want."
 *
 * The screen demanded a front-camera selfie: `captureSelfie` only ever called launchCameraAsync,
 * Generate was `disabled={!selfieB64}`, and the route answered `400 imageBase64 required`. Three
 * separate places enforced the same demand, which is why it has three assertions here — relaxing
 * the button while the route still rejects the body gives the user a live button and an error.
 * [[no-half-fixes-enforce-every-surface]]
 *
 * This guards the SHAPE, not the wording: what must stay true is that no photo is required, that
 * the library is reachable, and that a prompt-only body is sent WITHOUT an imageBase64 key.
 */
import * as fs from 'fs';
import * as path from 'path';

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const read = (rel: string) =>
  strip(fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8'));

const screen = read('app/profile/custom-caddie.tsx');
const route = read('api/image-edit.ts');

describe('a custom caddie can be made without a selfie', () => {
  it('the screen offers the photo library, not only the camera', () => {
    expect(screen).toMatch(/launchImageLibraryAsync/);
    expect(screen).toMatch(/launchCameraAsync/);
  });

  it('Generate is not gated on having a photo', () => {
    // The exact broken form, so restoring it fails here rather than passing on a reworded variant.
    expect(screen).not.toMatch(/disabled=\{!selfieB64/);
    expect(screen).not.toMatch(/\(!selfieB64 \|\| busy !== null\)/);
    // ...and the property that must hold: the gate is the brief, which both routes have.
    expect(screen).toMatch(/disabled=\{!prompt\.trim\(\) \|\| busy !== null\}/);
  });

  it('generate does not bail out early when there is no photo', () => {
    const body = screen.slice(screen.indexOf('const generateCaddie'));
    const upToFetch = body.slice(0, body.indexOf('await fetch'));
    expect(upToFetch).not.toMatch(/if \(!selfieB64\)[\s\S]{0,120}return;/);
  });

  it('the request omits imageBase64 entirely when there is no photo', () => {
    // An empty string would read as "here is an image" and hit the route's own validation.
    expect(screen).toMatch(/selfieB64 \? \{ imageBase64: selfieB64, prompt \} : \{ prompt \}/);
  });

  it('the route accepts a prompt-only body', () => {
    expect(route).not.toMatch(/if \(!imageBase64\) return res\.status\(400\)/);
    expect(route).toMatch(/if \(!prompt\) return res\.status\(400\)/);
  });

  it('the route runs text-to-image, not image-edit, when no image is sent', () => {
    // images.edit with no image is the failure mode this replaced; both providers need a text path.
    expect(route).toMatch(/geminiImageGenerate/);
    expect(route).toMatch(/openaiImageGenerate/);
    expect(route).toMatch(/openai\.images\.generate/);
    const gen = route.slice(route.indexOf('async function openaiImageGenerate'));
    expect(gen.slice(0, gen.indexOf('}'))).not.toMatch(/images\.edit/);
  });

  it('the no-photo default prompt does not talk about a person who is not there', () => {
    const m = screen.match(/DESCRIBE_ONLY_PROMPT\s*=\s*\n?\s*"([^"]+)"/);
    expect(m).not.toBeNull();
    const text = m![1];
    expect(text).not.toMatch(/this person|their face|recognizable/i);
    expect(text.length).toBeGreaterThan(40);
  });
});
