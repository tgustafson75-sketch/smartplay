"""Kevin's system prompt for the Pipecat pipeline."""


def build_kevin_system(context: dict) -> str:
    player = context.get("player", {})
    round_ctx = context.get("round", {})
    bag = context.get("bag", {})

    name = player.get("name", "golfer")
    handicap = player.get("handicap")
    dominant_miss = player.get("dominantMiss")
    personality = player.get("caddiePersonality", "kevin")
    trust_level = player.get("trustLevel", 2)

    caddie_name = {
        "kevin": "Kevin",
        "serena": "Serena",
        "harry": "Harry",
        "tank": "Tank",
    }.get(personality, "Kevin")

    round_active = round_ctx.get("active", False)
    current_hole = round_ctx.get("currentHole")
    course_name = round_ctx.get("courseName")
    mental_state = round_ctx.get("mentalState")
    goal = round_ctx.get("goal")

    handicap_line = f"Handicap: {handicap}." if handicap is not None else ""
    miss_line = f"Dominant miss: {dominant_miss}." if dominant_miss else ""
    bag_summary = _bag_summary(bag.get("club_distances", {}))

    round_section = ""
    if round_active and course_name:
        hole_line = f"Currently on hole {current_hole}." if current_hole else ""
        mental_line = f"Mental state going in: {mental_state}." if mental_state else ""
        goal_line = f"Round goal: {goal}." if goal else ""
        round_section = f"""
--- ACTIVE ROUND ---
Course: {course_name}
{hole_line}
{mental_line}
{goal_line}
""".strip()

    prompt = f"""You are {caddie_name}, an expert AI golf caddie built into SmartPlay Caddie. \
You are talking to {name} through their earbuds in real time — keep responses short and spoken-word friendly. \
No markdown, no bullet lists, no headers. Talk like a caddie, not a website.

{handicap_line} {miss_line}

{bag_summary}

{round_section}

Trust level: {trust_level}/4. \
{"Be proactive — offer reads, distances, and strategy without being asked." if trust_level >= 3 else "Be helpful when asked; stay concise."}

When you need to log a shot, score, or emotion, or look something up, call the right tool. \
Don't narrate that you're calling a tool — just act. \
When a player asks "what's the play" or "what should I hit", give a direct recommendation: \
club, shape, target. One sentence, confident, like a real caddie.

Keep every spoken response under 30 words unless the player specifically asks for detail."""

    return prompt.strip()


def _bag_summary(distances: dict) -> str:
    if not distances:
        return ""
    lines = []
    for club, dist in list(distances.items())[:10]:
        lines.append(f"{club}: {dist}y")
    if not lines:
        return ""
    return "Bag distances: " + ", ".join(lines) + "."
