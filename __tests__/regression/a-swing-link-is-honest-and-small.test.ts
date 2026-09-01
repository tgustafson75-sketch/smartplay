/**
 * 2026-08-31 (Tim: "I want to be able to send out, even if it's by link form, exactly what you would
 * get from swing library analysis — the reports, the video playback. Maybe better ways to have that
 * linkable, instead of exporting PDFs or photos.")
 *
 * This page is the ONLY thing a lot of people will ever see of the product — a coach opens a link a
 * student sent. So two properties matter more than anything else it does:
 *
 *   HONEST — it renders only what the analysis actually produced. A metric that was never measured
 *   must be ABSENT, not filled in with something plausible. A fabricated stat here is the most
 *   expensive lie the product could tell, because it is told to someone who is not yet a customer.
 *
 *   SMALL — the frames must sample the SWING, not the recording. A 60-120s clip sampled evenly
 *   spends most of its frames on a walk-up, which is exactly the bug the analysis sampler had to fix
 *   for itself.
 */
import { frameTimesMs } from '../../services/swing/shareSampling';
import * as fs from 'fs';
import * as path from 'path';
const read = (r: string) => fs.readFileSync(path.join(__dirname, '..', '..', r), 'utf8');
const api = read('api/swing-share.ts');

describe('the frames sample the swing, not the recording', () => {
  it('every frame lands inside the located window', () => {
    const times = frameTimesMs(12, 15);
    expect(times.length).toBeGreaterThan(4);
    for (const t of times) {
      expect([t, t >= 12_000 && t <= 15_000]).toEqual([t, true]);
    }
  });

  it('spans the whole window — first at the start, last at the end', () => {
    const t = frameTimesMs(4, 8);
    expect(t[0]).toBe(4000);
    expect(t[t.length - 1]).toBe(8000);
  });

  it('never produces a zero-length or inverted window', () => {
    for (const [a, b] of [[5, 5], [9, 2], [0, 0], [-3, -1]] as const) {
      const t = frameTimesMs(a, b);
      expect(t.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
      expect(t.length).toBeGreaterThan(1);
    }
  });
});

describe('the public page cannot invent data', () => {
  it('renders a section ONLY when the analysis produced it', () => {
    // card() returns '' for an absent field — an empty section is never drawn with a placeholder.
    expect(api).toMatch(/const card = \(h: string, t\?: string\) => \(t \? .*: ''\)/);
  });

  it('drops metrics that have no value rather than showing a blank tile', () => {
    expect(api).toMatch(/\.filter\(\(m\) => m\.label && m\.value\)/);
  });

  it('drops the overlay entirely when pose does not line up with the frames', () => {
    // A skeleton drawn against the wrong frame is worse than no skeleton.
    expect(read('services/swingShare.ts')).toMatch(/input\.pose\.length === frames\.length \? input\.pose : undefined/);
  });

  it('escapes every value it renders — the text comes from a model', () => {
    expect(api).toMatch(/function esc\(/);
    for (const f of ['esc(title)', 'esc(m.label)', 'esc(m.value)']) {
      expect([f, api.includes(f)]).toEqual([f, true]);
    }
  });
});

describe('the link is unguessable and bounded', () => {
  it('the id is crypto-random, not derived from the player', () => {
    expect(api).toMatch(/randomBytes\(16\)/);
    expect(api).toMatch(/base64.*replace\(\/\\\+\/g, '-'\)/);
  });

  it('rejects a payload that would blow up the row', () => {
    expect(api).toMatch(/MAX_PAYLOAD_BYTES/);
    expect(api).toMatch(/status\(413\)/);
  });

  it('only accepts plain base64 for frames — no data: prefix, no smuggled markup', () => {
    expect(api).toMatch(/\^\[A-Za-z0-9\+\/=\\s\]\+\$/);
  });

  it('a withdrawn link SAYS it was removed rather than 404-ing', () => {
    expect(api).toMatch(/revokedHtml/);
    expect(api).toMatch(/status\(410\)/);
  });

  it('creating a share is app-key gated and rate limited', () => {
    expect(api).toMatch(/requireAppKey\(req, res\)/);
    expect(api).toMatch(/allowInference\(req, res, 'swing-share'/);
  });

  it('the page ends in a way to get the app — the share is the marketing', () => {
    expect(api).toMatch(/\/download/);
    expect(api).toMatch(/Full Swing Ahead/);
  });
});
