import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Bounds = { x: number; y: number; width: number; height: number };
export type EmbedState = { url: string; title: string; loading: boolean; canGoBack: boolean; error?: string };

interface EmbedBridge {
  show: (url: string, bounds: Bounds) => Promise<{ ok: boolean; error?: string }>;
  setBounds: (bounds: Bounds) => Promise<unknown>;
  hide: () => Promise<unknown>;
  close: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  back: () => Promise<unknown>;
  onState: (cb: (s: EmbedState) => void) => () => void;
}

interface Os1Bridge {
  embed?: EmbedBridge;
  moonlight?: {
    status: () => Promise<{ available: boolean; host: string; app: string }>;
    stream: () => Promise<{ ok: boolean; error?: string }>;
  };
  openExternal?: (url: string) => Promise<unknown>;
}

interface MobileBridge {
  /** Opens a URL in an in-app browser tab (Android Custom Tab) on top of UAOS1. */
  openInApp: (url: string) => Promise<unknown>;
  /** Opens another installed Android app by package name (e.g. Moonlight: com.limelight). */
  launchApp?: (pkg: string) => Promise<boolean>;
}

/** Phone app only: launch another installed app. Null when not available. */
export function mobileAppLauncher(): ((pkg: string) => Promise<boolean>) | null {
  return mobile()?.launchApp ?? null;
}

/** Text shared into UAOS1 from another app, waiting for the Atlas composer to pick it up. */
export function takeSharedText(): string | null {
  const w = window as unknown as { __uaos1Shared?: string };
  const t = w.__uaos1Shared ?? null;
  w.__uaos1Shared = undefined;
  return t;
}

function mobile(): MobileBridge | undefined {
  return (window as unknown as { os1Mobile?: MobileBridge }).os1Mobile;
}

function bridge(): Os1Bridge | undefined {
  return (window as unknown as { os1?: Os1Bridge }).os1;
}

export function hasNativeEmbed(): boolean {
  return Boolean(bridge()?.embed);
}

/** Open a URL in the user's browser (Electron) or a new tab (web). */
export function openExternal(url: string): void {
  const b = bridge();
  const m = mobile();
  if (b?.openExternal) void b.openExternal(url);
  else if (m) void m.openInApp(url);
  else window.open(url, "_blank", "noopener");
}

export function embedReload(): void {
  void bridge()?.embed?.reload();
}

export function embedBack(): void {
  void bridge()?.embed?.back();
}

/**
 * Fills its box with a live app. In the Electron desktop app this is a native WebContentsView
 * (works with apps that refuse iframes, keeps logins); in a plain browser it falls back to an iframe.
 * `suspended` hides the native view so OS1 modals can sit on top of it.
 */
/** Phone app: most self-hosted apps refuse to be framed, so open them in an in-app browser tab instead. */
function MobileEmbed({ url, title, suspended }: { url: string; title: string; suspended: boolean }) {
  const m = mobile();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!m || suspended || opened.current === url) return;
    opened.current = url;
    void m.openInApp(url);
  }, [m, url, suspended]);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 220,
        borderRadius: 18,
        background: "var(--paper)",
        color: "var(--ink)",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div>
        <div style={{ font: "300 22px/1.3 var(--font-sans)" }}>{title}</div>
        <div className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
          Opens in an in-app browser. Close it to come back here.
        </div>
        <button
          type="button"
          className="os1-pill-ink primary"
          style={{ marginTop: 16 }}
          onClick={() => void m?.openInApp(url)}
        >
          Open {title}
        </button>
      </div>
    </div>
  );
}

export function EmbedFrame(props: {
  url: string;
  title: string;
  suspended?: boolean;
  onState?: (s: EmbedState) => void;
}) {
  if (!bridge()?.embed && mobile()) {
    return <MobileEmbed url={props.url} title={props.title} suspended={props.suspended ?? false} />;
  }
  return <DomEmbedFrame {...props} />;
}

function DomEmbedFrame({
  url,
  title,
  suspended = false,
  onState,
}: {
  url: string;
  title: string;
  suspended?: boolean;
  onState?: (s: EmbedState) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const embed = bridge()?.embed;
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const stateCb = useRef(onState);
  stateCb.current = onState;

  useEffect(() => {
    if (!embed) return;
    return embed.onState((s) => {
      if (s.error) setError(s.error);
      stateCb.current?.(s);
    });
  }, [embed]);

  useLayoutEffect(() => {
    if (!embed || !box.current) return;
    const el = box.current;
    const measure = (): Bounds => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    if (suspended || error) {
      // Native view sits above the DOM; hide it so OS1 modals / the error card are visible.
      void embed.hide();
      return;
    }
    void embed.show(url, measure()).then((res) => {
      if (!res.ok) setError(res.error ?? "Could not open this app.");
      else if (attempt > 0) void embed.reload();
    });
    const sync = () => void embed.setBounds(measure());
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    // The surface fades in; re-measure once it settles.
    const t = window.setTimeout(sync, 800);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.clearTimeout(t);
      void embed.hide();
    };
  }, [embed, url, suspended, error, attempt]);

  useEffect(() => {
    setError(null);
    setAttempt(0);
  }, [url]);

  useEffect(() => () => void embed?.close(), [embed]);

  return (
    <div
      ref={box}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 18,
        overflow: "hidden",
        background: "var(--paper)",
      }}
    >
      {!embed && (
        <iframe
          key={iframeKey}
          title={title}
          src={url}
          style={{ border: 0, width: "100%", height: "100%" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          allow="microphone; camera; clipboard-write; fullscreen"
          onError={() => setIframeKey((k) => k + 1)}
        />
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            color: "var(--ink)",
            padding: 32,
            gap: 12,
          }}
        >
          <div>
            <div style={{ font: "300 22px/1.3 var(--font-sans)" }}>{title} didn't load.</div>
            <div className="os1-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
              {error}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
              <button
                type="button"
                className="os1-pill-ink primary"
                onClick={() => {
                  setError(null);
                  if (embed) setAttempt((a) => a + 1);
                  else setIframeKey((k) => k + 1);
                }}
              >
                Try again
              </button>
              <button type="button" className="os1-pill-ink" onClick={() => openExternal(url)}>
                Open in browser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Moonlight launcher (desktop app only): null when this isn't the Electron app. */
export function moonlightBridge(): Os1Bridge["moonlight"] | null {
  return bridge()?.moonlight ?? null;
}
