/**
 * UAO client for the renderer. Everything goes through the OS1 orchestrator (/os1/uao/*),
 * which holds the tokens and only talks to tailnet/LAN hosts.
 */
import type {
  ApiFetch,
  AtlasActivity,
  AtlasAgent,
  AtlasFile,
  AtlasMe,
  AtlasMemory,
  AtlasModel,
  AtlasRunEvent,
  AtlasSchedule,
  AtlasThread,
  AtlasThreadDetail,
  AtlasWorkspace,
  UaoAppsResponse,
} from "../types";

export class UaoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorText(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as { detail?: unknown; error?: unknown; message?: unknown };
    const msg = j.detail ?? j.error ?? j.message;
    if (typeof msg === "string") return msg;
  } catch {
    /* not JSON */
  }
  return raw.slice(0, 240) || `HTTP ${res.status}`;
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

/** Items lists come back as {items:[...]} or bare arrays; accept both. */
export function itemsOf<T>(v: unknown, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") {
    for (const k of ["items", ...keys]) {
      const x = (v as Record<string, unknown>)[k];
      if (Array.isArray(x)) return x as T[];
    }
  }
  return [];
}

export function createUaoApi(apiFetch: ApiFetch) {
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await apiFetch(path, init);
    if (!res.ok) throw new UaoError(await errorText(res), res.status);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
  const atlas = <T>(path: string, method = "GET", body?: unknown) =>
    json<T>(`/os1/uao/atlas${path}`, body === undefined ? { method } : { method, body: JSON.stringify(body) });

  /** POST an Atlas run endpoint and feed each SSE `data:` frame to onEvent until the stream ends. */
  const stream = async (path: string, body: unknown, onEvent: (ev: AtlasRunEvent) => void, signal?: AbortSignal) => {
    const res = await apiFetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) throw new UaoError(await errorText(res), res.status);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value.replace(/\r\n/g, "\n");
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          try {
            onEvent(JSON.parse(data) as AtlasRunEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  return {
    // Apps & services
    apps: () => json<UaoAppsResponse>("/os1/uao/apps"),

    sunshine: () =>
      json<{ ok: boolean; host: string; reachable: boolean; hostname?: string; version?: string; streaming?: boolean; app?: string }>(
        "/os1/uao/sunshine",
      ),

    // One light per service UAOS1 depends on.
    status: () =>
      json<{ items: { name: string; state: "ok" | "off" | "down"; detail: string }[]; checkedAt: number }>("/os1/uao/status"),

    // Atlas reads
    me: () => atlas<AtlasMe>("/me"),
    models: async () => itemsOf<AtlasModel>(await atlas("/models")),
    agents: async () => itemsOf<AtlasAgent>(await atlas("/agents")),
    agent: (id: string) => atlas<Record<string, unknown>>(`/agents/${enc(id)}`),
    threads: async () => itemsOf<AtlasThread>(await atlas("/threads")),
    thread: (id: string) => atlas<AtlasThreadDetail>(`/threads/${enc(id)}`),
    workspaces: async () => itemsOf<AtlasWorkspace>(await atlas("/workspaces")),
    workspace: (id: string) => atlas<{ workspace: AtlasWorkspace; files: AtlasFile[] }>(`/workspaces/${enc(id)}`),
    workspaceHistory: async (id: string) =>
      itemsOf<Record<string, unknown>>(await atlas(`/workspaces/${enc(id)}/history`), "history", "versions"),
    activity: async () => itemsOf<AtlasActivity>(await atlas("/activity")),
    activityRun: (id: string) => atlas<Record<string, unknown>>(`/activity/${enc(id)}`),
    memory: async () => itemsOf<AtlasMemory>(await atlas("/memory")),
    approvals: async () => itemsOf<Record<string, unknown>>(await atlas("/approvals")),
    schedules: async () => itemsOf<AtlasSchedule>(await atlas("/schedules")),
    search: (q: string) => json<Record<string, unknown>>(`/os1/uao/atlas/search?q=${enc(q)}`),

    // Atlas writes
    createAgent: (a: Partial<AtlasAgent>) => atlas<Record<string, unknown>>("/agents", "POST", a),
    updateAgent: (id: string, a: Partial<AtlasAgent>) => atlas<Record<string, unknown>>(`/agents/${enc(id)}`, "PATCH", a),
    deleteAgent: (id: string) => atlas<unknown>(`/agents/${enc(id)}`, "DELETE"),
    addAgentMemory: (id: string, text: string) => atlas<unknown>(`/agents/${enc(id)}/memory`, "POST", { text }),
    deleteAgentMemory: (agentId: string, memoryId: string) =>
      atlas<unknown>(`/agents/${enc(agentId)}/memory/${enc(memoryId)}`, "DELETE"),
    renameThread: (id: string, title: string) => atlas<unknown>(`/threads/${enc(id)}`, "PATCH", { title }),
    deleteThread: (id: string) => atlas<unknown>(`/threads/${enc(id)}`, "DELETE"),
    restoreThread: (id: string) => atlas<unknown>(`/threads/${enc(id)}/restore`, "POST", {}),
    createWorkspace: (name: string, description: string) =>
      atlas<Record<string, unknown>>("/workspaces", "POST", { name, description }),
    deleteWorkspace: (id: string) => atlas<unknown>(`/workspaces/${enc(id)}`, "DELETE"),
    saveFile: (id: string, path: string, content: string) =>
      atlas<unknown>(`/workspaces/${enc(id)}/files`, "PUT", { path, content }),
    deleteFile: (id: string, fileId: string) => atlas<unknown>(`/workspaces/${enc(id)}/files/${enc(fileId)}`, "DELETE"),
    restoreWorkspace: (id: string, version: Record<string, unknown>) =>
      atlas<unknown>(`/workspaces/${enc(id)}/restore`, "POST", version),
    createSchedule: (s: Record<string, unknown>) => atlas<Record<string, unknown>>("/schedules", "POST", s),
    updateSchedule: (id: string, s: Record<string, unknown>) => atlas<unknown>(`/schedules/${enc(id)}`, "PATCH", s),
    deleteSchedule: (id: string) => atlas<unknown>(`/schedules/${enc(id)}`, "DELETE"),
    runSchedule: (id: string) => atlas<{ threadId?: string }>(`/schedules/${enc(id)}/run`, "POST", {}),

    // Atlas runs (SSE)
    run: (
      body: { agentId: string; task: string; workspaceId?: string | null; threadId?: string | null; _label?: string },
      onEvent: (ev: AtlasRunEvent) => void,
      signal?: AbortSignal,
    ) => stream("/os1/uao/atlas/run", body, onEvent, signal),
    decide: (runId: string, callId: string, approved: boolean, onEvent: (ev: AtlasRunEvent) => void, signal?: AbortSignal) =>
      stream(`/os1/uao/atlas/run/${enc(runId)}/approval`, { callId, approved }, onEvent, signal),
  };
}

export type UaoApi = ReturnType<typeof createUaoApi>;
