/**
 * 2026-09-23 (Tim — "we should not end up in error states ever. We need correct images not no images
 * where appropriate"). HoleTileImage — the course-detail grid, its viewer and the recap hole view —
 * walks the live tile → this hole's cached tile → one retry before it gives up, and the fallback only
 * shows when a hole genuinely cannot be drawn. It never draws somewhere else.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Image, Text } from 'react-native';

const mockTile = jest.fn();
const mockFetch = jest.fn(async () => null);
jest.mock('../../services/mapboxImagery', () => ({
  holeTile: (...a: unknown[]) => mockTile(...a),
  fetchHoleImagery: (...a: unknown[]) => (mockFetch as (...x: unknown[]) => unknown)(...a),
  urlForFrame: () => 'https://api.mapbox.com/x?a=1',
  tileSizeForPrefetch: () => undefined,
}));

import HoleTileImage from '../../components/course/HoleTileImage';

const INPUT = { courseId: 'local:palms', holeNumber: 3, par: 4, yardage: 380, tee: { lat: 33.68, lng: -117.18 }, green: { lat: 33.683, lng: -117.179 } };
const FRAME = { center: { lat: 1, lng: 1 }, zoom: 17, bearing: 0, width: 600, height: 500 };
const uriOf = (r: ReturnType<typeof render>) => (r.UNSAFE_getByType(Image).props.source as { uri: string }).uri;

describe('a hole image walks its fallbacks before it gives up', () => {
  beforeEach(() => mockTile.mockReset());

  it('live → the hole\'s cached tile → one retry → only then the fallback', () => {
    mockTile.mockReturnValue({ uri: 'https://api.mapbox.com/x?a=1', frame: FRAME, fallback: { uri: 'file:///cache/h3.png', frame: FRAME } });
    const r = render(<HoleTileImage input={INPUT} fallback={<Text>none</Text>} />);
    expect(uriOf(r)).toBe('https://api.mapbox.com/x?a=1');
    fireEvent(r.UNSAFE_getByType(Image), 'error');
    expect(uriOf(r)).toBe('file:///cache/h3.png');
    fireEvent(r.UNSAFE_getByType(Image), 'error');
    expect(uriOf(r)).toBe('https://api.mapbox.com/x?a=1&retry=1');
    fireEvent(r.UNSAFE_getByType(Image), 'error');
    expect(r.getByText('none')).toBeTruthy();
  });

  it('a cached file on disk draws straight away — and if it will not load (truncated), the live tile', () => {
    mockTile.mockReturnValue({ uri: 'file:///cache/h3-exact.png', frame: FRAME, fallback: null });
    const r = render(<HoleTileImage input={INPUT} />);
    expect(uriOf(r)).toBe('file:///cache/h3-exact.png');
    fireEvent(r.UNSAFE_getByType(Image), 'error');
    expect(uriOf(r)).toBe('https://api.mapbox.com/x?a=1');
  });

  it('a different hole starts at ITS first image — no frame of the previous hole\'s fallback', () => {
    mockTile.mockReturnValue({ uri: 'https://api.mapbox.com/x?a=1', frame: FRAME, fallback: { uri: 'file:///cache/h3.png', frame: FRAME } });
    const r = render(<HoleTileImage input={INPUT} />);
    fireEvent(r.UNSAFE_getByType(Image), 'error');
    expect(uriOf(r)).toBe('file:///cache/h3.png');
    mockTile.mockReturnValue({ uri: 'file:///cache/h4.png', frame: FRAME, fallback: null });
    r.rerender(<HoleTileImage input={{ ...INPUT, holeNumber: 4 }} />);
    expect(uriOf(r)).toBe('file:///cache/h4.png');
  });

  it('a live tile is saved for next time', () => {
    mockFetch.mockClear();
    mockTile.mockReturnValue({ uri: 'https://api.mapbox.com/x?a=1', frame: FRAME, fallback: null });
    render(<HoleTileImage input={INPUT} />);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a hole nothing places shows the fallback, not a picture of somewhere else', () => {
    mockTile.mockReturnValue(null);
    expect(render(<HoleTileImage input={{ ...INPUT, green: null }} fallback={<Text>none</Text>} />).getByText('none')).toBeTruthy();
  });

  it('asks for the size round prep caches, so a built course costs no requests', () => {
    mockTile.mockReturnValue(null);
    render(<HoleTileImage input={INPUT} />);
    expect(mockTile.mock.calls[0][1]).toEqual({ width: 600, height: 500 });
  });
});
