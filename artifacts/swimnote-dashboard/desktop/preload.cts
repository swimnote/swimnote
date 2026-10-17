import { contextBridge, ipcRenderer } from "electron";
import type { OfficeDesktopBridge } from "./contracts.js";

// Sandboxed preload is deliberately self-contained: no filesystem or Node APIs.
const bridge: OfficeDesktopBridge = Object.freeze({
  onCloseRequest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("office:close-request", listener);
    ipcRenderer.send("office:close-ready");
    return () => { ipcRenderer.removeListener("office:close-request", listener); ipcRenderer.send("office:close-not-ready"); };
  },
  confirmClose: () => ipcRenderer.send("office:close-confirm"),
  getBootstrapInfo: () => ipcRenderer.invoke("office:bootstrap-info", null),
  restoreSession: () => ipcRenderer.invoke("office:session-restore", null),
  commitSession: (session) => ipcRenderer.invoke("office:session-commit", session),
  clearSession: () => ipcRenderer.invoke("office:session-clear", null),
  readLoginPreferences: () => ipcRenderer.invoke("office:login-preferences-read", null),
  saveLoginPreferences: (preferences) => ipcRenderer.invoke("office:login-preferences-save", preferences),
});
contextBridge.exposeInMainWorld("officeDesktop", bridge);
