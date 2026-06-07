/**
 * 2026-06-06 — Pre-render the 5 greeting strings × 4 personas into MP3
 * files for the quickGreetingClips manifest.
 *
 * Run from repo root:
 *   set -a && source ./.env.local && set +a && npx ts-node scripts/render-greeting-clips.ts
 *
 * Output: assets/audio/greetings_local/<persona>/greeting_<n>.mp3
 * 20 files total (~$0.03 one-time TTS).
 *
 * Voice mapping mirrors scripts/render-ack-clips.ts and api/voice.ts:
 *   kevin → onyx, serena → nova, tank → ash, harry → fable
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Persona = 'kevin' | 'serena' | 'harry' | 'tank';
type OpenAIVoice = 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse';

const VOICE_BY_PERSONA: Record<Persona, OpenAIVoice> = {
  kevin:  'onyx',
  serena: 'nova',
  tank:   'ash',
  harry:  'fable',
};

// MUST stay in sync with services/intents/socialGreetingHandler.ts
// GREETINGS and services/quickGreetingClips.ts GREETING_TEXTS.
const GREETINGS_BY_PERSONA: Record<Persona, string[]> = {
  kevin: [
    "Hey, what do you need?",
    "Right here. What's up?",
    "I'm with you. What are we working on?",
    "Talk to me.",
    "Go ahead.",
  ],
  tank: [
    "Yeah, what do you got?",
    "Talk to me.",
    "Go ahead, I'm listening.",
    "What do you need?",
    "Here. What's up?",
  ],
  serena: [
    "I'm here. What are you thinking?",
    "Go ahead.",
    "Talk to me.",
    "What's on your mind?",
    "Right here with you.",
  ],
  harry: [
    "Go.",
    "Here.",
    "What do you need?",
    "Talk to me.",
    "Go ahead.",
  ],
};

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY required');
    process.exit(1);
  }
  const outRoot = path.join(__dirname, '..', 'assets', 'audio', 'greetings_local');
  await fs.mkdir(outRoot, { recursive: true });

  for (const persona of Object.keys(VOICE_BY_PERSONA) as Persona[]) {
    const personaDir = path.join(outRoot, persona);
    await fs.mkdir(personaDir, { recursive: true });
    const voice = VOICE_BY_PERSONA[persona];
    const pool = GREETINGS_BY_PERSONA[persona];
    for (let i = 0; i < pool.length; i++) {
      const text = pool[i];
      const outPath = path.join(personaDir, `greeting_${i}.mp3`);
      try {
        const stat = await fs.stat(outPath);
        if (stat.size > 0) {
          console.log(`skip ${persona}/greeting_${i} (already exists, ${stat.size} bytes)`);
          continue;
        }
      } catch { /* not present — render */ }
      console.log(`render ${persona}/greeting_${i} ("${text}") via ${voice}`);
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`FAILED ${persona}/greeting_${i}: HTTP ${res.status} ${body}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(outPath, buf);
      console.log(`  wrote ${buf.length} bytes → ${outPath}`);
    }
  }
  console.log('\nDone. quickGreetingClips.ts already has require() lines wired — bundle ships next OTA.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
