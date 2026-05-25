/**
 * 2026-05-24 v1.2.3 — Swing-tempo backend stub.
 *
 * Placeholder for the ffmpeg-based audio extraction + tempo analysis
 * pipeline. The pipeline (extract audio from MP4 → impact-pair
 * detection → backswing/downswing timing → tank_advice synthesis) is a
 * separate scope — it requires either an ffmpeg-capable worker (Vercel
 * Edge can't bundle ffmpeg under the 50MB limit) or an external audio
 * processing service.
 *
 * This route returns 501 Not Implemented honestly so the client surfaces
 * "backend not ready yet" rather than failing silently or fabricating a
 * tempo read. When the real pipeline lands, replace this body with the
 * ffmpeg + tempo logic — the client contract
 * (services/metaGlasses/videoAudioService.ts → MetaVideoTempoResult)
 * stays stable.
 */

export async function POST(request: Request) {
  void request;
  return new Response(
    JSON.stringify({
      message: "Tempo analysis backend isn't deployed yet — we detected your video but the audio extraction pipeline is still being built.",
      stub: true,
    }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
