/**
 * 2026-09-04 (launch) — THE LENGTH-1 BRANCH IS A REVENUE LANDMINE.
 *
 * ─── 2026-09-13 (release audit): THE BRANCH IS GONE. ────────────────────────────────────────────
 *
 * This test was right, and the mitigation it could reach from a test file — "OWNER_EMAILS never has
 * exactly one entry" — was the wrong place to hold the line. It asked a list of email addresses to
 * stay long enough to keep a privilege check safe, and pinned the dangerous branch in place so the
 * guard above would keep meaning something. Both halves were honest and both were load-bearing on a
 * coincidence.
 *
 * The branch itself is now deleted. Owner is claimed ONLY by an explicit signal: the build's own
 * EXPO_PUBLIC_OWNER_EMAIL, or an email the player typed. The convenience it existed for moved to
 * where it belongs — eas.json sets that env var on the development and preview profiles and
 * deliberately not on any release profile, asserted at the bottom of this file.
 *
 * The length assertion stays as defence in depth (it costs nothing and is still true), but it is no
 * longer what makes the app safe. [[a-default-that-grants-privilege-is-not-a-default]]
 *
 * app/_layout.tsx boots with an owner-email auto-mirror:
 *
 *     if (!profile.email) {
 *       const envOwner = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim();
 *       if (envOwner.length > 0) profile.setEmail(envOwner);
 *       else if (OWNER_EMAILS.length === 1) profile.setEmail(OWNER_EMAILS[0]);
 *     }
 *
 * The second branch was a beta convenience: with a single tester, owner mode worked without any
 * env or build-config hassle. It is now the most expensive line in the app. A blank profile email
 * is exactly what EVERY FRESH INSTALL has. So if OWNER_EMAILS is ever trimmed back to one entry,
 * every new player is stamped with the owner's email on first boot, isOwnerEmail() returns true,
 * planTrialLifecycle grants them `lifetime`, and the entire user base gets the paid product free —
 * permanently, because the grant is persisted to disk before anyone notices.
 *
 * It is inert TODAY only because the list happens to hold four addresses, two of which were added
 * for Play/App Review sign-in on 2026-09-03. Nothing enforced that. A future cleanup that removes
 * the review addresses after launch — an obviously reasonable thing to do — re-arms it silently,
 * and the symptom (nobody is ever asked to pay) is one nobody would think to test for.
 *
 * Cowork flagged the EXPO_PUBLIC_OWNER_EMAIL half of this on 2026-09-04. That half is real but is
 * a build-config mistake someone has to actively make. This half needs no mistake at all — just a
 * list that shrinks.
 *
 * Asserted as a property of the LIST, not of the screen, because the list is what will change.
 * [[a-persisted-grant-outlives-the-switch-that-made-it]] [[orphans-are-live-bugs-not-dead-code]]
 */
import fs from 'fs';
import path from 'path';
import { OWNER_EMAILS, isOwnerEmail } from '../../store/playerProfileStore';

const root = path.join(__dirname, '..', '..');
const stripped = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a blank-email install can never be auto-stamped as the owner', () => {
  it('OWNER_EMAILS never has exactly one entry', () => {
    // The auto-set fires on === 1. Zero is safe (nobody is an owner); two or more is safe
    // (the branch is skipped). One is the only dangerous length.
    expect(OWNER_EMAILS.length).not.toBe(1);
  });

  it('the dangerous branch does not exist any more — the list length is no longer load-bearing', () => {
    const layout = stripped('app/_layout.tsx');
    expect(layout).not.toMatch(/OWNER_EMAILS\.length\s*===\s*1/);
    expect(layout).not.toMatch(/setEmail\(OWNER_EMAILS\[0\]\)/);
    // the allowlist must not be consulted AT ALL when deciding what to stamp on a blank profile
    expect(layout).not.toMatch(/OWNER_EMAILS/);
  });

  it('the only auto-stamp path is the build\'s own env var, with no else after it', () => {
    const layout = stripped('app/_layout.tsx');
    expect(layout).toMatch(/const envOwner = \(process\.env\.EXPO_PUBLIC_OWNER_EMAIL \?\? ''\)\.trim\(\);/);
    expect(layout).toMatch(/if \(envOwner\.length > 0\) profile\.setEmail\(envOwner\);/);
    expect(layout).not.toMatch(/if \(envOwner\.length > 0\) profile\.setEmail\(envOwner\);\s*else/);
  });

  it('the four addresses are all present, and each one is documented for what it IS', () => {
    /**
     * 2026-09-13 — the previous version of this test called both smartplaycaddie.com addresses "the
     * review sign-in addresses". Tim corrected that: `support@` is his MAIN account email, and the two
     * personal addresses are ONE account (the hotmail one is the Apple ID on both eas.json submit
     * profiles and the Meta glasses developer account — the same person signed in elsewhere, not a
     * separate "test device" owner). Only `tim@` is a pure App Review credential.
     *
     * The mapping lives in store/playerProfileStore above OWNER_EMAILS, because that is the file that
     * decides what an address MEANS. This asserts the comment has not drifted from the list.
     */
    expect(OWNER_EMAILS).toContain('t.gustafson75@gmail.com');
    expect(OWNER_EMAILS).toContain('t.gustafson@hotmail.com');
    expect(OWNER_EMAILS).toContain('support@smartplaycaddie.com');
    expect(OWNER_EMAILS).toContain('tim@smartplaycaddie.com');

    /**
     * RAW source here, deliberately — the usual rule in this repo is to strip comments so an
     * explanation cannot certify the defect it describes. This assertion is the inverse case: the thing
     * under test IS the documentation, so stripping it guarantees a miss. (It did: the first version
     * used `stripped` and failed against a correct mapping.) The CODE assertions elsewhere in this file
     * still use `stripped`.
     */
    const doc = fs.readFileSync(path.join(root, 'store/playerProfileStore.ts'), 'utf8');
    // each address is named in the mapping, so a future reader is not guessing
    for (const addr of OWNER_EMAILS) expect(doc).toContain(addr);
    // and the two corrections are recorded, not just fixed
    expect(doc).toMatch(/BOTH Tim, ONE account/);
    expect(doc).toMatch(/MAIN account email/);
    expect(doc).not.toMatch(/Tim's iOS test device email/);
  });

  it('the hotmail address is the Apple ID, so the two really are one account', () => {
    // The claim in the mapping is checkable — assert it rather than trusting the prose.
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')) as {
      submit: Record<string, { ios?: { appleId?: string } }>;
    };
    for (const p of Object.keys(eas.submit)) {
      expect(eas.submit[p]?.ios?.appleId).toBe('t.gustafson@hotmail.com');
    }
  });

  it('a fresh install email is not an owner, including near-misses', () => {
    for (const e of ['', '   ', null, undefined, 'someone@example.com', `${OWNER_EMAILS[0]}.evil.com`]) {
      expect(isOwnerEmail(e as string)).toBe(false);
    }
  });

  it('a listed email still IS an owner, case- and space-insensitively', () => {
    expect(isOwnerEmail(OWNER_EMAILS[0])).toBe(true);
    expect(isOwnerEmail(`  ${OWNER_EMAILS[0].toUpperCase()} `)).toBe(true);
  });
});

/**
 * 2026-09-13 — where the beta convenience went. This is the half that replaces the deleted branch:
 * owner mode on the builds Tim tests, and on no build a player can install.
 */
describe('owner mode is a build-profile decision, not a runtime default', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };

  it('development and preview builds carry an owner email', () => {
    for (const p of ['development', 'preview']) {
      expect(eas.build[p]?.env?.EXPO_PUBLIC_OWNER_EMAIL).toBeTruthy();
    }
  });

  it('NO release profile does — this is the whole point', () => {
    for (const p of ['production', 'production-apk', 'glasses']) {
      expect(eas.build[p]?.env?.EXPO_PUBLIC_OWNER_EMAIL).toBeUndefined();
    }
  });

  it('the var is DOCUMENTED where the repo documents env vars, and left commented', () => {
    /**
     * 2026-09-13 — .env.example exists so "teammates / future-Tim / Claude know which env vars the
     * pipeline + app need" (its own header), and it documented only the D-ID pipeline. The one var whose
     * ABSENCE silently removes Owner Tools from a published OTA was missing from it, which is how a
     * publish loses owner mode without anyone touching owner code.
     *
     * Left COMMENTED on purpose: copying .env.example to .env.local must not silently enable owner mode,
     * because any non-empty value does (see the next assertion).
     */
    const ex = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(ex).toMatch(/EXPO_PUBLIC_OWNER_EMAIL/);
    expect(ex).toMatch(/^#\s*EXPO_PUBLIC_OWNER_EMAIL=/m);   // commented, not live
    expect(ex).not.toMatch(/^EXPO_PUBLIC_OWNER_EMAIL=/m);
    // and it warns about the property that makes it dangerous
    expect(ex).toMatch(/ANY non-empty value/);
  });

  it('ANY non-empty value marks the BUILD an owner build — the property the docs warn about', () => {
    // Asserted so the warning in .env.example cannot become false without this failing.
    const layout = stripped('app/_layout.tsx');
    expect(layout).toMatch(/\(process\.env\.EXPO_PUBLIC_OWNER_EMAIL \?\? ''\)\.trim\(\)\.length > 0/);
  });

  it('every build profile is accounted for, so a new one cannot quietly ship owner mode', () => {
    const reviewed = new Set(['development', 'preview', 'production', 'production-apk', 'glasses']);
    expect(Object.keys(eas.build).filter((p) => !reviewed.has(p))).toEqual([]);
  });
});
