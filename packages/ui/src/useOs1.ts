import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import type {
  ActiveSurface,
  AgentState,
  ConnectorPolicy,
  MemoryCategory,
  ApiFetch,
  Os1BusEvent,
  Os1BusState,
  Os1Config,
  Os1State,
  Phase,
  WorkItem,
} from "./types";

export type { AgentState, Os1BusState, Os1Config, Os1State, Phase, WorkItem };

/** Her computer: a noVNC stream (Orgo or your own websockify) or an in-app web view (e.g. Guacamole). */
export type VncSession =
  | { mode?: "vnc"; wsPath: string; password: string; readOnlyDefault: boolean; resolution: string; upstream?: string }
  | { mode: "embed"; embedUrl: string; label?: string };

const INITIAL: Os1State = {
  connection: "idle",
  phase: "preflight",
  agentState: "initializing",
  chips: [],
  work: [],
  voice: "",
  agentLine: "",
  userLine: "",
};

export const INITIAL_BUS: Os1BusState = {
  connected: false,
  activeSurface: "conversation",
  mood: { warmth: 0.45, pace: 0.45, overwhelm: 0.15, compactMode: false },
  runs: [],
  canvas: null,
  pendingAction: null,
  undoToast: null,
  rememberedShimmer: null,
  memories: [],
  connectors: [],
  inbox: [],
  voice: { voiceKey: "voice_1_warm", speed: 0.96, temperature: 0.72, styleNote: "" },
  cua: {
    connected: false,
    status: "disconnected",
    manifest: {
      version: "3",
      mode: "bounded",
      allowedApps: ["Finder", "Notes", "Calendar", "Safari", "Google Chrome", "Preview", "Music"],
      allowedPaths: ["~/Desktop", "~/Documents", "~/Downloads"],
      blockedApps: ["Terminal", "iTerm", "Keychain Access", "System Settings", "1Password", "Bitwarden"],
      telemetryEnabled: false,
    },
    recentActivity: [],
  },
  herComputer: { online: true, resolution: "1920x1080", recentActivity: [] },
  visiblePhrases: [],
};

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface TokenResponse {
  engine: "drama3" | "live3";
  url: string;
  token: string;
  session_id?: string;
  brain_url?: string;
}

export function useOs1(config: Os1Config) {
  const [state, setState] = useState<Os1State>(INITIAL);
  const [bus, setBus] = useState<Os1BusState>(INITIAL_BUS);
  const room = useRef<Room | null>(null);
  const levels = useRef({ agent: 0, user: 0 });
  const engine = useRef<TokenResponse["engine"]>("drama3");
  const events = useRef<{ close: () => void } | null>(null);
  const switching = useRef(false);
  const connectRef = useRef<(name?: string) => Promise<void>>(async () => {});
  const listeners = useRef(new Set<(ev: Os1BusEvent) => void>());

  /** Subscribe to non-snapshot bus frames (open_app, refresh_apps, …). Returns an unsubscribe. */
  const onEvent = useCallback((fn: (ev: Os1BusEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(config.clientToken ? { Authorization: `Bearer ${config.clientToken}` } : {}),
        ...((init?.headers as Record<string, string>) ?? {}),
      };
      const resp = await fetch(`${config.orchestratorUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
      return resp;
    },
    [config.orchestratorUrl, config.clientToken],
  );

  // Subscribe to the orchestrator's realtime WS /os1/events state bus (works even with voice off).
  useEffect(() => {
    if (window.location.hash.includes("preview=")) return;
    let alive = true;
    let ws: WebSocket | null = null;
    let retryTimer = 0;

    const applySnapshot = (snap: Partial<Os1BusState>) => {
      setBus((prev) => ({
        ...prev,
        ...snap,
        connected: true,
      }));
    };

    const loadHttp = async () => {
      try {
        const res = await apiFetch("/os1/state");
        if (res.ok && alive) applySnapshot((await res.json()) as Partial<Os1BusState>);
      } catch {
        /* orchestrator may be starting */
      }
    };

    const openWs = () => {
      if (!alive) return;
      const base = config.orchestratorUrl.replace(/\/$/, "").replace(/^http/, "ws");
      const tokenQ = config.clientToken ? `?token=${encodeURIComponent(config.clientToken)}` : "";
      try {
        ws = new WebSocket(`${base}/os1/events${tokenQ}`);
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(String(ev.data)) as Partial<Os1BusState> & { type?: string; url?: string };
            if (data.type === "snapshot") applySnapshot(data);
            else if (data.type && data.type !== "pong" && data.type !== "open_url") {
              listeners.current.forEach((fn) => fn(data as Os1BusEvent));
            }
            else if (data.type === "open_url" && typeof data.url === "string" && data.url.startsWith("https://connect.composio.dev/")) {
              window.open(data.url, "_blank", "noopener");
            }
          } catch {
            /* ignore malformed frames */
          }
        };
        ws.onopen = () => setBus((b) => ({ ...b, connected: true }));
        ws.onclose = () => {
          setBus((b) => ({ ...b, connected: false }));
          if (alive) retryTimer = window.setTimeout(openWs, 2500);
        };
        ws.onerror = () => ws?.close();
      } catch {
        if (alive) retryTimer = window.setTimeout(openWs, 3000);
      }
    };

    void loadHttp();
    openWs();
    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [apiFetch, config.orchestratorUrl, config.clientToken]);

  /** live3: Fish's client protocol takes text as a `user.message` on the `client-event` topic. */
  const sendFish = useCallback(async (text: string) => {
    const payload = new TextEncoder().encode(JSON.stringify({ type: "user.message", text }));
    await room.current?.localParticipant.publishData(payload, { reliable: true, topic: "client-event" });
  }, []);

  const readAgent = useCallback((p: Participant) => {
    const a = p.attributes;
    setState((s) => ({
      ...s,
      agentState: (a["lk.agent.state"] as AgentState) ?? s.agentState,
      phase: (a["os1.phase"] as Phase) ?? s.phase,
      chips: parseJson(a["os1.chips"], s.chips),
      work: parseJson(a["os1.work"], s.work),
      voice: a["os1.voice"] ?? s.voice,
    }));
    if (a["os1.handoff"] === "live3" && engine.current === "drama3" && !switching.current) {
      switching.current = true;
      void (async () => {
        await room.current?.disconnect();
        await connectRef.current();
        switching.current = false;
      })();
    }
  }, []);

  const connect = useCallback(
    async (name?: string) => {
      setState((s) => ({ ...s, connection: "connecting", error: undefined }));
      try {
        const resp = await apiFetch("/os1/token", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        if (!resp.ok) {
          const detail = String((await resp.json().catch(() => ({}))).detail ?? `token ${resp.status}`);
          if (resp.status === 503 && /livekit/i.test(detail)) {
            // No LiveKit on this machine: open UAOS1 without live voice instead of blocking at the door.
            if (name?.trim()) {
              await apiFetch("/os1/profile", { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }).catch(() => undefined);
            }
            setState((s) => ({
              ...s,
              connection: "connected",
              voiceOff: true,
              phase: "active",
              agentState: "idle",
              chips: ["Open Atlas", "Show apps and services"],
              agentLine: "Voice is off on this Mac (LiveKit isn't set up). Atlas, Services and the rest work — use the dock or tap below.",
            }));
            return;
          }
          throw new Error(detail);
        }
        const t = (await resp.json()) as TokenResponse;
        const { url, token } = t;
        engine.current = t.engine ?? "drama3";
        events.current?.close();
        events.current = null;

        const r = new Room({ adaptiveStream: true, dynacast: true });
        room.current = r;
        r.on(RoomEvent.ParticipantAttributesChanged, (_changed, p) => {
          if (p !== r.localParticipant) readAgent(p);
        });
        r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => readAgent(p));
        r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach());
        });
        r.on(RoomEvent.ConnectionStateChanged, (cs) => {
          if (cs === ConnectionState.Disconnected && !switching.current) setState((s) => ({ ...s, connection: "idle" }));
        });
        r.registerTextStreamHandler("lk.transcription", async (reader, participant) => {
          const mine = participant.identity === r.localParticipant.identity;
          let text = "";
          for await (const delta of reader) {
            text += delta;
            const line = text.trim();
            setState((s) => (mine ? { ...s, userLine: line } : { ...s, agentLine: line }));
          }
        });

        await r.connect(url, token);
        await r.localParticipant.setMicrophoneEnabled(true);
        r.remoteParticipants.forEach(readAgent);
        if (engine.current === "live3") {
          setState((s) => ({ ...s, phase: "active" }));
          if (t.brain_url && t.session_id) {
            const pollUrl = `${t.brain_url}/os1/sessions/${t.session_id}/poll`;
            const headers = config.clientToken ? { Authorization: `Bearer ${config.clientToken}` } : undefined;
            const timer = window.setInterval(async () => {
              try {
                const res = await fetch(pollUrl, { headers });
                if (!res.ok) return;
                const data = (await res.json()) as { chips: string[]; events: { type: string; [k: string]: unknown }[] };
                setState((s) => ({ ...s, chips: data.chips }));
                for (const ev of data.events) {
                  if (ev.type === "work") setState((s) => ({ ...s, work: ev.items as WorkItem[] }));
                  else if (ev.type === "phase") setState((s) => ({ ...s, phase: ev.phase as Phase }));
                  else if (ev.type === "narrate") void sendFish(ev.text as string);
                }
              } catch {
                /* transient */
              }
            }, 1000);
            events.current = { close: () => window.clearInterval(timer) };
          }
        }
        setState((s) => ({ ...s, connection: "connected" }));
      } catch (err) {
        setState((s) => ({ ...s, connection: "error", error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [apiFetch, config.clientToken, readAgent, sendFish],
  );
  connectRef.current = connect;

  /** A tapped say-chip is sent as if spoken (and also checked by orchestrator pills). */
  const say = useCallback(
    async (phrase: string) => {
      setState((s) => ({ ...s, userLine: phrase }));
      if (room.current?.state === ConnectionState.Connected) {
        if (engine.current === "live3") await sendFish(phrase);
        else await room.current.localParticipant.sendText(phrase, { topic: "lk.chat" });
      } else {
        // Voice off: route straight through orchestrator pill matcher so buttons always work!
        await apiFetch("/os1/actions", { method: "POST", body: JSON.stringify({ phrase, source: "tap" }) }).catch(() => undefined);
      }
    },
    [apiFetch, sendFish],
  );

  const dispatchAction = useCallback(
    async (opts: { phrase?: string; target?: string; action?: string; payload?: Record<string, unknown> }) => {
      if (opts.target === "surface" && opts.action) {
        setBus((b) => ({ ...b, activeSurface: opts.action as ActiveSurface }));
      }
      try {
        const res = await apiFetch("/os1/actions", {
          method: "POST",
          body: JSON.stringify({ ...opts, source: "tap" }),
        });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
    [apiFetch],
  );

  const setSurface = useCallback(
    (surface: ActiveSurface) => {
      setBus((b) => ({ ...b, activeSurface: surface }));
      void dispatchAction({ target: "surface", action: surface });
    },
    [dispatchAction],
  );

  const respondApproval = useCallback(
    async (actionId: string, choice: string) => {
      setBus((b) => (b.pendingAction?.id === actionId ? { ...b, pendingAction: null } : b));
      await apiFetch(`/os1/approvals/${actionId}/respond`, {
        method: "POST",
        body: JSON.stringify({ choice }),
      }).catch(() => undefined);
    },
    [apiFetch],
  );

  const undo = useCallback(
    async (undoId?: string) => {
      setBus((b) => ({ ...b, undoToast: null }));
      await apiFetch("/os1/undo", { method: "POST", body: JSON.stringify({ undo_id: undoId }) }).catch(() => undefined);
    },
    [apiFetch],
  );

  const addMemory = useCallback(
    async (category: MemoryCategory, summary: string, detail = "") => {
      await apiFetch("/os1/memories", {
        method: "POST",
        body: JSON.stringify({ category, summary, detail, source: "manual" }),
      }).catch(() => undefined);
    },
    [apiFetch],
  );

  const requestForgetMemory = useCallback(
    async (memoryId: string) => {
      await apiFetch("/os1/memories/forget", {
        method: "POST",
        body: JSON.stringify({ memory_id: memoryId, confirmed: false }),
      }).catch(() => undefined);
    },
    [apiFetch],
  );

  const updateConnector = useCallback(
    async (slug: string, patch: { policy?: ConnectorPolicy; connected?: boolean }) => {
      await apiFetch(`/os1/connectors/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => undefined);
    },
    [apiFetch],
  );

  const connectConnector = useCallback(
    async (slug: string): Promise<{ ok: boolean; redirect_url?: string; message?: string }> => {
      try {
        const res = await apiFetch(`/os1/connectors/${slug}/connect`, { method: "POST" });
        return (await res.json()) as { ok: boolean; redirect_url?: string; message?: string };
      } catch {
        return { ok: false, message: "Orchestrator unreachable" };
      }
    },
    [apiFetch],
  );

  const updateVoice = useCallback(
    async (patch: { voiceKey?: string; speed?: number; temperature?: number; styleNote?: string }) => {
      setBus((b) => ({ ...b, voice: { ...b.voice, ...patch } }));
      await apiFetch("/os1/voices", { method: "PATCH", body: JSON.stringify(patch) }).catch(() => undefined);
    },
    [apiFetch],
  );

  const revokeCua = useCallback(async () => {
    // Also trigger local Electron kill switch if running inside Desktop app.
    try {
      const os1 = (window as unknown as { os1?: { cua?: { revokeAll?: () => Promise<void> } } }).os1;
      await os1?.cua?.revokeAll?.();
    } catch {
      /* ignore */
    }
    await apiFetch("/os1/your-computer/revoke", { method: "POST" }).catch(() => undefined);
  }, [apiFetch]);

  const fetchVncSession = useCallback(async () => {
    const res = await apiFetch("/os1/her-computer/vnc-session", { method: "POST" });
    if (!res.ok) throw new Error(`VNC session failed (${res.status})`);
    return (await res.json()) as VncSession;
  }, [apiFetch]);

  const disconnect = useCallback(async () => {
    events.current?.close();
    await room.current?.disconnect();
    room.current = null;
    setState(INITIAL);
  }, []);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const r = room.current;
      if (r) {
        let agent = 0;
        r.remoteParticipants.forEach((p) => (agent = Math.max(agent, p.audioLevel)));
        levels.current = { agent, user: r.localParticipant.audioLevel };
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      void room.current?.disconnect();
    };
  }, []);

  return {
    state,
    bus,
    apiFetch: apiFetch as ApiFetch,
    onEvent,
    levels,
    connect,
    say,
    disconnect,
    dispatchAction,
    setSurface,
    respondApproval,
    undo,
    addMemory,
    requestForgetMemory,
    updateConnector,
    connectConnector,
    updateVoice,
    revokeCua,
    fetchVncSession,
  };
}
