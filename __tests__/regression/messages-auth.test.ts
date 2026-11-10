/**
 * REGRESSION — QA audit, finding H4 (broken access control / IDOR on /api/messages).
 *
 * /api/messages was unauthenticated: anyone who knew an email could read/forge that user's
 * messages. The fix gates the endpoint on a shared app-key the client sends as x-app-key and
 * the server verifies with keysMatch(). These cover the auth primitive + the client/server
 * key agreement that makes the gate work without breaking the shipped client.
 */
import {
  keysMatch,
  getMessagingKey,
  getMessagingServerKey,
} from '../../services/appAuth';

describe('keysMatch — the messages auth gate (H4)', () => {
  const secret = 'test-only-messaging-secret-0000000000';
  it('accepts the exact key', () => {
    expect(keysMatch(secret, secret)).toBe(true);
  });
  it('rejects a wrong key of equal length', () => {
    const wrong = 'x'.repeat(secret.length);
    expect(keysMatch(wrong, secret)).toBe(false);
  });
  it('rejects a key of different length (no early-return length leak crash)', () => {
    expect(keysMatch(secret.slice(0, -1), secret)).toBe(false);
    expect(keysMatch(secret + 'a', secret)).toBe(false);
  });
  it('rejects a missing/undefined header (the unauthenticated caller)', () => {
    expect(keysMatch(undefined, secret)).toBe(false);
    expect(keysMatch(null, secret)).toBe(false);
    expect(keysMatch('', secret)).toBe(false);
  });
});

describe('no key works until the server secret is set (2026-11-09 messages leak)', () => {
  it('with no env configured, both keys are empty and nothing matches', () => {
    expect(getMessagingKey()).toBe('');
    expect(getMessagingServerKey()).toBe('');
    expect(keysMatch(getMessagingKey(), getMessagingServerKey())).toBe(false);
  });

  it('server honors MESSAGING_APP_SECRET', () => {
    const prev = process.env.MESSAGING_APP_SECRET;
    process.env.MESSAGING_APP_SECRET = 'rotated-strong-secret';
    try {
      expect(getMessagingServerKey()).toBe('rotated-strong-secret');
      expect(keysMatch('rotated-strong-secret', getMessagingServerKey())).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MESSAGING_APP_SECRET;
      else process.env.MESSAGING_APP_SECRET = prev;
    }
  });
});
