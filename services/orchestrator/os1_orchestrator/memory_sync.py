"""One memory for Samantha and Atlas.

What Samantha remembers is mirrored into Atlas as memories of a "Samantha" agent (created on first
use), so every Atlas agent can find it with memory.search; forgetting it in UAOS1 deletes the mirror
too. Atlas agents' own memories are shown in UAOS1's Memory screen alongside hers.

Off when UAOS1_MEMORY_SYNC=0. Failures never block saving or forgetting locally.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from .uao import client as uao

log = logging.getLogger("os1.memory_sync")

AGENT_NAME = "Samantha"
AGENT = {
    "name": AGENT_NAME,
    "glyph": "✦",
    "accent": "#cd4f33",
    "instructions": (
        "You are Samantha, the voice of UAOS1. Your memory holds what the user told you out loud: "
        "people, places, things they love, things that hurt, and promises. Use it to help other agents "
        "understand the user. Be warm and brief."
    ),
    "model": "auto/best-chat",
    "temperature": 0.7,
    "tools": ["memory.save", "memory.search", "time.now"],
}
LABELS = {
    "people": "Person",
    "places": "Place",
    "things_you_love": "Loves",
    "things_that_hurt": "Hurts",
    "promises": "Promise",
}


def enabled() -> bool:
    return os.environ.get("UAOS1_MEMORY_SYNC", "1") != "0"


class MemorySync:
    def __init__(self, state_dir: Path) -> None:
        self.map_path = state_dir / "atlas-memory-map.json"
        self.agent_id: str | None = None

    def _load(self) -> dict[str, str]:
        try:
            return json.loads(self.map_path.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self, m: dict[str, str]) -> None:
        self.map_path.write_text(json.dumps(m))

    async def _agent(self) -> str | None:
        if self.agent_id:
            return self.agent_id
        base, headers = uao.atlas_base(), uao.atlas_headers()
        async with uao.make_client() as c:
            r = await c.get(f"{base}/agents", headers=headers)
            r.raise_for_status()
            items = r.json().get("items", []) if isinstance(r.json(), dict) else r.json()
            found = next((a for a in items if a.get("name") == AGENT_NAME), None)
            if found is None:
                r = await c.post(f"{base}/agents", headers=headers, json=AGENT)
                r.raise_for_status()
                body = r.json()
                found = body.get("agent", body)
        self.agent_id = str(found["id"])
        return self.agent_id

    @staticmethod
    def text_for(mem: dict[str, Any]) -> str:
        label = LABELS.get(str(mem.get("category")), "Note")
        text = f"{label}: {mem.get('summary', '').strip()}"
        if mem.get("detail"):
            text += f" — {str(mem['detail']).strip()}"
        return text[:900]

    async def added(self, mem: dict[str, Any]) -> None:
        if not enabled():
            return
        try:
            agent = await self._agent()
            async with uao.make_client() as c:
                r = await c.post(
                    f"{uao.atlas_base()}/agents/{agent}/memory", headers=uao.atlas_headers(), json={"text": self.text_for(mem)}
                )
                r.raise_for_status()
            body = r.json()
            atlas_id = (body.get("memory") or body).get("id") if isinstance(body, dict) else None
            if atlas_id:
                m = self._load()
                m[str(mem["id"])] = str(atlas_id)
                self._save(m)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not mirror memory to Atlas: %s", exc)

    async def forgotten(self, rows: list[dict[str, Any]]) -> None:
        if not enabled() or not rows:
            return
        m = self._load()
        try:
            agent = await self._agent()
            async with uao.make_client() as c:
                for row in rows:
                    atlas_id = m.pop(str(row.get("id")), None)
                    if atlas_id:
                        await c.delete(f"{uao.atlas_base()}/agents/{agent}/memory/{atlas_id}", headers=uao.atlas_headers())
        except Exception as exc:  # noqa: BLE001
            log.warning("could not forget memory in Atlas: %s", exc)
        finally:
            self._save(m)

    async def from_atlas(self) -> list[dict[str, Any]]:
        """Atlas agents' own memories (not Samantha's mirrors), newest first."""
        if not enabled():
            return []
        try:
            async with uao.make_client(read_timeout=6.0) as c:
                r = await c.get(f"{uao.atlas_base()}/memory", headers=uao.atlas_headers())
                r.raise_for_status()
            items = r.json().get("items", [])
        except Exception as exc:  # noqa: BLE001
            log.info("Atlas memory unavailable: %s", exc)
            return []
        return [
            {"id": i.get("id"), "text": i.get("text", ""), "agentName": i.get("agentName", ""), "createdAt": i.get("createdAt")}
            for i in items
            if i.get("agentName") != AGENT_NAME
        ][:60]
