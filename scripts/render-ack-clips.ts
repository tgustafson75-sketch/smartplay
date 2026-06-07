/**
 * 2026-06-06 — Pre-render the 8 default ack strings × 4 personas
 * into MP3 files for the quickAckClips manifest.
 *
 * Run from repo root:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/render-ack-clips.ts
 *
 * Output: assets/audio/acks/<persona>/<slug>.mp3 (32 files total).
 *
 * After rendering, update services/quickAckClips.ts CLIPS map to
 * `require()` each file, then ship via a new APK build (assets are
 * bundled, not OTA — you can't add new mp3 files via eas update).
 *
 * Cost: ~$0.05 one-time total. Each ack string is ~2-3 words; TTS
 * at $15/M chars ≈ $0.0015 × 32 = $0.05.
 *
 * Voice mapping mirrors api/voice.ts VOICE_BY_PERSONA:
 *   kevin → onyx, serena → nova, tank → ash, harry → fable
 */

import fs from 'node:fs/promises';
import path from 'node:path';

type Persona = 'kevin' | 'serena' | 'harry' | 'tank';
type OpenAIVoice = 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse';

const VOICE_BY_PERSONA: Record<Persona, OpenAIVoice> = {
  kevin:  'onyx',
  serena: 'nova',
  tank:   'ash',
  harry:  'fable',
};

const ACKS: Array<{ slug: string; text: string }> = [
  { slug: 'open_smartvision',    text: 'Pulling up the layout.' },
  { slug: 'open_smartfinder',    text: 'Locking that distance.' },
  { slug: 'open_swinglab',       text: 'Heading to SwingLab.' },
  { slug: 'log_score',           text: 'Got it.' },
  { slug: 'log_shot',            text: 'Logged.' },
  { slug: 'log_emotional_state', text: 'I hear you.' },
  { slug: 'record_swing',        text: "I'm watching." },
  { slug: 'generic',             text: 'On it.' },
];

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY required');
    process.exit(1);
  }

  const outRoot = path.join(__dirname, '..', 'assets', 'audio', 'acks');
  await fs.mkdir(outRoot, { recursive: true });

  for (const persona of Object.keys(VOICE_BY_PERSONA) as Persona[]) {
    const personaDir = path.join(outRoot, persona);
    await fs.mkdir(personaDir, { recursive: true });
    const voice = VOICE_BY_PERSONA[persona];
    for (const ack of ACKS) {
      const outPath = path.join(personaDir, ack.slug + '.mp3');
      try {
        const stat = await fs.stat(outPath);
        if (stat.size > 0) {
          console.log(`skip ${persona}/${ack.slug} (already exists, ${stat.size} bytes)`);
          continue;
        }
      } catch { /* not present — render */ }
      console.log(`render ${persona}/${ack.slug} ("${ack.text}") via ${voice}`);
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: ack.text, response_format: 'mp3' }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`FAILED ${persona}/${ack.slug}: HTTP ${res.status} ${body}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(outPath, buf);
      console.log(`  wrote ${buf.length} bytes → ${outPath}`);
    }
  }

  console.log('\nDone. Next steps:');
  console.log('  1. Verify the 32 files in assets/audio/acks/');
  console.log('  2. Update services/quickAckClips.ts CLIPS map to require() each file');
  console.log('  3. Build a new APK (`eas build`) — adding assets is not OTA-deliverable');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
