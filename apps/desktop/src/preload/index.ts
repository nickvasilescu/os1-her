import { type IpcRendererEvent, contextBridge, ipcRenderer } from "electron";

type Bounds = { x: number; y: number; width: number; height: number };
type EmbedState = { url: string; title: string; loading: boolean; canGoBack: boolean; error?: string };

contextBridge.exposeInMainWorld("os1", {
  getConfig: () => ipcRenderer.invoke("os1:config") as Promise<{ orchestratorUrl: string; clientToken?: string }>,
  cua: {
    revokeAll: () => ipcRenderer.invoke("os1:cua:revoke"),
    status: () => ipcRenderer.invoke("os1:cua:status"),
  },
  /** Native in-app view for UAO apps (tailnet/LAN only; enforced in main). */
  embed: {
    show: (url: string, bounds: Bounds) =>
      ipcRenderer.invoke("os1:embed:show", { url, bounds }) as Promise<{ ok: boolean; error?: string }>,
    setBounds: (bounds: Bounds) => ipcRenderer.invoke("os1:embed:bounds", bounds),
    hide: () => ipcRenderer.invoke("os1:embed:hide"),
    close: () => ipcRenderer.invoke("os1:embed:close"),
    reload: () => ipcRenderer.invoke("os1:embed:reload"),
    back: () => ipcRenderer.invoke("os1:embed:back"),
    onState: (cb: (s: EmbedState) => void) => {
      const fn = (_e: IpcRendererEvent, s: EmbedState) => cb(s);
      ipcRenderer.on("os1:embed:state", fn);
      return () => ipcRenderer.removeListener("os1:embed:state", fn);
    },
  },
  openExternal: (url: string) => ipcRenderer.invoke("os1:open-external", url),
  /** Launch Moonlight into the Sunshine stream configured in the main process (SUNSHINE_HOST / SUNSHINE_APP). */
  moonlight: {
    status: () => ipcRenderer.invoke("os1:moonlight:status") as Promise<{ available: boolean; host: string; app: string }>,
    stream: () => ipcRenderer.invoke("os1:moonlight:stream") as Promise<{ ok: boolean; error?: string }>,
  },
});
