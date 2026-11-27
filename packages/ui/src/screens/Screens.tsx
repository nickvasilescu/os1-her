import { type FormEvent, useEffect, useRef, useState } from "react";
import { InfinityLoader } from "../components/InfinityLoader";
import { Presence, type PresenceState } from "../components/Presence";
import { SayChips } from "../components/SayChips";
import { useNarrow } from "../components/useNarrow";
import { sound } from "../sound";
import type { AgentState, Os1State, WorkItem } from "../useOs1";

type Levels = { current: { agent: number; user: number } };

export function presenceFor(agent: AgentState, phase: Os1State["phase"], work: WorkItem[]): PresenceState {
  if (phase === "asleep") return "asleep";
  if (agent === "speaking") return "speaking";
  if (agent === "thinking") return "thinking";
  if (work.some((w) => w.status === "running")) return "working";
  return "listening";
}

function levelGetter(levels: Levels, presence: PresenceState) {
  return () => (presence === "speaking" ? levels.current.agent : levels.current.user);
}

const corner = (pos: "tl" | "tr" | "bl" | "br" | "bc", narrow = false): React.CSSProperties => ({
  position: "fixed",
  ...(pos.includes("t")
    ? { top: narrow ? "max(12px, calc(env(safe-area-inset-top, 0px) + 10px))" : 56 }
    : { bottom: narrow ? "max(66px, calc(env(safe-area-inset-bottom, 0px) + 66px))" : 52 }),
  ...(pos === "bc"
    ? { left: 16, right: 16, textAlign: "center" }
    : pos.includes("l")
      ? { left: narrow ? "max(14px, env(safe-area-inset-left, 0px))" : 60 }
      : { right: narrow ? "max(14px, env(safe-area-inset-right, 0px))" : 60 }),
  color: "var(--on-coral-dim)",
  zIndex: 10,
});

/* ------------------------------------------------------------------ preflight */

/** Before the scene starts: the name to greet, then the mic permission prompt. */
export function Preflight({
  onBegin,
  busy,
  error,
}: {
  onBegin: (name: string) => void;
  busy: boolean;
  error?: string;
}) {
  const [name, setName] = useState("");
  const narrow = useNarrow();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onBegin(name.trim());
  };
  return (
    <form
      onSubmit={submit}
      style={{
        display: "grid",
        justifyItems: "center",
        gap: narrow ? 24 : 36,
        width: "100%",
        maxWidth: 420,
        padding: "0 16px",
        boxSizing: "border-box",
      }}
      className="os1-fade"
    >
      <div className="os1-display" style={{ fontSize: narrow ? 52 : 64 }}>
        UAOS<sup style={{ fontSize: narrow ? 18 : 22, verticalAlign: "top" }}>1</sup>
      </div>
      <label style={{ display: "grid", justifyItems: "center", gap: 14, width: "100%" }}>
        <span className="os1-label" style={{ color: "var(--on-coral-dim)" }}>
          What should it call you?
        </span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your first name"
          style={{
            width: "100%",
            maxWidth: 360,
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--on-coral-faint)",
            color: "var(--on-coral)",
            font: `200 ${narrow ? 28 : 34}px var(--font-sans)`,
            textAlign: "center",
            padding: "6px 0",
            outline: "none",
          }}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: "11px 26px",
          borderRadius: 999,
          border: "none",
          background: "var(--paper)",
          color: "var(--coral-deep)",
          font: "400 16px var(--font-sans)",
          cursor: "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Starting…" : "Begin"}
      </button>
      <p className="os1-label" style={{ fontSize: 11, color: "var(--on-coral-dim)", maxWidth: 420, textAlign: "center" }}>
        UAOS1 listens through your microphone. You'll be asked to allow it.
      </p>
      {error && <p style={{ color: "var(--paper)", font: "300 15px var(--font-sans)" }}>{error}</p>}
    </form>
  );
}

/* ------------------------------------------------------------------ 01 boot */

export function Boot({ levels }: { levels: Levels }) {
  const narrow = useNarrow();
  return (
    <>
      <div style={{ ...corner("tl", narrow), display: "flex", alignItems: "baseline", gap: 18, color: "var(--on-coral)" }}>
        <span style={{ font: `200 ${narrow ? 24 : 30}px var(--font-sans)` }}>
          UAOS<sup style={{ fontSize: 13 }}>1</sup>
        </span>
        <span className="os1-mono">Build 1.0</span>
      </div>
      <div className="os1-mono" style={corner("tr", narrow)}>
        Voice-first realtime core
      </div>
      <div style={{ display: "grid", justifyItems: "center", gap: narrow ? 24 : 40, width: "100%", padding: "0 16px", boxSizing: "border-box" }} className="os1-fade">
        <Presence state="listening" getLevel={() => levels.current.agent * 0.4} size={narrow ? 220 : 360} />
        <Progress fraction={0.05} animate seconds={14} />
        <span className="os1-label" style={{ fontSize: 11 }}>
          Initializing UAOS¹
        </span>
      </div>
      <div className="os1-mono" style={corner("bl", narrow)}>
        Audio · full-duplex ready
      </div>
      <div className="os1-mono" style={corner("br", narrow)}>
        Mic on · camera off
      </div>
    </>
  );
}

function Progress({ fraction, animate = false, seconds = 6 }: { fraction: number; animate?: boolean; seconds?: number }) {
  const [f, setF] = useState(fraction);
  useEffect(() => {
    if (!animate) return;
    const started = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      setF(Math.min(1, fraction + ((t - started) / (seconds * 1000)) * (1 - fraction)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, fraction, seconds]);
  return (
    <div style={{ width: 240, height: 1, background: "var(--on-coral-faint)", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${f * 100}%`,
          background: "var(--paper)",
          boxShadow: "0 0 8px rgba(255,253,249,0.8)",
          height: 2,
          top: -0.5,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ 02 setup */

const SETUP_STEP: Partial<Record<Os1State["phase"], number>> = {
  operator_q1: 2,
  operator_q1_hesitance: 2,
  operator_q2: 3,
  operator_q3: 4,
};

export function Setup({ state, levels, onSay }: { state: Os1State; levels: Levels; onSay: (p: string) => void }) {
  const narrow = useNarrow();
  const step = SETUP_STEP[state.phase] ?? 1;
  const presence = state.agentState === "speaking" ? "listening" : "listening";
  return (
    <>
      <div style={{ ...corner("tl", narrow), display: "flex", alignItems: "center", gap: 10 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            style={{ width: narrow ? 18 : 28, height: 2, background: i <= step ? "var(--paper)" : "var(--on-coral-faint)" }}
          />
        ))}
        <span className="os1-label" style={{ fontSize: 11, marginLeft: 12, color: "var(--on-coral)" }}>
          Setup {step} / 5
        </span>
      </div>
      <div style={{ display: "grid", justifyItems: "center", gap: narrow ? 20 : 28, maxWidth: 900, width: "100%", padding: "0 16px", boxSizing: "border-box", textAlign: "center" }}>
        <Presence state={presence} getLevel={levelGetter(levels, presence)} size={narrow ? 200 : 320} />
        <div key={state.agentLine} className="os1-spoken os1-fade" style={{ minHeight: narrow ? 70 : 116, overflowWrap: "break-word" }}>
          {state.agentLine}
        </div>
        <div className="os1-heard" style={{ minHeight: 26, overflowWrap: "break-word" }}>
          {state.userLine && `“${state.userLine}”`}
        </div>
        <SayChips chips={state.chips} onSay={onSay} />
      </div>
      <div className="os1-label" style={{ ...corner("bc", narrow), fontSize: 11 }}>
        ● Listening — just speak
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 03 waking */

export function Waking({ levels }: { levels: Levels }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const narrow = useNarrow();

  useEffect(() => {
    sound.wake();
    const canvas = canvasRef.current;
    if (!canvas) return;
    let loader: InfinityLoader | null = null;
    try {
      // ~5.5 s continuous helix → breathing ring morph, matching the ~6 s server initiation window.
      loader = new InfinityLoader(canvas, { mode: "waking", fixedSize: narrow ? 240 : 340 });
      loader.start();
      loader.triggerTransition();
    } catch {
      setWebglFailed(true);
    }
    return () => {
      loader?.destroy();
    };
  }, [narrow]);

  return (
    <div style={{ display: "grid", justifyItems: "center", gap: narrow ? 24 : 36, width: "100%", padding: "0 16px", boxSizing: "border-box" }} className="os1-fade">
      {webglFailed ? (
        <Presence state="thinking" getLevel={() => levels.current.agent} size={narrow ? 220 : 380} />
      ) : (
        <canvas
          ref={canvasRef}
          aria-label="Initiating UAOS1"
          style={{
            width: narrow ? 240 : 340,
            height: narrow ? 240 : 340,
            maxWidth: "100%",
            display: "block",
            marginTop: narrow ? -14 : -28,
            marginBottom: narrow ? -14 : -28,
          }}
        />
      )}
      <Progress fraction={0.1} animate />
      <p className="os1-lead" style={{ textAlign: "center", margin: 0, color: "var(--on-coral)", fontSize: narrow ? 17 : undefined }}>
        Please wait while your operating system
        <br />
        becomes someone.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ 04 conversation */

export function Conversation({
  state,
  levels,
  onSay,
}: {
  state: Os1State;
  levels: Levels;
  onSay: (p: string) => void;
}) {
  const narrow = useNarrow();
  const presence = presenceFor(state.agentState, state.phase, state.work);
  const running = state.work.filter((w) => w.status === "running" || w.status === "waiting").length;
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const statusWord = state.voiceOff
    ? running > 0
      ? "Voice off · working"
      : "Voice off"
    : { asleep: "Asleep", listening: "Listening", thinking: "Thinking", speaking: "Speaking", working: "Working" }[presence];
  return (
    <>
      <div className="os1-label" style={{ ...corner("tl", narrow), display: "flex", gap: narrow ? 8 : 14, alignItems: "center" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--paper)" }} />
        <span style={{ color: "var(--on-coral)" }}>Samantha</span>
        <span>{statusWord}</span>
      </div>
      <div className="os1-label" style={corner("tr", narrow)}>
        {clock.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
      </div>
      <div
        style={{
          display: "grid",
          justifyItems: "center",
          gap: narrow ? 18 : 30,
          maxWidth: 1000,
          width: "100%",
          padding: narrow ? "0 14px" : undefined,
          boxSizing: "border-box",
          textAlign: "center",
        }}
      >
        <Presence state={presence} getLevel={levelGetter(levels, presence)} size={narrow ? 240 : 460} />
        <div className="os1-heard" style={{ minHeight: 26, overflowWrap: "break-word", maxWidth: "100%" }}>
          {state.userLine && `You — “${state.userLine}”`}
        </div>
        <div
          key={state.agentLine.slice(0, 24)}
          className="os1-spoken os1-fade"
          style={{ minHeight: narrow ? 72 : 120, width: "100%", maxWidth: "100%", overflowWrap: "break-word", wordBreak: "break-word" }}
        >
          {state.agentLine}
        </div>
        <SayChips chips={state.chips} onSay={onSay} />
      </div>
      {running > 0 && (
        <div className="os1-label" style={{ ...corner("bl", narrow), display: "flex", gap: 12, alignItems: "center" }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "1.5px solid var(--on-coral-faint)",
              borderTopColor: "var(--paper)",
            }}
          />
          {running} {running === 1 ? "thing" : "things"} in the background
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ 05 naming */

export function Naming({ state, onSay }: { state: Os1State; onSay: (p: string) => void }) {
  const narrow = useNarrow();
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 18, textAlign: "center", width: "100%", padding: "0 16px", boxSizing: "border-box" }} className="os1-fade">
      <div className="os1-lead" style={{ color: "var(--on-coral-dim)", fontSize: narrow ? 20 : 26 }}>
        {state.userLine && `“${state.userLine}”`}
      </div>
      <div style={{ font: `400 ${narrow ? 84 : 220}px/1.1 var(--font-sign)`, color: "var(--paper)", marginTop: narrow ? 0 : -10 }}>Samantha</div>
      <div className="os1-lead" style={{ maxWidth: 560, color: "var(--on-coral)", minHeight: 64, fontSize: narrow ? 16 : undefined, overflowWrap: "break-word" }}>
        {state.agentLine}
      </div>
      <div style={{ marginTop: narrow ? 24 : 60 }}>
        <SayChips chips={state.chips} onSay={onSay} />
      </div>
    </div>
  );
}