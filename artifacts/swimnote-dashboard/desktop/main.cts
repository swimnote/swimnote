import { app, BrowserWindow, dialog, ipcMain, protocol, screen, safeStorage } from "electron";
import { readFile, realpath, stat } from "node:fs/promises";
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { BootstrapInfo } from "./contracts.js";
import {
  BOOTSTRAP_CHANNEL, CONTENT_SECURITY_POLICY, ENTRY_URL, clampWindowBounds,
  isInsideDirectory, isTrustedRendererURL, isValidBootstrapPayload,
  resolveRendererPath, validateDevelopmentURL, isAllowedAuthRequest,
} from "./security.cjs";
import { TokenStore } from "./token-store.cjs";
import { registerSessionIPC, registerLoginPreferencesIPC, LoginPreferencesStore } from "./session-ipc.cjs";
declare const __OFFICE_STAGE3_ACTIVE__: boolean;
import { isAllowedOfficeImage } from "./office-access.cjs";

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

let mainWindow: BrowserWindow | null = null;
let developmentURL: string | undefined;

async function createWindow() {
  let saved: { x?: number; y?: number; width?: number; height?: number; maximized?: boolean } = {};
  const statePath = path.join(app.getPath("userData"), "window-state.json");
  try {
    if ((await stat(statePath)).size <= 4096) {
      const value: unknown = JSON.parse(await readFile(statePath, "utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) saved = value;
    }
  } catch { /* First launch or invalid geometry: use safe, visible defaults. */ }
  const display = typeof saved.x === "number" && typeof saved.y === "number" &&
    Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y })
    : screen.getPrimaryDisplay();
  const bounds = clampWindowBounds(saved, display.workArea);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(960, display.workArea.width),
    minHeight: Math.min(640, display.workArea.height),
    title: "SWIMNOTE OFFICE",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
      partition: "office-f02", // Memory-only Chromium session. Only main safeStorage persists an opted-in final token.
    },
  });
  mainWindow = win;
  let rendererCloseReady = false, closeConfirmed = false;
  const closeSender = (event: Electron.IpcMainEvent, args: unknown[]) =>
    event.sender === win.webContents && !!event.senderFrame && event.senderFrame === win.webContents.mainFrame &&
    isTrustedRendererURL(event.senderFrame.url, developmentURL) && args.length === 0;
  const ready = (event: Electron.IpcMainEvent, ...args: unknown[]) => { if (closeSender(event, args)) rendererCloseReady = true; };
  const notReady = (event: Electron.IpcMainEvent, ...args: unknown[]) => { if (closeSender(event, args)) rendererCloseReady = false; };
  const confirm = (event: Electron.IpcMainEvent, ...args: unknown[]) => {
    if (closeSender(event, args)) { closeConfirmed = true; win.close(); }
  };
  ipcMain.on("office:close-ready", ready);
  ipcMain.on("office:close-not-ready", notReady);
  ipcMain.on("office:close-confirm", confirm);
  win.webContents.on("will-prevent-unload", event => { if (closeConfirmed) event.preventDefault(); });
  win.removeMenu();
  const ownSession = win.webContents.session;
  // Custom sessions have their own protocol registry.
  await registerSessionProtocol(ownSession);
  ownSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ownSession.setPermissionCheckHandler(() => false);
  ownSession.webRequest.onBeforeRequest((details, callback) => {
    const local = isTrustedRendererURL(details.url, developmentURL);
    let devSocket = false;
    if (developmentURL) {
      try {
        const candidate = new URL(details.url);
        const dev = new URL(developmentURL);
        devSocket = candidate.protocol === "ws:" && candidate.host === dev.host &&
          !candidate.username && !candidate.password;
      } catch { /* Deny malformed network URLs. */ }
    }
    const image = details.resourceType === "image" && isAllowedOfficeImage(details.url);
    callback({ cancel: !local && !devSocket && !image && !details.url.startsWith("data:image/") &&
      !isAllowedAuthRequest(details.url, details.method,
        typeof __OFFICE_STAGE3_ACTIVE__ === "boolean" && __OFFICE_STAGE3_ACTIVE__) });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererURL(url, developmentURL)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererURL(url, developmentURL)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.on("before-input-event", (event, input) => {
    const refresh = input.key === "F5" ||
      (input.control && !input.alt && !input.meta && input.key.toLowerCase() === "r");
    if (input.type === "keyDown" && refresh) {
      event.preventDefault();
      win.webContents.reload();
    }
  });
  ipcMain.handle(BOOTSTRAP_CHANNEL, (event, ...args: unknown[]): BootstrapInfo => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        !event.senderFrame || !isTrustedRendererURL(event.senderFrame.url, developmentURL) ||
        !isValidBootstrapPayload(args)) {
      throw new Error("Invalid OFFICE bootstrap request");
    }
    return { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, stage: "F03" };
  });
  const store = new TokenStore(app.getPath("userData"), safeStorage, process.platform);
  const removeSessionIPC = registerSessionIPC(ipcMain, win.webContents, store, developmentURL);
  const removePreferencesIPC = registerLoginPreferencesIPC(
    ipcMain, win.webContents, new LoginPreferencesStore(app.getPath("userData")), developmentURL,
  );
  win.once("ready-to-show", () => {
    if (saved.maximized === true) win.maximize();
    win.show();
  });
  win.on("close", event => {
    if (rendererCloseReady && !closeConfirmed) { event.preventDefault(); win.webContents.send("office:close-request"); return; }
    const geometry = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    // Geometry only. Never persist renderer state, credentials, or auth tokens.
    const tmp = statePath + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(geometry), { mode: 0o600 });
      renameSync(tmp, statePath);
    } catch { /* Geometry persistence failure must not block normal exit. */ }
  });
  win.on("closed", () => {
    ipcMain.removeListener("office:close-ready", ready);
    ipcMain.removeListener("office:close-not-ready", notReady);
    ipcMain.removeListener("office:close-confirm", confirm);
    ipcMain.removeHandler(BOOTSTRAP_CHANNEL);
    removeSessionIPC();
    removePreferencesIPC();
    mainWindow = null;
  });
  await win.loadURL(developmentURL || ENTRY_URL);
}

async function registerSessionProtocol(ownSession: Electron.Session) {
  // Reuse the exact handler, without widening file/network access.
  const root = await realpath(path.join(__dirname, "../renderer"));
  ownSession.protocol.handle("app", async (request) => {
    const file = resolveRendererPath(request.url, root);
    const headers = {
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    };
    if (!file || !["GET", "HEAD"].includes(request.method)) return new Response("Forbidden", { status: 403, headers });
    try {
      const actual = await realpath(file);
      if (!isInsideDirectory(root, actual) || !(await stat(actual)).isFile()) return new Response("Forbidden", { status: 403, headers });
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      };
      return new Response(request.method === "HEAD" ? null : new Uint8Array(await readFile(actual)), {
        headers: { ...headers, "Content-Type": types[path.extname(actual)] || "application/octet-stream" },
      });
    } catch { return new Response("Not found", { status: 404, headers }); }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(async () => {
    // Packaged builds never consult or accept a development URL.
    if (!app.isPackaged && process.env.OFFICE_DEV_URL) {
      developmentURL = validateDevelopmentURL(process.env.OFFICE_DEV_URL);
    }
    await createWindow();
  }).catch(() => {
    dialog.showErrorBox("SWIMNOTE OFFICE", "OFFICE 시작에 실패했습니다. 검증 결과로 이 오류를 전달해주세요.");
    app.exit(1);
  });
}
