import { type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NarrowContext, useNarrow } from "../components/useNarrow";
import { takeSharedText } from "../components/EmbedFrame";
import type {
  AtlasActivity,
  AtlasAgent,
  AtlasFile,
  AtlasMe,
  AtlasMemory,
  AtlasMessage,
  AtlasModel,
  AtlasRunEvent,
  AtlasSchedule,
  AtlasStep,
  AtlasThread,
  AtlasThreadDetail,
  AtlasWorkspace,
} from "../types";
import { type UaoApi, itemsOf } from "../uao/api";

type Tab = "talk" | "agents" | "workspaces" | "schedules" | "memory" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "talk", label: "Talk" },
  { id: "agents", label: "Agents" },
  { id: "workspaces", label: "Workspaces" },
  { id: "schedules", label: "Schedules" },
  { id: "memory", label: "Memory" },
  { id: "activity", label: "Activity" },
];

// ------------------------------------------------------------------ small helpers

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function when(ts?: number | null): string {
  if (!ts) return "";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function str(v: unknown, max = 400): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pick(o: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid var(--ink-faint)",
  background: "rgba(255, 253, 249, 0.9)",
  color: "var(--ink)",
  font: "400 14px/1.4 var(--font-sans)",
  outline: "none",
  userSelect: "text",
};

const statusTone = (s: string) =>
  /done|complete|success|ok/i.test(s) ? "var(--sage)" : /error|fail/i.test(s) ? "var(--crimson)" : /wait|paused|pending/i.test(s) ? "var(--mustard)" : "var(--cobalt)";

function Notice({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div
      role="status"
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        background: "rgba(168, 39, 60, 0.08)",
        color: "var(--crimson)",
        fontSize: 13,
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span>{text}</span>
      {onClose && (
        <button type="button" onClick={onClose} style={{ border: 0, background: "none", color: "inherit", cursor: "pointer" }}>
          ✕
        </button>
      )}
    </div>
  );
}

/** Two-tap destructive button: “Delete” → “Really delete?”. */
function ConfirmButton({ label, onConfirm, small = true }: { label: string; onConfirm: () => void; small?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`os1-pill-ink ${armed ? "danger" : ""}`}
      style={small ? { padding: "5px 12px", fontSize: 12 } : undefined}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? "Really?" : label}
    </button>
  );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 12, alignContent: "start" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h3 style={{ margin: 0, font: "300 24px/1.2 var(--font-sans)" }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Glyph({ glyph, accent, size = 28 }: { glyph: string; accent?: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 99,
        display: "inline-grid",
        placeItems: "center",
        background: accent ? `${accent}33` : "var(--studio)",
        color: accent || "var(--coral-deep)",
        fontSize: size * 0.5,
      }}
    >
      {glyph || "✦"}
    </span>
  );
}

// ------------------------------------------------------------------ live run state

interface LiveRun {
  threadId: string | null;
  userText: string;
  text: string;
  steps: AtlasStep[];
  status: "working" | "waiting" | "error";
  error?: string;
}

function stepTitle(s: AtlasStep): string {
  return String(pick(s, "title", "name", "tool", "label", "kind") ?? "Step");
}

function StepList({ steps }: { steps: AtlasStep[] }) {
  if (!steps.length) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {steps.map((s, i) => {
        const status = String(pick(s, "status", "state") ?? "");
        const detail = pick(s, "summary", "detail", "output", "result", "args", "input");
        return (
          <div
            key={String(s.id ?? i)}
            style={{ display: "grid", gridTemplateColumns: "10px 1fr", gap: 10, alignItems: "start", fontSize: 13 }}
          >
            <span style={{ width: 8, height: 8, marginTop: 5, borderRadius: 9, background: statusTone(status || "working") }} />
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>{stepTitle(s)}</span>
              {status && (
                <span className="os1-mono" style={{ fontSize: 10, marginLeft: 8, color: "var(--ink-dim)" }}>
                  {status}
                </span>
              )}
              {detail != null && (
                <pre
                  style={{
                    margin: "4px 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    font: "400 12px/1.45 var(--font-mono)",
                    color: "var(--ink-dim)",
                    maxHeight: 120,
                    overflow: "auto",
                  }}
                >
                  {str(detail, 600)}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApprovalCard({
  pending,
  busy,
  onDecide,
}: {
  pending: Record<string, unknown>;
  busy: boolean;
  onDecide: (approved: boolean) => void;
}) {
  const tool = String(pick(pending, "tool", "name", "title", "kind") ?? "A tool call");
  const detail = pick(pending, "args", "input", "arguments", "detail", "preview");
  return (
    <div
      role="alertdialog"
      aria-label={`Approve ${tool}`}
      style={{ padding: 16, borderRadius: 16, border: "1.5px solid var(--mustard)", background: "rgba(217, 165, 58, 0.08)", display: "grid", gap: 10 }}
    >
      <div className="os1-mono" style={{ fontSize: 11, color: "var(--coral-deep)" }}>
        Checking with you first
      </div>
      <div style={{ font: "400 18px/1.3 var(--font-sans)" }}>{tool} needs your approval</div>
      {detail != null && (
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(56, 40, 30, 0.06)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            font: "400 12px/1.45 var(--font-mono)",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {str(detail, 2000)}
        </pre>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="os1-pill-ink primary" disabled={busy} onClick={() => onDecide(true)}>
          “Go ahead”
        </button>
        <button type="button" className="os1-pill-ink" disabled={busy} onClick={() => onDecide(false)}>
          “Don't do it”
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Talk (threads + composer)

function TalkPane({
  api,
  agents,
  workspaces,
  threadId,
  onThread,
  onChanged,
  agentId,
  setAgentId,
}: {
  api: UaoApi;
  agents: AtlasAgent[];
  workspaces: AtlasWorkspace[];
  threadId: string | null;
  onThread: (id: string | null) => void;
  onChanged: () => void;
  agentId: string | null;
  setAgentId: (id: string) => void;
}) {
  const [detail, setDetail] = useState<AtlasThreadDetail | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [task, setTask] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  useEffect(() => {
    const pick = () => {
      const shared = takeSharedText();
      if (shared) setTask(shared);
    };
    pick();
    window.addEventListener("uaos1:shared", pick);
    return () => window.removeEventListener("uaos1:shared", pick);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const liveThread = useRef<string | null>(null);
  const kept = useRef<AtlasMessage[]>([]);

  const loadThread = useCallback(
    async (id: string | null) => {
      if (!id) {
        setDetail(null);
        return;
      }
      try {
        const d = await api.thread(id);
        const extra = kept.current.filter((m) => m.threadId === id && !d.messages.some((x) => x.id === m.id));
        setDetail(extra.length ? { ...d, messages: [...d.messages, ...extra] } : d);
        if (d.thread?.workspaceId) setWorkspaceId(d.thread.workspaceId);
        if (d.thread?.agentId) setAgentId(d.thread.agentId);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [api, setAgentId],
  );

  useEffect(() => {
    if (live && liveThread.current === threadId) return; // streaming into this thread already
    void loadThread(threadId);
  }, [threadId, loadThread]);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [detail, live?.text, live?.steps.length]);

  /** Keep the reply Atlas just finished even if the thread refetch races or fails. */
  const keepMessage = useCallback((m?: AtlasMessage) => {
    if (!m?.id || !m.content) return;
    const msg = m.threadId ? m : { ...m, threadId: liveThread.current ?? "" };
    kept.current = [...kept.current.filter((x) => x.id !== msg.id), msg].slice(-20);
    setDetail((d) =>
      d && d.thread?.id === msg.threadId && !d.messages.some((x) => x.id === msg.id) ? { ...d, messages: [...d.messages, msg] } : d,
    );
  }, []);

  const handle = useCallback(
    (ev: AtlasRunEvent) => {
      switch (ev.type) {
        case "start":
          liveThread.current = ev.threadId;
          setLive((l) => (l ? { ...l, threadId: ev.threadId } : l));
          if (ev.threadId) onThread(ev.threadId);
          onChanged();
          break;
        case "tool_start":
        case "step":
          setLive((l) => {
            if (!l) return l;
            const exists = l.steps.some((s) => s.id === ev.step.id);
            return { ...l, steps: exists ? l.steps.map((s) => (s.id === ev.step.id ? { ...s, ...ev.step } : s)) : [...l.steps, ev.step] };
          });
          break;
        case "delta":
          setLive((l) => (l ? { ...l, text: l.text + ev.text } : l));
          break;
        case "paused":
          keepMessage(ev.message);
          setLive((l) => (l ? { ...l, status: "waiting" } : l));
          break;
        case "error":
          setLive((l) => (l ? { ...l, status: "error", error: ev.message || "The run failed." } : l));
          break;
        case "done":
          keepMessage(ev.message);
          break;
      }
    },
    [onChanged, onThread, keepMessage],
  );

  const finish = useCallback(async () => {
    const id = liveThread.current;
    abort.current = null;
    if (id) await loadThread(id);
    setLive((l) => {
      if (!l || l.status === "error") return l;
      return null;
    });
    onChanged();
  }, [loadThread, onChanged]);

  const send = async () => {
    const text = task.trim();
    const agent = agents.find((a) => a.id === agentId) ?? agents[0];
    if (!text || !agent || abort.current) return;
    setTask("");
    setError(null);
    liveThread.current = threadId;
    setLive({ threadId, userText: text, text: "", steps: [], status: "working" });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await api.run(
        { agentId: agent.id, task: text, workspaceId: workspaceId || null, threadId, _label: `${agent.name} · ${text}` },
        handle,
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setLive((l) => (l ? { ...l, status: "error", error: errMsg(e) } : l));
    }
    await finish();
  };

  const decide = async (approved: boolean) => {
    const pending = detail?.pending;
    if (!pending || abort.current) return;
    const callId = String(pick(pending, "callId", "id", "toolCallId") ?? "");
    const runId = String(
      pick(pending, "runId") ?? [...(detail?.runs ?? [])].reverse().find((r) => /wait|paused|pending/i.test(r.status))?.id ?? detail?.runs.at(-1)?.id ?? "",
    );
    if (!callId || !runId) {
      setError("This approval is missing its run or call id. Open the thread in Atlas to decide.");
      return;
    }
    liveThread.current = threadId;
    setLive({ threadId, userText: "", text: "", steps: [], status: "working" });
    setDetail((d) => (d ? { ...d, pending: null } : d));
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await api.decide(runId, callId, approved, handle, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) setLive((l) => (l ? { ...l, status: "error", error: errMsg(e) } : l));
    }
    await finish();
  };

  const stop = () => {
    abort.current?.abort();
  };

  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const messages = detail?.messages ?? [];
  const busy = Boolean(abort.current) || live?.status === "working";
  const showLive = live && (live.threadId === threadId || (!threadId && !live.threadId) || liveThread.current === threadId);

  return (
    <div style={{ display: "grid", gridTemplateRows: "1fr auto", minHeight: 0, height: "100%", gap: 14 }}>
      <div ref={scroller} className="os1-scroll" style={{ minHeight: 0, display: "grid", alignContent: "start", gap: 14, paddingRight: 6 }}>
        {!threadId && !showLive && (
          <div style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "40px 10px 10px", gap: 10 }}>
            <Glyph glyph={agent?.glyph ?? "✦"} accent={agent?.accent} size={64} />
            <h2 style={{ margin: 0, font: "200 40px/1.1 var(--font-sans)" }}>Talk to {agent?.name ?? "Atlas"}</h2>
            <div style={{ color: "var(--ink-dim)", maxWidth: 460, fontSize: 15, lineHeight: 1.5 }}>
              Every task runs as a visible trace, and anything that writes waits for your approval.
            </div>
            {agent?.instructions && (
              <div style={{ color: "var(--ink-dim)", maxWidth: 520, fontSize: 13, lineHeight: 1.5 }}>{str(agent.instructions, 220)}</div>
            )}
          </div>
        )}

        {detail?.thread && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Glyph glyph={detail.thread.agentGlyph} accent={agents.find((a) => a.id === detail.thread.agentId)?.accent} />
            <div style={{ font: "400 20px/1.2 var(--font-sans)", flex: 1, minWidth: 0 }}>{detail.thread.title}</div>
            <span className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
              {detail.runs.length} run{detail.runs.length === 1 ? "" : "s"}
            </span>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              justifySelf: m.role === "user" ? "end" : "stretch",
              maxWidth: m.role === "user" ? "78%" : "100%",
              padding: m.role === "user" ? "10px 16px" : "4px 2px",
              borderRadius: 16,
              background: m.role === "user" ? "var(--coral)" : "transparent",
              color: m.role === "user" ? "var(--paper)" : "var(--ink)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              userSelect: "text",
              font: "400 15px/1.55 var(--font-sans)",
            }}
          >
            {m.content}
            {m.interrupted && (
              <div className="os1-mono" style={{ fontSize: 10, marginTop: 4, color: "var(--ink-dim)" }}>
                interrupted
              </div>
            )}
          </div>
        ))}

        {detail?.steps && detail.steps.length > 0 && !showLive && (
          <details>
            <summary className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)", cursor: "pointer" }}>
              Trace · {detail.steps.length} steps
            </summary>
            <div style={{ marginTop: 8 }}>
              <StepList steps={detail.steps} />
            </div>
          </details>
        )}

        {showLive && live && (
          <>
            {live.userText && (
              <div
                style={{
                  justifySelf: "end",
                  maxWidth: "78%",
                  padding: "10px 16px",
                  borderRadius: 16,
                  background: "var(--coral)",
                  color: "var(--paper)",
                  whiteSpace: "pre-wrap",
                  font: "400 15px/1.55 var(--font-sans)",
                }}
              >
                {live.userText}
              </div>
            )}
            <StepList steps={live.steps} />
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", font: "400 15px/1.55 var(--font-sans)", userSelect: "text" }}>
              {live.text}
              {live.status === "working" && <span style={{ opacity: 0.5 }}> ▍</span>}
            </div>
            {live.status === "working" && !live.text && !live.steps.length && (
              <div className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                {agent?.name ?? "Atlas"} is working…
              </div>
            )}
            {live.error && <Notice text={live.error} onClose={() => setLive(null)} />}
          </>
        )}

        {detail?.pending && !busy && <ApprovalCard pending={detail.pending} busy={busy} onDecide={(ok) => void decide(ok)} />}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {error && <Notice text={error} onClose={() => setError(null)} />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {agents.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={`os1-pill-ink ${a.id === agent?.id ? "primary" : ""}`}
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={() => setAgentId(a.id)}
              title={a.mutating ? "Can write (asks first)" : "Read-only"}
            >
              <span className="os1-mono" style={{ fontSize: 10, opacity: 0.6, marginRight: 6 }}>
                {i + 1}
              </span>
              {a.glyph} {a.name}
            </button>
          ))}
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            aria-label="Workspace"
            style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12, borderRadius: 999 }}
          >
            <option value="">No workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={`Give ${agent?.name ?? "the agent"} a task…`}
            aria-label="Task"
            style={{ ...inputStyle, resize: "none", minHeight: 52, maxHeight: 180 }}
          />
          {busy ? (
            <button type="button" className="os1-pill-ink danger" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="os1-pill-ink primary" disabled={!task.trim() || !agent} onClick={() => void send()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Agents

function AgentsPane({
  api,
  agents,
  models,
  memories,
  onChanged,
}: {
  api: UaoApi;
  agents: AtlasAgent[];
  models: AtlasModel[];
  memories: AtlasMemory[];
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(agents[0]?.id ?? null);
  const [draft, setDraft] = useState<AtlasAgent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [memText, setMemText] = useState("");
  const [saving, setSaving] = useState(false);

  const narrow = useContext(NarrowContext);
  const allTools = useMemo(() => [...new Set(agents.flatMap((a) => (Array.isArray(a.tools) ? a.tools : [])))].sort(), [agents]);

  useEffect(() => {
    if (isNew) return;
    const a = agents.find((x) => x.id === selected) ?? agents[0] ?? null;
    setDraft(a ? { ...a, tools: Array.isArray(a.tools) ? a.tools : [] } : null);
  }, [selected, agents, isNew]);

  const startNew = () => {
    setIsNew(true);
    setDraft({
      id: "",
      name: "New agent",
      glyph: "✦",
      accent: "#e06a4c",
      instructions: "",
      model: agents[0]?.model ?? null,
      temperature: 0.4,
      tools: [],
      mutating: false,
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setNote(null);
    const { id, createdAt: _c, updatedAt: _u, ...body } = draft;
    try {
      if (isNew) {
        const res = (await api.createAgent(body)) as Record<string, unknown>;
        const created = (res.agent ?? res) as Partial<AtlasAgent>;
        setIsNew(false);
        if (created.id) setSelected(created.id);
      } else {
        await api.updateAgent(id, body);
      }
      setNote("Saved.");
      onChanged();
    } catch (e) {
      setNote(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    try {
      await api.deleteAgent(draft.id);
      setSelected(null);
      onChanged();
    } catch (e) {
      setNote(errMsg(e));
    }
  };

  const agentMem = memories.filter((m) => m.agentId === draft?.id);
  const set = (patch: Partial<AtlasAgent>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div
      className={narrow ? "os1-scroll" : undefined}
      style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "220px 1fr", gap: 22, minHeight: 0, height: "100%" }}
    >
      <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 6 }}>
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setIsNew(false);
              setSelected(a.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 14,
              border: 0,
              textAlign: "left",
              cursor: "pointer",
              color: "var(--ink)",
              background: !isNew && draft?.id === a.id ? "rgba(205, 79, 51, 0.12)" : "transparent",
            }}
          >
            <Glyph glyph={a.glyph} accent={a.accent} />
            <span style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{a.name}</div>
              <div className="os1-mono" style={{ fontSize: 9, color: "var(--ink-dim)" }}>
                {a.mutating ? "can write" : "read-only"} · {a.model || "default"}
              </div>
            </span>
          </button>
        ))}
        <button type="button" className="os1-pill-ink" style={{ marginTop: 8 }} onClick={startNew}>
          + New agent
        </button>
      </div>

      {draft && (
        <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 14, paddingRight: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 90px", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-dim)" }}>
              Glyph
              <input style={inputStyle} value={draft.glyph} maxLength={3} onChange={(e) => set({ glyph: e.target.value })} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-dim)" }}>
              Name
              <input style={inputStyle} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-dim)" }}>
              Accent
              <input
                type="color"
                style={{ ...inputStyle, padding: 2, height: 40 }}
                value={/^#[0-9a-f]{6}$/i.test(draft.accent) ? draft.accent : "#e06a4c"}
                onChange={(e) => set({ accent: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-dim)" }}>
              Model
<input
                style={inputStyle}
                list="atlas-models"
                value={draft.model ?? ""}
                placeholder={`Instance default · ${models.length} models`}
                onChange={(e) => set({ model: e.target.value.trim() || null })}
              />
              <datalist id="atlas-models">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name && m.name !== m.id ? m.name : undefined}
                  </option>
                ))}
              </datalist>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-dim)" }}>
              Temperature {draft.temperature ?? "—"}
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={draft.temperature ?? 0.4}
                onChange={(e) => set({ temperature: Number(e.target.value) })}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-dim)" }}>
            Instructions
            <textarea
              style={{ ...inputStyle, minHeight: 140, resize: "vertical" }}
              value={draft.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
            />
          </label>
          {allTools.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>Tools</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {allTools.map((t) => {
                  const on = draft.tools.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`os1-pill-ink ${on ? "primary" : ""}`}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => set({ tools: on ? draft.tools.filter((x) => x !== t) : [...draft.tools, t] })}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.mutating} onChange={(e) => set({ mutating: e.target.checked })} />
            Can write files and memories (every write still waits for your approval)
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="os1-pill-ink primary" disabled={saving || !draft.name.trim()} onClick={() => void save()}>
              {isNew ? "Create agent" : "Save changes"}
            </button>
            {isNew ? (
              <button type="button" className="os1-pill-ink" onClick={() => setIsNew(false)}>
                Cancel
              </button>
            ) : (
              <ConfirmButton label="Delete agent" small={false} onConfirm={() => void remove()} />
            )}
            {note && <span style={{ fontSize: 13, color: note === "Saved." ? "var(--sage)" : "var(--crimson)" }}>{note}</span>}
          </div>

          {!isNew && (
            <Section title={`What ${draft.name} remembers`}>
              {agentMem.length === 0 && <div style={{ color: "var(--ink-dim)", fontSize: 14 }}>Nothing yet.</div>}
              {agentMem.map((m) => (
                <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
                  <span style={{ flex: 1, lineHeight: 1.45 }}>{m.text}</span>
                  <ConfirmButton
                    label="Forget"
                    onConfirm={() =>
                      void api
                        .deleteAgentMemory(m.agentId, m.id)
                        .then(onChanged)
                        .catch((e) => setNote(errMsg(e)))
                    }
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={inputStyle}
                  value={memText}
                  placeholder={`Teach ${draft.name} something to remember…`}
                  onChange={(e) => setMemText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && memText.trim()) {
                      void api.addAgentMemory(draft.id, memText.trim()).then(() => {
                        setMemText("");
                        onChanged();
                      }, (err) => setNote(errMsg(err)));
                    }
                  }}
                />
                <button
                  type="button"
                  className="os1-pill-ink"
                  disabled={!memText.trim()}
                  onClick={() =>
                    void api.addAgentMemory(draft.id, memText.trim()).then(() => {
                      setMemText("");
                      onChanged();
                    }, (err) => setNote(errMsg(err)))
                  }
                >
                  Remember
                </button>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Workspaces

function WorkspacesPane({ api, workspaces, onChanged }: { api: UaoApi; workspaces: AtlasWorkspace[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<string | null>(workspaces[0]?.id ?? null);
  const [files, setFiles] = useState<AtlasFile[]>([]);
  const [fileId, setFileId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const ws = workspaces.find((w) => w.id === selected) ?? null;
  const narrow = useContext(NarrowContext);

  const load = useCallback(async () => {
    if (!selected) return;
    try {
      const d = await api.workspace(selected);
      setFiles(itemsOf<AtlasFile>(d, "files"));
    } catch (e) {
      setNote(errMsg(e));
    }
  }, [api, selected]);

  useEffect(() => {
    setFileId(null);
    setPath("");
    setContent("");
    setShowHistory(false);
    void load();
  }, [load]);

  const openFile = (f: AtlasFile) => {
    setFileId(f.id);
    setPath(f.path);
    setContent(f.content);
  };

  const save = async () => {
    if (!selected || !path.trim()) return;
    try {
      await api.saveFile(selected, path.trim(), content);
      setNote("Saved.");
      await load();
      onChanged();
    } catch (e) {
      setNote(errMsg(e));
    }
  };

  const loadHistory = async () => {
    if (!selected) return;
    setShowHistory((s) => !s);
    try {
      setHistory(await api.workspaceHistory(selected));
    } catch (e) {
      setNote(errMsg(e));
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const res = (await api.createWorkspace(newName.trim(), newDesc.trim())) as Record<string, unknown>;
      const w = (res.workspace ?? res) as Partial<AtlasWorkspace>;
      setNewName("");
      setNewDesc("");
      onChanged();
      if (w.id) setSelected(w.id);
    } catch (e) {
      setNote(errMsg(e));
    }
  };

  return (
    <div
      className={narrow ? "os1-scroll" : undefined}
      style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "230px 1fr", gap: 22, minHeight: 0, height: "100%" }}
    >
      <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 6 }}>
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setSelected(w.id)}
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: 0,
              textAlign: "left",
              cursor: "pointer",
              color: "var(--ink)",
              background: w.id === selected ? "rgba(205, 79, 51, 0.12)" : "transparent",
            }}
          >
            <div style={{ fontWeight: 500 }}>{w.name}</div>
            <div className="os1-mono" style={{ fontSize: 9, color: "var(--ink-dim)" }}>
              {w.fileCount} file{w.fileCount === 1 ? "" : "s"}
            </div>
          </button>
        ))}
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <input style={inputStyle} placeholder="New workspace name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input style={inputStyle} placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <button type="button" className="os1-pill-ink" disabled={!newName.trim()} onClick={() => void create()}>
            + New workspace
          </button>
        </div>
      </div>

      {ws ? (
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 12, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "300 24px/1.2 var(--font-sans)" }}>{ws.name}</div>
              {ws.description && <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>{ws.description}</div>}
            </div>
            <button type="button" className="os1-pill-ink" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => void loadHistory()}>
              {showHistory ? "Hide history" : "History"}
            </button>
            <ConfirmButton
              label="Delete workspace"
              onConfirm={() =>
                void api.deleteWorkspace(ws.id).then(() => {
                  setSelected(null);
                  onChanged();
                }, (e) => setNote(errMsg(e)))
              }
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "200px 1fr", gap: 16, minHeight: 0 }}>
            <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 4 }}>
              {files.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>No files yet.</div>}
              {files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => openFile(f)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 10,
                    border: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    font: "400 12px var(--font-mono)",
                    color: "var(--ink)",
                    background: f.id === fileId ? "rgba(205, 79, 51, 0.12)" : "transparent",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={f.path}
                >
                  {f.path}
                </button>
              ))}
              <button
                type="button"
                className="os1-pill-ink"
                style={{ marginTop: 8, padding: "5px 12px", fontSize: 12 }}
                onClick={() => {
                  setFileId(null);
                  setPath("notes.md");
                  setContent("");
                }}
              >
                + New file
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateRows: showHistory ? "auto 1fr auto auto" : "auto 1fr auto", gap: 10, minHeight: 0 }}>
              <input style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13 }} value={path} placeholder="path/to/file.md" onChange={(e) => setPath(e.target.value)} />
              <textarea
                style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13, resize: "none", minHeight: 160 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Pick a file, or start a new one."
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" className="os1-pill-ink primary" disabled={!path.trim()} onClick={() => void save()}>
                  Save file
                </button>
                {fileId && (
                  <ConfirmButton
                    label="Delete file"
                    onConfirm={() =>
                      void api.deleteFile(ws.id, fileId).then(async () => {
                        setFileId(null);
                        setPath("");
                        setContent("");
                        await load();
                        onChanged();
                      }, (e) => setNote(errMsg(e)))
                    }
                  />
                )}
                {note && <span style={{ fontSize: 13, color: note === "Saved." ? "var(--sage)" : "var(--crimson)" }}>{note}</span>}
              </div>
              {showHistory && (
                <div className="os1-scroll" style={{ maxHeight: 180, display: "grid", gap: 6 }}>
                  {history.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>No earlier versions.</div>}
                  {history.map((h, i) => (
                    <div key={String(h.id ?? i)} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                      <span className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)", width: 70 }}>
                        {when(Number(pick(h, "createdAt", "at", "timestamp")) || null)}
                      </span>
                      <span style={{ flex: 1 }}>{String(pick(h, "label", "summary", "message", "path", "reason") ?? `Version ${i + 1}`)}</span>
                      <ConfirmButton
                        label="Restore"
                        onConfirm={() =>
                          void api
                            .restoreWorkspace(ws.id, { versionId: h.id, id: h.id })
                            .then(async () => {
                              await load();
                              onChanged();
                              setNote("Restored.");
                            }, (e) => setNote(errMsg(e)))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: "var(--ink-dim)", fontSize: 15 }}>Create a workspace to give agents files to work in.</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Schedules

function SchedulesPane({
  api,
  agents,
  workspaces,
  onOpenThread,
}: {
  api: UaoApi;
  agents: AtlasAgent[];
  workspaces: AtlasWorkspace[];
  onOpenThread: (id: string) => void;
}) {
  const [items, setItems] = useState<AtlasSchedule[]>([]);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [task, setTask] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const narrow = useContext(NarrowContext);

  const load = useCallback(async () => {
    try {
      setItems(await api.schedules());
    } catch (e) {
      setNote(errMsg(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!agentId || !task.trim()) return;
    try {
      await api.createSchedule({ agentId, task: task.trim(), workspaceId: workspaceId || null });
      setTask("");
      await load();
    } catch (e) {
      setNote(errMsg(e));
    }
  };

  return (
    <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 20, height: "100%" }}>
      <Section title="Ambient tasks">
        <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, maxWidth: 640 }}>
          A schedule runs on its own once a day. Creating one is your consent for the writes it makes — there is no one at the
          approval checkpoint when it fires. Each run lands as a normal thread.
        </div>
        {items.length === 0 && <div style={{ fontSize: 14, color: "var(--ink-dim)" }}>No schedules yet.</div>}
        {items.map((s) => {
          const agent = agents.find((a) => a.id === s.agentId);
          const enabled = s.enabled !== false && s.paused !== true;
          return (
            <div
              key={s.id}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 14, background: "rgba(237, 215, 189, 0.4)" }}
            >
              <Glyph glyph={String(s.agentGlyph ?? agent?.glyph ?? "✦")} accent={agent?.accent} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15 }}>{String(pick(s, "task", "title", "name") ?? "Task")}</div>
                <div className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)", marginTop: 2 }}>
                  {String(s.agentName ?? agent?.name ?? "")}
                  {pick(s, "cron", "schedule", "time") ? ` · ${String(pick(s, "cron", "schedule", "time"))}` : " · daily"}
                  {pick(s, "nextRunAt") ? ` · next ${when(Number(s.nextRunAt))}` : ""}
                  {pick(s, "lastRunAt") ? ` · last ${when(Number(s.lastRunAt))}` : ""}
                  {enabled ? "" : " · paused"}
                </div>
              </div>
              <button
                type="button"
                className="os1-pill-ink"
                style={{ padding: "5px 12px", fontSize: 12 }}
                onClick={() =>
                  void api.runSchedule(s.id).then((r) => {
                    if (r?.threadId) onOpenThread(r.threadId);
                    else setNote("Started.");
                  }, (e) => setNote(errMsg(e)))
                }
              >
                Run now
              </button>
              <button
                type="button"
                className="os1-pill-ink"
                style={{ padding: "5px 12px", fontSize: 12 }}
                onClick={() => void api.updateSchedule(s.id, { enabled: !enabled }).then(load, (e) => setNote(errMsg(e)))}
              >
                {enabled ? "Pause" : "Resume"}
              </button>
              <ConfirmButton label="Delete" onConfirm={() => void api.deleteSchedule(s.id).then(load, (e) => setNote(errMsg(e)))} />
            </div>
          );
        })}
      </Section>

      <Section title="Add an ambient task">
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "180px 1fr 180px auto", gap: 10, alignItems: "center" }}>
          <select style={inputStyle} value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.glyph} {a.name}
              </option>
            ))}
          </select>
          <input style={inputStyle} value={task} placeholder="Every morning, …" onChange={(e) => setTask(e.target.value)} />
          <select style={inputStyle} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label="Workspace">
            <option value="">No workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button type="button" className="os1-pill-ink primary" disabled={!task.trim() || !agentId} onClick={() => void create()}>
            Schedule
          </button>
        </div>
        {note && <Notice text={note} onClose={() => setNote(null)} />}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Memory & Activity

function MemoryPane({ api, memories, onChanged }: { api: UaoApi; memories: AtlasMemory[]; onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, AtlasMemory[]>();
    for (const x of memories) m.set(x.agentId, [...(m.get(x.agentId) ?? []), x]);
    return [...m.values()];
  }, [memories]);
  return (
    <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 22, height: "100%" }}>
      {note && <Notice text={note} onClose={() => setNote(null)} />}
      {memories.length === 0 && <div style={{ color: "var(--ink-dim)", fontSize: 15 }}>No agent has saved a memory yet.</div>}
      {groups.map((list) => (
        <Section
          key={list[0].agentId}
          title={`${list[0].agentGlyph} ${list[0].agentName}`}
          right={<span className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>{list.length}</span>}
        >
          {list.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 14 }}>
              <span className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)", width: 54, paddingTop: 3 }}>
                {when(m.createdAt)}
              </span>
              <span style={{ flex: 1, lineHeight: 1.45, userSelect: "text" }}>{m.text}</span>
              <ConfirmButton label="Forget" onConfirm={() => void api.deleteAgentMemory(m.agentId, m.id).then(onChanged, (e) => setNote(errMsg(e)))} />
            </div>
          ))}
        </Section>
      ))}
    </div>
  );
}

function ActivityPane({ items, onOpenThread }: { items: AtlasActivity[]; onOpenThread: (id: string) => void }) {
  return (
    <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 8, height: "100%" }}>
      {items.length === 0 && <div style={{ color: "var(--ink-dim)", fontSize: 15 }}>No runs yet.</div>}
      {items.map((a) => (
        <button
          key={a.run.id}
          type="button"
          onClick={() => a.run.threadId && onOpenThread(a.run.threadId)}
          style={{
            display: "grid",
            gridTemplateColumns: "28px 1fr auto",
            gap: 12,
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 14,
            border: 0,
            background: "rgba(237, 215, 189, 0.32)",
            textAlign: "left",
            cursor: "pointer",
            color: "var(--ink)",
          }}
        >
          <Glyph glyph={a.agentGlyph} />
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.run.task || a.threadTitle}</div>
            <div className="os1-mono" style={{ fontSize: 9, color: "var(--ink-dim)", marginTop: 2 }}>
              {a.agentName} · {a.run.steps} steps · {a.run.toolCalls} tools · {a.run.model || "default"}
              {a.run.parentRunId ? " · after approval" : ""}
              {a.run.error ? ` · ${str(a.run.error, 60)}` : ""}
            </div>
          </span>
          <span style={{ display: "grid", justifyItems: "end", gap: 3 }}>
            <span className="os1-mono" style={{ fontSize: 10, color: statusTone(a.run.status) }}>
              {a.run.status}
            </span>
            <span className="os1-mono" style={{ fontSize: 9, color: "var(--ink-dim)" }}>
              {when(a.run.startedAt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Surface

/**
 * Atlas — your server's agent deck (Scout, Builder, Scribe, Operator) as a native OS1 surface:
 * streaming traces, approvals for every write, threads, agents, workspaces & files, ambient
 * schedules, agent memory and run activity. All calls go through the orchestrator's /os1/uao/atlas.
 */
export function AtlasSurface({ api, onBack }: { api: UaoApi; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("talk");
  const [me, setMe] = useState<AtlasMe | null>(null);
  const [agents, setAgents] = useState<AtlasAgent[]>([]);
  const [models, setModels] = useState<AtlasModel[]>([]);
  const [threads, setThreads] = useState<AtlasThread[]>([]);
  const [workspaces, setWorkspaces] = useState<AtlasWorkspace[]>([]);
  const [memories, setMemories] = useState<AtlasMemory[]>([]);
  const [activity, setActivity] = useState<AtlasActivity[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const narrow = useNarrow();
  const [showList, setShowList] = useState(false);

  const refresh = useCallback(async () => {
    const settled = await Promise.allSettled([
      api.me(),
      api.agents(),
      api.threads(),
      api.workspaces(),
      api.memory(),
      api.activity(),
    ]);
    const [m, a, t, w, mem, act] = settled;
    if (m.status === "fulfilled") setMe(m.value);
    if (a.status === "fulfilled") setAgents(a.value);
    if (t.status === "fulfilled") setThreads(t.value);
    if (w.status === "fulfilled") setWorkspaces(w.value);
    if (mem.status === "fulfilled") setMemories(mem.value);
    if (act.status === "fulfilled") setActivity(act.value);
    const failed = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? errMsg(failed.reason) : null);
    setLoaded(true);
  }, [api]);

  useEffect(() => {
    void refresh();
    void api.models().then(setModels, () => undefined);
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [api, refresh]);

  useEffect(() => {
    if (!agentId && agents[0]) setAgentId(agents[0].id);
  }, [agents, agentId]);

  // 1–4 picks an agent (like Atlas), Esc leaves a thread.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (tab === "talk" && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        const a = agents[Number(e.key) - 1];
        if (a) setAgentId(a.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agents, tab]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(() => {
      void api.search(q).then(setResults, () => setResults(null));
    }, 250);
    return () => window.clearTimeout(t);
  }, [api, query]);

  const openThread = (id: string | null) => {
    setTab("talk");
    setThreadId(id);
    setQuery("");
    setShowList(false);
  };

  const searchThreads = itemsOf<Record<string, unknown>>(results, "threads");
  const searchFiles = itemsOf<Record<string, unknown>>(results ? { items: results.files } : null);
  const searchMem = itemsOf<Record<string, unknown>>(results ? { items: results.memories } : null);

  return (
    <NarrowContext.Provider value={narrow}>
    <div
      style={{
        position: "fixed",
        inset: 0,
        padding: narrow
          ? "max(12px, calc(env(safe-area-inset-top, 0px) + 10px)) 10px max(76px, calc(env(safe-area-inset-bottom, 0px) + 76px))"
          : "34px 40px 84px",
        display: "grid",
        gridTemplateColumns: narrow ? "1fr" : "270px 1fr",
        gridTemplateRows: narrow ? "auto 1fr" : undefined,
        gap: narrow ? 10 : 20,
      }}
    >
      {/* Sidebar (a compact header with a Threads drawer on phones) */}
      <aside
        className="os1-glass"
        style={{
          padding: narrow ? 12 : 16,
          display: "grid",
          gridTemplateRows: narrow ? "auto" : "auto auto auto auto 1fr auto",
          gap: narrow ? 8 : 12,
          minHeight: 0,
          maxHeight: narrow && showList ? "60vh" : undefined,
          overflow: narrow ? "hidden" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="os1-label" style={{ color: "var(--on-coral-dim)", fontSize: 10 }}>
              Server agents
            </div>
            <div style={{ font: "300 26px/1.1 var(--font-sans)" }}>Atlas</div>
          </div>
          <span style={{ display: "flex", gap: 6 }}>
            {narrow && (
              <button type="button" className="os1-pill" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setShowList((v) => !v)}>
                {showList ? "Close" : "Threads"}
              </button>
            )}
            <button type="button" className="os1-pill" style={{ padding: "5px 12px", fontSize: 12 }} onClick={onBack}>
              Back
            </button>
          </span>
        </div>
        <button type="button" className="os1-pill" onClick={() => openThread(null)}>
          + New task
        </button>
        <nav style={{ display: "grid", gridTemplateColumns: narrow ? "repeat(3, 1fr)" : "1fr 1fr", gap: 6 }} aria-label="Atlas sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-active={tab === t.id}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: 0,
                cursor: "pointer",
                font: "500 11px var(--font-sans)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: tab === t.id ? "var(--paper)" : "var(--on-coral-dim)",
                background: tab === t.id ? "rgba(255, 253, 249, 0.22)" : "transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {(!narrow || showList) && <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search threads, files, memory…"
          aria-label="Search Atlas"
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid rgba(255, 253, 249, 0.3)",
            background: "rgba(255, 253, 249, 0.1)",
            color: "var(--paper)",
            font: "400 13px var(--font-sans)",
            outline: "none",
          }}
        />}
        {(!narrow || showList) && <div className="os1-scroll" style={{ minHeight: 0, maxHeight: narrow ? "34vh" : undefined, display: "grid", alignContent: "start", gap: 2 }}>
          {results ? (
            <>
              {[...searchThreads, ...searchFiles, ...searchMem].length === 0 && (
                <div style={{ fontSize: 13, color: "var(--on-coral-dim)", padding: 8 }}>No matches.</div>
              )}
              {searchThreads.map((t) => (
                <button key={`t${String(t.id)}`} type="button" onClick={() => openThread(String(t.id))} style={rowStyle(false)}>
                  ⌘ {String(t.title ?? "Thread")}
                </button>
              ))}
              {searchFiles.map((f, i) => (
                <button key={`f${i}`} type="button" onClick={() => setTab("workspaces")} style={rowStyle(false)}>
                  ▤ {String(f.workspaceName ?? "")} / {String(f.path ?? "")}
                </button>
              ))}
              {searchMem.map((m, i) => (
                <button key={`m${i}`} type="button" onClick={() => setTab("memory")} style={rowStyle(false)}>
                  ✦ {String(m.agentName ?? "")}: {str(m.text, 60)}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="os1-label" style={{ color: "var(--on-coral-dim)", fontSize: 10, padding: "4px 8px" }}>
                Threads
              </div>
              {threads.length === 0 && loaded && <div style={{ fontSize: 13, color: "var(--on-coral-dim)", padding: 8 }}>No threads yet.</div>}
              {threads.map((t) =>
                renaming === t.id ? (
                  <input
                    key={t.id}
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenaming(null);
                      if (e.key === "Enter" && renameText.trim()) {
                        void api.renameThread(t.id, renameText.trim()).then(refresh, (err) => setError(errMsg(err)));
                        setRenaming(null);
                      }
                    }}
                    style={{ ...inputStyle, padding: "6px 10px", fontSize: 13 }}
                  />
                ) : (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button type="button" onClick={() => openThread(t.id)} style={{ ...rowStyle(tab === "talk" && t.id === threadId), flex: 1 }} title={t.title}>
                      <span style={{ opacity: 0.7, marginRight: 6 }}>{t.agentGlyph}</span>
                      {t.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${t.title}`}
                      title="Rename"
                      onClick={() => {
                        setRenaming(t.id);
                        setRenameText(t.title);
                      }}
                      style={iconBtn}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${t.title}`}
                      title="Delete"
                      onClick={() =>
                        void api.deleteThread(t.id).then(() => {
                          if (threadId === t.id) setThreadId(null);
                          void refresh();
                        }, (err) => setError(errMsg(err)))
                      }
                      style={iconBtn}
                    >
                      ✕
                    </button>
                  </div>
                ),
              )}
            </>
          )}
        </div>}
        {!narrow && <div style={{ borderTop: "1px solid rgba(255, 253, 249, 0.18)", paddingTop: 10, fontSize: 12, color: "var(--on-coral-dim)" }}>
          {me ? (
            <>
              <div style={{ color: "var(--paper)" }}>{me.user?.name}</div>
              <div className="os1-mono" style={{ fontSize: 10 }}>
                {me.usage?.used} of {me.usage?.limit} runs today
                {me.capabilities?.backend ? ` · ${me.capabilities.backend.reachable ? `${me.capabilities.backend.models} models` : "backend offline"}` : ""}
              </div>
            </>
          ) : (
            <div className="os1-mono" style={{ fontSize: 10 }}>{loaded ? "Atlas offline" : "Connecting…"}</div>
          )}
        </div>}
      </aside>

      {/* Main */}
      <section
        className="os1-paper-card"
        style={{ padding: narrow ? "14px 14px" : "22px 26px", display: "grid", gridTemplateRows: "auto 1fr", gap: 14, minHeight: 0, borderRadius: narrow ? 18 : undefined }}
      >
        <div>{error && <Notice text={`Atlas: ${error}`} onClose={() => setError(null)} />}</div>
        <div style={{ minHeight: 0 }}>
          {!loaded ? (
            <div style={{ color: "var(--ink-dim)" }}>Opening Atlas…</div>
          ) : tab === "talk" ? (
            <TalkPane
              api={api}
              agents={agents}
              workspaces={workspaces}
              threadId={threadId}
              onThread={(id) => setThreadId(id)}
              onChanged={() => void refresh()}
              agentId={agentId}
              setAgentId={setAgentId}
            />
          ) : tab === "agents" ? (
            <AgentsPane api={api} agents={agents} models={models} memories={memories} onChanged={() => void refresh()} />
          ) : tab === "workspaces" ? (
            <WorkspacesPane api={api} workspaces={workspaces} onChanged={() => void refresh()} />
          ) : tab === "schedules" ? (
            <SchedulesPane api={api} agents={agents} workspaces={workspaces} onOpenThread={openThread} />
          ) : tab === "memory" ? (
            <MemoryPane api={api} memories={memories} onChanged={() => void refresh()} />
          ) : (
            <ActivityPane items={activity} onOpenThread={openThread} />
          )}
        </div>
      </section>
    </div>
    </NarrowContext.Provider>
  );
}

function rowStyle(active: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "7px 10px",
    borderRadius: 10,
    border: 0,
    textAlign: "left",
    cursor: "pointer",
    font: "400 13px var(--font-sans)",
    color: "var(--paper)",
    background: active ? "rgba(255, 253, 249, 0.2)" : "transparent",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

const iconBtn: CSSProperties = {
  border: 0,
  background: "transparent",
  color: "var(--on-coral-dim)",
  cursor: "pointer",
  fontSize: 12,
  padding: "4px 5px",
  borderRadius: 6,
};
