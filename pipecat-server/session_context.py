"""
Per-session context manager for Pipecat.

React Native pushes a `context` message on WebSocket open, then delta
messages as round state / GPS changes. This module holds and merges that
state so build_kevin_system() always has the latest snapshot.
"""

import json
from typing import Any


class SessionContext:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self._ctx: dict = {
            "player": {},
            "round": {"active": False},
            "gps": {},
            "bag": {"club_distances": {}},
            "settings": {"trustLevel": 2, "language": "en"},
        }

    def apply(self, message: dict) -> None:
        """Merge a context push or delta from React Native."""
        msg_type = message.get("type")

        if msg_type == "context":
            # Full snapshot on session open
            for key in ("player", "round", "gps", "bag", "settings"):
                if key in message:
                    self._ctx[key] = {**self._ctx.get(key, {}), **message[key]}

        elif msg_type == "gps_update":
            self._ctx["gps"] = {**self._ctx.get("gps", {}), **message.get("gps", {})}

        elif msg_type == "hole_transition":
            self._ctx["round"]["currentHole"] = message.get("hole")
            self._ctx["round"]["holePar"] = message.get("par")
            self._ctx["round"]["holeYardage"] = message.get("yardage")

        elif msg_type == "round_end":
            self._ctx["round"]["active"] = False

    def snapshot(self) -> dict:
        return dict(self._ctx)

    @property
    def session_id_str(self) -> str:
        return self.session_id

    def to_system_extra(self) -> str:
        """Extra live context lines injected after the base system prompt."""
        gps = self._ctx.get("gps", {})
        rnd = self._ctx.get("round", {})
        lines = []

        if gps.get("lat") and gps.get("lng"):
            lines.append(f"GPS: {gps['lat']:.5f}, {gps['lng']:.5f}")

        hole = rnd.get("currentHole")
        par = rnd.get("holePar")
        yardage = rnd.get("holeYardage")
        if hole:
            hole_line = f"Current hole: {hole}"
            if par:
                hole_line += f" (par {par}"
                if yardage:
                    hole_line += f", {yardage}y"
                hole_line += ")"
            lines.append(hole_line)

        return "\n".join(lines)
