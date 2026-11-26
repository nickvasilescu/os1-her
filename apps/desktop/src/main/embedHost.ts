import { BrowserWindow, WebContentsView, ipcMain, session, shell } from "electron";

/**
 * In-app embeds for UAO Apps & services (and Atlas "open full app"): one native WebContentsView
 * layered over the renderer, positioned by the renderer. Only tailnet / LAN / loopback hosts may
 * load inside OS1; anything else opens in the user's browser. Uses its own persistent session so
 * app logins survive restarts without touching OS1's own renderer session.
 */

const TAILNET_SUFFIXES = (process.env.UAO_TAILNET_SUFFIXES ?? "tail85e19.ts.net")
  .split(",")
  .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
  .filter(Boolean);

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export function isEmbeddableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (TAILNET_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return true;
  return isPrivateIPv4(host);
}

function isWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbedState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  error?: string;
}

export class EmbedHost {
  private view: WebContentsView | null = null;
  private owner: BrowserWindow | null = null;
  private attached = false;

  register(): void {
    const embedSession = session.fromPartition("persist:os1-embed");
    embedSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(["media", "fullscreen", "clipboard-sanitized-write"].includes(permission));
    });

    ipcMain.handle("os1:embed:show", (e, opts: { url: string; bounds: Bounds }) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return { ok: false, error: "no window" };
      if (!isEmbeddableUrl(opts.url)) return { ok: false, error: "Only tailnet and LAN apps open inside UAOS1." };
      this.show(win, opts.url, opts.bounds);
      return { ok: true };
    });
    ipcMain.handle("os1:embed:bounds", (_e, bounds: Bounds) => this.setBounds(bounds));
    ipcMain.handle("os1:embed:hide", () => this.hide());
    ipcMain.handle("os1:embed:close", () => this.close());
    ipcMain.handle("os1:embed:reload", () => this.view?.webContents.reload());
    ipcMain.handle("os1:embed:back", () => {
      const nav = this.view?.webContents.navigationHistory;
      if (nav?.canGoBack()) nav.goBack();
    });
    ipcMain.handle("os1:open-external", (_e, url: string) => {
      if (isWebUrl(url)) void shell.openExternal(url);
    });
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = new WebContentsView({
      webPreferences: { partition: "persist:os1-embed", contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    view.setBackgroundColor("#fffdf9");
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isEmbeddableUrl(url)) void wc.loadURL(url);
      else if (isWebUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (ev, url) => {
      if (!isEmbeddableUrl(url)) {
        ev.preventDefault();
        if (isWebUrl(url)) void shell.openExternal(url);
      }
    });
    const push = (error?: string) => this.emit(error);
    wc.on("did-start-loading", () => push());
    wc.on("did-stop-loading", () => push());
    wc.on("page-title-updated", () => push());
    wc.on("did-navigate", () => push());
    wc.on("did-navigate-in-page", () => push());
    wc.on("did-fail-load", (_ev, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) push(`${desc} (${code})`); // -3 = aborted by a newer navigation
    });
    this.view = view;
    return view;
  }

  private emit(error?: string): void {
    const wc = this.view?.webContents;
    if (!wc || !this.owner || this.owner.isDestroyed()) return;
    const state: EmbedState = {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      ...(error ? { error } : {}),
    };
    this.owner.webContents.send("os1:embed:state", state);
  }

  private show(win: BrowserWindow, url: string, bounds: Bounds): void {
    const view = this.ensureView();
    if (this.owner !== win || !this.attached) {
      if (this.owner && this.attached && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view);
      win.contentView.addChildView(view);
      this.owner = win;
      this.attached = true;
    }
    this.setBounds(bounds);
    view.setVisible(true);
    const current = view.webContents.getURL();
    if (current !== url) void view.webContents.loadURL(url).catch(() => undefined);
    else this.emit();
  }

  private setBounds(b: Bounds): void {
    if (!this.view) return;
    this.view.setBounds({
      x: Math.max(0, Math.round(b.x)),
      y: Math.max(0, Math.round(b.y)),
      width: Math.max(1, Math.round(b.width)),
      height: Math.max(1, Math.round(b.height)),
    });
  }

  private hide(): void {
    this.view?.setVisible(false);
  }

  /** Detach and blank the view (keeps the session cookies). */
  private close(): void {
    if (!this.view) return;
    this.view.setVisible(false);
    if (this.owner && this.attached && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(this.view);
    this.attached = false;
    void this.view.webContents.loadURL("about:blank").catch(() => undefined);
  }
}
