/**
 * 2026-10-27 (sibling of audit R7, found while fixing R1 on the same card) — the library's BODY tiles for swing 3
 * were toned from the SESSION headline whenever swing 3 had no per-swing read: another swing's fault painted
 * "Posture: bad" on a swing nobody read for posture. Driven through the owner the screen calls (a null read tones every tile neutral in deriveBodyItems).
 */
import { swingBodyFaultRead } from '../../services/swing/faultSpotlight';

const headline = { primary_fault: 'early_extension', issue_id: 'early_extension', severity: 'significant' };

describe('a later swing\'s BODY tiles are its own', () => {
  it('THE REPORT: swing 3 with no read of its own is not toned by the session headline', () => {
    expect(swingBodyFaultRead(2, headline, null)).toBeNull();
  });
  it('swing 3 with its own read uses it; a legacy swing 1 with none uses the headline', () => {
    expect(swingBodyFaultRead(2, headline, { primary_fault: 'sway', detected_issue: 'sway' })).toEqual({ primary_fault: 'sway', detected_issue: 'sway' });
    expect(swingBodyFaultRead(0, headline, null)).toEqual({ primary_fault: 'early_extension', detected_issue: 'early_extension' });
  });
});
