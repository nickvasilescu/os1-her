import { useCallback, useEffect, useMemo, useState } from "react";
import { useNarrow } from "../components/useNarrow";
import { EmbedFrame, type EmbedState, embedBack, embedReload, hasNativeEmbed, openExternal } from "../components/EmbedFrame";
import type { UaoApp, UaoAppsResponse } from "../types";
import type { UaoApi } from "../uao/api";

export const HOMARR_BOARD_ID = "__homarr_board__";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function statusColor(status: UaoApp["status"]): string {
  return status === "up" ? "var(--sage)" : status === "down" ? "var(--crimson)" : "var(--mustard)";
}

function shortName(name: string): string {
  return name.split(/\s+(?:&|·|—|-|×)\s+|\s*\(/)[0] || name;
}

function AppIcon({ app, size = 34 }: { app: UaoApp; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (app.iconUrl && !broken) {
    return (
      <img
        src={app.iconUrl}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: "contain", flex: "none" }}
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 10,
        display: "grid",
        placeItems: "center",
        background: "var(--studio)",
        color: "var(--coral-deep)",
        font: "500 15px var(--font-sans)",
      }}
    >
      {app.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/**
 * Apps & services — the UAO Homarr catalogue as an OS1 surface: live status and latency per app,
 * filter, refresh, Homarr board, and every app opens inside OS1 with a Back bar
 * (or in the browser when it isn't on the tailnet). Every tile is speakable: “Open Jellyfin”.
 */
export function AppsSurface({
  api,
  openAppId,
  onOpenApp,
  refreshKey,
  suspended,
  onBack,
}: {
  api: UaoApi;
  openAppId: string | null;
  onOpenApp: (id: string | null) => void;
  refreshKey: number;
  suspended: boolean;
  onBack: () => void;
}) {
  const [data, setData] = useState<UaoAppsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [embedState, setEmbedState] = useState<EmbedState | null>(null);
  const [, tick] = useState(0);
  const narrow = useNarrow();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.apps());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    const clock = window.setInterval(() => tick((n) => n + 1), 10_000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(clock);
    };
  }, [load, refreshKey]);

  const apps = data?.apps ?? [];
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = q
      ? apps.filter((a) => `${a.name} ${a.description} ${a.url} ${a.category}`.toLowerCase().includes(q))
      : apps;
    const map = new Map<string, UaoApp[]>();
    for (const a of shown) map.set(a.category, [...(map.get(a.category) ?? []), a]);
    return [...map.entries()];
  }, [apps, filter]);

  const up = apps.filter((a) => a.status === "up").length;
  const down = apps.filter((a) => a.status === "down").length;

  const openApp = (app: UaoApp) => {
    if (app.embeddable) onOpenApp(app.id);
    else openExternal(app.url);
  };

  // ------------------------------------------------------------------ in-app view
  const homarr: UaoApp | null = data?.dashboardUrl
    ? {
        id: HOMARR_BOARD_ID,
        appId: HOMARR_BOARD_ID,
        name: "Homarr board",
        description: "The full Homarr dashboard",
        url: data.dashboardUrl,
        originalUrl: data.dashboardUrl,
        iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg",
        category: "",
        board: "",
        status: "up",
        statusCode: null,
        latencyMs: null,
        embeddable: true,
      }
    : null;
  const opened = openAppId === HOMARR_BOARD_ID ? homarr : apps.find((a) => a.id === openAppId) ?? null;

  if (openAppId && opened) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          padding: narrow
            ? "max(14px, calc(env(safe-area-inset-top, 0px) + 10px)) 12px max(74px, calc(env(safe-area-inset-bottom, 0px) + 74px))"
            : "26px 28px 78px",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <button type="button" className="os1-pill" onClick={() => onOpenApp(null)}>
            ← Back to Apps &amp; services
          </button>
          <AppIcon app={opened} size={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ font: "400 18px/1.2 var(--font-sans)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {opened.name}
              {embedState?.loading && (
                <span className="os1-mono" style={{ fontSize: 10, marginLeft: 10, color: "var(--on-coral-dim)" }}>
                  loading…
                </span>
              )}
            </div>
            <div
              style={{
                font: "400 12px var(--font-sans)",
                color: "var(--on-coral-dim)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {opened.description}
            </div>
          </div>
          {hasNativeEmbed() && (
            <>
              <button type="button" className="os1-pill" disabled={!embedState?.canGoBack} onClick={() => embedBack()}>
                ‹ Page back
              </button>
              <button type="button" className="os1-pill" onClick={() => embedReload()}>
                Reload
              </button>
            </>
          )}
          <button type="button" className="os1-pill" onClick={() => openExternal(embedState?.url || opened.url)}>
            Open full screen ↗
          </button>
        </div>
        <EmbedFrame url={opened.url} title={opened.name} suspended={suspended} onState={setEmbedState} />
      </div>
    );
  }

  // ------------------------------------------------------------------ catalogue
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        padding: narrow
          ? "max(14px, calc(env(safe-area-inset-top, 0px) + 12px)) 14px max(84px, calc(env(safe-area-inset-bottom, 0px) + 84px))"
          : "48px 56px 92px",
        display: "grid",
        gridTemplateRows: "auto auto auto 1fr",
        gap: 18,
        maxWidth: 1320,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="os1-label" style={{ color: "var(--on-coral-dim)" }}>
            Apps &amp; services · Homelab
          </div>
          <h2 style={{ margin: "6px 0 0", font: `200 ${narrow ? 28 : 40}px/1.1 var(--font-sans)` }}>Everything you run</h2>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter apps & services…"
            aria-label="Filter apps and services"
            style={{
              width: narrow ? "100%" : 240,
              padding: "9px 16px",
              borderRadius: 999,
              border: "1px solid rgba(255, 253, 249, 0.34)",
              background: "rgba(255, 253, 249, 0.10)",
              color: "var(--paper)",
              font: "400 14px var(--font-sans)",
              outline: "none",
            }}
          />
          {homarr && (
            <button type="button" className="os1-pill" onClick={() => onOpenApp(HOMARR_BOARD_ID)}>
              Homarr board
            </button>
          )}
          <button type="button" className="os1-pill" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="os1-pill" onClick={onBack}>
            Back to talking
          </button>
        </div>
      </div>
      <StatusStrip api={api} refreshKey={refreshKey} />

      <div className="os1-mono" style={{ fontSize: 11, color: "var(--on-coral-dim)" }}>
        {error
          ? `Can't reach the server · ${error}`
          : data
            ? `${up} up · ${down} down · ${apps.length} apps · checked ${timeAgo(data.fetchedAt)} · say “Open ${shortName(apps[0]?.name ?? "Jellyfin")}”`
            : "Loading apps and services…"}
      </div>

      <div className="os1-scroll" style={{ display: "grid", alignContent: "start", gap: 26, paddingBottom: 12 }}>
        {error && !data && (
          <div className="os1-paper-card" style={{ padding: 28, display: "grid", gap: 10, maxWidth: 560 }}>
            <div style={{ font: "300 22px/1.3 var(--font-sans)" }}>The apps catalogue isn't answering.</div>
            <div style={{ color: "var(--ink-dim)", fontSize: 14 }}>
              UAOS1 reaches it through the orchestrator over Tailscale. Check the server is up and this Mac is on the tailnet.
            </div>
            <div>
              <button type="button" className="os1-pill-ink primary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          </div>
        )}
        {data && groups.length === 0 && (
          <div style={{ color: "var(--on-coral-dim)", fontSize: 15 }}>Nothing matches “{filter}”.</div>
        )}
        {groups.map(([category, list]) => (
          <section key={category} style={{ display: "grid", gap: 12 }}>
            {groups.length > 1 && (
              <div className="os1-label" style={{ color: "var(--on-coral-dim)", fontSize: 11 }}>
                {category}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
              {list.map((app) => (
                <article
                  key={app.id}
                  className="os1-paper-card"
                  style={{ padding: "16px 18px", display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, borderRadius: 18 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <AppIcon app={app} />
                    <div style={{ flex: 1, minWidth: 0, font: "500 15px/1.25 var(--font-sans)" }}>{app.name}</div>
                    <span
                      title={`${app.status}${app.statusCode ? ` · HTTP ${app.statusCode}` : ""}`}
                      aria-label={app.status}
                      style={{ width: 9, height: 9, borderRadius: 99, background: statusColor(app.status), flex: "none" }}
                    />
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink-dim)" }}>{app.description}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="os1-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
                      {app.latencyMs != null ? `${Math.round(app.latencyMs)} ms` : app.status}
                      {!app.embeddable ? " · browser" : ""}
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="os1-pill-ink"
                        style={{ padding: "5px 10px", fontSize: 12 }}
                        title="Open in your browser"
                        aria-label={`Open ${app.name} in your browser`}
                        onClick={() => openExternal(app.url)}
                      >
                        ↗
                      </button>
                      <button
                        type="button"
                        className="os1-pill-ink primary"
                        style={{ padding: "5px 14px", fontSize: 12 }}
                        onClick={() => openApp(app)}
                      >
                        Open →
                      </button>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

type StatusItem = { name: string; state: "ok" | "off" | "down"; detail: string };

/** A light for each service UAOS1 needs (voice, Atlas, Sunshine, notifications…), refreshed every 30 s. */
function StatusStrip({ api, refreshKey }: { api: UaoApi; refreshKey: number }) {
  const [items, setItems] = useState<StatusItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .status()
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    void tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [api, refreshKey]);

  const down = items?.filter((i) => i.state === "down") ?? [];
  const color = (s: StatusItem["state"]) => (s === "ok" ? "var(--sage)" : s === "down" ? "var(--crimson)" : "var(--on-coral-faint)");
  const summary = failed
    ? "Can't check the services right now"
    : !items
      ? "Checking services…"
      : down.length
        ? `${down.map((d) => d.name).join(", ")} ${down.length === 1 ? "is" : "are"} down`
        : "Everything is running";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 14,
          border: "1px solid rgba(255, 253, 249, 0.22)",
          background: "rgba(255, 253, 249, 0.08)",
          color: "var(--paper)",
          font: "400 14px var(--font-sans)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", gap: 4 }}>
          {(items ?? []).map((i) => (
            <span key={i.name} title={i.name} style={{ width: 8, height: 8, borderRadius: 9, background: color(i.state) }} />
          ))}
        </span>
        <span style={{ flex: 1 }}>{summary}</span>
        <span className="os1-label" style={{ color: "var(--on-coral-dim)" }}>
          {open ? "Hide" : "Details"}
        </span>
      </button>
      {open && items && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {items.map((i) => (
            <div
              key={i.name}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 12, background: "rgba(255, 253, 249, 0.82)", color: "var(--ink)" }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 9, flex: "none", background: i.state === "off" ? "var(--ink-faint, #bbb)" : color(i.state) }} />
              <span style={{ display: "grid" }}>
                <span style={{ font: "500 13px var(--font-sans)" }}>{i.name}</span>
                <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{i.state === "off" ? `Off · ${i.detail}` : i.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
