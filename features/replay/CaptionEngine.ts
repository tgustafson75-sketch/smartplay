/**
 * CaptionEngine
 *
 * Generates a short, branded share caption from round highlight data.
 * Designed to drop straight into a platform share sheet or clipboard.
 */

import type { ScoredShot } from './HighlightEngine';

const OPENERS = [
  'Dialed in today',
  'Striking it pure',
  'Course management on point',
  'Playing some good golf',
  'Finding fairways and greens',
  'Locked in out there',
];

const EMOJIS = ['⛳', '🔥', '🎯', '🏌️', '✅'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface RoundSummaryData {
  courseName?: string;
  shotsLogged: number;
  topShots: ScoredShot[];
}

export function generateShareCaption(data: RoundSummaryData): string {
  const opener = `${pick(OPENERS)} ${pick(EMOJIS)}`;
  const lines: string[] = [opener, ''];

  if (data.courseName) {
    lines.push(`📍 ${data.courseName}`);
  }

  if (data.shotsLogged > 0) {
    lines.push(`${data.shotsLogged} shots tracked`);
  }

  // Highlight the single best shot
  const best = data.topShots[0];
  if (best) {
    const dist = best.gpsDistance ?? best.distance ?? 0;
    const club = best.club ?? '';
    if (dist > 0 && club) {
      lines.push(`Best shot: ${club} · ${dist} yds`);
    }
  }

  lines.push('');
  lines.push('SmartCaddie Highlights');
  lines.push('#golf #smartcaddie #highlights');

  return lines.join('\n');
}
