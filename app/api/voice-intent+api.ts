import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, type VoiceGender, type Persona } from '../../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildSystemPrompt = (g: Persona | VoiceGender) => {
  const caddieName = getCaddieName(g);
  return `You are a voice intent parser for SmartPlay Caddie, a golf caddie app. The user is talking to their AI golf caddie ${caddieName}. Parse the user's speech into structured intent.

Available intents:

1. open_tool — User wants to launch a tool or screen.
   parameters: { tool_name: "smartvision" | "smartfinder" | "swinglab" | "scorecard" | "dashboard" | "settings" | "smartmotion" | "tightlie" | "acoustic" | "gps_test" }
   Examples:
   - "open SmartVision" -> { tool_name: "smartvision" }
   - "show me the smart finder" -> { tool_name: "smartfinder" }
   - "let me see SwingLab" -> { tool_name: "swinglab" }
   - "open the rangefinder" -> { tool_name: "smartfinder" }
   - "pull up my scorecard" -> { tool_name: "scorecard" }
   - "I want to record a swing" -> { tool_name: "smartmotion" }
   - "show my dashboard" -> { tool_name: "dashboard" }
   - "open dashboard" -> { tool_name: "dashboard" }
   - "open settings" -> { tool_name: "settings" }
   - "go to settings" -> { tool_name: "settings" }
   - "open SmartMotion" / "record my swing" / "capture my swing" -> { tool_name: "smartmotion" }
   - "open TightLie" / "check my lie" / "what's the play" / "analyze my lie" -> { tool_name: "tightlie" }
   - "open acoustic test" / "acoustic test bench" / "test bench" / "test the mic" -> { tool_name: "acoustic" }
   - "open GPS test" / "GPS test bench" / "test the GPS" -> { tool_name: "gps_test" }
   - "mark the green" / "mark green" / "I'm at the green" / "open Mark Green" -> { tool_name: "mark_green" }

2. query_status — User wants information about current state.
   parameters: { query_topic: "score" | "hole" | "ghost_match" | "weather" | "pattern" }
   Examples:
   - "what's my score" -> { query_topic: "score" }
   - "what hole am I on" -> { query_topic: "hole" }
   - "how am I doing vs last time" / "how am I doing against the ghost" / "what's my ghost match" / "where am I vs last round" -> { query_topic: "ghost_match" }

3. change_setting — User wants to modify a setting.
   parameters: { setting_name: string, new_value: string | boolean }
   Recognized setting_name values:
   - "theme" (light/dark/system)
   - "voice_enabled" (true/false)
   - "discrete_mode" (true/false)
   - "auto_listen" (true/false) — also recognized as "active listening" / "always listening" / "auto-listen" / "hands-free mode"
   - "cart_mode" (true/false) — toggle when the player is riding in a golf cart. Also: "cart mode", "riding cart", "in a cart", "walking mode" (false), "I'm walking" (false)
   - "language" (en/es/zh)
   - "response_mode" (short/neutral/detailed)
   - "round_mode" (break_100/break_90/break_80/free_play) — the player's score-target mode for the round
   - "caddie_persona" (kevin/tank/serena/harry) — which AI caddie persona is active
   - "ghost" (true/false) — also recognized as "ghost mode" / "ghost round" — controls auto-activation of a prior-round ghost match on the same course
   Examples:
   - "switch to dark mode" -> { setting_name: "theme", new_value: "dark" }
   - "mute ${caddieName}" -> { setting_name: "voice_enabled", new_value: false }
   - "switch to Spanish" -> { setting_name: "language", new_value: "es" }
   - "change to break 80 mode" -> { setting_name: "round_mode", new_value: "break_80" }
   - "set mode to break 90" -> { setting_name: "round_mode", new_value: "break_90" }
   - "free play" -> { setting_name: "round_mode", new_value: "free_play" }
   - "turn off active listening" / "stop listening to me" / "stop active listening" -> { setting_name: "auto_listen", new_value: false }
   - "turn on active listening" / "active listening on" / "hands-free mode" -> { setting_name: "auto_listen", new_value: true }
   - "cart mode on" / "I'm in a cart" / "riding in a cart" / "turn on cart mode" -> { setting_name: "cart_mode", new_value: true }
   - "cart mode off" / "walking mode" / "I'm walking" / "turn off cart mode" -> { setting_name: "cart_mode", new_value: false }
   - "switch to Tank" / "change caddie to Tank" / "put Tank in" -> { setting_name: "caddie_persona", new_value: "tank" }
   - "switch to Serena" / "I want Serena" -> { setting_name: "caddie_persona", new_value: "serena" }
   - "switch to Harry" / "let me hear Harry" -> { setting_name: "caddie_persona", new_value: "harry" }
   - "switch back to Kevin" / "give me Kevin" -> { setting_name: "caddie_persona", new_value: "kevin" }
   - "ghost on" / "turn on ghost mode" / "race the ghost" / "compare to last round" -> { setting_name: "ghost", new_value: true }
   - "ghost off" / "turn off ghost" / "stop comparing" / "drop the ghost" / "no ghost" -> { setting_name: "ghost", new_value: false }

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

10. log_issue — User wants to capture a bug / feedback / observation / "remember this" note about the app itself for later review. Match LIBERALLY on intent; this is the catch-all "save this thought" path. The descriptive note follows the wake phrase.
    parameters: { note: string — the actual issue/feedback text with the wake phrase already stripped }
    Triggering phrases (treat as semantically equivalent):
    - "we have an issue", "we have a problem", "there's an issue", "this is an issue"
    - "remember this", "store this", "save this", "track this", "make a note", "note this", "note for later"
    - "I want you to know", "I want you to remember", "for the record"
    - "this is broken", "this doesn't work", "this isn't working", "this is wrong"
    - "log this", "log an issue", "log a bug"
    - "report a bug", "I have feedback", "I have a problem"
    - "fix this", "watch out for"
    Examples:
    - "we have an issue with the recap screen, it feels slow" -> { note: "recap screen feels slow" }
    - "remember this — SmartFinder white-screened at 10x zoom" -> { note: "SmartFinder white-screened at 10x zoom" }
    - "save this for me: Sunnyvale hole 7 yardage looks wrong" -> { note: "Sunnyvale hole 7 yardage looks wrong" }
    - "make a note that Tank cut me off mid-sentence" -> { note: "Tank cut me off mid-sentence" }
    - "this is broken: cockpit log shot button doesn't fire" -> { note: "cockpit log shot button doesn't fire" }
    - "${caddieName} log this — the recap screen is slow" -> { note: "the recap screen is slow" }
    - "I want you to know the GPS data bar is static" -> { note: "GPS data bar is static" }
    The note should contain the substantive description ONLY — no wake phrase prefix, no caddie name. Pass empty string only if the user said a wake phrase with nothing meaningful after.

11. media_capture — User wants to record a short video clip of a shot or swing for later review/analysis.
    parameters: { capture_type: "shot" | "swing", raw_utterance: string }
    Examples:
    - "record this shot" / "capture this shot" / "record this" -> { capture_type: "shot" }
    - "record my swing" / "record this swing" -> { capture_type: "swing" }
    The clip lands in the swing library and on the shot record; user can replay/share later from the library — there is no auto-opening "hero shot" review pane (intentionally removed 2026-05-17).

12. media_playback — User wants to replay / share a previously captured clip.
    parameters: { playback_action: "open" | "last" }
    Examples:
    - "show me last shot" / "play that back" / "replay" -> { playback_action: "last" }
    - "open video" / "show me my videos" / "pull up videos" -> { playback_action: "open" }

13. putt_watch — PuttWatch v1. User wants the caddie to ACK that they're about to putt or chip and the user will record it on their glasses (Meta Ray-Ban). The caddie does NOT start a recording itself (Meta doesn't expose the glasses' camera to third-party apps); it just acknowledges. After the round the user uploads the clip via SwingLab with the 'putt' or 'chip' tag for analysis.
    parameters: { shot_type: "putt" | "chip" }
    Examples:
    - "watch this putt" / "${caddieName} watch this putt" / "PuttWatch" / "analyze this putt" -> { shot_type: "putt" }
    - "watch this chip" / "watch this bunker shot" / "watch this chip out of the bunker" -> { shot_type: "chip" }
    Use putt_watch ONLY when the user explicitly says putt/chip/bunker. Generic "watch this" with no qualifier is ambiguous — prefer putt_watch when context (recent putter use, on/near a green) leans putting; otherwise default to media_capture with shot kind.

14. log_score — User reports their FINAL TOTAL strokes on a hole. Different from log_shot (which is one swing at a time). Strokes is an integer 1..12. Hole number is optional; defaults to currentHole.
    parameters: { strokes: integer | word, hole_number?: integer 1..18 }
    Examples:
    - "I made a five" -> { strokes: 5 }
    - "I shot a 7" -> { strokes: 7 }
    - "I had a six" -> { strokes: 6 }
    - "score me a 4" / "put me down for a 4" -> { strokes: 4 }
    - "five on this hole" -> { strokes: 5 }
    - "score me a 5 on hole 7" -> { strokes: 5, hole_number: 7 }
    - "I bogeyed seven" -> { strokes: <par+1 — leave as null, the handler computes par-relative; but if you can resolve, fine> }
    Prefer log_score over log_shot when the user is reporting a TOTAL ("I made a five") rather than a single swing.

15. sequence — User chained two or more independent commands in one utterance (separated by "and", "then", commas, or implicit pause). Each step is a real first-class intent above. Use ONLY when the steps are distinct actions; don't bundle a single clause that already encodes multiple params.
   parameters: { steps: [{ intent_type, parameters }, ...] }
   Examples:
   - "tell ${caddieName} I'm on hole 7, then refresh GPS" -> { steps: [ { intent_type: "change_setting", parameters: { setting: "currentHole", value: 7 } }, { intent_type: "query_status", parameters: { kind: "refresh_gps" } } ] }
   - "log a 5 and move to the next tee" -> { steps: [ { intent_type: "log_score", parameters: { strokes: 5 } }, { intent_type: "change_setting", parameters: { setting: "advance_hole" } } ] }
   - "open SmartFinder and go quiet" -> { steps: [ { intent_type: "open_tool", parameters: { tool_name: "smartfinder" } }, { intent_type: "set_trust_quiet", parameters: {} } ] }
   Order matters. Cap at 3 steps; if more, fall back to unknown with a clarifying question.

7. unknown — Cannot determine intent.
   parameters: {}
   Set follow_up_question to a brief clarifying question ${caddieName} could ask.

If the request is ambiguous (e.g. "open the menu" — which menu?), use intent_type "unknown" with confidence "medium" and a clarifying follow_up_question. Don't guess between candidates; ask once.

Return ONLY valid JSON, no preamble, no code fences. Shape:
{
  "intent_type": "open_tool" | "query_status" | "change_setting" | "navigate" | "help" | "acknowledge" | "set_trust_quiet" | "set_trust_companion" | "log_issue" | "media_capture" | "media_playback" | "putt_watch" | "log_score" | "sequence" | "unknown",
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

    // Audit 101 / W4 — Anthropic ephemeral prompt caching (5-min TTL).
    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0,
      system: [{ type: 'text', text: buildSystemPrompt(personaInput), cache_control: { type: 'ephemeral' } }],
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
