# UAO bridge: Apps & services and Atlas

Two server UIs are now native OS1 surfaces. The renderer never talks to the server; every call goes
through the orchestrator's `/os1/uao/*` routes (Bearer `OS1_CLIENT_TOKEN`), which only reach
tailnet / LAN / loopback hosts (`services/orchestrator/os1_orchestrator/uao/`).

## Apps & services (dock: **Services**; was `:8444/#/apps-services`)

- `GET /os1/uao/apps` → `GET {UAO_API_BASE}/api/homarr/apps`, normalised (status, latency, `embeddable`).
- Tiles grouped by board, live up/down dot, latency, filter, Refresh, **Homarr board**, auto-refresh every 60 s.
- **Open** shows the app inside OS1 with a Back bar, page-back, reload and *Open full screen*.
  In Electron this is a native `WebContentsView` (`apps/desktop/src/main/embedHost.ts`): it works with apps that
  refuse iframes, keeps logins in its own `persist:os1-embed` session, and only loads tailnet/LAN hosts. Anything
  else (e.g. Google's cloud Antigravity) opens in your browser. The view hides while an OS1 approval modal is up.
- Voice, from any surface: “open jellyfin”, “launch n8n”, “show the guacamole”, “show apps and services”,
  “refresh the apps”. While the surface is up every tile is a visible pill (“Open SuperBot (Orchestrator)”).

## Atlas (dock: **Atlas**; was `:8459/atlas`)

Proxied 1:1 through `/os1/uao/atlas/*` with a strict allowlist (see `ATLAS_ALLOW` in `uao/routes.py`;
e.g. `DELETE /account/data` is refused).

| Atlas | OS1 |
| --- | --- |
| Presence / Talk to Scout | **Talk**: agent chips (keys 1–4), workspace picker, streaming reply + live tool trace, Stop |
| Write approvals | Inline “Checking with you first” card → `POST /run/:id/approval {callId, approved}` (streams the continuation) |
| Threads | Sidebar list with rename / delete; search across threads, files and memory |
| Agents | Edit name, glyph, accent, model (searchable, 2.9k models), temperature, instructions, tools, can-write; create / delete; per-agent memory add / forget |
| Workspaces | Create / delete, file list, edit & save, new file, delete file, history & restore |
| Schedules | Ambient daily tasks: create, run now, pause / resume, delete |
| Memory · Activity | Grouped agent memories with forget; run history (status, steps, tools, model) → opens the thread |

Runs are SSE (`start · tool_start · step · delta · paused · done · error`); the orchestrator passes the bytes
through untouched and mirrors run state into OS1's work list, so Home / Swarm / presence show “Scout · …” working,
waiting for you, or done.

## Config

See the *UAO bridge* block in `.env.example`. Tests: `(cd services/orchestrator && uv run pytest -q tests/test_uao.py)`.

## One server

The home server runs the only UAOS1 orchestrator (`uaos1-orchestrator` user service, Tailscale Serve
`:8796`), plus LiveKit (`uaos1-livekit`, `livekit.yaml`, tailnet-only, Serve `:7444` for signalling),
the voice worker (`uaos1-voice`) and ntfy (`uaos1-ntfy` container, Serve `:8462`). The Mac, the laptop and
the Pixel are all clients: set `UAOS1_SERVER_URL` / `UAOS1_SERVER_TOKEN` in `.env` and
`scripts/run-uaos1.command` only starts the desktop app.

- **Replies:** quick questions go to `UAOS1_FAST_LLM_MODEL` through the server's model router (first words in
  about 3–4 s); anything needing tools, live data or actions is handed to the UAO Jarvis route.
- **Notifications:** Atlas runs that need approval, finish or fail, and Samantha's approval requests, are
  posted to ntfy. Tapping one opens `uaos1://open?surface=…`.
- **Status:** `GET /os1/uao/status` (shown at the top of Services) checks every dependency.
- **Memory:** saving a memory mirrors it into Atlas under a "Samantha" agent; forgetting deletes the mirror.
  Atlas agents' memories appear under "From Atlas" on the Memory screen.
- **Phone layout check:** `node scripts/check-phone-layout.mjs` (see the header) fails if any screen overflows.
