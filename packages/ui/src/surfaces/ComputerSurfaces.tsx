import { useNarrow } from "../components/useNarrow";
import { EmbedFrame, mobileAppLauncher, moonlightBridge, openExternal } from "../components/EmbedFrame";
import type { UaoApi } from "../uao/api";
import { useEffect, useRef, useState } from "react";
import type { VncSession } from "../useOs1";
import type { CuaState, HerComputerState, Os1Config } from "../types";

/**
 * Paper 09 — Computer use on YOUR machine (embedded Cua Driver in bounded mode + instant kill switch).
 */
export function YourComputerSurface({
  cua,
  onRevoke,
  onBack,
}: {
  cua: CuaState;
  onRevoke: () => void;
  onBack: () => void;
}) {
  return (
    <div
      className="os1-page"
      style={{
        position: "fixed",
        inset: 0,
        padding: "52px 56px 96px",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: 24,
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <div className="os1-label" style={{ color: "var(--on-coral-dim)" }}>
            09 · Your computer · Cua Driver bounded
          </div>
          <h2 style={{ margin: "6px 0 0", font: "200 40px/1.1 var(--font-sans)" }}>What I'm doing on your Mac</h2>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={onRevoke}
            style={{
              padding: "11px 22px",
              borderRadius: 999,
              border: "none",
              background: "var(--crimson)",
              color: "var(--paper)",
              font: "500 14px var(--font-sans)",
              cursor: "pointer",
              boxShadow: "0 10px 28px rgba(168, 39, 60, 0.35)",
            }}
          >
            “Let me drive” · Revoke all
          </button>
          <button type="button" className="os1-pill" onClick={onBack}>
            Back to talking
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 20, minHeight: 0 }}>
        {/* Live activity stream */}
        <div className="os1-paper-card os1-scroll" style={{ padding: 24, display: "grid", gap: 14, alignContent: "start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="os1-label" style={{ color: "var(--ink-dim)" }}>
              Activity
            </span>
            <span
              className="os1-mono"
              style={{
                fontSize: 11,
                color: cua.connected ? "var(--teal)" : "var(--ink-dim)",
              }}
            >
              ● {cua.connected ? cua.status : "Tunnel standby"}
            </span>
          </div>

          {cua.recentActivity.length === 0 ? (
            <p style={{ margin: "12px 0", color: "var(--ink-dim)", font: "300 16px/1.5 var(--font-sans)" }}>
              Samantha hasn't touched your Mac. She always prefers Composio and her own cloud computer first, and asks
              before every action here.
            </p>
          ) : (
            cua.recentActivity.map((act) => (
              <div
                key={act.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(56, 40, 30, 0.04)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ font: "500 14px var(--font-sans)", color: "var(--ink)" }}>{act.title}</div>
                  {act.detail && (
                    <div style={{ font: "300 13px var(--font-sans)", color: "var(--ink-dim)", marginTop: 2 }}>
                      {act.detail}
                    </div>
                  )}
                </div>
                <span className="os1-mono" style={{ fontSize: 10, color: "var(--coral)", alignSelf: "center" }}>
                  {act.status}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Bounded v3 capability manifest */}
        <div className="os1-studio-card os1-scroll" style={{ padding: 24, display: "grid", gap: 16, alignContent: "start" }}>
          <div className="os1-label" style={{ color: "var(--ink-dim)" }}>
            Bounded safety fence · v{cua.manifest.version}
          </div>
          <div>
            <div className="os1-mono" style={{ fontSize: 11, color: "var(--teal)", marginBottom: 6 }}>
              Allowed apps
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cua.manifest.allowedApps.map((app) => (
                <span
                  key={app}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(56,40,30,0.08)",
                    font: "400 12px var(--font-sans)",
                  }}
                >
                  {app}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 6 }}>
              Allowed folders
            </div>
            <div style={{ font: "400 13px/1.6 var(--font-mono)", color: "var(--ink)" }}>
              {cua.manifest.allowedPaths.join(" · ")}
            </div>
          </div>
          <div>
            <div className="os1-mono" style={{ fontSize: 11, color: "var(--crimson)", marginBottom: 6 }}>
              Always blocked
            </div>
            <div style={{ font: "300 13px/1.6 var(--font-sans)", color: "var(--ink-dim)" }}>
              {cua.manifest.blockedApps.join(", ")} · Raw display capture off · Telemetry off
            </div>
          </div>
          <div className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
            Global kill switch: say “Let me drive” or press ⌘⇧Esc
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center" }} className="os1-mono">
        Outbound authenticated tunnel · no local ports exposed
      </div>
    </div>
  );
}

/**
 * Paper 10 — Her own computer (Orgo cloud VM): embedded noVNC viewer over orchestrator WSS proxy
 * (read-only by default, toggleable control) + "While you were away" log.
 */
export function HerComputerSurface({
  herComputer,
  config,
  fetchVncSession,
  suspended = false,
  uaoApi,
  onBack,
}: {
  herComputer: HerComputerState;
  config: Os1Config;
  fetchVncSession: () => Promise<VncSession>;
  suspended?: boolean;
  uaoApi?: UaoApi;
  onBack: () => void;
}) {
  const narrow = useNarrow();
  const moon = moonlightBridge();
  const [moonOk, setMoonOk] = useState(false);
  const [sun, setSun] = useState<{ reachable: boolean; streaming?: boolean; hostname?: string; host: string; app?: string } | null>(null);
  const [moonMsg, setMoonMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void moon?.status().then((st) => alive && setMoonOk(st.available), () => undefined);
    const poll = () => void uaoApi?.sunshine().then((st) => alive && setSun(st), () => alive && setSun(null));
    poll();
    const id = window.setInterval(poll, 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [moon, uaoApi]);
  const watchInMoonlight = async () => {
    const res = await moon?.stream();
    setMoonMsg(res?.ok ? "Opening Moonlight…" : res?.error || "Moonlight isn't available here.");
    window.setTimeout(() => setMoonMsg(null), 5000);
  };
  const [embed, setEmbed] = useState<{ url: string; label: string } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<{ viewOnly: boolean; disconnect: () => void } | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "preview">("connecting");
  const [error, setError] = useState("");
  const [viewOnly, setViewOnly] = useState(true);

  useEffect(() => {
    if (window.location.hash.includes("preview=")) {
      setStatus("preview");
      return;
    }
    let alive = true;
    void (async () => {
      try {
        setStatus("connecting");
        const sess = await fetchVncSession();
        if (!alive) return;
        if (sess.mode === "embed") {
          setEmbed({ url: sess.embedUrl, label: sess.label || "Remote desktop" });
          setStatus("connected");
          return;
        }
        if (!screenRef.current) return;
        const { default: RFB } = await import("@novnc/novnc");
        if (!alive || !screenRef.current) return;

        const baseWs = config.orchestratorUrl.replace(/\/$/, "").replace(/^http/, "ws");
        const tokenQ = config.clientToken ? `?token=${encodeURIComponent(config.clientToken)}` : "";
        const wsUrl = `${baseWs}${sess.wsPath}${tokenQ}`;

        screenRef.current.innerHTML = "";
        const rfb = new RFB(screenRef.current, wsUrl, {
          credentials: { password: sess.password || "" },
        });
        rfb.viewOnly = sess.readOnlyDefault;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.clipViewport = false;
        rfb.qualityLevel = 6;
        rfb.compressionLevel = 2;
        rfb.showDotCursor = true;
        rfb.addEventListener("connect", () => alive && setStatus("connected"));
        rfb.addEventListener("disconnect", () => {
          if (!alive) return;
          setError((e) => e || `No desktop stream answered at ${sess.upstream || "the VNC upstream"}.`);
          setStatus("error");
        });
        rfb.addEventListener("securityfailure", () => {
          if (!alive) return;
          setError("VNC authentication failed");
          setStatus("error");
        });
        rfbRef.current = rfb;
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      alive = false;
      try {
        rfbRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
    };
  }, [config.clientToken, config.orchestratorUrl, fetchVncSession]);

  const toggleControl = () => {
    const next = !viewOnly;
    setViewOnly(next);
    if (rfbRef.current) rfbRef.current.viewOnly = next;
  };

  return (
    <div
      className="os1-page"
      style={{
        position: "fixed",
        inset: 0,
        padding: narrow
          ? "max(14px, calc(env(safe-area-inset-top, 0px) + 12px)) 12px max(80px, calc(env(safe-area-inset-bottom, 0px) + 80px))"
          : "48px 52px 92px",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gap: narrow ? 12 : 20,
        maxWidth: 1320,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: narrow ? 10 : 16, flexWrap: "wrap" }}>
        <div>
          <div className="os1-label" style={{ color: "var(--on-coral-dim)" }}>
            10 · Her own computer · {embed ? embed.label : "VNC stream"}
          </div>
          <h2 style={{ margin: "6px 0 0", font: `200 ${narrow ? 28 : 38}px/1.1 var(--font-sans)` }}>Samantha's desktop</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", whiteSpace: "nowrap" }}>
          {moonOk && (
            <button type="button" className="os1-pill" style={{ background: "var(--paper)", color: "var(--coral-deep)" }} onClick={() => void watchInMoonlight()}>
              “Stream the desktop” · Moonlight
            </button>
          )}
          {embed ? (
            <button type="button" className="os1-pill" onClick={() => openExternal(embed.url)}>
              Open full screen ↗
            </button>
          ) : (
            <button type="button" className="os1-pill" onClick={toggleControl}>
              {viewOnly ? "“Take control” (watching)" : "“Watch only” (interactive)"}
            </button>
          )}
          <button type="button" className="os1-pill" onClick={onBack}>
            Back to talking
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: narrow ? "1fr" : "2.1fr 1fr",
          gridTemplateRows: narrow ? "minmax(320px, 1fr) auto" : undefined,
          gap: narrow ? 12 : 20,
          minHeight: 0,
        }}
      >
        {/* Live noVNC viewport */}
        <div
          style={{
            position: "relative",
            borderRadius: 22,
            overflow: "hidden",
            background: "#1c0e09",
            boxShadow: "0 24px 64px rgba(56, 20, 10, 0.34)",
            border: "1px solid rgba(255,253,249,0.18)",
          }}
        >
          {embed ? (
            <EmbedFrame url={embed.url} title={embed.label} suspended={suspended} />
          ) : (
            <div ref={screenRef} style={{ width: "100%", height: "100%" }} />
          )}
          {status !== "connected" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "radial-gradient(circle at 50% 45%, rgba(205,79,51,0.22), rgba(28,14,9,0.94))",
                textAlign: "center",
                padding: 28,
              }}
            >
              <div>
                <div className="os1-mono" style={{ color: "var(--on-coral-dim)", marginBottom: 8 }}>
                  {status === "connecting"
                    ? "Connecting to her cloud computer via noVNC…"
                    : status === "preview"
                      ? `Live noVNC stream · ${herComputer.resolution} · read-only`
                      : "Desktop stream paused"}
                </div>
                {error && <div style={{ fontSize: 13, color: "var(--studio)" }}>{error}</div>}
                {status === "error" && (
                  <div style={{ fontSize: 12, color: "var(--on-coral-dim)", marginTop: 10, maxWidth: 420 }}>
                    Set OS1_HER_COMPUTER_URL (e.g. a Guacamole connection link) or OS1_VNC_UPSTREAM_WS in .env, then restart.
                  </div>
                )}
              </div>
            </div>
          )}
          {!embed && <div
            className="os1-mono"
            style={{
              position: "absolute",
              top: 14,
              left: 16,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(28,14,9,0.62)",
              fontSize: 10,
              color: status === "connected" ? "#8fa88f" : "var(--on-coral-dim)",
            }}
          >
            ● {status === "connected" ? (viewOnly ? "LIVE · WATCHING" : "LIVE · INTERACTIVE") : status.toUpperCase()}
          </div>}
        </div>

        {/* "While you were away" log */}
        <div className="os1-studio-card os1-scroll" style={{ padding: 22, display: "grid", gap: 14, alignContent: "start" }}>
          {(sun || moonOk) && (
            <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(255, 253, 249, 0.82)", display: "grid", gap: 8 }}>
              <div className="os1-label" style={{ color: "var(--ink-dim)", fontSize: 10 }}>
                Sunshine · {sun?.hostname || sun?.host || "server"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, font: "400 14px/1.4 var(--font-sans)", color: "var(--ink)" }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9,
                    background: !sun?.reachable ? "var(--crimson)" : sun.streaming ? "var(--mustard)" : "var(--sage)",
                  }}
                />
                {!sun ? "Checking…" : !sun.reachable ? "Not reachable" : sun.streaming ? "Streaming now" : "Ready to stream"}
                {sun?.app ? ` · ${sun.app}` : ""}
              </div>
              {moonOk ? (
                <button type="button" className="os1-pill-ink primary" onClick={() => void watchInMoonlight()}>
                  Watch in Moonlight
                </button>
              ) : mobileAppLauncher() ? (
                <button
                  type="button"
                  className="os1-pill-ink primary"
                  onClick={() =>
                    void mobileAppLauncher()?.("com.limelight").then((ok) => {
                      if (!ok) setMoonMsg("Moonlight isn't installed on this phone.");
                    })
                  }
                >
                  Open the Moonlight app
                </button>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>Moonlight opens from the UAOS1 desktop app.</div>
              )}
              {moonMsg && <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>{moonMsg}</div>}
            </div>
          )}
          <div className="os1-label" style={{ color: "var(--ink-dim)" }}>
            While you were away
          </div>
          {herComputer.recentActivity.length === 0 ? (
            <p style={{ margin: 0, font: "300 15px/1.5 var(--font-sans)", color: "var(--ink-dim)" }}>
              Her overnight research, scheduled jobs, and completed tasks appear here automatically.
            </p>
          ) : (
            herComputer.recentActivity.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(255, 253, 249, 0.72)",
                }}
              >
                <div style={{ font: "500 14px/1.3 var(--font-sans)", color: "var(--ink)" }}>{item.title}</div>
                {item.detail && (
                  <div style={{ font: "300 13px/1.4 var(--font-sans)", color: "var(--ink-dim)", marginTop: 4 }}>
                    {item.detail}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
