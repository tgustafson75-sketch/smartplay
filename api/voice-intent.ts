import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a voice intent parser for SmartPlay Caddie, a golf caddie app. The user is talking to their AI golf caddie Kevin. Parse the user's speech into structured intent.

Available intents:

1. open_tool — User wants to launch a tool or screen.
   parameters: { tool_name: "smartvision" | "smartfinder" | "swinglab" | "scorecard" | "dashboard" | "settings" | "lie_analysis", play_intent?: "aggressive" | "conservative" }
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
   - "Kevin what should I do here" / "analyze my lie" / "what's my play" / "look at this lie" -> { tool_name: "lie_analysis" }
   - "should I go for it" / "can I go at this pin" -> { tool_name: "lie_analysis", play_intent: "aggressive" }
   - "should I lay up" / "should I play safe here" -> { tool_name: "lie_analysis", play_intent: "conservative" }

2. query_status — User wants information about current state.
   parameters: { query_topic: "score" | "hole" | "ghost_match" | "weather" | "pattern" | "shot_distance" | "hole_progress" | "distance_to_green" | "wind" | "conditions" | "plays_like" | "green_front" | "green_back" | "green_middle", target_yards?: number }
   Examples:
   - "what's my score" -> { query_topic: "score" }
   - "what hole am I on" -> { query_topic: "hole" }
   - "how am I doing against the ghost" -> { query_topic: "ghost_match" }
   - "how far was that shot" / "how far did I hit it" / "what was that one" -> { query_topic: "shot_distance" }
   - "how far have I gone" / "how far have I hit it on this hole" / "total yardage" -> { query_topic: "hole_progress" }
   - "how far to the green" / "yardage to the pin" / "how far to the flag" -> { query_topic: "distance_to_green" }
   - "what's the wind doing" / "how's the wind" / "any wind out there" -> { query_topic: "wind" }
   - "is it going to rain" / "any rain" / "what are conditions like" / "how's the weather" -> { query_topic: "conditions" }
   - "plays like" alone -> { query_topic: "plays_like" }
   - "plays like 152" / "what does 165 play like" / "how does 140 play" -> { query_topic: "plays_like", target_yards: 152 } (extract the integer when stated)
   - "how far to the front" / "yardage to the front of the green" / "how far is the front" -> { query_topic: "green_front" }
   - "how far to the back" / "yardage to the back of the green" -> { query_topic: "green_back" }
   - "how far to the middle" / "middle of the green" -> { query_topic: "green_middle" }

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
   - "mute Kevin" -> { setting_name: "voice_enabled", new_value: false }
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
   - "what can I do with my voice"

6. acknowledge — User is acknowledging Kevin without requesting action.
   parameters: {}
   Examples: "thanks Kevin", "got it", "okay", "alright", "cool"

7. unknown — Cannot determine intent.
   parameters: {}
   Set follow_up_question to a brief clarifying question Kevin could ask.

If the request is ambiguous (e.g. "open the menu" — which menu?), use intent_type "unknown" with confidence "medium" and a clarifying follow_up_question. Don't guess between candidates; ask once.

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const text = String(body?.text ?? '').trim();
    const context = body?.context ?? {};

    if (!text) {
      return res.status(200).json({
        intent_type: 'unknown',
        parameters: {},
        confidence: 'low',
        follow_up_question: 'I didn\'t catch anything — try again?',
      });
    }

    const userPrompt = `User said: "${text}"

Current context:
${JSON.stringify(context, null, 2)}

Parse the intent. Return JSON only.`;

    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0,
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

    return res.status(200).json({
      intent_type,
      parameters,
      confidence,
      follow_up_question,
    });

  } catch (err) {
    console.log('[voice-intent] error:', err);
    return res.status(200).json({
      intent_type: 'unknown',
      parameters: {},
      confidence: 'low',
      follow_up_question: null,
    });
  }
}
