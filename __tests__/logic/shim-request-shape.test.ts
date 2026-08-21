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

describe('the shim never pays for audio it discards', () => {
  it('asks kevin to skip TTS', async () => {
    // kevin synthesises speech on every turn for its own clients. This adapter has never carried
    // audioBase64 across, so generating it is a full OpenAI round-trip thrown away — and on a COLD
    // first turn that latency is the difference between an answer and the offline degrade.
    const { pipecatRequestToKevinBody } = require('../../api/_brainShim');
    expect(pipecatRequestToKevinBody({ text: 'hi', history: [], context: {} }).skip_tts).toBe(true);
  });

  it('kevin honours the flag rather than ignoring an unknown field', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const kevin = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf-8');
    expect(kevin).toMatch(/skip_tts = false,/);
    // Gated BEFORE the network call, not after — skipping it afterwards would save nothing.
    const tts = kevin.slice(kevin.indexOf('let audioBase64: string | null = null;'));
    const guard = tts.indexOf('skip_tts');
    const call = tts.indexOf('openai.audio.speech.create');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
  });
});

describe('the number the player just measured reaches the brain', () => {
  const { pipecatRequestToKevinBody } = require('../../api/_brainShim');

  it('translates a SmartFinder lock into the field kevin already understands', () => {
    // 2026-08-21 context audit: kevin has accepted smartFinderContext for months, and pipecat had
    // no way to send it — so "I ranged it at 152, what do I hit?" was answered from the GPS
    // green-middle on the DEFAULT brain, ignoring the number the player trusts most.
    const body = pipecatRequestToKevinBody({
      text: 'what should I hit', history: [],
      context: { smartFinderLock: { distance_yards: 152, compass_heading: 271, confidence: 'high' } },
    });
    expect(body.smartFinderContext).toMatch(/152 yards/);
    expect(body.smartFinderContext).toMatch(/271/);
    // It must say the measured number OUTRANKS the GPS middle, or the brain has two numbers and
    // no rule for choosing between them.
    expect(body.smartFinderContext).toMatch(/beats the GPS green-middle/);
  });

  it('sends nothing when there is no lock — never a phantom distance', () => {
    const body = pipecatRequestToKevinBody({ text: 'hi', history: [], context: {} });
    expect(body.smartFinderContext).toBeNull();
  });
});
