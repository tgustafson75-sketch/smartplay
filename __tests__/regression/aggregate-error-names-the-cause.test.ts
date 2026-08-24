/**
 * 2026-08-24 (Tim's device log) — "voice_error: capture_utterance — All promises were rejected".
 *
 * That string is the SHAPE OF A PROMISE.ANY, not a description of a failure. The voice path races a
 * primary request against a hedged one; when both reject, Promise.any throws an AggregateError whose
 * message is that literal sentence, and the real causes sit unread in err.errors[]. Every hedged
 * failure in the field therefore reported the racing STRATEGY instead of the REASON — the entry Tim
 * called "the racing crash" told us nothing we could act on, when the answer (a dead network) was
 * sitting inside the object the whole time.
 */
import { describeError } from '../../services/voiceErrorLog';

describe('a failed race names what actually went wrong', () => {
  it('unwraps an AggregateError into the underlying causes', () => {
    const agg = new AggregateError(
      [Object.assign(new Error('Aborted'), { name: 'AbortError' }), new TypeError('Network request failed')],
      'All promises were rejected',
    );
    const out = describeError(agg);
    expect(out).not.toBe('All promises were rejected');
    expect(out).toMatch(/AbortError/);
    expect(out).toMatch(/Network request failed/);
  });

  it('collapses duplicates — both halves of a hedge usually fail the same way', () => {
    const agg = new AggregateError(
      [Object.assign(new Error('x'), { name: 'AbortError' }), Object.assign(new Error('x'), { name: 'AbortError' })],
      'All promises were rejected',
    );
    expect(describeError(agg).match(/AbortError/g)).toHaveLength(1);
  });

  it('handles an AggregateError-shaped object without the real constructor', () => {
    // Hermes/older RN can surface the shape without the global class.
    const shaped = { errors: [new TypeError('Network request failed')], message: 'All promises were rejected' };
    expect(describeError(shaped)).toMatch(/Network request failed/);
  });

  it('leaves an ordinary error alone', () => {
    expect(describeError(new Error('mic busy'))).toBe('mic busy');
  });

  it('never returns the bare racing sentence when causes exist', () => {
    const agg = new AggregateError([new Error('boom')], 'All promises were rejected');
    expect(describeError(agg)).not.toBe('All promises were rejected');
  });
});
