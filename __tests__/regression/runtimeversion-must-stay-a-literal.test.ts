/**
 * 2026-09-11 (Tim, pre-launch) — runtimeVersion MUST STAY THE LITERAL "1.0.0".
 *
 * Tim: "You're OTA-capable purely because it's a literal '1.0.0'. Someone — you, me, or Claude Code
 * in three months — will eventually 'improve' that to a fingerprint policy because it's the modern
 * default, and every OTA after that will publish successfully and reach zero users."
 *
 * That is exactly right, and it is worth being precise about WHY, because the failure is silent in
 * both directions:
 *
 *   - Expo delivers an update to a binary only when the update's runtimeVersion EQUALS the binary's.
 *   - app.json pins the literal string "1.0.0". Every build ever cut carries it — 17, 18, 19, 21,
 *     22, 23, 26 — so one `eas update --branch production` reaches all of them.
 *   - `{"policy": "fingerprint"}` replaces that with a hash of the native surface. The store
 *     binaries were built when the fingerprint was 63e11599… (iOS 26). The moment anyone edits
 *     app.json, eas.json, a config plugin, or bumps a native dependency, HEAD's fingerprint moves —
 *     and it has ALREADY moved: measured 2026-09-11, HEAD is de36e437…, four sources different from
 *     the shipped binary (see docs/LAUNCH-RECONCILE.md §1).
 *   - So the very first OTA published under a fingerprint policy would target de36e437…, the phones
 *     would ask for 63e11599…, and the server would correctly answer "no update for you."
 *
 * `eas update` would print "Published!" with a green tick. The dashboard would show the update. No
 * error anywhere. The fix would never reach a single device, and the only symptom would be users
 * reporting a bug you believed you had already shipped a fix for.
 *
 * THIS TEST IS THE COMMENT. app.json is strict JSON and cannot carry one, and a note in a doc is not
 * read at the moment someone edits the field. A failing test is.
 *
 * IF YOU ARE HERE BECAUSE THIS TEST FAILED: do not "fix" it by updating the expected value. Changing
 * runtimeVersion is a STORE RELEASE, not an OTA — every existing install stops receiving updates the
 * moment it changes, and only a new binary from the store can pick them up again. That may be the
 * right call one day; it is never an incidental one.
 */
/*
 * 2026-09-30 (Tim: "yes set to 1.0.2") — MOVED DELIBERATELY, AS A STORE RELEASE. 1.0.2 carries new
 * native code (Sentry 7.13, RevenueCat 10.10, R8, Health Connect out of the binary). Under "1.0.0" any
 * OTA cut from 1.0.2's JS would also reach 1.0.0/1.0.1 shells with the OLD native bridges, so a small
 * 1.0.2 fix could not ship over the air without risking those installs. "1.0.2" isolates it: OTAs now
 * reach 1.0.2 binaries only; 1.0.1 installs get fixes by updating from the store. Still a LITERAL.
 */
import fs from 'fs';
import path from 'path';

const appJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'),
) as { expo: { runtimeVersion: unknown; updates?: Record<string, unknown> } };

describe('runtimeVersion is a literal, not a policy', () => {
  it('is the string "1.0.2" — the value the 1.0.2 store binaries carry', () => {
    expect(typeof appJson.expo.runtimeVersion).toBe('string');
    expect(appJson.expo.runtimeVersion).toBe('1.0.2');
  });

  it('is NOT a policy object — a fingerprint policy silently reaches zero users', () => {
    // The shape that breaks it: { "policy": "fingerprint" } or { "policy": "appVersion" }.
    expect(appJson.expo.runtimeVersion).not.toBeInstanceOf(Object);
    expect(JSON.stringify(appJson.expo.runtimeVersion)).not.toMatch(/policy/i);
  });

  it('still points at the EAS update URL, or nothing is delivered at all', () => {
    expect(appJson.expo.updates?.url).toBe('https://u.expo.dev/60b7ee0e-0165-4971-a9c8-219960fed645');
  });

  it('keeps fallbackToCacheTimeout at 0 — build 26 shipped with it, and first launch depends on it', () => {
    // 0 means: run the embedded bundle immediately, fetch in the background, apply next launch.
    // Raising it reintroduces a startup stall on a cold network for every day-one installer.
    expect(appJson.expo.updates?.fallbackToCacheTimeout).toBe(0);
  });
});
