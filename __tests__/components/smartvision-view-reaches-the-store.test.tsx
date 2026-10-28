/**
 * 2026-10-27 (Brain review F5) — SMARTVISION'S VIEW REACHES THE STORE THE PAYLOAD BUILDER READS.
 *
 * SmartVision's tapped target lived only in a React context, and only useVoiceCaddie's follow-up loop
 * could hand it to the caddie; every primary route (global mic, earbud, caddie bar, typed box) sent
 * none, so "what do I hit to that?" was answered to the middle of the green. The provider now mirrors
 * its state into smartVisionSignalStore. This drives the real provider the way app/smartvision.tsx
 * does (open → target tapped → close) and reads the store; the builder → prompt half is
 * __tests__/regression/every-route-carries-the-course-card-penalties-and-smartvision.test.ts.
 */
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react-native';
import { SmartVisionProvider, useSmartVision } from '../../contexts/SmartVisionContext';
import { useSmartVisionSignalStore } from '../../store/smartVisionSignalStore';

function SmartVisionScreen({ measure }: { measure: number }) {
  const { setSmartVisionState } = useSmartVision();
  useEffect(() => {
    setSmartVisionState({ isOpen: true, holeNumber: 5, par: 4 });
    return () => setSmartVisionState({ isOpen: false, analysisText: null });
  }, [setSmartVisionState]);
  useEffect(() => {
    setSmartVisionState({ centerYards: 171, measureYards: measure });
  }, [measure, setSmartVisionState]);
  return null;
}

// The provider sits at the app root and outlives the screen; only the screen comes and goes.
const tree = (screen: { measure: number } | null) => (
  <SmartVisionProvider>{screen ? <SmartVisionScreen measure={screen.measure} /> : null}</SmartVisionProvider>
);
const liveView = () => (useSmartVisionSignalStore.getState() as unknown as { liveView?: Record<string, unknown> | null }).liveView;

describe('SmartVision mirrors what it shows into the store the caddie payload reads', () => {
  it('open with a tapped target → the store has it; a new tap updates it; closing clears it', () => {
    const view = render(tree({ measure: 143 }));
    expect(liveView()).toEqual(expect.objectContaining({ isOpen: true, holeNumber: 5, par: 4, centerYards: 171, measureYards: 143 }));

    view.rerender(tree({ measure: 128 }));
    expect(liveView()).toEqual(expect.objectContaining({ measureYards: 128 }));

    view.rerender(tree(null));
    expect(liveView()).toBeNull();
    act(() => view.unmount());
  });

  it('the provider going away leaves nothing behind', () => {
    const view = render(tree({ measure: 150 }));
    expect(liveView()).toEqual(expect.objectContaining({ measureYards: 150 }));
    act(() => view.unmount());
    expect(liveView()).toBeNull();
  });
});
