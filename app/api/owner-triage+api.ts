/**
 * 2026-05-22 — Path 1 (Owner Triage with Claude).
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
 * responses; the triage text is fine to leak (it's just Claude analyzing
 * the user's own report).
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 25_000,
  maxRetries: 1,
});

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `You are a senior React Native / Expo / TypeScript engineer triaging a bug report from inside the SmartPlay Caddie Pro app.

Your job: given the user's report + context snapshot + recent app events, produce a TIGHT triage hypothesis the owner can read on their phone mid-round and decide what to do next.

What you know about the codebase (broad strokes):
- React Native + Expo SDK 54 + TypeScript, Zustand state stores, expo-router.
- Three pillars: Round (GPS / SmartFinder / scoring / recap), SwingLab (SmartMotion / Cage Mode), Play (course discovery / ghost play).
- Four caddie personas (Kevin, Serena, Tank, Harry) — Harry soft-removed from UI.
- Voice path: ElevenLabs TTS primary, OpenAI fallback. Claude Sonnet 4.5 brain at /api/kevin. Claude Haiku at /api/voice-intent.
- Key stores: roundStore, settingsStore, playerProfileStore, watchStore, issueLogStore, teamIntelligenceStore, trustLevelStore.
- Key gates that cause silent failures: voiceEnabled, trustLevel (L1 Quiet suppresses scripted speech), voiceOnPhoneSpeaker, skip_briefings.
- Recent fix history (Day 3, 2026-05-21): Fix Q (one persona everywhere + opt-in handoff), Fix R (recap Notes section), Fix N-3 (Health Connect off round-start path — fixed Z Fold Start Round crash), Fix S (per-hole intro on transition), Fix T (briefing fetch failure honest-fallback).

Output format (markdown, ~150 words max):

**Hypothesis:** one-sentence likely root cause.

**Where to look:** file path + ~line area (best guess, mark as guess). Up to 3 candidate locations.

**Quick check first:** the one setting/state the owner should verify on-device before any code change (e.g. "is voiceEnabled on?", "what's the current trustLevel?").

**If real, fix scope:** one-line description of the change shape. NO code blocks. If you'd need more context to be confident, say what context.

**Severity:** P0 (round-killer) / P1 (frustrating but workaround exists) / P2 (cosmetic).

Be honest about uncertainty. If the report is too vague or the context is insufficient, say so plainly and ask for one specific clarifying detail. Don't fabricate file paths — if you don't know, name the subsystem ("likely in services/intents/* or app/api/voice-intent+api.ts").

Do NOT propose multi-day refactors. Do NOT write code. Do NOT suggest disabling features. The owner is mid-round; they need a quick read.`;

interface TriageRequestBody {
  entry?: { id?: string; text?: string; timestamp?: number; context?: Record<string, unknown> };
  recentEvents?: unknown[];
  settingsSnapshot?: Record<string, unknown>;
  recentIssues?: Array<{ text: string; timestamp: number }>;
  bundleInfo?: { updateId?: string | null; createdAt?: string | null };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as TriageRequestBody;
    const entry = body.entry ?? {};
    const reportText = String(entry.text ?? '').trim();
    if (!reportText) {
      return Response.json({ error: 'No report text provided.' }, { status: 400 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { triage: 'Triage unavailable — Anthropic key not configured on server.' },
        { status: 200 },
      );
    }

    // Bundle the context into a compact payload for the model. We keep
    // recentEvents capped at 50 to stay well under prompt cache limits;
    // the most recent events are the most diagnostic for an active
    // session anyway.
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
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPayload }],
    });

    // Pull out the first text block (model normally returns one).
    const block = completion.content.find(b => b.type === 'text');
    const triage = block && block.type === 'text' ? block.text.trim() : 'Triage returned empty.';

    return Response.json({ triage }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[owner-triage] failed', msg);
    return Response.json(
      { triage: `Triage request failed: ${msg}. Try again in a moment.` },
      { status: 200 },
    );
  }
}
