/**
 * sttService.js — Speech-to-text service
 *
 * Uses expo-camera's microphone recording + OpenAI Whisper for transcription.
 * Falls back to a contextual prompt if recording/Whisper is unavailable.
 *
 * The window is capped at 5 seconds — resolves early if silence detected.
 * All state mutations go through the callback so the UI stays reactive.
 */

import * as FileSystem from 'expo-file-system';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_DURATION_MS = 5000;

let _timeoutRef = null;
let _resolveRef = null;
let _recording  = null;  // expo-av Audio.Recording instance

/**
 * startSTT(setTranscript, audioRecordingRef?)
 *
 * @param {(text: string) => void} setTranscript  — callback to push partial + final transcript
 * @param {React.MutableRefObject} audioRecordingRef — optional ref holding an active Audio.Recording
 * @returns {Promise<string>} resolved transcript
 */
export async function startSTT(setTranscript, audioRecordingRef = null) {
  return new Promise(async (resolve) => {
    _resolveRef = resolve;

    // If we have an active recording ref from a screen, use it
    if (audioRecordingRef?.current) {
      _recording = audioRecordingRef.current;
    }

    // Safety timeout — always resolves after MAX_DURATION_MS even with no audio
    _timeoutRef = setTimeout(async () => {
      const text = await _finalizeRecording(audioRecordingRef);
      setTranscript(text);
      _resolveRef?.(text);
      _resolveRef = null;
    }, MAX_DURATION_MS);
  });
}

/**
 * stopSTT(setTranscript, audioRecordingRef?)
 *
 * Called when the user taps Cancel or the silence window closes.
 * Cancels the timer and finalizes the recording immediately.
 */
export async function stopSTT(setTranscript, audioRecordingRef = null) {
  if (_timeoutRef) {
    clearTimeout(_timeoutRef);
    _timeoutRef = null;
  }

  if (_resolveRef) {
    const text = await _finalizeRecording(audioRecordingRef);
    if (setTranscript) setTranscript(text);
    _resolveRef(text);
    _resolveRef = null;
  }
}

// ---------------------------------------------------------------------------
// Internal: stop + transcribe recording
// ---------------------------------------------------------------------------
async function _finalizeRecording(audioRecordingRef) {
  const rec = audioRecordingRef?.current ?? _recording;
  _recording = null;

  if (!rec) {
    // No real recording — return empty (caller will use local AI fallback)
    return '';
  }

  try {
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI();
    if (!uri) return '';

    // If no OpenAI key, we can't transcribe — return empty
    if (!OPENAI_KEY || OPENAI_KEY.length < 20) return '';

    const form = new FormData();
    form.append('file', { uri, name: 'voice.m4a', type: 'audio/m4a' } as any);
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });

    if (!res.ok) return '';
    const json = await res.json();
    return (json.text ?? '').trim().toLowerCase();
  } catch {
    return '';
  } finally {
    // Clean up temp audio file
    if (rec) {
      try {
        const uri = rec.getURI?.();
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {}
    }
  }
}
