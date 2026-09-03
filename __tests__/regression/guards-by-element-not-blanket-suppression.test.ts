/**
 * 2026-09-02 (Tim, on the N16 harness failure) — "we weren't saying fabricated number. We were just
 * saying lower the guard a bit so we could get an estimate... We were supposed to put guards by
 * element."
 *
 * The 06-09 honesty pass nulled ball speed whenever the club was untagged. That is one guard doing
 * two jobs: it treated "we are less sure" as "we know nothing", and threw away a real signal (the
 * club speed IS measured) to dodge a presentation problem the presentation layer already solves —
 * confidence picks the bucket, the bucket picks the range, and the UI marks the estimate off source.
 *
 * These lock the SHAPE of the rule, not just today's numbers, so the next honesty pass tightens the
 * confidence knob instead of reaching for null again:
 *   ball speed  → DOWNGRADES (still a number, lower bucket, wider range, note says why)
 *   smash factor→ SUPPRESSES (ball ÷ club against an assumed ratio is the constant, every swing)
 */
import { synthesizeSwingMetrics } from '../../services/swingMetricsService';
import { CLUB_ORDER } from '../../store/clubStatsStore';

const CLUB_SPEED = 100;

describe('an untagged club downgrades the estimate — it does not delete it', () => {
  const untagged = synthesizeSwingMetrics({ measuredClubSpeedMph: CLUB_SPEED, club: null });
  const tagged8i = synthesizeSwingMetrics({ measuredClubSpeedMph: CLUB_SPEED, club: '8I' });
  const driver = synthesizeSwingMetrics({ measuredClubSpeedMph: CLUB_SPEED, club: 'driver' });

  it('still produces the generic-smash estimate rather than a withheld dash', () => {
    expect(untagged.ball_speed.value).toBe(136); // 100 × 1.36
  });

  it('marks it LOW confidence with a wider range than a tagged club', () => {
    expect(untagged.ball_speed.confidenceLabel).toBe('low');
    expect(tagged8i.ball_speed.confidence).toBeGreaterThan(untagged.ball_speed.confidence);
    const width = (m: [number, number] | null) => (m ? m[1] - m[0] : 0);
    expect(width(untagged.ball_speed.range)).toBeGreaterThan(width(tagged8i.ball_speed.range));
  });

  it('says WHY it is wide, so the player knows the action that sharpens it', () => {
    expect(untagged.ball_speed.estimateNote).toContain('not tagged');
  });

  it('stays swing-derived so the UI renders it with the estimate marker', () => {
    // The rails gate on isSwingDerived(source), never on confidence — a 'placeholder' source would
    // vanish from the card entirely, which is the blanket suppression this replaced.
    expect(untagged.ball_speed.source).not.toBe('placeholder');
  });

  it('the club tag still reaches the derivation — two known clubs must differ', () => {
    expect(driver.ball_speed.value).toBe(148); // 1.48
    expect(tagged8i.ball_speed.value).toBe(136); // 1.36
    expect(driver.ball_speed.value).not.toBe(untagged.ball_speed.value);
  });
});

describe('the NEXT element keeps its own guard — the downgrade must not leak', () => {
  it('smash stays suppressed on a derived ball speed, tagged or not', () => {
    // ball ÷ club here is exactly the typical constant: identical every swing, zero per-swing signal.
    expect(synthesizeSwingMetrics({ measuredClubSpeedMph: CLUB_SPEED, club: null }).smash_factor.value).toBeNull();
    expect(synthesizeSwingMetrics({ measuredClubSpeedMph: CLUB_SPEED, club: 'driver' }).smash_factor.value).toBeNull();
  });

  it('smash returns only when the ball speed was independently measured', () => {
    const acoustic = synthesizeSwingMetrics({
      measuredClubSpeedMph: CLUB_SPEED, measuredBallSpeedMph: 140, club: 'driver',
    });
    expect(acoustic.smash_factor.value).toBe(1.4);
    expect(acoustic.smash_factor.source).toBe('pose'); // estimate-grade, never truth
  });

  it('carry is untouched by the ball-speed guard — it has its own owner', () => {
    // Carry comes from the club+effort estimate or the player's profile, never from ball speed.
    expect(synthesizeSwingMetrics({ measuredClubSpeedMph: CLUB_SPEED, club: null }).carry_yards.value).toBeNull();
  });
});


/**
 * 2026-09-03 — THE CLUB VOCABULARY AND THE SMASH TABLE ARE TWO OWNERS OF ONE FACT.
 *
 * `CLUB_ORDER` says which clubs exist; `TYPICAL_SMASH_BY_CLUB` says what each one's ratio is. Nothing
 * linked them, so three clubs drifted out of the table while the normalizer went on producing them:
 *   - 3I hit the `?? unknown` fallback and was presented as "typical smash for 3i" at MED confidence
 *     — the generic 1.36 wearing a club-specific label. The tell was physical: 3I read 136 while 4I
 *     read 140, a longer club returning a SLOWER ball.
 *   - 7W and 2H did not normalize at all, so a player who HAD tagged their club was told
 *     "club not tagged — tag it to sharpen". Advice they cannot act on.
 *
 * The first test is the physical invariant that makes the next drift visible on sight. The second
 * spans the two owners directly, so a club added to the bag without a ratio fails here rather than
 * shipping as a confident generic number. [[an-invariant-has-three-homes]]
 */
describe('every club in the bag has its own ratio, and longer clubs hit it harder', () => {
  const FULL_SWING = CLUB_ORDER.filter(c => c !== 'Putter');

  it('no club in CLUB_ORDER falls through to the generic ratio', () => {
    const generic = FULL_SWING.filter((club) => {
      const note = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club }).ball_speed.estimateNote ?? '';
      return note.includes('generic smash') || note.includes('not tagged');
    });
    expect(generic).toEqual([]);
  });

  it('a tagged club is never told to tag itself', () => {
    for (const club of FULL_SWING) {
      const m = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club });
      expect(m.ball_speed.confidenceLabel).toBe('med');
      expect(m.ball_speed.estimateNote).not.toContain('not tagged');
    }
  });

  it('ball speed never RISES as the clubs get shorter — the 3I-under-4I tell', () => {
    const speeds = FULL_SWING.map((club) => ({
      club,
      v: synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club }).ball_speed.value ?? 0,
    }));
    // CLUB_ORDER runs longest → shortest, so this must be monotonically non-increasing.
    const inversions = speeds.filter((s, i) => i > 0 && s.v > speeds[i - 1].v)
      .map((s, i) => `${s.club} ${s.v} > previous`);
    expect(inversions).toEqual([]);
  });

  it('a club we recognise but have NO ratio for degrades to low, and says so honestly', () => {
    // '1I' normalizes to '1i' (the regex takes any digit) and is deliberately not in the table —
    // nobody carries one. It stands in for the next club that drifts out.
    const m = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club: '1I' });
    expect(m.ball_speed.value).toBe(136);                    // the generic ratio, honestly applied
    expect(m.ball_speed.confidenceLabel).toBe('low');        // NOT borrowed 'med' from a missed lookup
    expect(m.ball_speed.estimateNote).toContain('no 1i ratio yet');
    expect(m.ball_speed.estimateNote).not.toContain('not tagged'); // it WAS tagged
  });
});
