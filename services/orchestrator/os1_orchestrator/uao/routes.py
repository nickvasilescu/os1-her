"""/os1/uao/* routes: Apps & services catalogue and a strict, allowlisted Atlas proxy.

Atlas runs stream as Server-Sent Events. We pass the bytes straight through to the renderer and
also mirror run state into the OS1 work list, so Home/Swarm/presence know an agent is busy.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .. import notify
from . import client as uao

log = logging.getLogger("os1.uao")

SEG = r"[A-Za-z0-9_\-.~%]+"

# Every Atlas call the renderer may make. Anything else (e.g. DELETE /account/data) is refused.
ATLAS_ALLOW: dict[str, list[str]] = {
    "GET": [
        r"me", r"models", r"agents", rf"agents/{SEG}", r"workspaces", rf"workspaces/{SEG}",
        rf"workspaces/{SEG}/history", r"threads", rf"threads/{SEG}", r"activity", rf"activity/{SEG}",
        r"memory", r"approvals", r"schedules", r"search",
    ],
    "POST": [
        r"agents", rf"agents/{SEG}/memory", r"workspaces", rf"workspaces/{SEG}/restore",
        rf"threads/{SEG}/restore", r"schedules", rf"schedules/{SEG}/run",
    ],
    "PATCH": [rf"agents/{SEG}", rf"threads/{SEG}", rf"schedules/{SEG}"],
    "PUT": [rf"workspaces/{SEG}/files"],
    "DELETE": [
        rf"agents/{SEG}", rf"agents/{SEG}/memory/{SEG}", rf"workspaces/{SEG}",
        rf"workspaces/{SEG}/files/{SEG}", rf"threads/{SEG}", rf"schedules/{SEG}",
    ],
}
ATLAS_STREAM = [r"run", rf"run/{SEG}/approval"]

APPS_CACHE: dict[str, Any] = {"apps": [], "fetchedAt": 0.0}


def atlas_path_allowed(method: str, path: str) -> bool:
    return any(re.fullmatch(p, path) for p in ATLAS_ALLOW.get(method.upper(), []))


def _quote_path(path: str) -> str:
    return "/".join(quote(seg, safe="") for seg in path.split("/"))


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9'\s]+", " ", text.lower())).strip()


def short_names(name: str, all_names: list[str] | None = None) -> list[str]:
    """'Jellyfin & Tony's Place Media' -> ['jellyfin & tony's place media', 'jellyfin']."""
    full = _norm(name)
    out = [full]
    head = re.split(r"\s+(?:&|·|—|-|\(|×)\s*|\s*\(", name, maxsplit=1)[0]
    if _norm(head) and _norm(head) not in out:
        out.append(_norm(head))
    first = full.split(" ")[0] if full else ""
    if len(first) >= 3 and first not in out:
        others = [_norm(n).split(" ")[0] for n in (all_names or []) if _norm(n) != full]
        if first not in others:
            out.append(first)
    return out


def app_pills() -> list[dict[str, Any]]:
    """Speakable 'Open <name>' pills for every catalogued app (shown while Apps & services is up)."""
    names = [a["name"] for a in APPS_CACHE["apps"]]
    pills = [
        {
            "phrase": f"Open {a['name']}",
            "aliases": [f"open {n}" for n in short_names(a["name"], names)[1:]],
            "target": "uao_app",
            "action": a["id"],
        }
        for a in APPS_CACHE["apps"]
    ]
    pills.append({"phrase": "Refresh the apps", "target": "uao", "action": "refresh_apps"})
    return pills


OPEN_VERBS = re.compile(r"^(?:please\s+)?(?:open|launch|show me|show|go to|take me to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+app)?$")


def match_app_utterance(utterance: str) -> dict[str, Any] | None:
    """Global fallback: 'open jellyfin' / 'launch n8n' resolves to an app from any surface."""
    m = OPEN_VERBS.match(_norm(utterance))
    if not m:
        return None
    target = m.group(1).strip()
    names = [a["name"] for a in APPS_CACHE["apps"]]
    for a in APPS_CACHE["apps"]:
        if target in short_names(a["name"], names):
            return a
    # Any unique app whose name contains every spoken word ("guacamole" -> "Apache Guacamole").
    words = set(target.split())
    hits = [a for a in APPS_CACHE["apps"] if words and words <= set(_norm(a["name"]).split())]
    return hits[0] if len(hits) == 1 else None


def find_app(app_id_or_name: str) -> dict[str, Any] | None:
    key = app_id_or_name.strip().lower()
    for a in APPS_CACHE["apps"]:
        if key in (a["id"].lower(), a["appId"].lower(), a["name"].lower()):
            return a
    return None


async def fetch_apps() -> dict[str, Any]:
    base = uao.uao_base()
    uao.assert_allowed_base(base)
    async with uao.make_client() as c:
        resp = await c.get(f"{base}/api/homarr/apps", headers=uao.uao_headers())
    if resp.status_code >= 400:
        raise HTTPException(502, f"UAO apps catalogue returned {resp.status_code}")
    data = resp.json()
    apps = [uao.normalize_app(a) for a in data.get("apps", []) if isinstance(a, dict)]
    dashboard = str(data.get("dashboardUrl") or "")
    result = {
        "ok": True,
        "dashboardUrl": dashboard if uao.is_allowed_url(dashboard) else "",
        "boards": data.get("boards") or [],
        "count": len(apps),
        "apps": apps,
        "fetchedAt": time.time(),
        "source": base,
    }
    APPS_CACHE.update(apps=apps, fetchedAt=result["fetchedAt"])
    return result


class RunMirror:
    """Parses Atlas SSE frames (start/tool_start/step/delta/paused/done/error) into OS1 work items."""

    def __init__(self, on_change: Callable[[dict[str, Any]], Any], label: str) -> None:
        self.on_change = on_change
        self.label = label
        self.buf = b""
        self.run_id: str | None = None

    async def feed(self, chunk: bytes) -> None:
        self.buf += chunk.replace(b"\r\n", b"\n")
        while b"\n\n" in self.buf:
            frame, self.buf = self.buf.split(b"\n\n", 1)
            data = b"\n".join(line[5:].lstrip() for line in frame.split(b"\n") if line.startswith(b"data:"))
            if not data:
                continue
            try:
                ev = json.loads(data)
            except ValueError:
                continue
            await self._apply(ev)

    async def _apply(self, ev: dict[str, Any]) -> None:
        kind = ev.get("type")
        run = ev.get("run") if isinstance(ev.get("run"), dict) else {}
        if kind == "start":
            self.run_id = str(run.get("id") or ev.get("runId") or self.run_id or "")
            self.label = self.label or str(run.get("task") or "Atlas task")
            await self._emit("running")
        elif kind == "paused":
            self.run_id = str(run.get("id") or self.run_id or "")
            await self._emit("waiting")
        elif kind == "done":
            await self._emit("done")
        elif kind == "error":
            await self._emit("error")

    async def _emit(self, status: str) -> None:
        if self.run_id:
            res = self.on_change({"id": f"atlas:{self.run_id}", "label": self.label[:80], "status": status})
            if hasattr(res, "__await__"):
                await res


def build_router(hub: Any, dependencies: list[Any]) -> APIRouter:
    router = APIRouter(prefix="/os1/uao", dependencies=dependencies)

    async def upsert_run(item: dict[str, Any], replaces: str | None = None) -> None:
        notify.run_changed(item)
        drop = {item["id"], replaces}
        runs = [r for r in hub.runs if r.get("id") not in drop]
        runs.insert(0, item)
        await hub.set_runs(runs[:12])

    @router.get("/config")
    def config() -> dict[str, Any]:
        return {
            "uaoBase": uao.uao_base(),
            "atlasBase": uao.atlas_base(),
            "tailnetSuffixes": uao.tailnet_suffixes(),
            "uaoTokenSet": bool(uao.uao_headers()),
        }

    @router.get("/apps")
    async def apps() -> dict[str, Any]:
        try:
            return await fetch_apps()
        except uao.UaoConfigError as exc:
            raise HTTPException(400, str(exc)) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"UAO server unreachable: {exc.__class__.__name__}") from exc

    @router.get("/sunshine")
    async def sunshine() -> dict[str, Any]:
        """Sunshine host status (for the Moonlight button): GET http://<host>:47989/serverinfo."""
        host = os.environ.get("SUNSHINE_HOST", "server." + uao.DEFAULT_TAILNET).strip()
        url = f"http://{host}:47989/serverinfo"
        if not uao.is_allowed_url(url):
            raise HTTPException(400, "SUNSHINE_HOST must be a tailnet or LAN host")
        try:
            async with uao.make_client(read_timeout=6.0) as c:
                resp = await c.get(url)
        except httpx.HTTPError:
            return {"ok": False, "host": host, "reachable": False}
        def tag(name: str) -> str:
            m = re.search(rf"<{name}>([^<]*)</{name}>", resp.text)
            return m.group(1) if m else ""
        state = tag("state")
        return {
            "ok": resp.status_code == 200,
            "host": host,
            "reachable": resp.status_code == 200,
            "hostname": tag("hostname"),
            "version": tag("appversion"),
            "streaming": state.endswith("BUSY"),
            "state": state,
            "app": os.environ.get("SUNSHINE_APP", "Desktop"),
        }

    @router.get("/status")
    async def status() -> dict[str, Any]:
        """One light per service UAOS1 depends on, checked in parallel (green / amber / red)."""


        async def probe(url: str, headers: dict[str, str] | None = None, ok_text: str | None = None) -> tuple[bool, str]:
            try:
                async with uao.make_client(read_timeout=5.0) as c:
                    r = await c.get(url, headers=headers or {})
            except httpx.HTTPError as exc:
                return False, type(exc).__name__
            good = r.status_code < 400 and (ok_text is None or ok_text in r.text)
            return good, f"HTTP {r.status_code}"

        async def livekit() -> dict[str, Any]:
            url = os.environ.get("LIVEKIT_URL", "")
            if not url:
                return {"state": "off", "detail": "Not set up on this server"}
            ok, detail = await probe(url.replace("wss://", "https://").replace("ws://", "http://"), ok_text="OK")
            return {"state": "ok" if ok else "down", "detail": "Ready" if ok else detail}

        async def voice() -> dict[str, Any]:
            if not os.environ.get("LIVEKIT_URL"):
                return {"state": "off", "detail": "Voice is off"}
            proc = await asyncio.create_subprocess_exec(
                "pgrep", "-f", "os1_voice[.]worker", stdout=asyncio.subprocess.DEVNULL
            )
            running = await proc.wait() == 0
            return {"state": "ok" if running else "down", "detail": "Samantha is listening" if running else "Worker not running"}

        async def atlas() -> dict[str, Any]:
            ok, detail = await probe(f"{uao.atlas_base()}/agents", uao.atlas_headers())
            return {"state": "ok" if ok else "down", "detail": "Reachable" if ok else detail}

        async def services() -> dict[str, Any]:
            ok, detail = await probe(f"{uao.uao_base()}/api/homarr/apps", uao.uao_headers())
            return {"state": "ok" if ok else "down", "detail": f"{len(APPS_CACHE.get('apps') or [])} apps" if ok else detail}

        async def composio() -> dict[str, Any]:
            if not os.environ.get("COMPOSIO_API_KEY"):
                return {"state": "off", "detail": "No API key"}
            return {"state": "ok", "detail": "Key set"}

        async def sunshine_() -> dict[str, Any]:
            s = await sunshine()
            if not s.get("reachable"):
                return {"state": "down", "detail": "Not reachable"}
            return {"state": "ok", "detail": "Streaming now" if s.get("streaming") else "Ready to stream"}

        async def cloud() -> dict[str, Any]:
            url = os.environ.get("OS1_HER_COMPUTER_URL", "")
            if not url:
                return {"state": "off", "detail": "Not set"}
            ok, detail = await probe(url)
            return {"state": "ok" if ok else "down", "detail": "Reachable" if ok else detail}

        async def ntfy() -> dict[str, Any]:
            url = os.environ.get("UAOS1_NTFY_URL", "")
            if not url:
                return {"state": "off", "detail": "Not set up"}
            ok, detail = await probe(f"{url.rstrip('/')}/v1/health", ok_text="healthy")
            return {"state": "ok" if ok else "down", "detail": "Ready" if ok else detail}

        checks = {
            "Voice server": livekit(),
            "Samantha": voice(),
            "Atlas": atlas(),
            "Services": services(),
            "Composio": composio(),
            "Sunshine": sunshine_(),
            "Cloud desktop": cloud(),
            "Notifications": ntfy(),
        }
        results = await asyncio.gather(*checks.values(), return_exceptions=True)
        items = []
        for name, res in zip(checks, results, strict=True):
            if isinstance(res, BaseException):
                res = {"state": "down", "detail": type(res).__name__}
            items.append({"name": name, **res})
        return {"items": items, "checkedAt": int(time.time() * 1000)}

    @router.post("/apps/{app_id}/open")
    async def open_app(app_id: str) -> dict[str, Any]:
        app_ = find_app(app_id)
        if app_ is None:
            raise HTTPException(404, "unknown app")
        await hub.set_surface("apps")
        await hub.broadcast({"type": "open_app", "appId": app_["id"]})
        return {"ok": True, "app": app_}

    async def _atlas_stream(path: str, body: dict[str, Any], label: str, replaces: str | None = None) -> Response:
        base = uao.atlas_base()
        uao.assert_allowed_base(base)
        c = uao.make_client(read_timeout=None)
        req = c.build_request(
            "POST",
            f"{base}/{_quote_path(path)}",
            json=body,
            headers={**uao.atlas_headers(), "accept": "text/event-stream"},
        )
        try:
            resp = await c.send(req, stream=True)
        except httpx.HTTPError as exc:
            await c.aclose()
            raise HTTPException(502, f"Atlas unreachable: {exc.__class__.__name__}") from exc
        if resp.status_code >= 400:
            text = (await resp.aread()).decode(errors="replace")[:500]
            await resp.aclose()
            await c.aclose()
            return JSONResponse({"error": text or f"Atlas returned {resp.status_code}"}, status_code=resp.status_code)

        mirror = RunMirror(lambda item: upsert_run(item, replaces), label)

        async def chunks() -> AsyncIterator[bytes]:
            if resp.is_stream_consumed:  # some transports pre-buffer the body
                yield resp.content
                return
            async for chunk in resp.aiter_raw():
                yield chunk

        async def gen() -> AsyncIterator[bytes]:
            try:
                async for chunk in chunks():
                    yield chunk
                    try:
                        await mirror.feed(chunk)
                    except Exception as exc:  # noqa: BLE001 - mirroring must never break the stream
                        log.debug("atlas mirror failed: %s", exc)
            finally:
                await resp.aclose()
                await c.aclose()

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.post("/atlas/run")
    async def atlas_run(request: Request) -> Response:
        body = await request.json()
        if not isinstance(body, dict) or not str(body.get("task") or "").strip() or not body.get("agentId"):
            raise HTTPException(422, "agentId and task are required")
        label = str(body.pop("_label", "") or body.get("task") or "")
        return await _atlas_stream("run", body, label)

    @router.post("/atlas/run/{run_id}/approval")
    async def atlas_approval(run_id: str, request: Request) -> Response:
        body = await request.json()
        if not isinstance(body, dict) or "approved" not in body or not body.get("callId"):
            raise HTTPException(422, "callId and approved are required")
        body = {"callId": str(body["callId"]), "approved": bool(body["approved"])}
        parent = f"atlas:{run_id}"
        prior = next((r.get("label") for r in hub.runs if r.get("id") == parent), None)
        label = prior or ("Atlas · " + ("approved" if body["approved"] else "denied"))
        return await _atlas_stream(f"run/{run_id}/approval", body, label, replaces=parent)

    @router.api_route("/atlas/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
    async def atlas_proxy(path: str, request: Request) -> Response:
        method = request.method.upper()
        path = path.strip("/")
        if not atlas_path_allowed(method, path):
            raise HTTPException(403, f"{method} /{path} is not allowed through OS1")
        base = uao.atlas_base()
        try:
            uao.assert_allowed_base(base)
        except uao.UaoConfigError as exc:
            raise HTTPException(400, str(exc)) from exc
        url = f"{base}/{_quote_path(path)}"
        content = await request.body() if method in ("POST", "PATCH", "PUT") else None
        headers = {**uao.atlas_headers(), "accept": "application/json"}
        if content:
            headers["content-type"] = "application/json"
        try:
            async with uao.make_client() as c:
                resp = await c.request(method, url, params=dict(request.query_params), content=content, headers=headers)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Atlas unreachable: {exc.__class__.__name__}") from exc
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "application/json"),
        )

    return router
