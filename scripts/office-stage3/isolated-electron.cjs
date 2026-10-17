// Separate un-packaged test shell. Never imported by the production Electron entrypoint.
const { app, BrowserWindow, session } = require("../../artifacts/swimnote-dashboard/node_modules/electron");
if (!process.argv.includes("--isolated-only")) throw new Error("Isolated-only flag required");
app.whenReady().then(() => {
  const partition = session.fromPartition("office-isolated-ephemeral"); // no persist:
  partition.webRequest.onBeforeRequest((details, done) => {
    let allowed = false;
    try { const u = new URL(details.url); allowed = ["http://127.0.0.1:20411", "http://127.0.0.1:20412", "ws://127.0.0.1:20412"].includes(u.origin); } catch {}
    done({ cancel: !allowed && !details.url.startsWith("data:image/") });
  });
  const win = new BrowserWindow({ width: 1280, height: 800, title: "OFFICE 합성 전용 — 운영 미연결",
    webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("http://127.0.0.1:20412/")) e.preventDefault(); });
  win.loadURL("http://127.0.0.1:20412/admin/members");
});
app.on("window-all-closed", () => app.quit());
