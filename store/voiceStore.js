/**
 * voiceStore.js — Global voice state (Zustand)
 *
 * Single source of truth for voice state across ALL screens.
 * Every mic button, every overlay, every status label reads from here.
 *
 * States: IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
 */

import { create } from 'zustand';

export const useVoiceStore = create((set) => ({
  /** Current voice pipeline state */
  voiceState: 'IDLE',

  /** Last transcript received from STT */
  transcript: '',

  /** Last AI response to display in overlay */
  caddieResponse: '',

  /** Mutations */
  setVoiceState:    (state)    => set({ voiceState: state }),
  setTranscript:    (text)     => set({ transcript: text }),
  setCaddieResponse:(text)     => set({ caddieResponse: text }),
  reset:            ()         => set({ voiceState: 'IDLE', transcript: '', caddieResponse: '' }),
}));
