import * as fs from 'fs';
import * as path from 'path';
import { CADDIE_REQUEST_KEYS } from '../../services/caddieRequestBody';

/**
 * THE CONTRACT IS CLOSED AT BOTH ENDS.
 *
 * 2026-08-23. Tim, sprint finish: "a single source of truth, a single path, a total present caddie
 * … getting all the generics out."
 *
 * Unifying the ten hand-built payloads onto one builder fixed WHO SENDS WHAT. It could not, by
 * itself, catch the other half of the same class: a field that is faithfully sent and never read.
 * That half is worse, because it looks connected from every angle except the one that matters.
 * Two were sitting in the live payload when this test was written:
 *
 *   yardageInsight — services/yardageResolver has been the "single source of truth" for the number
 *     since 2026-05-25, written after a round where the UI, the prompt and the voice readback each
 *     derived yardage differently. Its header says outright that it exists so "Kevin's prompt can
 *     hedge correctly". The client sent it from that day on. The brain never destructured it —
 *     so the prompt called the number "measured live" even when the resolver had fallen back to
 *     the SCORECARD because GPS went soft. Three months.
 *
 *   experienceContext — starting / improving / returning / competitive. One payload sent it; the
 *     brain read nothing by that name, so a beginner and a competitive player got the same answer
 *     at the same depth.
 *
 * Neither could fail any other kind of test: both halves worked perfectly, they were simply not
 * connected. [[unconnected-halves-not-broken-code]] [[no-half-fixes-enforce-every-surface]]
 */
const kevin = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf-8');

/** The names api/kevin destructures off the request body. */
const destructured = (() => {
  const m = kevin.match(/\n {4}const \{\n([\s\S]*?)\n {4}\} = body;/);
  if (!m) throw new Error('could not find the request-body destructuring in api/kevin.ts');
  const names = new Set<string>();
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const mm = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*(=|,|$)/);
    if (mm) names.add(mm[1]);
  }
  return names;
})();

describe('the payload contract is closed at both ends', () => {
  it('every key the client sends is READ by the brain — nothing is sent and ignored', () => {
    const ignored = CADDIE_REQUEST_KEYS.filter((k) => !destructured.has(k));
    expect(ignored).toEqual([]);
  });

  it('every field the brain destructures is USED — nothing is read and dropped on the floor', () => {
    // A field pulled off the body and never referenced again is the same dead end one layer in:
    // the payload looks complete, the prompt never says it.
    const body = kevin.slice(kevin.indexOf('} = body;'));
    // Strip comments first — a field NAMED in a comment explaining that it is unused would
    // otherwise read as a use. Stripping comments before asserting is the lesson from the guards
    // that matched their own explanation of the bug they were guarding.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const unused = [...destructured].filter((n) => !new RegExp(`\\b${n}\\b`).test(code));
    expect(unused).toEqual([]);
  });

  it('the builder still emits a real, non-trivial union', () => {
    // A guard that passes because both sides went to zero is not a guard.
    expect(CADDIE_REQUEST_KEYS.length).toBeGreaterThan(80);
  });
});
