/**
 * Inference cost-gate guard (deep audit 2026-07-26). The paid text/voice/vision LLM + audio routes
 * shipped with no app-key and no rate-limit — CORS only blocks browser callers, so a curl loop could
 * run an unbounded provider bill and take the brain down for everyone. Each got the zero-regression
 * per-IP `allowInference(req,res,'<name>')` gate. This test fails if any of them loses it again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_DIR = join(__dirname, '..', '..', 'api');

// Every paid-inference route that must carry a cost gate.
const GATED_ROUTES = [
  /* 2026-09-01 — pipecat-turn deleted with the shim (no callers since 08-23). */ 'voice', 'transcribe', 'owner-triage', 'kevin-read', 'kevin', 'recap', 'briefing',
  'context-synthesis', 'course-import', 'round-import', 'toptracer-parse', 'workout-import',
  'voice-intent', 'meta-voice', 'parse-shot', 'preround', 'swing-question', 'course-content',
  'course-intelligence', 'narrative-extract', 'course-ai-search',
];

describe('paid inference routes are cost-gated', () => {
  it.each(GATED_ROUTES)('api/%s.ts calls allowInference(req, res, ...)', (route) => {
    const src = readFileSync(join(API_DIR, `${route}.ts`), 'utf8');
    expect(src).toMatch(/from '\.\/_inferLimit'/);
    // gate is actually invoked with the request (not just imported)
    expect(src).toMatch(/allowInference\s*\(\s*req\s*,\s*res\s*,/);
  });
});
