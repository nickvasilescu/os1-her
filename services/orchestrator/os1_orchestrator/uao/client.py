"""Typed, tailnet-only HTTP client for the UAO backend (:8444) and Atlas (:8459/atlas/api)."""

from __future__ import annotations

import ipaddress
import os
from typing import Any
from urllib.parse import urlparse

import httpx

DEFAULT_TAILNET = "tail85e19.ts.net"


def _env(name: str, default: str) -> str:
    return (os.environ.get(name) or default).strip()


def tailnet_suffixes() -> list[str]:
    raw = _env("UAO_TAILNET_SUFFIXES", DEFAULT_TAILNET)
    return [s.strip().lower().lstrip(".") for s in raw.split(",") if s.strip()]


def uao_base() -> str:
    return _env("UAO_API_BASE", f"https://server.{DEFAULT_TAILNET}:8444").rstrip("/")


def atlas_base() -> str:
    return _env("ATLAS_API_BASE", f"https://server.{DEFAULT_TAILNET}:8459/atlas/api").rstrip("/")


def is_private_host(host: str) -> bool:
    """Tailnet MagicDNS names, loopback, RFC1918 LAN and Tailscale CGNAT (100.64/10) only."""
    host = (host or "").lower().strip("[]")
    if not host:
        return False
    if host in ("localhost",) or host.endswith(".localhost"):
        return True
    if any(host == s or host.endswith("." + s) for s in tailnet_suffixes()):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip in ipaddress.ip_network("100.64.0.0/10")


def is_allowed_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and is_private_host(parsed.hostname or "")


class UaoConfigError(RuntimeError):
    pass


def assert_allowed_base(url: str) -> None:
    if not is_allowed_url(url):
        raise UaoConfigError(f"refusing non-tailnet/non-LAN upstream {urlparse(url).hostname!r}")


# Tests inject an httpx.MockTransport here.
_transport: httpx.AsyncBaseTransport | None = None


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    global _transport
    _transport = transport


def make_client(read_timeout: float | None = 20.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=_transport,
        timeout=httpx.Timeout(10.0, read=read_timeout),
        follow_redirects=False,
    )


def uao_headers() -> dict[str, str]:
    token = os.environ.get("UAO_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def atlas_headers() -> dict[str, str]:
    # Atlas refuses writes (runs, approvals, edits) unless Origin is its own site (CSRF guard).
    u = urlparse(atlas_base())
    headers = {"Origin": f"{u.scheme}://{u.netloc}"}
    token = os.environ.get("ATLAS_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def normalize_app(raw: dict[str, Any]) -> dict[str, Any]:
    url = str(raw.get("url") or raw.get("originalUrl") or "")
    status = str(raw.get("status") or "unknown").lower()
    latency = raw.get("latencyMs")
    return {
        "id": str(raw.get("id") or raw.get("appId") or url),
        "appId": str(raw.get("appId") or raw.get("id") or url),
        "name": str(raw.get("name") or url),
        "description": str(raw.get("description") or ""),
        "url": url,
        "originalUrl": str(raw.get("originalUrl") or url),
        "iconUrl": str(raw.get("iconUrl") or ""),
        "category": str(raw.get("category") or raw.get("boardTitle") or "Apps"),
        "board": str(raw.get("board") or ""),
        "status": status if status in ("up", "down") else "unknown",
        "statusCode": raw.get("statusCode"),
        "latencyMs": latency if isinstance(latency, (int, float)) else None,
        # Tailnet/LAN apps open inside OS1; anything public (e.g. Google's cloud IDE) opens in the browser.
        "embeddable": is_allowed_url(url),
    }
