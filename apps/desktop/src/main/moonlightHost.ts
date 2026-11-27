import { execFile, spawn } from "node:child_process";
import { ipcMain } from "electron";
import { isEmbeddableUrl } from "./embedHost";

/**
 * Launch Moonlight (macOS / Linux) straight into a Sunshine stream: `Moonlight stream <host> <app>`.
 * Host and app come from the environment, never from the renderer, and the host must be tailnet/LAN.
 *   SUNSHINE_HOST (default server.tail85e19.ts.net)   SUNSHINE_APP (default "Desktop", Sunshine's built-in full-screen stream)
 */
const HOST = (process.env.SUNSHINE_HOST ?? "server.tail85e19.ts.net").trim();
const APP = (process.env.SUNSHINE_APP ?? "Desktop").trim();

function hostAllowed(): boolean {
  return Boolean(HOST) && isEmbeddableUrl(`https://${HOST}/`);
}

function available(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === "darwin") execFile("/usr/bin/open", ["-Ra", "Moonlight"], (err) => resolve(!err));
    else if (process.platform === "linux") execFile("/usr/bin/env", ["which", "moonlight"], (err) => resolve(!err));
    else resolve(false);
  });
}

export function registerMoonlight(): void {
  ipcMain.handle("os1:moonlight:status", async () => ({
    available: hostAllowed() && (await available()),
    host: HOST,
    app: APP,
  }));
  ipcMain.handle("os1:moonlight:stream", async () => {
    if (!hostAllowed()) return { ok: false, error: "SUNSHINE_HOST must be a tailnet or LAN host." };
    if (!(await available())) return { ok: false, error: "Moonlight isn't installed on this computer." };
    const args = ["stream", HOST, APP];
    const child =
      process.platform === "darwin"
        ? // -n: a fresh instance so the CLI arguments are honoured even when Moonlight is already open.
          spawn("/usr/bin/open", ["-n", "-a", "Moonlight", "--args", ...args], { detached: true, stdio: "ignore" })
        : spawn("moonlight", args, { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, host: HOST, app: APP };
  });
}
