/**
 * useVoiceInput — speech recognition hook.
 *
 * Uses expo-speech-recognition when available (native builds only).
 * Gracefully no-ops in Expo Go or builds where the native module is absent.
 *
 * NOTE: useSpeechRecognitionEvent is NOT used here because it crashes when
 * the native module isn't linked. All listeners are attached imperatively
 * via ExpoSpeechRecognitionModule.addListener() only when STT_AVAILABLE.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseVoiceCommand, type VoiceCommand } from '../../services/voiceCommandParser';

// ─────────────────────────────────────────────────────────────────────────────
// Safe module access — never crashes when native module is absent
// ─────────────────────────────────────────────────────────────────────────────
let _sttModule: any = null;
try {
  // Dynamic require prevents Metro from crashing the module graph
  const mod = require('expo-speech-recognition');
  _sttModule = mod?.ExpoSpeechRecognitionModule ?? null;
} catch {
  _sttModule = null;
}

const STT_AVAILABLE: boolean = typeof _sttModule?.start === 'function';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface UseVoiceInputOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onCommand?: (command: VoiceCommand, transcript: string) => void;
  lang?: string;
  maxDurationMs?: number;
}

export interface UseVoiceInputReturn {
  listening: boolean;
  transcript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

const DEFAULT_MAX_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────
export function useVoiceInput({
  onTranscript,
  onCommand,
  lang = 'en-US',
  maxDurationMs = DEFAULT_MAX_MS,
}: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const [listening,  setListening]  = useState(false);
  const [transcript, setTranscript] = useState('');
  const autoStopRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenersRef  = useRef<Array<{ remove: () => void }>>([]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const _clearAutoStop = useCallback(() => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
  }, []);

  const _removeListeners = useCallback(() => {
    listenersRef.current.forEach((l) => { try { l.remove(); } catch {} });
    listenersRef.current = [];
  }, []);

  const _doStop = useCallback(() => {
    _clearAutoStop();
    _removeListeners();
    try { if (STT_AVAILABLE) _sttModule.stop(); } catch {}
    setListening(false);
  }, [_clearAutoStop, _removeListeners]);

  // ── Start ──────────────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (!STT_AVAILABLE) {
      console.warn('[useVoiceInput] STT native module not available — mic disabled');
      return;
    }
    if (listening) return;
    setTranscript('');

    try {
      const { granted } = await _sttModule.requestPermissionsAsync();
      if (!granted) {
        console.warn('[useVoiceInput] Microphone permission denied');
        return;
      }

      // Attach listeners imperatively before starting
      listenersRef.current = [
        _sttModule.addListener('result', (event: any) => {
          const text: string = event?.results?.[0]?.transcript ?? '';
          if (!text) return;
          setTranscript(text);
          onTranscript?.(text, event.isFinal ?? false);
          if (event.isFinal) {
            _doStop();
            const command = parseVoiceCommand(text);
            if (command) onCommand?.(command, text);
          }
        }),
        _sttModule.addListener('error', (event: any) => {
          if (event?.error !== 'no-speech') {
            console.warn('[useVoiceInput] STT error:', event?.error, event?.message);
          }
          _doStop();
        }),
        _sttModule.addListener('end', () => {
          _clearAutoStop();
          setListening(false);
        }),
      ];

      _sttModule.start({
        lang,
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: true,
      });
      setListening(true);

      autoStopRef.current = setTimeout(() => {
        _doStop();
      }, maxDurationMs);

    } catch (err) {
      console.error('[useVoiceInput] Failed to start recognition:', err);
      _removeListeners();
      setListening(false);
    }
  }, [listening, lang, maxDurationMs, _doStop, _clearAutoStop, _removeListeners, onTranscript, onCommand]);

  const stopListening = useCallback(() => { _doStop(); }, [_doStop]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      _clearAutoStop();
      _removeListeners();
      try { if (STT_AVAILABLE) _sttModule.stop(); } catch {}
    };
  }, []);

  return { listening, transcript, startListening, stopListening };
}
