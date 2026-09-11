/**
 * 2026-09-10 — TWO VALUES THAT WERE STORED AND NEVER READ.
 *
 * 1. `flagStore.minSupportedBuild` has been fetched from the remote flag document and written into
 *    the store since the store existed, and NOTHING read it. So the one remote lever for "that
 *    build is broken, get people off it" did not exist — while looking like it did, which is worse
 *    than not having one. Production is staged in 176 countries.
 *
 * 2. `relationshipStore.firstBreak90` was set by string-matching '90' in a breakthrough's
 *    DESCRIPTION, and the only caller passes "New personal best: " + total. So it stamped the
 *    milestone on a round of exactly 90 — which is not breaking 90 — and never on 85, 88 or 89,
 *    which are. A 190 would have set it too.
 */
import { useFlagStore, isBuildUnsupported } from '../../store/flagStore';
import { useRelationshipStore } from '../../store/relationshipStore';

describe('the old-build lever actually pulls', () => {
  afterEach(() => useFlagStore.setState({ minSupportedBuild: 0 }));

  it('nudges when this build is below the remote floor', () => {
    useFlagStore.setState({ minSupportedBuild: 30 });
    expect(isBuildUnsupported('26')).toBe(true);
    expect(isBuildUnsupported(26)).toBe(true);
  });

  it('stays quiet at or above the floor', () => {
    useFlagStore.setState({ minSupportedBuild: 26 });
    expect(isBuildUnsupported('26')).toBe(false);
    expect(isBuildUnsupported('27')).toBe(false);
  });

  it('stays quiet when no floor is set — the default must never nag', () => {
    useFlagStore.setState({ minSupportedBuild: 0 });
    expect(isBuildUnsupported('26')).toBe(false);
  });

  it('treats every uncertain case as supported', () => {
    // A misconfigured flag doc, a missing constant, a dev build — none may nag a player.
    useFlagStore.setState({ minSupportedBuild: 30 });
    expect(isBuildUnsupported(null)).toBe(false);
    expect(isBuildUnsupported(undefined)).toBe(false);
    expect(isBuildUnsupported('')).toBe(false);
    expect(isBuildUnsupported('not-a-number')).toBe(false);
    expect(isBuildUnsupported(0)).toBe(false);
    useFlagStore.setState({ minSupportedBuild: -1 as unknown as number });
    expect(isBuildUnsupported('26')).toBe(false);
    useFlagStore.setState({ minSupportedBuild: NaN as unknown as number });
    expect(isBuildUnsupported('26')).toBe(false);
  });
});

describe('breaking 90 means a score under 90', () => {
  beforeEach(() => useRelationshipStore.setState({ breakthroughs: [], firstBreak90: null }));

  it('stamps the milestone on a round that actually broke 90', () => {
    useRelationshipStore.getState().recordBreakthrough('New personal best: 85', 4, { totalScore: 85 });
    expect(useRelationshipStore.getState().firstBreak90).not.toBeNull();
  });

  it('does NOT stamp it on a round of exactly 90', () => {
    // The old string match fired here — 90 contains "90" — and this is the one score in the
    // neighbourhood that is not breaking 90.
    useRelationshipStore.getState().recordBreakthrough('New personal best: 90', 4, { totalScore: 90 });
    expect(useRelationshipStore.getState().firstBreak90).toBeNull();
  });

  it('does NOT stamp it on a 190 that merely contains the characters', () => {
    useRelationshipStore.getState().recordBreakthrough('New personal best: 190', 4, { totalScore: 190 });
    expect(useRelationshipStore.getState().firstBreak90).toBeNull();
  });

  it('records the breakthrough either way — the flag is separate from the list', () => {
    useRelationshipStore.getState().recordBreakthrough('New personal best: 91', 4, { totalScore: 91 });
    expect(useRelationshipStore.getState().breakthroughs.length).toBe(1);
  });

  it('keeps the FIRST date once set', () => {
    const rel = useRelationshipStore.getState();
    rel.recordBreakthrough('New personal best: 88', 4, { totalScore: 88 });
    const first = useRelationshipStore.getState().firstBreak90;
    rel.recordBreakthrough('New personal best: 84', 9, { totalScore: 84 });
    expect(useRelationshipStore.getState().firstBreak90).toBe(first);
  });

  it('ignores a call with no score rather than guessing from the text', () => {
    useRelationshipStore.getState().recordBreakthrough('Something about 90', 4);
    expect(useRelationshipStore.getState().firstBreak90).toBeNull();
  });
});
