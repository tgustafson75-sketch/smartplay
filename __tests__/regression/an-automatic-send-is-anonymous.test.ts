/**
 * 2026-09-12 (Tim, pre-launch foundations walk) — "the settings being correct by default at first
 * pass for a user."
 *
 * `shareDiagnostics` defaults ON, and the automatic sends it gates identified the player by their
 * PLAINTEXT EMAIL — `reporter = usePlayerProfileStore.getState().email`. So on a submitted app about
 * to reach strangers, every public user's email address would have left the device automatically,
 * with no deliberate act.
 *
 * The published privacy policy covers "crash and diagnostic data — stack traces and breadcrumb
 * logs", device data, and Sentry. It has NO row describing an email address, and that is precisely
 * what Play's Data safety form and Apple's privacy label ask about.
 *
 * THE DISTINCTION THIS PINS, because it is the whole design:
 *   AUTOMATIC send  → anonymous install id. No deliberate act, so no PII.
 *   MANUAL export   → keeps the email. The player is composing from their own mail client;
 *                     identifying themselves is the POINT of the act, and the act IS the consent.
 *
 * services/installId exists for exactly this: random, generated locally, tied to no hardware, no ad
 * id and no account, regenerated on reinstall. It answers the only question triage needs — "is this
 * the same device as the last three reports?"
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const EXPORT = code('services/issueLogExport.ts');
const ROUND = code('store/roundStore.ts');

describe('automatic sends carry no email', () => {
  it('the auto issue send identifies by install id', () => {
    const at = EXPORT.indexOf('autoSendIssues');
    expect(at).toBeGreaterThan(-1);
    /**
     * The id is resolved ONCE at the send point (a LOCK guard enforces exactly one call in this
     * file), and `reporter` derives from it — so assert the derivation, not a second resolution.
     */
    const body = EXPORT.slice(EXPORT.indexOf('async function autoSendIssuesInner'));
    expect(body).toMatch(/const installId = await getInstallId\(\);/);
    expect(body).toMatch(/const reporter = installId \?\? 'unknown-install';/);
    expect(body.slice(0, 1400)).not.toMatch(/getState\(\)\.email/);
  });

  it('the round trace does too', () => {
    expect(ROUND).toMatch(/getInstallId\(\)/);
    const at = ROUND.indexOf('sendRoundTrace');
    expect(ROUND.slice(Math.max(0, at - 600), at)).not.toMatch(/prof\.email/);
  });

  it('and both stay gated on the consent toggle regardless', () => {
    expect(EXPORT).toMatch(/shareDiagnostics === false/);
    expect(code('services/roundTrace.ts')).toMatch(/shareDiagnostics === false/);
  });
});

describe('the MANUAL export still identifies the sender', () => {
  it('keeps the email — there the act is the consent', () => {
    const body = EXPORT.slice(EXPORT.indexOf('export function buildIssueLogBody'));
    expect(body.slice(0, 600)).toMatch(/getState\(\)\.email/);
  });

  it('which means the two paths are genuinely different, not one changed by accident', () => {
    // If this ever collapses to one reporter, the automatic path silently regains the email.
    expect((EXPORT.match(/const reporter = /g) ?? []).length).toBe(2);
  });
});

describe('the install id is safe to send', () => {
  const ID = fs.readFileSync(path.join(ROOT, 'services/installId.ts'), 'utf8');

  it('is random and local, not a device identifier', () => {
    expect(ID).toMatch(/Math\.random\(\)/);
    expect(ID).not.toMatch(/getUniqueId|androidId|identifierForVendor|advertisingId/);
  });

  it('says so in its own header, so nobody repurposes it as one', () => {
    expect(ID).toMatch(/deliberately NOT a device identifier/);
  });
});
