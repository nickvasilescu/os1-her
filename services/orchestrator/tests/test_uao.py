"""Contract tests for the UAO bridge: Apps & services catalogue and the Atlas proxy (no network)."""

from __future__ import annotations

import importlib
import json

import httpx
import pytest
from fastapi.testclient import TestClient

APPS = {
    "ok": True,
    "dashboardUrl": "https://server.tail85e19.ts.net:8452",
    "boards": [{"id": "b1", "name": "dashboard", "title": "SuperBot × Homarr"}],
    "count": 3,
    "apps": [
        {"id": "app_jf:1", "appId": "app_jf", "name": "Jellyfin & Tony's Place Media", "description": "Media",
         "url": "https://ai-1.tail85e19.ts.net:8096/", "iconUrl": "", "category": "Media", "status": "up",
         "statusCode": 200, "latencyMs": 12},
        {"id": "app_guac:2", "appId": "app_guac", "name": "Apache Guacamole", "description": "Remote desktop",
         "url": "https://server.tail85e19.ts.net:8444/guacamole/", "status": "down", "statusCode": 502},
        {"id": "app_ag:3", "appId": "app_ag", "name": "Google Antigravity (Cloud)", "description": "Cloud IDE",
         "url": "https://antigravity.google.com", "status": "up"},
    ],
}

SSE = (
    b'data: {"type":"start","threadId":"t1","run":{"id":"r1","task":"hi"}}\n\n'
    b'data: {"type":"delta","text":"po"}\n\n'
    b'data: {"type":"delta","text":"ng"}\n\n'
    b'data: {"type":"done","message":{"id":"m1"},"run":{"id":"r1","status":"done"}}\n\n'
)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("OS1_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("OS1_CLIENT_TOKEN", "test-token")
    monkeypatch.setenv("OS1_UAO_PREFETCH", "0")
    monkeypatch.delenv("UAO_API_BASE", raising=False)
    monkeypatch.delenv("ATLAS_API_BASE", raising=False)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path == "/api/homarr/apps":
            return httpx.Response(200, json=APPS)
        if path == "/atlas/api/agents" and request.method == "GET":
            return httpx.Response(200, json={"items": [{"id": "a1", "name": "Scout"}]})
        if path == "/atlas/api/agents" and request.method == "POST":
            return httpx.Response(200, json={"agent": {"id": "sam1", **json.loads(request.content)}})
        if path == "/atlas/api/agents/sam1/memory" and request.method == "POST":
            return httpx.Response(200, json={"memory": {"id": "am1", **json.loads(request.content)}})
        if path == "/atlas/api/agents/sam1/memory/am1" and request.method == "DELETE":
            return httpx.Response(200, json={"ok": True})
        if path == "/atlas/api/memory":
            return httpx.Response(200, json={"items": [
                {"id": "x1", "text": "Prefer primary sources", "agentName": "Scout"},
                {"id": "am1", "text": "Person: mirror", "agentName": "Samantha"},
            ]})
        if path == "/atlas/api/search":
            return httpx.Response(200, json={"q": request.url.params.get("q")})
        if path == "/atlas/api/agents/a1" and request.method == "PATCH":
            return httpx.Response(200, json={"agent": json.loads(request.content)})
        if path == "/serverinfo":
            xml = "<root><hostname>server</hostname><appversion>7.1.431.-1</appversion><state>SUNSHINE_SERVER_BUSY</state></root>"
            return httpx.Response(200, text=xml)
        if path in ("/atlas/api/run", "/atlas/api/run/r1/approval"):
            return httpx.Response(200, content=SSE, headers={"content-type": "text/event-stream"})
        return httpx.Response(404, json={"error": "nope"})

    import os1_orchestrator.app as app_module
    from os1_orchestrator.uao import client as uao_client
    from os1_orchestrator.uao import routes as uao_routes

    importlib.reload(app_module)
    uao_client.set_transport(httpx.MockTransport(handler))
    uao_routes.APPS_CACHE.update(apps=[], fetchedAt=0.0)
    client = TestClient(app_module.app, headers={"Authorization": "Bearer test-token"})
    yield client, seen, app_module
    uao_client.set_transport(None)


def test_requires_token(env):
    client, _, _ = env
    assert client.get("/os1/uao/apps", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_apps_catalogue_normalised(env):
    client, _, _ = env
    data = client.get("/os1/uao/apps").json()
    assert data["count"] == 3 and data["dashboardUrl"].endswith(":8452")
    by = {a["appId"]: a for a in data["apps"]}
    assert by["app_jf"]["status"] == "up" and by["app_jf"]["latencyMs"] == 12 and by["app_jf"]["embeddable"]
    assert by["app_guac"]["status"] == "down"
    # Public (non-tailnet) apps never load inside OS1; they open in the browser.
    assert by["app_ag"]["embeddable"] is False


def test_refuses_public_upstream(env, monkeypatch):
    client, seen, _ = env
    monkeypatch.setenv("UAO_API_BASE", "https://agents.tonysplace.co.uk")
    assert client.get("/os1/uao/apps").status_code == 400
    assert not seen


def test_voice_opens_apps_from_any_surface(env):
    client, _, _ = env
    client.get("/os1/uao/apps")
    for phrase, app_id in [("open jellyfin", "app_jf:1"), ("launch the guacamole", "app_guac:2")]:
        res = client.post("/os1/actions", json={"phrase": phrase}).json()
        assert res["matched"] and res["target"] == "uao_app" and res["action"] == app_id
    assert client.get("/os1/state").json()["activeSurface"] == "apps"
    assert client.post("/os1/actions", json={"phrase": "open the fridge"}).json()["matched"] is False


def test_apps_surface_pills_visible(env):
    client, _, _ = env
    client.get("/os1/uao/apps")
    client.post("/os1/actions", json={"phrase": "show apps and services"})
    phrases = client.get("/os1/state").json()["visiblePhrases"]
    assert "Open Apache Guacamole" in phrases and "Refresh the apps" in phrases


def test_atlas_proxy_allowlist(env):
    client, seen, _ = env
    assert client.get("/os1/uao/atlas/agents").json()["items"][0]["name"] == "Scout"
    assert client.get("/os1/uao/atlas/search", params={"q": "spec"}).json() == {"q": "spec"}
    patched = client.patch("/os1/uao/atlas/agents/a1", json={"name": "Scout 2"}).json()
    assert patched["agent"]["name"] == "Scout 2"
    n = len(seen)
    for method, path in [("DELETE", "account/data"), ("POST", "threads"), ("GET", "../admin"), ("PUT", "agents/a1")]:
        assert client.request(method, f"/os1/uao/atlas/{path}").status_code in (403, 404)
    assert len(seen) == n  # refused calls never reach Atlas


def test_atlas_run_streams_and_mirrors_work(env):
    client, seen, _ = env
    with client.stream("POST", "/os1/uao/atlas/run", json={"agentId": "a1", "task": "hi", "_label": "Scout · hi"}) as r:
        body = b"".join(r.iter_raw())
    assert r.headers["content-type"].startswith("text/event-stream")
    assert body == SSE
    sent = json.loads(seen[-1].content)
    assert sent == {"agentId": "a1", "task": "hi"}  # private _label is not forwarded
    runs = client.get("/os1/state").json()["runs"]
    assert runs[0] == {"id": "atlas:r1", "label": "Scout · hi", "status": "done"}


def test_atlas_run_validation_and_approval(env):
    client, seen, _ = env
    assert client.post("/os1/uao/atlas/run", json={"agentId": "a1"}).status_code == 422
    assert client.post("/os1/uao/atlas/run/r1/approval", json={"approved": True}).status_code == 422
    with client.stream("POST", "/os1/uao/atlas/run/r1/approval", json={"callId": "c1", "approved": 1, "x": 2}) as r:
        b"".join(r.iter_raw())
    assert json.loads(seen[-1].content) == {"callId": "c1", "approved": True}


def test_approval_continuation_replaces_waiting_run(env):
    client, _, app_module = env
    app_module.hub.runs = [{"id": "atlas:r1", "label": "Builder · write it", "status": "waiting"}]
    with client.stream("POST", "/os1/uao/atlas/run/r1/approval", json={"callId": "c1", "approved": True}) as r:
        b"".join(r.iter_raw())
    runs = client.get("/os1/state").json()["runs"]
    assert runs == [{"id": "atlas:r1", "label": "Builder · write it", "status": "done"}]


def test_her_computer_falls_back_to_guacamole_embed(env, monkeypatch):
    client, _, _ = env
    monkeypatch.delenv("ORGO_API_KEY", raising=False)
    monkeypatch.delenv("OS1_VNC_UPSTREAM_WS", raising=False)
    monkeypatch.delenv("OS1_HER_COMPUTER_URL", raising=False)
    sess = client.post("/os1/her-computer/vnc-session").json()
    assert sess == {"mode": "embed", "embedUrl": "https://server.tail85e19.ts.net:8444/guacamole/", "label": "Guacamole on your server"}
    monkeypatch.setenv("OS1_HER_COMPUTER_URL", "https://example.com/desktop")
    assert client.post("/os1/her-computer/vnc-session").status_code == 400
    monkeypatch.setenv("OS1_VNC_UPSTREAM_WS", "ws://127.0.0.1:6080/websockify")
    assert client.post("/os1/her-computer/vnc-session").json()["mode"] == "vnc"


def test_sunshine_status_and_moonlight_voice(env):
    client, seen, _ = env
    st = client.get("/os1/uao/sunshine").json()
    assert st["reachable"] and st["streaming"] and st["hostname"] == "server" and st["app"] == "Desktop"
    assert str(seen[-1].url) == "http://server.tail85e19.ts.net:47989/serverinfo"
    res = client.post("/os1/actions", json={"phrase": "open moonlight"}).json()
    assert res["target"] == "moonlight" and client.get("/os1/state").json()["activeSurface"] == "her_computer"


def test_atlas_headers_send_atlas_origin(monkeypatch):
    from os1_orchestrator.uao import client as uao

    monkeypatch.setenv("ATLAS_API_BASE", "https://server.tail85e19.ts.net:8459/atlas/api")
    assert uao.atlas_headers()["Origin"] == "https://server.tail85e19.ts.net:8459"


def test_ntfy_notifications_for_atlas_runs(monkeypatch):
    import asyncio

    import httpx

    from os1_orchestrator import notify

    sent: list[httpx.Request] = []
    monkeypatch.setenv("UAOS1_NTFY_URL", "http://ntfy.test")
    monkeypatch.setenv("UAOS1_NTFY_TOPIC", "uaos1-test")
    monkeypatch.setattr(notify, "_transport", httpx.MockTransport(lambda r: sent.append(r) or httpx.Response(200)))
    notify._sent.clear()

    async def run():
        notify.run_changed({"id": "atlas:r1", "label": "Find flights", "status": "waiting"})
        notify.run_changed({"id": "atlas:r1", "label": "Find flights", "status": "waiting"})  # de-duplicated
        notify.run_changed({"id": "atlas:r1", "label": "Find flights", "status": "done"})
        notify.run_changed({"id": "atlas:r1", "label": "Find flights", "status": "running"})  # not notified
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert [r.headers["Title"] for r in sent] == ["Atlas needs your OK", "Atlas finished"]
    assert sent[0].url == "http://ntfy.test/uaos1-test"
    assert sent[0].headers["Click"] == "uaos1://open?surface=atlas"
    assert sent[0].content == b"Find flights"


def test_status_reports_each_service(env, monkeypatch):
    client, _seen, _app = env
    monkeypatch.delenv("LIVEKIT_URL", raising=False)
    monkeypatch.delenv("UAOS1_NTFY_URL", raising=False)
    r = client.get("/os1/uao/status")
    assert r.status_code == 200
    items = {i["name"]: i for i in r.json()["items"]}
    assert set(items) >= {"Voice server", "Samantha", "Atlas", "Services", "Notifications", "Sunshine"}
    assert items["Voice server"]["state"] == "off" and items["Notifications"]["state"] == "off"
    assert items["Sunshine"] == {"name": "Sunshine", "state": "ok", "detail": "Streaming now"}
    assert all(i["state"] in {"ok", "off", "down"} for i in items.values())


def test_memory_is_shared_with_atlas(env):
    import time

    client, seen, _app = env
    r = client.post("/os1/memories", json={"category": "people", "summary": "Sam is my sister", "detail": "lives in Leeds"})
    assert r.status_code == 200
    mem_id = r.json()["id"]
    for _ in range(50):
        if any(q.method == "POST" and q.url.path.endswith("/memory") for q in seen):
            break
        time.sleep(0.02)
    made = [q for q in seen if q.method == "POST" and q.url.path == "/atlas/api/agents"]
    assert made and json.loads(made[0].content)["name"] == "Samantha"
    saved = [q for q in seen if q.method == "POST" and q.url.path == "/atlas/api/agents/sam1/memory"]
    assert json.loads(saved[0].content) == {"text": "Person: Sam is my sister — lives in Leeds"}

    listed = client.get("/os1/memories").json()
    assert [a["text"] for a in listed["atlas"]] == ["Prefer primary sources"]  # Samantha's mirrors hidden

    client.post("/os1/memories/forget", json={"memory_id": mem_id, "confirmed": True})
    for _ in range(50):
        if any(q.method == "DELETE" for q in seen):
            break
        time.sleep(0.02)
    assert any(q.method == "DELETE" and q.url.path == "/atlas/api/agents/sam1/memory/am1" for q in seen)
