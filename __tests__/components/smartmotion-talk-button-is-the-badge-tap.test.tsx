/**
 * 2026-10-27 (capture-half audit C7) — SmartMotion's talk button discarded every empty capture, so
 * offline it was silent. It is now the badge's tap: services/listeningSession.toggle(), which owns the
 * failure reply (the-earbud-session-owns-its-turn / one-microphone-honest-bail drive that owner).
 * Rendered here: a press is a toggle (never a private capture), and the button shows the session's state.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockToggle = jest.fn(async () => undefined);
jest.mock('../../services/listeningSession', () => ({ toggle: () => mockToggle() }));
const mockCapture = jest.fn(async () => null);
jest.mock('../../services/voiceService', () => ({ captureUtterance: () => mockCapture(), endCaptureEarly: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { TalkToCaddieButton } from '../../components/smartmotion/TalkToCaddieButton';
import { useListeningSessionStore } from '../../store/listeningSessionStore';

describe('the SmartMotion talk button is the caddie badge\'s tap', () => {
  beforeEach(() => { mockToggle.mockClear(); mockCapture.mockClear(); useListeningSessionStore.getState().setState('idle'); });

  it('THE REPORT: a press opens the listening session (which owns the offline reply), never a private capture', () => {
    render(<TalkToCaddieButton accent="#0f0" />);
    fireEvent.press(screen.getByLabelText('Talk to your caddie'));
    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('shows the session listening, and a second press goes to the same toggle (its tap-to-finish)', () => {
    render(<TalkToCaddieButton accent="#0f0" />);
    act(() => { useListeningSessionStore.getState().setState('listening'); });
    fireEvent.press(screen.getByLabelText('Listening — tap to stop'));
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });
});
