"""
Single-turn Claude handler for the Pipecat Phase 2 text path.

No Pipecat pipeline — just Anthropic SDK directly. Used by POST /turn.
The Pipecat audio pipeline (Phase 3) uses kevin_pipeline.py instead.

Flow:
  user transcript + history + context
    → build system prompt from context
    → Anthropic claude-sonnet-4-6 with all 9 KEVIN_TOOLS
    → agentic loop: resolve tool calls until text response
      - UI tools  → added to tool_actions list (dispatched client-side)
      - data tools → bridged to Vercel /api/pipecat-tool → result fed back to Claude
    → return { response_text, tool_actions, updated_history }
"""

import os
from anthropic import AsyncAnthropic
from kevin_prompt import build_kevin_system
from kevin_tools import KEVIN_TOOLS, UI_TOOLS, PERSIST_TOOLS
import httpx

anthropic = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

MAX_TOOL_ROUNDS = 4  # prevent runaway loops

# ─── History conversion ──────────────────────────────────────────────────────

def _to_anthropic_history(history: list[dict]) -> list[dict]:
    """
    Convert simplified { role, content: string } history to Anthropic format.
    Anthropic requires assistant content to be a list of content blocks.
    """
    out = []
    for msg in history:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            out.append({"role": "user", "content": str(content)})
        elif role == "assistant":
            out.append({"role": "assistant", "content": [{"type": "text", "text": str(content)}]})
    return out


def _extract_simple_history(messages: list[dict]) -> list[dict]:
    """Collapse Anthropic messages back to simplified { role, content: str } pairs."""
    out = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        if isinstance(content, str):
            out.append({"role": role, "content": content})
        elif isinstance(content, list):
            # grab first text block
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    out.append({"role": role, "content": block["text"]})
                    break
    return out


# ─── Vercel bridge ───────────────────────────────────────────────────────────

async def _call_vercel_tool(tool_name: str, tool_input: dict, session_id: str | None) -> str:
    vercel_url = os.environ.get("VERCEL_API_URL", "")
    if not vercel_url:
        return f"{tool_name} acknowledged (server not configured)."
    payload = {
        "tool": tool_name,
        "args": tool_input,
        "sessionId": session_id,
    }
    secret = os.environ.get("SESSION_SECRET", "")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{vercel_url}/api/pipecat-tool",
                json=payload,
                headers={"x-pipecat-secret": secret},
            )
            resp.raise_for_status()
            return resp.json().get("result", "Done.")
    except Exception as e:
        print(f"[turn] tool bridge {tool_name} error: {e}")
        return "Got it."


# ─── Main handler ─────────────────────────────────────────────────────────────

async def handle_turn(
    *,
    text: str,
    history: list[dict],
    context: dict,
    session_id: str | None = None,
) -> dict:
    """
    Process one user turn with Claude.

    Returns:
      {
        "response_text": str,
        "tool_actions": [{"type": tool_name, **args}],  # UI tools only
        "updated_history": [{"role", "content"}],
      }
    """
    system = build_kevin_system(context)
    live_extra = _build_live_context(context)
    if live_extra:
        system += "\n\n" + live_extra

    # Build Anthropic messages: prior history + new user message
    messages = _to_anthropic_history(history)
    messages.append({"role": "user", "content": text})

    tool_actions: list[dict] = []
    response_text = ""

    for _round in range(MAX_TOOL_ROUNDS):
        resp = await anthropic.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=256,
            system=system,
            tools=KEVIN_TOOLS,
            messages=messages,
        )

        # Build assistant turn from response content
        assistant_content = []
        pending_tool_uses = []

        for block in resp.content:
            if block.type == "text":
                response_text = block.text
                assistant_content.append({"type": "text", "text": block.text})

            elif block.type == "tool_use":
                assistant_content.append({
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })
                pending_tool_uses.append(block)

        # Append assistant turn with all content blocks
        if assistant_content:
            messages.append({"role": "assistant", "content": assistant_content})

        # No tool calls — done
        if not pending_tool_uses or resp.stop_reason != "tool_use":
            break

        # Resolve each tool call
        tool_results = []
        for tool_use in pending_tool_uses:
            name = tool_use.name
            args = dict(tool_use.input or {})

            if name in UI_TOOLS:
                # Client handles these; add to tool_actions and return a stub result
                tool_actions.append({"type": name, **args})
                result_text = f"Opening {name.replace('_', ' ')}."
            elif name in PERSIST_TOOLS:
                # 2026-06-23 — route to the CLIENT (not Vercel) so handleToolAction
                # persists to roundStore + CNS. Previously these were server-routed
                # and silently dropped: "shot logged" spoken, scorecard got nothing.
                tool_actions.append({"type": name, **args})
                result_text = _persist_ack(name, args)
            else:
                result_text = await _call_vercel_tool(name, args, session_id)

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": result_text,
            })

        # Feed tool results back to Claude
        messages.append({"role": "user", "content": tool_results})
        # Continue loop to get Claude's text response after tool resolution

    # Rebuild simplified history for the client (drop tool_use/tool_result internals)
    updated_history = _extract_simple_history([
        m for m in messages
        if not (isinstance(m.get("content"), list)
                and any(b.get("type") in ("tool_use", "tool_result") for b in m["content"] if isinstance(b, dict)))
    ])

    return {
        "response_text": response_text,
        "tool_actions": tool_actions,
        "updated_history": updated_history,
    }


def _persist_ack(name: str, args: dict) -> str:
    """Synthetic confirmation fed back to Claude's loop after a client-persist tool.
    The actual persistence happens client-side via handleToolAction (tool_actions)."""
    if name == "log_score":
        hole = args.get("hole")
        return f"Score {args.get('score')} logged" + (f" for hole {hole}." if hole else ".")
    if name == "log_shot":
        bits = [f"{k}: {args[k]}" for k in ("club", "direction", "contactQuality", "outcome") if args.get(k)]
        return "Shot logged" + (f" ({', '.join(bits)})." if bits else ".")
    if name == "log_emotional_state":
        return "Noted."
    return f"{name} logged."


def _build_live_context(context: dict) -> str:
    lines = []
    gps = context.get("gps", {})
    rnd = context.get("round", {})
    if gps.get("lat") and gps.get("lng"):
        lines.append(f"GPS: {gps['lat']:.5f}, {gps['lng']:.5f}")
    hole = rnd.get("currentHole")
    par = rnd.get("holePar")
    yardage = rnd.get("holeYardage")
    if hole:
        s = f"Current hole: {hole}"
        if par:
            s += f" (par {par}"
            if yardage:
                s += f", {yardage}y"
            s += ")"
        lines.append(s)
    return "\n".join(lines)
