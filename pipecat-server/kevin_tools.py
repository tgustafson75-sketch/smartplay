"""
Kevin's 9 tools translated to Anthropic tool_use format for Pipecat.

UI tools (open_smartvision, open_smartfinder, open_swinglab, record_swing)
  → send a JSON push frame back to the React Native client via WebSocket.

Data tools (log_score, log_shot, log_emotional_state, lookup_course, lookup_hole)
  → POST to /api/pipecat/tool on the Vercel deployment (Phase 2 wires the server side).
"""

import json
import os
import httpx

# ── Tool definitions in Anthropic format ─────────────────────────────────────

KEVIN_TOOLS = [
    {
        "name": "open_smartvision",
        "description": (
            "Open the SmartVision tool — a visual hole layout / overhead view / hole map showing "
            "the green, fairway, hazards, and yardages. Trigger this when the player says ANY of: "
            '"show me the hole", "let me see the layout", "what does the hole look like", '
            '"show the green", "pull up the map", "give me a look at this", or any phrasing '
            "meaning they want the visual map of the hole."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "open_smartfinder",
        "description": (
            "Open the SmartFinder — a precise distance-locking tool / rangefinder / yardage finder. "
            'Trigger when the player says: "rangefinder", "lock the distance", "find the yardage", '
            '"give me a precise distance", "let me lock that", or any phrasing meaning they want '
            "to use a rangefinder-style tool."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "open_swinglab",
        "description": (
            "Open SwingLab — the swing analysis / practice / drill tool. Trigger when the player says: "
            '"swinglab", "practice", "let\'s work on my swing", "swing analysis", "swing drills", '
            '"open practice", or any phrasing meaning they want to enter practice or analysis mode.'
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "log_score",
        "description": (
            "Log the score for a specific hole. Trigger when the player names a score "
            '("got a 3 on hole 3", "bogey on this one", "made the putt for par", "5 here"). '
            "Pass `hole` ONLY if they name a specific hole; otherwise omit it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "hole":  {"type": "number", "description": "Hole number 1-18. Omit when talking about the current hole."},
                "score": {"type": "number", "description": "Strokes taken on the hole"},
            },
            "required": ["score"],
        },
    },
    {
        "name": "log_shot",
        "description": (
            "Log a shot the player just hit, extracting whatever they mentioned: direction, contact "
            "quality, where it ended up, how it felt. Use whenever they describe a shot they made "
            '("I hit it fat", "pulled it left", "striped it", "pushed it but it\'s playable"). '
            "Pass only fields they mentioned — omit anything they did not say."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "club": {
                    "type": "string",
                    "description": "Club used (e.g. '7I', 'Driver', 'PW').",
                },
                "direction": {
                    "type": "string",
                    "enum": ["left", "straight", "right", "pull", "push", "hook", "slice", "fade", "draw"],
                    "description": "Shot direction or shape if mentioned",
                },
                "contactQuality": {
                    "type": "string",
                    "enum": ["fat", "thin", "pure", "toe", "heel", "topped"],
                    "description": "Contact quality if mentioned",
                },
                "outcome": {
                    "type": "string",
                    "description": 'Where the ball ended up — "in the bunker", "on the green", "in the trees"',
                },
                "feel": {
                    "type": "string",
                    "description": 'How the swing felt — "rushed", "smooth", "decelerated", "powerful"',
                },
            },
        },
    },
    {
        "name": "log_emotional_state",
        "description": (
            "Note the player's emotional or mental state when they express it. "
            'Use only when they actually voice a feeling ("I\'m pissed", "feeling locked in", '
            '"pressure\'s getting to me"), not on every sentence.'
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "state":   {"type": "string", "description": "Free text describing the emotional state"},
                "valence": {"type": "string", "enum": ["positive", "neutral", "negative"]},
            },
            "required": ["state", "valence"],
        },
    },
    {
        "name": "record_swing",
        "description": (
            "Open SwingLab in record mode to capture a swing on camera. Trigger when the player says: "
            '"watch this", "record this", "record my swing", "film this", "get this on camera", '
            "or any phrasing meaning they want the camera to capture their next swing."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "lookup_course",
        "description": "Search for a golf course by name or location. Use when asked about a course not already in context.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'Course name or "name in city" e.g. "Pebble Beach" or "Riverside in Phoenix"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "lookup_hole",
        "description": "Get detailed info about a specific hole at a known course. Returns par and yardage from each tee.",
        "input_schema": {
            "type": "object",
            "properties": {
                "course_id":   {"type": "string"},
                "hole_number": {"type": "number", "minimum": 1, "maximum": 18},
                "tee_name":    {"type": "string", "description": "Optional. Defaults to first available tee."},
            },
            "required": ["course_id", "hole_number"],
        },
    },
]

# ── UI tool names — handled locally, not bridged to Vercel ───────────────────
UI_TOOLS = {"open_smartvision", "open_smartfinder", "open_swinglab", "record_swing"}

# ── Persist tools — dispatched to the CLIENT as tool_actions so the RN
# handleToolAction persists them to roundStore + CNS (scorecard, shot log,
# emotional log). 2026-06-23: these were wrongly routed server-side (just
# console.log'd in /api/pipecat-tool), so the caddie SAID "shot logged" on the
# live-voice path while the scorecard/CNS got NOTHING. They carry their args to
# the client exactly like UI tools; the server returns a synthetic confirmation
# to Claude's agentic loop. lookup_course/lookup_hole stay server-routed (real fetch).
PERSIST_TOOLS = {"log_shot", "log_score", "log_emotional_state"}

# ── Tool handler registry ────────────────────────────────────────────────────

async def handle_tool_call(tool_name: str, tool_input: dict, session_ctx: dict, push_ui_event) -> str:
    """
    Routes a tool call from Claude to either:
      - push_ui_event(name, data) for UI tools (fires a WebSocket msg to React Native)
      - Vercel /api/pipecat/tool for data-mutation tools
    Returns a string result for the Anthropic tool_result message.
    """
    if tool_name in UI_TOOLS:
        await push_ui_event(tool_name, tool_input)
        return f"Opened {tool_name.replace('_', ' ')}."

    vercel_url = os.environ.get("VERCEL_API_URL", "")
    if not vercel_url:
        return f"Tool {tool_name} acknowledged (VERCEL_API_URL not configured)."

    payload = {
        "tool": tool_name,
        "args": tool_input,
        "sessionId": session_ctx.get("sessionId"),
        "playerId": session_ctx.get("player", {}).get("id"),
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{vercel_url}/api/pipecat/tool",
                json=payload,
                headers={"x-pipecat-secret": os.environ.get("SESSION_SECRET", "")},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", "Done.")
    except Exception as e:
        # Don't crash the pipeline on tool failure — Kevin acknowledges and moves on
        print(f"[pipecat-tool] {tool_name} bridge error: {e}")
        return f"Got it — {tool_name} noted."
