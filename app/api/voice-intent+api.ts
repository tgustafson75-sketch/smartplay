import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, type VoiceGender, type Persona } from '../../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildSystemPrompt = (g: Persona | VoiceGender) => {
  const caddieName = getCaddieName(g);
  return `You are a voice intent parser for SmartPlay Caddie, a golf caddie app. The user is talking to their AI golf caddie ${caddieName}. Parse the user's speech into structured intent.

Available intents:

1. open_tool — User wants to launch a tool or screen.
   parameters: { tool_name: "smartvision" | "smartfinder" | "swinglab" | "scorecard" | "dashboard" | "settings" }
   Examples:
   - "open SmartVision" -> { tool_name: "smartvision" }
   - "show me the smart finder" -> { tool_name: "smartfinder" }
   - "let me see SwingLab" -> { tool_name: "swinglab" }
   - "open the rangefinder" -> { tool_name: "smartfinder" }
   - "pull up my scorecard" -> { tool_name: "scorecard" }
   - "I want to record a swing" -> { tool_name: "swinglab" }
   - "show my dashboard" -> { tool_name: "dashboard" }
   - "open dashboard" -> { tool_name: "dashboard" }
   - "open settings" -> { tool_name: "settings" }
   - "go to settings" -> { tool_name: "settings" }

2. query_status — User wants information about current state.
   parameters: { query_topic: "score" | "hole" | "ghost_match" | "weather" | "pattern" }
   Examples:
   - "what's my score" -> { query_topic: "score" }
   - "what hole am I on" -> { query_topic: "hole" }
   - "how am I doing against the ghost" -> { query_topic: "ghost_match" }

3. change_setting — User wants to modify a setting.
   parameters: { setting_name: string, new_value: string | boolean }
   Recognized setting_name values:
   - "theme" (light/dark/system)
   - "voice_enabled" (true/false)
   - "discrete_mode" (true/false)
   - "auto_listen" (true/false)
   - "language" (en/es/zh)
   - "response_mode" (short/neutral/detailed)
   - "round_mode" (break_100/break_90/break_80/free_play) — the player's score-target mode for the round
   Examples:
   - "switch to dark mode" -> { setting_name: "theme", new_value: "dark" }
   - "mute ${caddieName}" -> { setting_name: "voice_enabled", new_value: false }
   - "switch to Spanish" -> { setting_name: "language", new_value: "es" }
   - "change to break 80 mode" -> { setting_name: "round_mode", new_value: "break_80" }
   - "set mode to break 90" -> { setting_name: "round_mode", new_value: "break_90" }
   - "free play" -> { setting_name: "round_mode", new_value: "free_play" }

4. navigate — User wants navigation: back, forward, home, close, next/previous hole.
   parameters: { direction: "back" | "home" | "close" | "next_hole" | "previous_hole" | "main_menu" }
   Examples:
   - "go back" -> { direction: "back" }
   - "back" -> { direction: "back" }
   - "main menu" -> { direction: "main_menu" }
   - "go home" / "home" -> { direction: "home" }
   - "next hole" -> { direction: "next_hole" }
   - "previous hole" -> { direction: "previous_hole" }
   - "close this" / "dismiss" / "close the menu" -> { direction: "close" }

5. help — User asked what they can say or for help discovering voice commands.
   parameters: {}
   Examples:
   - "what can I say"
   - "help"
   - "what are my options"
   - "what voice commands work here"

6. acknowledge — User is acknowledging ${caddieName} without requesting action.
   parameters: {}
   Examples: "thanks ${caddieName}", "got it", "okay", "alright", "cool"

8. set_trust_quiet — User wants ${caddieName} silent / Discrete mode.
   parameters: {}
   Examples: "${caddieName} go quiet", "${caddieName} be quiet", "${caddieName} quiet mode", "${caddieName} quiet down", "${caddieName} shush", "go silent", "quiet please"

9. set_trust_companion — User wants ${caddieName} back from Quiet mode.
   parameters: {}
   Examples: "${caddieName} come back", "${caddieName} speak up", "${caddieName} talk to me", "${caddieName} un-quiet", "back to normal"

7. unknown — Cannot determine intent.
   parameters: {}
   Set follow_up_question to a brief clarifying question ${caddieName} could ask.

If the request is ambiguous (e.g. "open the menu" — which menu?), use intent_type "unknown" with confidence "medium" and a clarifying follow_up_question. Don't guess between candidates; ask once.

Return ONLY valid JSON, no preamble, no code fences. Shape:
{
  "intent_type": "open_tool" | "query_status" | "change_setting" | "acknowledge" | "set_trust_quiet" | "set_trust_companion" | "unknown",
  "parameters": {...},
  "confidence": "high" | "medium" | "low",
  "follow_up_question": string | null
}

Confidence guide:
- high: intent and all parameters are unambiguous
- medium: intent is clear but parameters are partial or fuzzy
- low: intent itself is uncertain — set follow_up_question

If the user's words could be a tactical golf question ("what's the play here", "what club", "where do I aim"), return intent_type "unknown" with confidence "low" and follow_up_question null — those route to ${caddieName}'s brain instead.`;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    const context = body.context ?? {};
    const voiceGender: VoiceGender = (body.voiceGender as VoiceGender | undefined) ?? 'male';
    // Audit 101 / B4 — prefer body.persona; fall back to voiceGender.
    const personaInput: Persona | VoiceGender =
      (typeof body.persona === 'string' ? (body.persona as string) : voiceGender) as Persona | VoiceGender;

    if (!text) {
      return new Response(JSON.stringify({
        intent_type: 'unknown',
        parameters: {},
        confidence: 'low',
        follow_up_question: 'I didn\'t catch anything — try again?',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const userPrompt = `User said: "${text}"

Current context:
${JSON.stringify(context, null, 2)}

Parse the intent. Return JSON only.`;

    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0,
      system: buildSystemPrompt(personaInput),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = result.content.find(b => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';

    let parsed: Record<string, unknown> = {};
    try {
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
      parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      parsed = {
        intent_type: 'unknown',
        parameters: {},
        confidence: 'low',
        follow_up_question: 'I didn\'t catch that — try again?',
      };
    }

    const intent_type = typeof parsed.intent_type === 'string' ? parsed.intent_type : 'unknown';
    const parameters = (parsed.parameters && typeof parsed.parameters === 'object') ? parsed.parameters : {};
    const confidence = (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low')
      ? parsed.confidence
      : 'low';
    const follow_up_question = typeof parsed.follow_up_question === 'string' ? parsed.follow_up_question : null;

    return new Response(JSON.stringify({
      intent_type,
      parameters,
      confidence,
      follow_up_question,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.log('[voice-intent] error:', err);
    return new Response(JSON.stringify({
      intent_type: 'unknown',
      parameters: {},
      confidence: 'low',
      follow_up_question: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}
