import { Presence, type PresenceState } from "../components/Presence";
import { SayChips } from "../components/SayChips";
import { useNarrow } from "../components/useNarrow";
import type { ActiveSurface, MoodState, WorkItem } from "../types";

type Levels = { current: { agent: number; user: number } };

const SHAPE_COLORS = ["#fffdf9", "#edd7bd", "#d9a53a", "#8fa88f", "#4a78c8", "#8a5866"];

/**
 * Paper 06 — Desktop Home: calm coral horizon with softly drifting translucent shapes,
 * one per active background run. Never cluttered; voice stays front and center.
 */
export function HomeSurface({
  runs,
  mood,
  presence,
  levels,
  onOpenSurface,
  onSay,
}: {
  runs: WorkItem[];
  mood: MoodState;
  presence: PresenceState;
  levels: Levels;
  onOpenSurface: (s: ActiveSurface) => void;
  onSay: (phrase: string) => void;
}) {
  const narrow = useNarrow();
  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "waiting");
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", overflowY: "auto", overflowX: "hidden", padding: narrow ? "52px 16px 80px" : "64px 56px 96px" }}>
      {/* Soft warm horizon band */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: "56%",
          height: 1,
          background: "linear-gradient(90deg, transparent 5%, rgba(255,253,249,0.22) 50%, transparent 95%)",
          pointerEvents: "none",
        }}
      />

      {/* Top corners */}
      <div
        className="os1-label"
        style={{
          position: "fixed",
          top: narrow ? 14 : 44,
          left: narrow ? 14 : 52,
          display: "flex",
          gap: narrow ? 8 : 12,
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--paper)" }} />
        <span>Samantha</span>
        <span style={{ color: "var(--on-coral-dim)" }}>
          {activeRuns.length > 0 ? `${activeRuns.length} running` : "Calm horizon"}
        </span>
      </div>
      <div
        className="os1-mono os1-hide-narrow"
        style={{
          position: "fixed",
          top: narrow ? 14 : 44,
          right: narrow ? "max(14px, env(safe-area-inset-right, 0px))" : 52,
          color: "var(--on-coral-dim)",
          zIndex: 10,
        }}
      >
        Warmth {Math.round(mood.warmth * 100)}%
      </div>

      {/* Floating translucent shapes representing active work */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 1080,
          display: "grid",
          justifyItems: "center",
          gap: narrow ? 20 : 32,
        }}
      >
        <Presence state={presence} getLevel={() => levels.current.agent} size={narrow ? 220 : 340} />

        {activeRuns.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 20,
              maxWidth: 920,
            }}
          >
            {activeRuns.map((run, idx) => {
              const accent = SHAPE_COLORS[idx % SHAPE_COLORS.length];
              const isCircle = idx % 2 === 0;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onOpenSurface("swarm")}
                  className="os1-glass"
                  style={{
                    padding: "16px 22px",
                    borderRadius: isCircle ? 999 : 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    animation: `os1-float ${4.2 + idx * 0.7}s ease-in-out infinite`,
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: isCircle ? "50%" : 3,
                      background: accent,
                      boxShadow: `0 0 12px ${accent}`,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ font: "400 15px/1.25 var(--font-sans)", color: "var(--paper)" }}>{run.label}</div>
                    <div className="os1-mono" style={{ fontSize: 10, color: "var(--on-coral-dim)", marginTop: 3 }}>
                      {run.status === "waiting" ? "Needs your okay" : "Working in background"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="os1-lead" style={{ margin: 0, color: "var(--on-coral-dim)", textAlign: "center" }}>
            Everything is quiet. Just speak whenever you're ready.
          </p>
        )}

        <SayChips
          chips={
            mood.compactMode
              ? ["Show me my inbox", "Just talk"]
              : ["Show me my inbox", "Show me your computer", "Show me what you remember", "Just talk"]
          }
          onSay={onSay}
        />
      </div>
    </div>
  );
}

/**
 * Paper 11 — Swarm ("Many of her"): each parallel Hermes run rendered as an orbital floating card
 * with live status and speakable control chips.
 */
export function SwarmSurface({
  runs,
  onSay,
  onBack,
}: {
  runs: WorkItem[];
  onSay: (phrase: string) => void;
  onBack: () => void;
}) {
  const narrow = useNarrow();
  return (
    <div
      className="os1-page"
      style={{
        position: "fixed",
        inset: 0,
        padding: narrow ? "max(14px, calc(env(safe-area-inset-top, 0px) + 12px)) 16px max(80px, calc(env(safe-area-inset-bottom, 0px) + 80px))" : "56px 56px 96px",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: narrow ? 16 : 28,
        maxWidth: 1180,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="os1-label" style={{ color: "var(--on-coral-dim)" }}>
            11 · Swarm
          </div>
          <h2 style={{ margin: "6px 0 0", font: `200 ${narrow ? 28 : 40}px/1.1 var(--font-sans)` }}>Many of her</h2>
        </div>
        <button type="button" className="os1-pill" onClick={onBack}>
          Back to talking
        </button>
      </div>

      <div
        className="os1-scroll"
        style={{
          display: "grid",
          gridTemplateColumns: narrow ? "1fr" : "repeat(auto-fill, minmax(290px, 1fr))",
          gap: 18,
          alignContent: "start",
        }}
      >
        {runs.length === 0 ? (
          <div className="os1-glass" style={{ padding: 28, gridColumn: "1 / -1", textAlign: "center" }}>
            <p className="os1-lead" style={{ margin: 0, color: "var(--on-coral-dim)" }}>
              No background runs right now. Ask Samantha to look into something and it will orbit here.
            </p>
          </div>
        ) : (
          runs.map((run, idx) => {
            const running = run.status === "running";
            const waiting = run.status === "waiting";
            return (
              <div
                key={run.id}
                className="os1-paper-card"
                style={{
                  padding: 22,
                  display: "grid",
                  gap: 14,
                  animation: running ? `os1-float ${4.5 + (idx % 3) * 0.8}s ease-in-out infinite` : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span
                    className="os1-mono"
                    style={{
                      fontSize: 11,
                      color: waiting ? "var(--crimson)" : running ? "var(--coral)" : "var(--sage)",
                    }}
                  >
                    ● {run.status}
                  </span>
                  <span className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
                    {run.id.slice(0, 10)}
                  </span>
                </div>
                <div style={{ font: "400 18px/1.3 var(--font-sans)", color: "var(--ink)" }}>{run.label}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="os1-pill-ink"
                    onClick={() => onSay(`How is ${run.label} going?`)}
                  >
                    “How's it going?”
                  </button>
                  {(running || waiting) && (
                    <button
                      type="button"
                      className="os1-pill-ink danger"
                      onClick={() => onSay(`Stop ${run.label}`)}
                    >
                      “Stop it”
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <SayChips chips={["How's it going?", "Show me your computer", "Back to talking"]} onSay={onSay} />
      </div>
    </div>
  );
}
