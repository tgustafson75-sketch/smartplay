/**
 * features/smartCaddie/types/club.ts
 *
 * Re-exports from the canonical types/club.ts so smartCaddie internals
 * can import from a relative path without reaching outside their feature.
 */

export { CLUBS, type ClubName, isClubName } from '../../../types/club';
