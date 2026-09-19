/**
 * 2026-09-19, from a brand-new player's FIRST swing (Pixel 8a, Android 17, trust_level 1):
 *
 *     analysis_error: clubpath_arc_too_sparse
 *     { detected: 2, rejected: "too_few", gate: "client", framesSampled: 14, windowMs: 1544 }
 *
 * The arc gate had already classified its own refusal into four reasons, and `too_few` is
 * documented there as "the model genuinely could not see the head. A CAPTURE problem: light, angle,
 * frame rate." We wrote it to a log. The player got a skeleton with no swing path and silence, and
 * no way to tell whether the feature is broken or their capture was.
 *
 * services/captureQuality has ended that exact silent degrade once already, for frame rate. These
 * lock the two halves Tim asked for on the report: SAY IT when it happens, and ASK FOR THE FRAME
 * RATE BEFORE the first swing rather than apologising after the miss.
 */
import {
  captureQualityNote, captureQualityLine, clubheadUnreadableNote, beforeFirstCaptureTip,
} from '../../services/captureQuality';
import { MIN_TRACE_FPS, PREFERRED_CAPTURE_FPS } from '../../services/capture/captureFlags';

describe('the clubhead note', () => {
  const note = clubheadUnreadableNote();

  it('leads with what the analysis CAN still do', () => {
    // Leading with the limitation makes a working analysis sound like a failure — the tempo, the
    // positions and the contact were all read fine on this capture.
    expect(note.can).toMatch(/tempo/i);
    expect(note.can).toMatch(/contact/i);
    expect(note.ok).toBe(false);
  });

  it('names what was missing in the player\'s terms, not ours', () => {
    expect(note.missing).toMatch(/clubhead/i);
    expect(note.missing).toMatch(/swing path/i);
    // Never the internals. "too_few", "arc", "detections" and "gate" are our words.
    for (const jargon of ['too_few', 'detections', 'gate', 'arc gate', 'classif']) {
      expect(note.missing!.toLowerCase()).not.toContain(jargon);
    }
  });

  it('gives a fix the player can actually act on', () => {
    expect(note.fix).toBeTruthy();
    expect(note.fix).toMatch(/light|further back/i);
    expect(note.fix).toContain(String(PREFERRED_CAPTURE_FPS));
  });
});

describe('the before-first-swing tip', () => {
  const tip = beforeFirstCaptureTip();

  it('asks for the frame rate that unlocks the path', () => {
    expect(tip).toContain(String(PREFERRED_CAPTURE_FPS));
    expect(tip).toContain(String(MIN_TRACE_FPS));
  });

  /**
   * THE RULE THIS FILE ALREADY HAD, applied to a new caller. Nothing has been recorded when this
   * speaks, so nothing has been measured — and captureQualityNote's own header says an unmeasured
   * capture must not produce a warning, because "telling a player their capture might be poor when
   * we have not measured it is a guess dressed as a finding".
   */
  it('states a CAPABILITY, never a verdict on their phone', () => {
    expect(tip).toMatch(/if your camera can/i);
    for (const accusation of ['your camera is', 'too slow', 'your capture was', "can't read"]) {
      expect(tip.toLowerCase()).not.toContain(accusation);
    }
  });
});

describe('the frame-rate note it sits beside is unchanged', () => {
  it('still says nothing when the rate is unknown', () => {
    // null means UNKNOWN, not slow. The expo-camera path reports no rate at all — which is why the
    // 09-19 player heard nothing, and why the tip above had to be worded as a capability.
    expect(captureQualityNote(null).ok).toBe(true);
    expect(captureQualityLine(null)).toBeNull();
  });

  it('still says nothing when the capture was fine', () => {
    expect(captureQualityNote(PREFERRED_CAPTURE_FPS).ok).toBe(true);
  });

  it('still speaks when a measured rate falls short', () => {
    expect(captureQualityNote(MIN_TRACE_FPS - 1).ok).toBe(false);
  });
});
