/**
 * 2026-09-04 (launch) — THE LENGTH-1 BRANCH IS A REVENUE LANDMINE.
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

describe('a blank-email install can never be auto-stamped as the owner', () => {
  it('OWNER_EMAILS never has exactly one entry', () => {
    // The auto-set fires on === 1. Zero is safe (nobody is an owner); two or more is safe
    // (the branch is skipped). One is the only dangerous length.
    expect(OWNER_EMAILS.length).not.toBe(1);
  });

  it('the dangerous branch is still gated on that exact length — if this changes, re-read the guard', () => {
    // Pinning the shape means a refactor that drops the length check fails here rather than
    // silently making the guard above meaningless.
    const layout = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
    const stripped = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).toMatch(/OWNER_EMAILS\.length\s*===\s*1/);
  });

  it('the review sign-in addresses are present — Play declares them, so removing them is a doc change too', () => {
    // These two were added for Play Console -> App content -> Sign in details. They are also two
    // of the four entries keeping the length above 1.
    expect(OWNER_EMAILS).toContain('support@smartplaycaddie.com');
    expect(OWNER_EMAILS).toContain('tim@smartplaycaddie.com');
  });

  it('a fresh install email is not an owner', () => {
    expect(isOwnerEmail('')).toBe(false);
    expect(isOwnerEmail('someone@example.com')).toBe(false);
  });
});
