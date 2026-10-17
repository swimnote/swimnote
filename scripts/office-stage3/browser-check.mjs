// Local Chromium CDP driver for the isolated renderer. No dependency install, no operating login.
import { writeFile, mkdir } from "node:fs/promises";
const tabs = await (await fetch("http://127.0.0.1:20413/json")).json();
const tab = tabs.find(t => t.type === "page" && t.url.startsWith("http://127.0.0.1:20412/")) ??
  tabs.find(t => t.type === "page" && t.url === "about:blank");
if (!tab) throw new Error("Synthetic browser tab unavailable");
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const entry = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message)); else entry.resolve(msg.result);
  }
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + r.exceptionDetails.exception?.description);
  return r.result.value;
};
try {
  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("Network.setBlockedURLs", { urls: ["*swimnote-api.onrender.com*", "*swimnote.kr*", "*supabase*"] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const [action, arg] = process.argv.slice(2);
  if (action === "verify-search") {
    const { verifySearch } = await import("./verify-search-browser.mjs");
    await verifySearch({ cdp, evaluate });
  }
  else if (action === "verify-navigation") {
    const { verifyNavigation } = await import("./verify-navigation-browser.mjs");
    await verifyNavigation({ cdp, evaluate });
  }
  else if (action === "open") { await cdp("Page.navigate", { url: "http://127.0.0.1:20412/admin/members" }); }
  else if (action === "eval") console.log(JSON.stringify(await evaluate(arg)));
  else if (action === "inspect") console.log(await evaluate("document.body.innerText.slice(0,14000)"));
  else if (action === "attachment") {
    const { root } = await cdp("DOM.getDocument");
    const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
    await cdp("DOM.setFileInputFiles", { nodeId, files: [new URL("../../generated-artifacts/office-stage3-real-ai/synthetic-attachment.txt", import.meta.url).pathname] });
    console.log("Synthetic attachment selected locally; not uploaded");
  }
  else if (action === "screenshot") {
    if (!/^[a-z0-9-]+$/.test(arg ?? "")) throw new Error("Safe screenshot name required");
    const out = new URL("../../generated-artifacts/office-stage3-real-ai/screenshots/", import.meta.url);
    await mkdir(out, { recursive: true });
    const img = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(new URL(arg + ".png", out), Buffer.from(img.data, "base64"));
    console.log("Saved synthetic UI screenshot: " + arg);
  } else throw new Error("Use open, inspect, screenshot or eval");
} finally { socket.close(); }
