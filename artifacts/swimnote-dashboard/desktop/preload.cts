import { contextBridge, ipcRenderer } from "electron";
import type { OfficeDesktopBridge } from "./contracts.js";

// Sandboxed preload is deliberately self-contained: no filesystem or Node APIs.
const bridge: OfficeDesktopBridge = Object.freeze({
  getBootstrapInfo: () => ipcRenderer.invoke("office:bootstrap-info", null),
});
contextBridge.exposeInMainWorld("officeDesktop", bridge);
