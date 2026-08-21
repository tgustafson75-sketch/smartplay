/**
 * The synthetic request the shim hands to kevin.
 *
 * 2026-08-21. This is a regression test for a bug that cost a full verification cycle and produced a
 * FALSE PASS: `{ ...req }` looked like it copied the request, but a VercelRequest is a Node
 * IncomingMessage where `headers` is a PROTOTYPE GETTER. Spread copies what an object OWNS, not what
 * it INHERITS — so kevin received `headers: undefined`, applyCors read `req.headers.origin`, and the
 * shim threw on its first line of real work while silently falling through to the native path.
 */
import { callKevin } from '../../api/_brainShim';

describe('the request handed to kevin is complete', () => {
  it('carries headers — the property object spread silently drops', async () => {
    // A stand-in for a real IncomingMessage: `headers` lives on the PROTOTYPE, exactly like Node's.
    const proto = { get headers() { return { origin: 'https://example.com', 'x-ai-provider': 'openai' }; } };
    const req = Object.create(proto) as never;
    let seen: Record<string, unknown> = {};
    const handler = async (r: never, res: never) => {
      seen = r as unknown as Record<string, unknown>;
      (res as unknown as { status: (n: number) => { json: (o: unknown) => void } }).status(200).json({ text: 'ok' });
    };
    await callKevin(handler as never, req, { message: 'hi' });
    expect(seen.headers).toBeDefined();
    expect((seen.headers as Record<string, string>).origin).toBe('https://example.com');
  });

  it('never hands kevin an undefined headers object, even from a bare request', async () => {
    // The failure mode was a TypeError inside applyCors, so the floor matters more than the content.
    let seen: Record<string, unknown> = {};
    const handler = async (r: never, res: never) => {
      seen = r as unknown as Record<string, unknown>;
      (res as unknown as { status: (n: number) => { json: (o: unknown) => void } }).status(200).json({ text: 'ok' });
    };
    await callKevin(handler as never, {} as never, { message: 'hi' });
    expect(seen.headers).toEqual({});
    expect(seen.body).toEqual({ message: 'hi' });
    expect(seen.method).toBe('POST');
  });
});
