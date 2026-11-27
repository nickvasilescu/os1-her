"""Phone notifications through the self-hosted ntfy on the home server (tailnet only).

Set UAOS1_NTFY_URL (e.g. http://127.0.0.1:2586) and UAOS1_NTFY_TOPIC (a long random name) to turn
it on; the phone subscribes to the same topic in the ntfy app. Tapping a notification opens UAOS1
on the right screen through the uaos1:// deep link.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("os1.notify")

_sent: set[tuple[str, str]] = set()
_transport: httpx.AsyncBaseTransport | None = None  # tests


def enabled() -> bool:
    return bool(os.environ.get("UAOS1_NTFY_URL") and os.environ.get("UAOS1_NTFY_TOPIC"))


async def send(title: str, body: str, *, surface: str = "conversation", priority: int = 3, tags: str = "") -> bool:
    if not enabled():
        return False
    url = f"{os.environ['UAOS1_NTFY_URL'].rstrip('/')}/{os.environ['UAOS1_NTFY_TOPIC']}"
    headers = {
        # ntfy reads these as plain header values; keep them ASCII-safe.
        "Title": title.encode("ascii", "replace").decode()[:120],
        "Priority": str(priority),
        "Click": f"uaos1://open?surface={surface}",
    }
    if tags:
        headers["Tags"] = tags
    try:
        async with httpx.AsyncClient(timeout=6.0, transport=_transport) as c:
            r = await c.post(url, content=body.encode()[:1000], headers=headers)
        return r.status_code < 300
    except httpx.HTTPError as exc:
        log.warning("ntfy send failed: %s", exc)
        return False


def fire(title: str, body: str, *, key: tuple[str, str] | None = None, **kw: Any) -> None:
    """Send without blocking the caller; `key` de-duplicates (e.g. one 'done' per run)."""
    if not enabled():
        return
    if key is not None:
        if key in _sent:
            return
        _sent.add(key)
        if len(_sent) > 500:
            _sent.clear()
    asyncio.get_running_loop().create_task(send(title, body, **kw))


def run_changed(item: dict[str, Any]) -> None:
    status, label, rid = item.get("status"), str(item.get("label") or "Atlas task"), str(item.get("id"))
    if status == "waiting":
        fire("Atlas needs your OK", label, key=(rid, status), surface="atlas", priority=4, tags="raised_hand")
    elif status == "done":
        fire("Atlas finished", label, key=(rid, status), surface="atlas", tags="white_check_mark")
    elif status == "error":
        fire("Atlas run failed", label, key=(rid, status), surface="atlas", priority=4, tags="warning")


def approval_needed(action_id: str, title: str, lines: list[str]) -> None:
    body = "\n".join([title, *lines[:3]])
    fire("Samantha needs your OK", body, key=(action_id, "pending"), surface="conversation", priority=4, tags="raised_hand")
