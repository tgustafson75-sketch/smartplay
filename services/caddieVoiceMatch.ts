/**
 * 2026-07-30 (Tim — "analyze the photo for my caddie and assign a fitting OpenAI voice"). Sends the
 * custom caddie's portrait to /api/caddie-voice, which returns the best-fitting OpenAI TTS voice, and
 * stores it as playerProfile.customCaddieVoice (used by voiceService when the custom caddie speaks text
 * with no recorded clip). Also exposes the voice list for a manual picker override.
 */
import { getApiBaseUrl } from './apiBase';
import { useCustomCaddieMediaStore } from '../store/customCaddieMediaStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';

/** The gpt-4o-mini-tts voices offered in the manual picker (must match api/caddie-voice + api/voice). */
export const CADDIE_VOICES: { id: string; label: string }[] = [
  { id: 'onyx', label: 'Onyx — deep, warm' },
  { id: 'echo', label: 'Echo — calm, steady' },
  { id: 'ash', label: 'Ash — confident' },
  { id: 'verse', label: 'Verse — expressive' },
  { id: 'fable', label: 'Fable — storyteller' },
  { id: 'alloy', label: 'Alloy — neutral' },
  { id: 'sage', label: 'Sage — soft, wise' },
  { id: 'nova', label: 'Nova — bright' },
  { id: 'coral', label: 'Coral — warm, upbeat' },
  { id: 'shimmer', label: 'Shimmer — soft, gentle' },
];

export interface VoiceMatchResult {
  ok: boolean;
  voice?: string;
  reason?: string | null;
  error?: 'no_photo' | 'no_voice' | string;
}

/** Analyze the custom caddie portrait → set + return the recommended voice. Best-effort; never throws. */
export async function matchCaddieVoiceFromPhoto(): Promise<VoiceMatchResult> {
  const media = useCustomCaddieMediaStore.getState();
  const b64 = media.customCaddiePortraitB64 ?? media.selfieB64 ?? null;
  if (!b64) return { ok: false, error: 'no_photo' };
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/caddie-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageB64: b64, mediaType: 'image/jpeg' }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false, error: `server_${res.status}` };
    const data = (await res.json()) as { voice?: string; reason?: string | null };
    if (typeof data.voice === 'string' && data.voice) {
      usePlayerProfileStore.getState().setCustomCaddieVoice(data.voice);
      return { ok: true, voice: data.voice, reason: data.reason ?? null };
    }
    return { ok: false, error: 'no_voice' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
