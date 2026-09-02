/**
 * 2026-09-01 — THE POSE TELEMETRY BUS HAS A READER, AND IT STAYS HONEST.
 *
 * recordPoseTelemetry fired on every pose call since 05-23 and nothing ever read it, so a pose
 * failure in the field could say how many frames came back but not which engine produced them —
 * on-device MediaPipe and a timed-out cloud proxy logged the same sentence.
 * [[orphans-are-live-bugs-not-dead-code]]
 */
import { recordPoseTelemetry, describePoseTelemetry, getLatestPoseTelemetry } from '../../services/poseTelemetry';

describe('describePoseTelemetry', () => {
  it('says nothing at all before any pose has run', () => {
    jest.isolateModules(() => {
      const fresh = require('../../services/poseTelemetry') as typeof import('../../services/poseTelemetry');
      // Reporting backend 'none' here would be a claim about this device; there is no reading yet.
      expect(fresh.describePoseTelemetry()).toBeNull();
    });
  });

  it('reports the backend and inference time of the last pose call', () => {
    recordPoseTelemetry({ backend: 'mediapipe', confidence: 91.4, inferenceMs: 47.6 });
    const d = describePoseTelemetry();
    expect(d).toMatchObject({ poseBackend: 'mediapipe', poseInferenceMs: 48, poseConfidence: 91 });
  });

  it('omits inference time for a cloud path rather than reporting zero', () => {
    recordPoseTelemetry({ backend: 'cloud_proxy', confidence: 60, inferenceMs: null });
    const d = describePoseTelemetry()!;
    expect(d.poseBackend).toBe('cloud_proxy');
    expect('poseInferenceMs' in d).toBe(false);  // a cloud call has no on-device inference time
  });

  it('carries the age of the reading — it is the LAST call, not necessarily this one', () => {
    recordPoseTelemetry({ backend: 'mediapipe', confidence: 80, inferenceMs: 30 });
    const d = describePoseTelemetry()!;
    expect(typeof d.poseReadingAgeMs).toBe('number');
    expect(d.poseReadingAgeMs as number).toBeLessThan(1000);
    expect(getLatestPoseTelemetry().at).toBeGreaterThan(0);
  });

  it('never throws, whatever the bus holds', () => {
    recordPoseTelemetry({ backend: 'none', confidence: NaN, inferenceMs: undefined as never });
    expect(() => describePoseTelemetry()).not.toThrow();
  });
});
