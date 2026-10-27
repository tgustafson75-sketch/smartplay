/**
 * 2026-10-27 (SmartMotion review audit R6, R8).
 *
 * R6: tapping the review video opened the markup on frame 0 while the review underneath kept playing with
 * sound. Opening must freeze the replay and the markup must show the frame it was frozen on.
 * R8: unfolding / folding the Fold changes the window width; the review pager kept its old pixel offset and
 * stranded the player between pages.
 */
import React from 'react';
import { render, screen, renderHook } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../components/swinglab/VideoAnnotationOverlay', () => () => null);
jest.mock('expo-av', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { Video: (p: Record<string, unknown>) => R.createElement(View, p), ResizeMode: { CONTAIN: 'contain' } };
});

import { ReplayMarkupModal, freezeReplayForMarkup } from '../../components/smartmotion/ReplayMarkupModal';
import { usePagerKeepsPage } from '../../hooks/usePagerKeepsPage';

describe('R6 — the markup freezes the moment the player tapped', () => {
  it('THE REPORT: opening pauses the replay (state and player) and returns the moment on screen', async () => {
    const pauseAsync = jest.fn(async () => undefined);
    const setVideoPaused = jest.fn();
    const at = await freezeReplayForMarkup({ video: { pauseAsync }, setVideoPaused, playbackMs: 2345.6 });
    expect(setVideoPaused).toHaveBeenCalledWith(true);
    expect(pauseAsync).toHaveBeenCalledTimes(1);
    expect(at).toBe(2346);
  });

  it('a player that will not pause still freezes the review state', async () => {
    const setVideoPaused = jest.fn();
    const at = await freezeReplayForMarkup({ video: { pauseAsync: async () => { throw new Error('unloaded'); } }, setVideoPaused, playbackMs: 900 });
    expect(setVideoPaused).toHaveBeenCalledWith(true);
    expect(at).toBe(900);
  });

  it('the markup video opens on that moment, not frame 0, and does not play', () => {
    render(<ReplayMarkupModal open clipUri="file:///clip.mp4" atMs={2346} onClose={() => undefined} topInset={0} closeLabel="Close" />);
    const v = screen.getByTestId('markup-video');
    expect(v.props.positionMillis).toBe(2346);
    expect(v.props.shouldPlay).toBe(false);
  });
});

describe('R8 — the review pager keeps its page when the width changes', () => {
  it('THE REPORT: on page 2, unfolding re-seats the pager at page 2 of the new width', () => {
    const scrollTo = jest.fn();
    const pager = { current: { scrollTo } };
    const { rerender } = renderHook(({ w }: { w: number }) => usePagerKeepsPage(pager, 1, w), { initialProps: { w: 400 } });
    scrollTo.mockClear();
    rerender({ w: 880 });
    expect(scrollTo).toHaveBeenCalledWith({ x: 880, animated: false });
  });

  it('a width that does not change does not scroll (no fight with the player\'s swipe)', () => {
    const scrollTo = jest.fn();
    const pager = { current: { scrollTo } };
    const { rerender } = renderHook(({ w, p }: { w: number; p: number }) => usePagerKeepsPage(pager, p, w), { initialProps: { w: 400, p: 0 } });
    scrollTo.mockClear();
    rerender({ w: 400, p: 1 });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
