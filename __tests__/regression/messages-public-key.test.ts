/**
 * REGRESSION — Caddie "messages leak" (Report Card blocker, SmartPlay CyberSecurity 1b, 2026-11-09).
 *
 * /api/messages fell back to a key hardcoded in services/appAuth.ts. The smartplay repo is public,
 * so that key was public, and with it `GET ?user=<email>` returned that user's thread. Production
 * accepted it on 2026-11-09 (probe got past the 401 door). The endpoint must fail CLOSED: with no
 * MESSAGING_APP_SECRET on the server, no x-app-key opens it — not the old literal, not an empty one.
 */
jest.mock('../../api/_appKey', () => ({ noteAppKey: () => {} }));
jest.mock('../../api/_inferLimit', () => ({ allowInference: async () => true }));
const dbCalls: string[] = [];
jest.mock('../../api/_supabase', () => ({
  getSmartPlaySupabase: () => ({ from: (t: string) => { dbCalls.push(t); throw new Error('db must not be reached'); } }),
}));

import handler from '../../api/messages';
import { keysMatch } from '../../services/appAuth';

// The literal that shipped in the public repo until this fix.
const OLD_PUBLIC_KEY = 'spc_msg_k1_a7f39c2e5b8140d6b3e1c9f0aa47d2e8';

function call(headers: Record<string, string>) {
  const req = { method: 'GET', headers, query: { user: 'someone@example.com' }, body: undefined } as any;
  const out: { status?: number; body?: any } = {};
  const res = {
    status(c: number) { out.status = c; return this; },
    json(b: any) { out.body = b; return this; },
    setHeader() { return this; },
  } as any;
  return handler(req, res).then(() => out);
}

describe('messages endpoint fails closed without a server secret', () => {
  const prev = process.env.MESSAGING_APP_SECRET;
  beforeEach(() => { delete process.env.MESSAGING_APP_SECRET; dbCalls.length = 0; });
  afterAll(() => { if (prev !== undefined) process.env.MESSAGING_APP_SECRET = prev; });

  it('rejects the old public key', async () => {
    const out = await call({ 'x-app-key': OLD_PUBLIC_KEY });
    expect(out.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it('rejects an empty key', async () => {
    const out = await call({ 'x-app-key': '' });
    expect(out.status).toBe(401);
    expect(dbCalls).toEqual([]);
  });

  it('keysMatch never treats an unset secret as a match', () => {
    expect(keysMatch('', '')).toBe(false);
  });

  it('the public literal is gone from the source', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['services/appAuth.ts', 'api/messages.ts', 'services/messaging.ts']) {
      expect(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')).not.toContain(OLD_PUBLIC_KEY);
    }
  });
});
