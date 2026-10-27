/**
 * 2026-10-27 (Phase SB4x — review of SB3, finding "practice #4").
 *
 * The cage summary's issue card said "seen in N of M swings" with M = every shot, practice swings
 * included, while the swing detail (and the headline's own occurrence count) counts the demoted swing
 * out. The two screens disagreed about the same set. The card's total is the counted swings.
 *
 * Rendered: the real screen on the real store, with the read held (it is the run's, tested elsewhere).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockCardProps: { totalShots: number }[] = [];
jest.mock('../../components/swinglab/PrimaryIssueCard', () => ({
  __esModule: true,
  default: (p: { totalShots: number }) => { mockCardProps.push(p); return null; },
}));
jest.mock('../../components/swinglab/DrillCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/swinglab/KevinCoachBox', () => ({ __esModule: true, default: () => null }));
jest.mock('../../services/swing/orchestrator/uploadRun', () => ({ runSwingAnalysis: () => new Promise(() => undefined) }));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async () => undefined), speakChunked: jest.fn(async () => undefined),
  warmVoice: jest.fn(), configureAudioForSpeech: jest.fn(async () => undefined),
}));
jest.mock('../../services/mediaKeyBridge', () => ({ activateMediaSession: async () => undefined, deactivateMediaSession: async () => undefined }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

import CageSummary from '../../app/practice-session/summary';
import { useSwingSessionStore } from '../../store/swingSessionStore';

describe('the cage summary counts the swings the detail counts', () => {
  it('THE REPORT: one of three swings demoted as practice — the issue card says "of 2", not "of 3"', () => {
    useSwingSessionStore.setState({
      activeSession: null,
      sessionHistory: [{
        id: 'c1', source: 'live_capture', analysis_status: 'ok', club: '7i', date: 1,
        primary_issue: { issue_id: 'over_the_top', name: 'Over the top', occurrence_count: 2, detected_in_shots: ['c1_0', 'c1_2'] },
        shots: [0, 1, 2].map((i) => ({
          id: `c1_${i}`, club: '7i', clipUri: 'file:///c.mp4', timestamp: 1, feel: null, shape: null, contact: null, direction: null,
          ...(i === 1 ? { practice: { reason: 'no_ball_seen' } } : {}),
        })),
      }] as never,
    });
    render(<CageSummary />);
    expect(mockCardProps.length).toBeGreaterThan(0);
    expect(mockCardProps[mockCardProps.length - 1].totalShots).toBe(2);
  });
});
