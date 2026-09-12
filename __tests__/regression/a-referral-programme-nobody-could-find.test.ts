/**
 * 2026-09-12 (Tim) — "In Tools we need a refer-a-friend link that sends that app link to a friend.
 * This will help tie in with the future referral promotions."
 *
 * THE WHOLE SYSTEM ALREADY EXISTED. api/referral.ts, app/invite.tsx, services/billing/referral, the
 * 0009 migration and the reward banking in app/_layout all shipped 2026-09-03 — and the ONLY way in
 * was a single row buried in Settings. A referral programme nobody can find earns nothing, and the
 * promotions being planned around it would have launched against a door with no handle.
 *
 * This is the missing-half shape again: the hard part built, the reachable part forgotten.
 * [[sweep-the-missing-half-not-the-unused-export]] [[orphans-are-live-bugs-not-dead-code]]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the invite screen is reachable from Tools', () => {
  const MENU = code('components/tools/GlobalToolsMenu.tsx');

  it('the Tools menu opens it', () => {
    expect(MENU).toMatch(/nav\('\/invite'\)/);
  });

  it('the row says what the player gets, not just what it is', () => {
    // "Invite a friend" alone is a chore. The 30 days is the reason to tap it.
    expect(MENU).toMatch(/30 days when they play/);
  });

  it('it is still reachable from Settings too — Tools is an ADDITION, not a move', () => {
    expect(code('app/settings.tsx')).toMatch(/router\.push\('\/invite' as never\)/);
  });
});

describe('the screen actually sends a link', () => {
  const INVITE = code('app/invite.tsx');

  it('uses the native share sheet', () => {
    expect(INVITE).toMatch(/Share\.share\(/);
  });

  it('shares a LINK, not just a code — a code with no link is homework', () => {
    expect(INVITE).toMatch(/link/);
  });
});

describe('the payout rules stay server-side', () => {
  const API = read('api/referral.ts');

  it('the code is derived from a salt that never ships in the bundle', () => {
    expect(API).toMatch(/REFERRAL_SALT/);
    // If this ever appears client-side, anyone can mint codes for guessed install ids.
    const clientHits = code('services/billing/referral.ts');
    expect(clientHits).not.toMatch(/REFERRAL_SALT/);
    expect(clientHits).not.toMatch(/createHash/);
  });

  it('a referral pays on PLAYING, not on installing — an install is a tap an emulator can farm', () => {
    expect(API).toMatch(/qualify/);
    expect(API).toMatch(/starts a round or records a swing/);
  });
});
