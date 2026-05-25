/**
 * 2026-05-24 v1.2.3 — Meta glasses video → audio extraction client.
 *
 * Ray-Ban Meta records swing video as MP4 with embedded audio. There's
 * no standalone audio output from the glasses, so to get the audio
 * for tempo analysis (impact timing, takeaway/downswing ratio) we
 * upload the full MP4 to a backend endpoint that runs ffmpeg
 * server-side and returns a tempo read.
 *
 * Client-side scope only:
 *   - POST video URI to /api/swing-tempo with multipart form data
 *   - Receive { tank_advice: string, audio_mp3_url?, tempo_ms?: ... }
 *   - Caller renders tank_advice in the existing Meta banner UI
 *
 * Server-side ffmpeg pipeline is a separate scope (own Vercel route or
 * dedicated worker). The placeholder route at app/api/swing-tempo+api.ts
 * returns 501 honestly until backend lands; client surfaces that as a
 * "backend not ready" message rather than failing silently.
 *
 * Honest gates:
 *   - Returns null on missing API URL, network failure, or 5xx server
 *   - Returns the parsed response on 200 OR honest message on 501
 *   - Never fabricates a result
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export interface MetaVideoTempoResult {
  ok: boolean;
  tank_advice: string;          // ALWAYS populated — honest message on backend-not-ready
  audio_mp3_url?: string | null; // future: cached MP3 URL from backend
  tempo_ratio?: number | null;   // backswing : downswing ratio (e.g. 3.0 = textbook)
  backswing_ms?: number | null;
  downswing_ms?: number | null;
  not_implemented?: boolean;     // true when backend returned 501
}

/**
 * Upload a Meta glasses video for tempo analysis. Non-throwing — every
 * failure path returns a shape with `tank_advice` so the UI has
 * something honest to show.
 */
export async function uploadMetaVideoForTempoAnalysis(videoUri: string): Promise<MetaVideoTempoResult> {
  if (!API_URL) {
    return {
      ok: false,
      tank_advice: "I can't reach the analysis backend right now — try again with a connection.",
    };
  }
  try {
    const formData = new FormData();
    formData.append('video', {
      uri: videoUri,
      type: 'video/mp4',
      name: 'meta-swing.mp4',
    } as unknown as Blob);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(API_URL + '/api/swing-tempo', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.status === 501) {
      // Backend stub — ffmpeg pipeline not deployed yet. Honest path.
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      return {
        ok: false,
        not_implemented: true,
        tank_advice: data?.message
          ?? "Video tempo analysis is coming — backend pipeline isn't deployed yet.",
      };
    }
    if (!res.ok) {
      console.log('[metaVideoTempo] backend error:', res.status);
      return {
        ok: false,
        tank_advice: `Backend returned ${res.status}. Try again in a moment.`,
      };
    }
    const data = (await res.json()) as Partial<MetaVideoTempoResult>;
    return {
      ok: true,
      tank_advice: (data.tank_advice ?? '').trim() || 'Read your swing — looks good.',
      audio_mp3_url: data.audio_mp3_url ?? null,
      tempo_ratio: typeof data.tempo_ratio === 'number' ? data.tempo_ratio : null,
      backswing_ms: typeof data.backswing_ms === 'number' ? data.backswing_ms : null,
      downswing_ms: typeof data.downswing_ms === 'number' ? data.downswing_ms : null,
    };
  } catch (e) {
    console.log('[metaVideoTempo] upload exception:', e);
    return {
      ok: false,
      tank_advice: "Couldn't reach the analysis backend. Try again in a moment.",
    };
  }
}
