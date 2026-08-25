/**
 * 2026-08-25 — a course name is a proper noun, and a reviewer screenshots the header.
 */
import { courseDisplayName } from '../../services/courseDisplayName';

describe('course names display properly', () => {
  it('fixes the reported case', () => {
    expect(courseDisplayName('pebble beach')).toBe('Pebble Beach');
  });

  it('leaves a properly-cased name completely alone', () => {
    expect(courseDisplayName('Pebble Beach Golf Links')).toBe('Pebble Beach Golf Links');
    expect(courseDisplayName('Streamsong (Black)')).toBe('Streamsong (Black)');
  });

  it('does not mangle golf acronyms', () => {
    expect(courseDisplayName('tpc sawgrass')).toBe('TPC Sawgrass');
    expect(courseDisplayName('pga national')).toBe('PGA National');
    expect(courseDisplayName('berlin cc')).toBe('Berlin CC');
  });

  it('lowercases joining words mid-name but not when they lead', () => {
    expect(courseDisplayName('the golf club at rancho california')).toBe('The Golf Club at Rancho California');
  });

  it('capitalises across hyphens and apostrophes', () => {
    expect(courseDisplayName("o'hara links")).toBe("O'Hara Links");
    expect(courseDisplayName('jones-smith gc')).toBe('Jones-Smith GC');
  });

  it('is safe on empty input', () => {
    expect(courseDisplayName(null)).toBe('');
    expect(courseDisplayName('   ')).toBe('');
  });
});
