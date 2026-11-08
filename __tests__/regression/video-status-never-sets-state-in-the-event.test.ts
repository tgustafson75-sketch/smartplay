/**
 * 2026-11-08 (Sentry SMARTPLAY-CADDIE-MOBILE-8, fatal "Maximum update depth" on swing review, fifth return).
 * A native video status event must never setState directly: per-tick values go through
 * hooks/useFrameCoalescer and commit once per frame. One check per playback screen with a status callback.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SCREENS: Array<[file: string, callback: string, perTickSetters: string[]]> = [
  ['app/swinglab/swing/[swing_id].tsx', 'onPlaybackStatusUpdate', ['setPosition', 'setDuration', 'setIsPlaying', 'setIssueHoldState']],
  ['app/swinglab/smartmotion.tsx', 'onReviewPlaybackStatus', ['setPlaybackMs']],
  ['app/swinglab/smart-tempo.tsx', 'onStatus', ['setPosition', 'setDuration', 'setIsPlaying']],
  ['app/swinglab/trim.tsx', 'onPlaybackStatusUpdate', ['setPosition', 'setDuration']],
];

function callbackBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  if (start < 0) throw new Error(`${name} not found — the gate would pass on nothing`);
  const end = src.indexOf('\n  }, [', start);
  if (end < 0) throw new Error(`${name}: end of useCallback not found`);
  return src.slice(start, end);
}

describe('video status callbacks never setState inside the native event', () => {
  it.each(SCREENS)('%s › %s', (file, cb, setters) => {
    const body = callbackBody(readFileSync(join(__dirname, '../..', file), 'utf8'), cb);
    for (const s of setters) expect(body).not.toMatch(new RegExp(`\\b${s}\\(`));
    expect(body).toMatch(/\.queue\(\{/);
  });
});
