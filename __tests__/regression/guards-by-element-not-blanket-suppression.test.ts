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
