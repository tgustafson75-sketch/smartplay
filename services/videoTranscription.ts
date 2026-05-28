/**
 * 2026-05-28 — Fix FP: video-audio transcription client helper.
 *
 * Wraps the existing /api/transcribe endpoint (Whisper → Gemini
 * fallback, 25MB multipart limit, golf-vocab priming). The endpoint
 * accepts mp4 directly — Whisper extracts the audio track server-side
 * — so no client-side audio extraction is needed.
 *
 * Use cases:
 *   1. Library uploads of instructor footage where the coach is
 *      narrating ("feel like your hands are softer at the top").
 *   2. Glasses-POV chip/putt clips where the player narrates feel
 *      ("buttery hands here, soft tempo").
 *
 * Design notes:
 *   - Returns null on any failure — caller never errors, just skips
 *     the audio enrichment. Matches the rest of the upload pipeline's
 *     "optional enrichment" pattern (pose API, ball-area detection).
 *   - Caller is responsible for kicking this off in parallel with the
 *     vision analysis so transcription latency doesn't block the
 *     primary "what was the fault" read. The transcript attaches to
 *     the session asynchronously via cageStore.setSessionAudioTranscript.
 *   - Skips when has_audio === false (probed at ingest time). Cuts a
 *     wasted 5-15s upload on silent clips (typical for in-app captures
 *     where the mic is recording impact transient, not narration).
 *   - Maximum payload guard at 20MB — under /api/transcribe's 25MB
 *     limit with headroom for multipart overhead. Larger clips skip
 *     with a console.log; future work is chunked / blob upload.
 */

import * as FileSystem from 'expo-file-system/legacy';

interface TranscribeOpts {
  /** Caller-known has_audio flag from probeVideo. When explicitly
   *  false, we skip the network roundtrip entirely. Undefined = don't
   *  pre-filter, let the server try. */
  hasAudio?: boolean;
  /** User's selected language for caddie speech; threaded into the
   *  Whisper language hint + priming prompt. Defaults 'en'. */
  language?: 'en' | 'es' | 'zh';
  /** Hard upload cap. Default 20MB (under /api/transcribe's 25MB). */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Transcribe the audio track from a local video file. Returns the
 * trimmed transcript string, or null if no audio / file missing /
 * too large / network or API failure. Never throws.
 */
export async function transcribeVideoAudio(
  videoUri: string,
  opts: TranscribeOpts = {},
): Promise<string | null> {
  if (!videoUri) return null;
  if (opts.hasAudio === false) {
    console.log('[transcribe-video] skipping (has_audio=false)');
    return null;
  }

  let fileSize: number | null = null;
  try {
    // expo-file-system/legacy: getInfoAsync returns { exists, uri, size?, ... }
    // by default; no separate opts needed for size.
    const info = await FileSystem.getInfoAsync(videoUri);
    if (!info.exists) {
      console.log('[transcribe-video] file does not exist:', videoUri.slice(-40));
      return null;
    }
    const sizeProp = (info as { size?: number }).size;
    fileSize = typeof sizeProp === 'number' ? sizeProp : null;
  } catch (e) {
    console.log('[transcribe-video] getInfoAsync failed (non-fatal)', e);
  }

  const cap = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (fileSize != null && fileSize > cap) {
    console.log('[transcribe-video] skipping — file too large for /api/transcribe', {
      size_mb: Math.round(fileSize / (1024 * 1024)),
      cap_mb: Math.round(cap / (1024 * 1024)),
    });
    return null;
  }

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!apiUrl) {
    console.log('[transcribe-video] EXPO_PUBLIC_API_URL not configured');
    return null;
  }

  const language = opts.language ?? 'en';
  const t0 = Date.now();
  try {
    const form = new FormData();
    // React Native FormData expects the file as a { uri, name, type } shape.
    // /api/transcribe handler (formidable) accepts any of the audio/* +
    // audio/mp4 mime types and reads the actual stream regardless of label.
    form.append('audio', {
      uri: videoUri,
      name: 'upload.mp4',
      type: 'video/mp4',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    form.append('language', language);

    const res = await fetch(`${apiUrl}/api/transcribe`, {
      method: 'POST',
      body: form,
      // 60s — Whisper typically returns in 3-8s for a 15s clip, but
      // Gemini fallback + larger uploads can stretch. Cap generously.
      signal: AbortSignal.timeout(60_000),
    });
    const elapsedMs = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      console.log('[transcribe-video] non-ok response', { status: res.status, elapsed_ms: elapsedMs, body_head: body.slice(0, 200) });
      return null;
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? '').trim();
    if (text.length === 0) {
      console.log('[transcribe-video] empty transcript', { elapsed_ms: elapsedMs, size_bytes: fileSize });
      return null;
    }
    console.log('[transcribe-video] success', {
      elapsed_ms: elapsedMs,
      size_bytes: fileSize,
      chars: text.length,
      head: text.slice(0, 80),
    });
    return text;
  } catch (e) {
    const elapsedMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[transcribe-video] fetch failed', { elapsed_ms: elapsedMs, error: msg.slice(0, 200) });
    return null;
  }
}
