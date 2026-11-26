import { App as CapApp } from "@capacitor/app";
import { AppLauncher } from "@capacitor/app-launcher";
import { Browser } from "@capacitor/browser";
import { App, type Os1Config } from "@os1/ui";
import { type FormEvent, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// Services, Atlas links and the cloud desktop open in an in-app Custom Tab (most refuse iframes).
(window as unknown as { os1Mobile: unknown }).os1Mobile = {
  openInApp: (url: string) => Browser.open({ url, toolbarColor: "#cd4f33", presentationStyle: "fullscreen" }),
  // Android: opens an installed app by package name (Moonlight is com.limelight).
  launchApp: async (pkg: string) => {
    try {
      const { completed } = await AppLauncher.openUrl({ url: pkg });
      return completed;
    } catch {
      return false;
    }
  },
};

const SURFACES = new Set([
  "conversation", "home", "inbox_cascade", "your_computer", "her_computer", "swarm",
  "made_just_now", "connectors", "voice_picker", "memory", "apps", "atlas",
]);

/** Notification taps (uaos1://open?surface=atlas) and text shared from other apps (uaos1://share?text=…). */
async function handleAppLink(url: string, c: Os1Config | null): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== "uaos1:" || !c) return;
  let surface = u.searchParams.get("surface") ?? "";
  if (u.host === "share") {
    const text = (u.searchParams.get("text") ?? "").slice(0, 4000);
    if (!text) return;
    (window as unknown as { __uaos1Shared?: string }).__uaos1Shared = text;
    window.dispatchEvent(new Event("uaos1:shared"));
    surface = "atlas";
  } else if (u.host !== "open") {
    return;
  }
  if (!SURFACES.has(surface)) return;
  await fetch(`${c.orchestratorUrl.replace(/\/$/, "")}/os1/actions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.clientToken ?? ""}` },
    body: JSON.stringify({ target: "surface", action: surface }),
  }).catch(() => undefined);
}

/**
 * UAOS1 on Android. There is no local orchestrator on a phone: the app talks to the one on your server
 * over Tailscale. Server address + token are never built into the APK; they arrive once through a
 * `uaos1://pair?url=…&token=…` link (sent over adb, or tapped) and live in the app's private storage.
 */
const KEY = "uaos1.config";
const DEFAULT_URL = "https://server.tail85e19.ts.net:8796";

function load(): Os1Config | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null") as Os1Config | null;
    return c?.orchestratorUrl && c.clientToken ? c : null;
  } catch {
    return null;
  }
}

function save(c: Os1Config | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

function fromPairLink(url: string): Os1Config | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "uaos1:") return null;
    const server = u.searchParams.get("url") || "";
    const token = u.searchParams.get("token") || "";
    const s = new URL(server);
    // Tailnet / LAN only, and always HTTPS for the orchestrator.
    if (s.protocol !== "https:" || !/(\.ts\.net|\.local|^localhost)$/i.test(s.hostname)) return null;
    return token ? { orchestratorUrl: server.replace(/\/$/, ""), clientToken: token } : null;
  } catch {
    return null;
  }
}

async function check(c: Os1Config): Promise<string | null> {
  try {
    const r = await fetch(`${c.orchestratorUrl}/os1/state`, { headers: { Authorization: `Bearer ${c.clientToken}` } });
    if (r.status === 401) return "The server rejected that token.";
    if (!r.ok) return `The server answered ${r.status}.`;
    return null;
  } catch {
    return "Can't reach the server. Is Tailscale on?";
  }
}

function Pair({ onPaired, error }: { onPaired: (c: Os1Config) => void; error: string | null }) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<string | null>(error);
  useEffect(() => setMsg(error), [error]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = { orchestratorUrl: url.trim().replace(/\/$/, ""), clientToken: token.trim() };
    setMsg("Checking…");
    const err = await check(c);
    if (err) setMsg(err);
    else onPaired(c);
  };
  const field = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,253,249,0.35)",
    background: "rgba(255,253,249,0.1)",
    color: "#fffdf9",
    font: "400 15px system-ui",
  } as const;
  return (
    <main className="os1-coral" style={{ padding: 28, display: "grid", placeItems: "center" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, display: "grid", gap: 14, userSelect: "text" }}>
        <div style={{ font: "200 44px/1 system-ui", color: "#fffdf9" }}>
          UAOS<sup style={{ fontSize: 16 }}>1</sup>
        </div>
        <div style={{ color: "rgba(255,253,249,0.75)", fontSize: 15, lineHeight: 1.45 }}>
          Connect this phone to the UAOS1 server on your tailnet. The easiest way is the pairing link from your computer; or
          paste the server address and token here.
        </div>
        <input style={field} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Server address" autoCapitalize="none" />
        <input
          style={field}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token"
          aria-label="Access token"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button type="submit" className="os1-pill" style={{ padding: "12px 18px" }}>
          Connect
        </button>
        {msg && <div style={{ color: "#fffdf9", fontSize: 14 }}>{msg}</div>}
      </form>
    </main>
  );
}

function Root() {
  const [config, setConfig] = useState<Os1Config | null>(() => load());
  const [error, setError] = useState<string | null>(null);

  const adopt = async (c: Os1Config) => {
    const err = await check(c);
    if (err) {
      setError(err);
      return;
    }
    save(c);
    setError(null);
    setConfig(c);
  };

  useEffect(() => {
    const handle = (url: string) => {
      const c = fromPairLink(url);
      if (c) void adopt(c);
      else void handleAppLink(url, load());
    };
    void CapApp.getLaunchUrl().then((r) => r?.url && handle(r.url)).catch(() => undefined);
    const sub = CapApp.addListener("appUrlOpen", (e) => handle(e.url));
    return () => {
      void sub.then((h) => h.remove());
    };
  }, []);

  if (!config) return <Pair onPaired={(c) => void adopt(c)} error={error} />;
  return <App key={config.clientToken} config={config} />;
}

// biome-ignore lint/style/noNonNullAssertion: root exists in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
