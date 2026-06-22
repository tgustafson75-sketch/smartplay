/**
 * 2026-05-22 — Path 1 (Owner Triage with Claude) — Vercel production endpoint.
 *
 * On-phone AI hypothesis generator for issues captured via the
 * "Kevin, log this" voice intent or manual entries. Tim taps "Triage"
 * on an entry in /owner-logs and the entry + context snapshot is sent
 * here. Claude returns a structured hypothesis: most-likely file path,
 * what to investigate, severity, suggested fix in plain English. No
 * code is generated, no patch is applied, no commits happen — this is
 * a triage assistant, not an auto-fixer.
 *
 * SAFETY: read-only. This route does not mutate device state, does not
 * write to git, does not publish anything. The output is text the
 * owner reads on their phone to decide if a real fix is needed.
 *
 * Owner-gating: the /owner-logs UI only exposes the Triage button when
 * isOwnerEmail(profile.email) is true, but this route is unauthenticated
 * (matches the rest of the api/* surface). Don't put secrets in
 * responses; the triage text is fine to surface (it's just Claude
 * analyzing the user's own report).
 *
 * The Expo Router twin at app/api/owner-triage+api.ts handles the same
 * contract for local dev; this Vercel-format file is what production
 * routes hit per vercel.json.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30_000,
  maxRetries: 1,
});

const SYSTEM_PROMPT = `You are a senior React Native / Expo / TypeScript engineer triaging a bug report from inside the SmartPlay Caddie Pro app.

Your job: given the user's report + context snapshot + recent app events, produce a TIGHT triage hypothesis the owner can read on their phone and decide what to do next.

What you know about the codebase (broad strokes):
- React Native + Expo SDK 54 + TypeScript, Zustand state stores, expo-router.
- Three pillars: Round (GPS / SmartFinder / scoring / recap), SwingLab (SmartMotion / Cage Mode), Play (course discovery / ghost play).
- Five caddie personas: Kevin, Serena, Tank, Harry (soft-removed from UI), and 'custom' (user's AI-generated portrait + recorded voice clips).
- AI provider layer: all production routes now use Gemini 2.5 Flash (primary) + OpenAI gpt-4o (fallback) via api/_aiProvider.ts. Anthropic Sonnet powers /api/kevin brain and /api/owner-triage. /api/voice-intent uses Gemini.
- Voice path: ElevenLabs TTS primary, OpenAI TTS fallback. Kevin brain at /api/kevin. Voice intent classification at /api/voice-intent (Gemini).
- Key stores: roundStore, settingsStore, playerProfileStore, cageStore, customCaddieMediaStore, issueLogStore, caddieMemoryStore.
- Key gates that cause silent failures: voiceEnabled, trustLevel (L1 Quiet suppresses scripted speech), voiceOnPhoneSpeaker, skip_briefings.
- SmartMotion: RANGE + CAGE capture modes, Gemini vision for swing fault detection, tier='quick' short-circuits OpenAI escalation.

Output format (markdown, ~150 words max):

**Hypothesis:** one-sentence likely root cause.

**Where to look:** file path + ~line area (best guess, mark as guess). Up to 3 candidate locations.

**Quick check first:** the one setting/state the owner should verify on-device before any code change.

**If real, fix scope:** one-line description of the change shape. NO code blocks. If you'd need more context to be confident, say what context.

**Severity:** P0 (round-killer) / P1 (frustrating but workaround exists) / P2 (cosmetic).

Be honest about uncertainty. Don't fabricate file paths — if you don't know, name the subsystem. Do NOT propose multi-day refactors. Do NOT write code.`;

interface TriageRequestBody {
  entry?: {
    id?: string;
    text?: string;
    timestamp?: number;
    context?: Record<string, unknown>;
  };
  recentEvents?: unknown[];
  settingsSnapshot?: Record<string, unknown>;
  recentIssues?: Array<{ text: string; timestamp: number }>;
  bundleInfo?: { updateId?: string | null; createdAt?: string | null };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const body = (req.body ?? {}) as TriageRequestBody;
    const entry = body.entry ?? {};
    const reportText = String(entry.text ?? '').trim();
    if (!reportText) {
      res.status(400).json({ error: 'No report text provided.' });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(200).json({
        triage: 'Triage unavailable — Anthropic key not configured on server.',
      });
      return;
    }

    const eventsTail = Array.isArray(body.recentEvents) ? body.recentEvents.slice(-50) : [];
    const recentIssues = Array.isArray(body.recentIssues) ? body.recentIssues.slice(-5) : [];

    const userPayload = [
      '## User report',
      reportText,
      '',
      '## Capture context',
      '```json',
      JSON.stringify(entry.context ?? {}, null, 2),
      '```',
      '',
      '## Settings snapshot',
      '```json',
      JSON.stringify(body.settingsSnapshot ?? {}, null, 2),
      '```',
      '',
      '## Recent app events (last 50)',
      '```json',
      JSON.stringify(eventsTail, null, 2),
      '```',
      '',
      '## Other recent issues (last 5)',
      '```json',
      JSON.stringify(recentIssues, null, 2),
      '```',
      '',
      '## Build info',
      '```json',
      JSON.stringify(body.bundleInfo ?? {}, null, 2),
      '```',
    ].join('\n');

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPayload }],
    });

    const block = completion.content.find(b => b.type === 'text');
    const triage = block && block.type === 'text' ? block.text.trim() : 'Triage returned empty.';

    res.status(200).json({ triage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[owner-triage] failed', msg);
    res.status(200).json({
      triage: `Triage request failed: ${msg}. Try again in a moment.`,
    });
  }
}
