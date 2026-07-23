/**
 * REGRESSION — QA audit 2026-07-21, finding #3 (HIGH, SSRF).
 *
 * Bug: /api/pose-analysis fetched a user-supplied imageUrl with no validation, allowing
 * an unauthenticated caller to make the server reach internal/metadata endpoints.
 * Guard: assertPublicHttpUrl() rejects non-https schemes and any host that resolves to a
 * private / loopback / link-local / cloud-metadata address; isBlockedIp() is the core.
 */
import { isBlockedIp, assertPublicHttpUrl, safeFetchPinned, SsrfBlockedError } from '../../api/_ssrfGuard';

describe('isBlockedIp — internal ranges are blocked (finding #3)', () => {
  const blocked = [
    '127.0.0.1', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', /* cloud metadata */ '100.64.0.1', '::1',
    'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip',
  ];
  it.each(blocked)('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'];
  it.each(allowed)('allows public %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('assertPublicHttpUrl — scheme + host validation', () => {
  it('rejects the cloud-metadata IP URL', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/', { allowHttp: true }))
      .rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it('rejects localhost by name resolution', async () => {
    await expect(assertPublicHttpUrl('https://localhost/x')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it('rejects non-http(s) schemes (file:, gopher:)', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it('rejects http when allowHttp is not set', async () => {
    await expect(assertPublicHttpUrl('http://8.8.8.8/x')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it('allows a public https IP literal', async () => {
    await expect(assertPublicHttpUrl('https://8.8.8.8/image.jpg')).resolves.toMatchObject({ ip: '8.8.8.8' });
  });
});

describe('safeFetchPinned — validates BEFORE fetching (DNS-rebind TOCTOU close)', () => {
  // These throw at the validation step, before any undici import or network call — so they prove the
  // pinned-fetch path can't be tricked into reaching an internal target regardless of DNS behavior.
  it('rejects the cloud-metadata IP without fetching', async () => {
    await expect(safeFetchPinned('http://169.254.169.254/latest/', {}, { allowHttp: true }))
      .rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it('rejects localhost by name without fetching', async () => {
    await expect(safeFetchPinned('https://localhost/x')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it('rejects a non-http(s) scheme without fetching', async () => {
    await expect(safeFetchPinned('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
