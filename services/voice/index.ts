/**
 * services/voice — single voice facade for the live app.
 *
 * Goal: one import surface so screens never have to know which legacy module
 * owns which symbol. Internals stay where they are; only this barrel is the
 * supported public API.
 *
 * Active internals (do NOT import these directly from screens):
 *   - VoiceEngine.js           → speakJob, cancelAll, PRIORITY, getEngineState, etc.
 *   - voiceService.js          → setGlobalGender, configureAudioForSpeech, speak
 *   - voiceTimingController.ts → VoiceTimingController (post-shot timing)
 *   - VoiceController.js       → global listener orchestrator
 *
 * Orphan modules (NOT re-exported, slated for removal in a later pass):
 *   safeVoice, voice.js, voiceCommandParser, voicePriority, voiceProfile,
 *   VoiceIntelligence, core/voice/VoiceManager, voice/caddieVoice.
 */

// VoiceEngine has a sibling .d.ts that types its public surface.
export {
  speakJob,
  cancelAll,
  PRIORITY,
  getEngineState,
  onStateChange,
  startListening,
  stopListening,
  forceStop,
  canSpeak,
} from '../VoiceEngine';

// voiceService is plain JS — declare the surface used by screens.
type VoiceServiceModule = {
  setGlobalGender: (gender: string) => void;
  getGlobalGender: () => string;
  configureAudioForSpeech: () => Promise<void>;
  speak: (text: string, gender?: string) => Promise<unknown>;
};
import * as _voiceService from '../voiceService';
const _vs = _voiceService as unknown as VoiceServiceModule;
export const setGlobalGender         = _vs.setGlobalGender;
export const getGlobalGender         = _vs.getGlobalGender;
export const configureAudioForSpeech = _vs.configureAudioForSpeech;
export const speak                   = _vs.speak;

export { VoiceTimingController } from '../voiceTimingController';

// Legacy shim — preserves the pre-facade API used only by the dead PlayScreenClean.
// Safe to delete once that screen is removed.
import { speakJob as _speakJob, PRIORITY as _PRIORITY } from '../VoiceEngine';
export const speakCaddie = (text: string): Promise<boolean> =>
  _speakJob(text, _PRIORITY.SHOT, 'male');

// VoiceController is plain JS — declare its public surface.
import { VoiceController as _VoiceController } from '../VoiceController';
type VoiceControllerSurface = {
  startListening: (startSTT: () => unknown, setVoiceState?: ((s: string) => void) | null) => Promise<string | null>;
  stopListening: (stopSTT?: () => unknown) => void;
  speak: (text: string, setVoiceState?: ((s: string) => void) | null, gender?: string | null) => Promise<unknown>;
  queueSpeak: (text: string, priority?: number, setVoiceState?: ((s: string) => void) | null, gender?: string | null) => Promise<unknown>;
  stopSpeaking: (setVoiceState?: ((s: string) => void) | null) => void;
  cancel: (setVoiceState?: ((s: string) => void) | null) => Promise<void>;
  getState: () => { isListening: boolean; isSpeaking: boolean };
  PRIORITY: { AMBIENT: number; STRATEGY: number; SHOT: number; CRITICAL: number };
};
export const VoiceController = _VoiceController as unknown as VoiceControllerSurface;
