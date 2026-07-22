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
  MESSAGING_APP_KEY_DEFAULT,
} from '../../services/appAuth';

describe('keysMatch — the messages auth gate (H4)', () => {
  const secret = MESSAGING_APP_KEY_DEFAULT;
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

describe('client and server agree on a key by default (non-breaking)', () => {
  it('client key == server key when no env is configured', () => {
    // In this test env neither EXPO_PUBLIC_MESSAGING_KEY nor MESSAGING_APP_SECRET is set.
    expect(getMessagingKey()).toBe(MESSAGING_APP_KEY_DEFAULT);
    expect(getMessagingServerKey()).toBe(MESSAGING_APP_KEY_DEFAULT);
    expect(keysMatch(getMessagingKey(), getMessagingServerKey())).toBe(true);
  });

  it('server honors a rotated MESSAGING_APP_SECRET', () => {
    const prev = process.env.MESSAGING_APP_SECRET;
    process.env.MESSAGING_APP_SECRET = 'rotated-strong-secret';
    try {
      expect(getMessagingServerKey()).toBe('rotated-strong-secret');
      // A client still on the default no longer matches — as intended after rotation.
      expect(keysMatch(MESSAGING_APP_KEY_DEFAULT, getMessagingServerKey())).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MESSAGING_APP_SECRET;
      else process.env.MESSAGING_APP_SECRET = prev;
    }
  });
});
