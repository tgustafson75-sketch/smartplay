/**
 * 2026-08-31 (Tim: "add this to render in my owner tools as a digital business card I can ask
 * Caddie for") — the card is only useful if asking for it WORKS, on the first try, in front of
 * someone. So the phrasings are pinned, and so is the one that must never match.
 *
 * The trap here is "card". A golfer says "card" mid-round and means their SCORECARD, every single
 * time. Opening a business card instead — while standing over a putt, in front of a playing partner
 * — is exactly the confidently-wrong behaviour this app treats as a defect.
 */
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import * as fs from 'fs';
import * as path from 'path';

const toolOf = (s: string) => {
  const r = precheckLocalIntent(s) as { intent_type?: string; tool_name?: string; parameters?: { tool_name?: string } } | null;
  if (!r) return null;
  return r.tool_name ?? r.parameters?.tool_name ?? null;
};

describe('asking the caddie for the card', () => {
  it('opens on the natural phrasings', () => {
    for (const s of [
      'pull up my card',
      'show me my business card',
      'open my digital card',
      'my contact card',
      'can you show my business card',
      'business card',
    ]) {
      expect([s, toolOf(s)]).toEqual([s, 'my_card']);
    }
  });

  it('NEVER hijacks the scorecard — the word a golfer actually means', () => {
    for (const s of [
      'pull up my scorecard',
      'show me my score card',
      'open the scorecard',
      "what's my scorecard",
      'my score card please',
    ]) {
      expect([s, toolOf(s)]).not.toEqual([s, 'my_card']);
    }
  });

  it('does not fire when the player is reporting a PROBLEM with it', () => {
    // NOT_ABOUT_TOOL: "log an issue with my business card" is a bug report, not a request to open it.
    for (const s of ['log an issue with my business card', 'report a bug with the digital card']) {
      expect([s, toolOf(s)]).not.toEqual([s, 'my_card']);
    }
  });
});

describe('the route is wired and owner-gated', () => {
  const read = (r: string) => fs.readFileSync(path.join(__dirname, '..', '..', r), 'utf8');

  it('every alias the brain can emit resolves to the screen', () => {
    const h = read('services/intents/openToolHandler.ts');
    for (const alias of ['my_card', 'business_card', 'digital_card', 'contact_card']) {
      expect([alias, new RegExp(`${alias}: \\{ type: 'navigate', path: '/owner-card' \\}`).test(h)]).toEqual([alias, true]);
    }
    // ...and the ambiguous bare alias is deliberately absent.
    expect(/^\s*card: \{ type: 'navigate'/m.test(h)).toBe(false);
  });

  it('the SCREEN gates on owner, not just the menu that links to it', () => {
    // A route is reachable by voice and by deep link, so hiding the row is not a gate.
    const src = read('app/owner-card.tsx');
    expect(src).toMatch(/isOwnerEmail/);
    expect(src).toMatch(/if \(!isOwner\)/);
  });

  it('ships the QR as an asset, so it travels over the air', () => {
    const qr = path.join(__dirname, '..', '..', 'assets/images/owner-card-qr.png');
    expect(fs.existsSync(qr)).toBe(true);
    expect(fs.statSync(qr).size).toBeGreaterThan(1000);
    expect(read('app/owner-card.tsx')).toMatch(/require\('\.\.\/assets\/images\/owner-card-qr\.png'\)/);
  });

  it('the shared text carries every way to reach him, not just a link', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shareTextFor, CARD } = require('../../services/ownerCard') as typeof import('../../services/ownerCard');
    const t = shareTextFor(CARD);
    for (const must of ['Tim Gustafson', 'SmartPlay AI LLC', 'smartplaycaddie.com/download', '951-746-4090', 'tim@smartplaycaddie.com', '@smartplay_caddie', 'Full Swing Ahead']) {
      expect([must, t.includes(must)]).toEqual([must, true]);
    }
  });
});
