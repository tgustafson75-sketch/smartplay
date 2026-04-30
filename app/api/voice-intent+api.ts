import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a voice intent parser for SmartPlay Caddie, a golf caddie app. The user is talking to their AI golf caddie Kevin. Parse the user's speech into structured intent.

Available intents:

1. open_tool — User wants to launch a tool.
   parameters: { tool_name: "smartvision" | "smartfinder" | "swinglab" | "scorecard" }
   Examples:
   - "open SmartVision" -> { tool_name: "smartvision" }
   - "show me the smart finder" -> { tool_name: "smartfinder" }
   - "let me see SwingLab" -> { tool_name: "swinglab" }
   - "open the rangefinder" -> { tool_name: "smartfinder" }
   - "pull up my scorecard" -> { tool_name: "scorecard" }
   - "I want to record a swing" -> { tool_name: "swinglab" }

2. query_status — User wants information about current state.
   parameters: { query_topic: "score" | "hole" | "ghost_match" | "weather" | "pattern" }
   Examples:
   - "what's my score" -> { query_topic: "score" }
   - "tell me my score" -> { query_topic: "score" }
   - "how am I doing" -> { query_topic: "score" }
   - "what hole is this" -> { query_topic: "hole" }
   - "what hole am I on" -> { query_topic: "hole" }
   - "how am I doing against the ghost" -> { query_topic: "ghost_match" }
   - "what's the wind" -> { query_topic: "weather" }
   - "what's my pattern" -> { query_topic: "pattern" }

3. change_setting — User wants to modify a setting.
   parameters: { setting_name: string, new_value: string | boolean }
   Recognized setting_name values: "theme" (light/dark/system), "voice_enabled" (true/false), "discrete_mode" (true/false), "auto_listen" (true/false), "language" (en/es/zh), "response_mode" (short/neutral/detailed).
   Examples:
   - "switch to dark mode" -> { setting_name: "theme", new_value: "dark" }
   - "make it light mode" -> { setting_name: "theme", new_value: "light" }
   - "turn on always-listening" -> { setting_name: "auto_listen", new_value: true }
   - "mute Kevin" -> { setting_name: "voice_enabled", new_value: false }
   - "unmute" -> { setting_name: "voice_enabled", new_value: true }
   - "switch to Spanish" -> { setting_name: "language", new_value: "es" }
   - "be more concise" -> { setting_name: "response_mode", new_value: "short" }

4. acknowledge — User is acknowledging Kevin without requesting action.
   parameters: {} (none)
   Examples:
   - "thanks Kevin"
   - "got it"
   - "okay"
   - "alright"
   - "thanks"
   - "cool"

5. unknown — Cannot determine intent.
   parameters: {}
   Set follow_up_question to a brief clarifying question Kevin could ask.

Return ONLY valid JSON, no preamble, no code fences. Shape:
{
  "intent_type": "open_tool" | "query_status" | "change_setting" | "acknowledge" | "unknown",
  "parameters": {...},
  "confidence": "high" | "medium" | "low",
  "follow_up_question": string | null
}

Confidence guide:
- high: intent and all parameters are unambiguous
- medium: intent is clear but parameters are partial or fuzzy
- low: intent itself is uncertain — set follow_up_question

If the user's words could be a tactical golf question ("what's the play here", "what club", "where do I aim"), return intent_type "unknown" with confidence "low" and follow_up_question null — those route to Kevin's brain instead.`;

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    const context = body.context ?? {};

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
      system: SYSTEM_PROMPT,
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
