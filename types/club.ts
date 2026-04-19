/**
 * types/club.ts
 *
 * Canonical club list and derived types used across the app.
 * Import CLUBS or ClubName from here rather than redefining per-file.
 */

export const CLUBS = [
  'Driver',
  '3W',
  '5W',
  '3H',
  '4H',
  '5I',
  '6I',
  '7I',
  '8I',
  '9I',
  'PW',
  'GW',
  'SW',
  'LW',
] as const;

/** Union type of all valid club names. */
export type ClubName = (typeof CLUBS)[number];

/** Returns true if the given string is a valid ClubName. */
export function isClubName(value: string): value is ClubName {
  return (CLUBS as readonly string[]).includes(value);
}
