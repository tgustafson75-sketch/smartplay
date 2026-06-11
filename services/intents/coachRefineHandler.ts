/**
 * 2026-05-25 — Fix AF: voice intent for coach refinement.
 *
 * Triggered when an authorized coach (e.g. Marc / real Tank) says one
 * of the trigger phrases AFTER the caddie has just answered a topic
 * question. The handler:
 *   1. Reads the prior conversation turns (user question + caddie
 *      reply) from conversationState
 *   2. Extracts the TOPIC from the user's prior question (e.g. "what
 *      is smash factor" → topic "smash factor")
 *   3. Opens the mic for ~15s to capture the coach's refined
 *      explanation (longer than normal — instruction explanations run
 *      long, and the silence-VAD will end it early when the coach
 *      stops talking)
 *   4. Persists the refinement to coachKnowledgeStore keyed by topic
 *   5. Speaks an honest ack: "Got it — saved your take on smash factor.
 *      I'll lead with that next time."
 *
 * Authorization: by email — coaches must be flagged in
 * inviteePreferences with coachMode=true. Non-coach users get a polite
 * "this is a coach-only tool" reply (no silent fail).
 *
 * The capture goes straight into coachKnowledgeStore; api/kevin.ts's
 * brain prompt pulls matching entries on every future call so the
 * caddie uses the coach's framing automatically.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { captureUtterance } from '../voiceService';
import { useCoachKnowledgeStore } from '../../store/coachKnowledgeStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { isInviteeCoach } from '../../data/inviteePreferences';
import { getRecentTurns } from '../conversationState';
import { getApiBaseUrl } from '../apiBase';

const COACH_CAPTURE_MS = 15_000;

// Extract a topic from the user's most-recent prior turn. Strategies:
//   1. Strip "what is", "tell me about", "explain", "define", etc.
//   2. Lowercase
//   3. Truncate to a short noun phrase (≤8 words)
function extractTopic(priorUserText: string | null): string {
  if (!priorUserText) return 'general';
  const stripped = priorUserText
    .toLowerCase()
    .replace(/[?.!,]/g, '')
    .replace(/^(hey|kevin|tank|serena|harry)[, ]+/i, '')
    .replace(/^(what\s+is|what's|tell\s+me\s+about|explain|define|how\s+does|how\s+do\s+you|what\s+does)\s+/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean).slice(0, 8);
  return words.length === 0 ? 'general' : words.join(' ');
}

// Lookup: is the caller's email flagged as a coach in
// inviteePreferences? Owner is implicitly authorized via the isOwner
// branch in the handler below, so Tim can test the flow on his own.
function isAuthorizedCoach(email: string | null | undefined): boolean {
  return isInviteeCoach(email);
}

export const coachRefineHandler: IntentHandler = {
  intent_type: 'coach_refine',

  parameter_schema: {},

  examples: [
    'remember this',
    'add to brain',
    "here's how I'd say it",
    'let me refine that',
    'save my interpretation',
    'remember my take',
    'add my version',
    'save this for the brain',
    'I want to refine that',
  ],

  async execute(_intent: VoiceIntent, context: AppContext): Promise<IntentResult> {
    const profile = usePlayerProfileStore.getState();
    const email = profile.email ?? null;

    // Authorization: coach by inviteePreferences OR owner (for testing).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isOwnerEmail } = require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore');
    const isOwner = isOwnerEmail(email);
    const isCoach = isAuthorizedCoach(email);
    if (!isOwner && !isCoach) {
      return {
        success: true,
        voice_response: "Got it — that one's a coach tool we're rolling out. Tim'll flip you the access when it's ready.",
        side_effects: ['coach_refine:not_authorized'],
        follow_up_needed: false,
      };
    }

    // Pull the prior conversation turns to extract topic + prior answer.
    const turns = getRecentTurns();
    const lastUserTurn = [...turns].reverse().find(t => t.role === 'user');
    const lastCaddieTurn = [...turns].reverse().find(t => t.role === 'kevin');
    const priorQuestion = lastUserTurn?.text ?? null;
    const priorAnswer = lastCaddieTurn?.text ?? null;
    const topic = extractTopic(priorQuestion);

    // Speak the listening prompt then capture for up to 15s. Silence-
    // VAD will end the capture early when the coach stops talking.
    // We can't speak through this handler directly — the router speaks
    // our voice_response AFTER execute() returns. So speak via direct
    // import here, then capture, THEN return the final ack.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vs = require('../voiceService') as typeof import('../voiceService');
    const { useSettingsStore } = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
    const settings = useSettingsStore.getState();
    const apiUrl = getApiBaseUrl();
    void context;

    try {
      await vs.speak(
        `Listening — give me your take on ${topic}.`,
        settings.voiceGender ?? 'male',
        settings.language as 'en' | 'es' | 'zh',
        apiUrl,
        { userInitiated: true },
      );
    } catch { /* fall through to capture even if speak fails */ }

    const refinement = await captureUtterance(COACH_CAPTURE_MS, apiUrl, settings.language as 'en' | 'es' | 'zh');
    if (!refinement || !refinement.trim()) {
      return {
        success: false,
        voice_response: "Didn't catch your refinement — try again when you're ready.",
        side_effects: ['coach_refine:empty_capture'],
        follow_up_needed: false,
      };
    }

    useCoachKnowledgeStore.getState().addEntry(topic, refinement.trim(), {
      prior_question: priorQuestion,
      caddie_original_answer: priorAnswer,
      authoredByEmail: email,
    });

    return {
      success: true,
      voice_response: `Got it — saved your take on ${topic}. I'll lead with that next time.`,
      side_effects: [`coach_refine:saved:${topic}`],
      follow_up_needed: false,
    };
  },
};
