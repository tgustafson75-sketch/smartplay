/**
 * 2026-09-12 (Tim) — "We should have logic already that has the active indicator, because in the
 * rounds and yardage with GPS we have static if it is not working or active. All of that should be
 * in the same general category, right — that it all same catches, because the connectivity is the
 * same."
 *
 * He caught this ONE SHOT before it shipped. The rule already existed, was correct, and had been
 * argued over twice — but it lived INLINE in a JSX prop in app/(tabs)/caddie.tsx:
 *
 *     yardageSource={displayYardage == null ? null
 *       : liveYardage != null ? 'live'
 *       : geometryBuilding[activeCourseId] ? 'building'
 *       : 'static'}
 *
 * A rule inside one component's props cannot be reused. So L1HolePreview — which needs the identical
 * judgement about the identical GPS — was about to receive its own copy, under a different name,
 * with its own staleness threshold. That is the two-owners defect, and the copy drifts the first
 * time either side is tuned. [[two-owners-is-the-root-cause]]
 *
 * The rule now lives in services/yardageSource and BOTH surfaces call it.
 */
import fs from 'fs';
import path from 'path';
import { resolveYardageSource, yardageSourceLabel, isLiveYardage } from '../../services/yardageSource';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the rule itself', () => {
  it('no number on screen means there is nothing to label', () => {
    expect(resolveYardageSource({ displayYardage: null, liveYardage: 150, isBuilding: false })).toBeNull();
    expect(yardageSourceLabel(null)).toBeNull();
  });

  it('GPS driving the number is LIVE', () => {
    expect(resolveYardageSource({ displayYardage: 150, liveYardage: 150, isBuilding: false })).toBe('live');
  });

  it('a course mid-build says MAPPING…, not a bare STATIC', () => {
    /**
     * 2026-08-12, and it is the reason there are three states: STATIC reads as "this is as good as
     * it gets", which is a lie while a build is still running.
     */
    expect(resolveYardageSource({ displayYardage: 150, liveYardage: null, isBuilding: true })).toBe('building');
    expect(yardageSourceLabel('building')).toBe('MAPPING…');
  });

  it('otherwise it is the scorecard, and says so', () => {
    expect(resolveYardageSource({ displayYardage: 150, liveYardage: null, isBuilding: false })).toBe('static');
  });

  it('LIVE means GPS and nothing else — the colour depends on it not lying', () => {
    expect(isLiveYardage('live')).toBe(true);
    for (const s of ['building', 'static', null] as const) expect(isLiveYardage(s)).toBe(false);
  });

  it('a live yardage wins even mid-build — GPS resolving beats a background job', () => {
    expect(resolveYardageSource({ displayYardage: 150, liveYardage: 150, isBuilding: true })).toBe('live');
  });
});

describe('both surfaces use that one function', () => {
  // 2026-09-29 — ONE READOUT (Tim, Hemet 17: bar STATIC, map LIVE 446y at the same instant). The rule
  // was one function but its INPUT had two owners: the preview fed it its own raw haversine. Now the
  // Caddie tab computes `yardageReadout` once with this function and hands it to the strip AND every
  // preview; the preview decides nothing. Behaviour: __tests__/regression/a-still-player-keeps-a-live-number.
  it('the in-round data strip does', () => {
    const tab = code('app/(tabs)/caddie.tsx');
    expect(tab).toMatch(/const yardageReadout = useMemo\(\(\) => \(\{[\s\S]{0,160}?source: resolveYardageSource\(\{/);
    expect(tab).toMatch(/yardageSource=\{yardageReadout\.source\}/);
    // and the inline ternary is GONE, not merely duplicated beside it
    expect(tab).not.toMatch(/liveYardage != null \? 'live'/);
  });

  it('the L1 hole preview shows THAT readout — it no longer runs the function on its own input', () => {
    const prev = code('components/caddie/L1HolePreview.tsx');
    expect(prev).not.toMatch(/resolveYardageSource\(/);
    expect(prev).toMatch(/const src = readout\?\.source \?\? null;/);
    expect(prev).toMatch(/yardageSourceLabel\(src\)/);
    expect(prev).toMatch(/isLiveYardage\(src\)/);
  });

  it('and NEITHER defines its own live/static rule', () => {
    for (const f of ['app/(tabs)/caddie.tsx', 'components/caddie/L1HolePreview.tsx']) {
      const src = code(f);
      expect(src).not.toMatch(/'building' : 'static'/);
    }
  });

  it('there is no second module claiming the same judgement', () => {
    // A `holePreviewStatus` service was written for this and deleted before it shipped.
    expect(fs.existsSync(path.join(ROOT, 'services/holePreviewStatus.ts'))).toBe(false);
  });
});

describe('the preview says something during EVERY round, not only the happy path', () => {
  it('labels the map whenever the round bar has a number — the same label, never its own', () => {
    // 2026-09-29 — was "displayYardage: 1" (always label) + its own yardsToGreen. The strip's
    // displayYardage falls back to the card distance in a round, so the map is labelled whenever the
    // bar is — and now always with the bar's word.
    const tab = code('app/(tabs)/caddie.tsx');
    expect(tab).toMatch(/yardage: isRoundActive \? \(displayYardage \?\? null\) : null,/);
    const prev = code('components/caddie/L1HolePreview.tsx');
    expect(prev).not.toMatch(/liveYardage: yardsToGreen,/);
  });

  it('and says nothing at all outside a round — it is a hole picture and does not pretend', () => {
    const prev = code('components/caddie/L1HolePreview.tsx');
    expect(prev).toMatch(/if \(!isRoundActive\) return null;/);
  });
});
