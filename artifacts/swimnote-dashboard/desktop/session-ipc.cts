import type { IpcMain, WebContents } from "electron";
import type { LoginPreferences, SessionWrite } from "./contracts.js";
import { readFile, writeFile, rename, lstat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TokenStore } from "./token-store.cjs";
import { isFinalSessionToken } from "./token-store.cjs";
import { isTrustedRendererURL, isValidBootstrapPayload } from "./security.cjs";

export const SESSION_CHANNELS = ["office:session-restore", "office:session-commit", "office:session-clear"] as const;
const PREFERENCE_CHANNELS = ["office:login-preferences-read", "office:login-preferences-save"] as const;

type RequestPointer = { owner: string; requestId: string; path: string; createdAt: string };
const pointerPath = /^(?:\/students|\/office\/operations\/[a-z-]+(?:\/[a-zA-Z0-9_-]+){0,4}|\/transport\/[a-z-]+(?:\/[a-zA-Z0-9_-]+){0,3})$/;
const pointerId = /^[a-zA-Z0-9_-]{1,160}$/;
const lane = (p: string) => p === "/students" ? "member-create" : p.startsWith("/transport/")?"transport":p.split("/")[3];
/** Only opaque owner hashes/request IDs and endpoint names; never bodies, money, tokens or member data. */
export class PendingRequestStore {
  private queue: Promise<unknown> = Promise.resolve();
  private file: string;
  constructor(directory: string) { this.file = path.join(directory, "office-pending-requests.json"); }
  apply(input: { op: "list" | "begin" | "finish"; owner: string; requestId?: string; path?: string }): Promise<Omit<RequestPointer,"owner">[]> {
    const run = this.queue.then(async () => {
      if (!input || typeof input.owner!=="string" || !/^[a-f0-9]{64}$/.test(input.owner) || !["list","begin","finish"].includes(input.op) ||
          Object.keys(input).some(k=>!["op","owner","requestId","path"].includes(k))) throw new Error("Invalid recovery pointer");
      let rows: RequestPointer[] = [];
      try {
        const info = await lstat(this.file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error("Invalid recovery file");
        rows = JSON.parse(await readFile(this.file,"utf8"));
        if (!Array.isArray(rows) || rows.length > 128 || rows.some(r=>!r || typeof r.owner!=="string" || !/^[a-f0-9]{64}$/.test(r.owner) ||
          typeof r.requestId!=="string" || !pointerId.test(r.requestId) || typeof r.path!=="string" || !pointerPath.test(r.path) || typeof r.createdAt!=="string" || !Number.isFinite(Date.parse(r.createdAt)) ||
          Object.keys(r).sort().join(",")!=="createdAt,owner,path,requestId")) throw new Error("Invalid recovery file");
      } catch(e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (input.op !== "list") {
        if (typeof input.requestId!=="string" || !pointerId.test(input.requestId)) throw new Error("Invalid request ID");
        if (input.op === "begin") {
          if (typeof input.path!=="string" || !pointerPath.test(input.path)) throw new Error("Invalid request path");
          if (rows.some(r=>r.owner===input.owner && lane(r.path)===lane(input.path!))) throw new Error("이전 요청 결과를 먼저 확인하세요. 새 요청은 전송하지 않았습니다.");
          if (rows.length >= 128) throw new Error("미확인 요청 보관 한도입니다. 기존 영수증을 먼저 확인하세요.");
          rows.push({owner:input.owner,requestId:input.requestId,path:input.path,createdAt:new Date().toISOString()});
        } else rows = rows.filter(r=>r.owner!==input.owner || r.requestId!==input.requestId);
        const tmp=this.file+"."+randomUUID()+".tmp";
        await writeFile(tmp,JSON.stringify(rows),{flag:"wx",mode:0o600});
        await rename(tmp,this.file);
      }
      return rows.filter(r=>r.owner===input.owner).map(({owner,...r})=>r);
    });
    this.queue = run.catch(()=>undefined);
    return run;
  }
}

export function registerPendingRequestsIPC(ipc: Pick<IpcMain,"handle"|"removeHandler">, contents: WebContents, store: PendingRequestStore, developmentURL?: string) {
  const channel="office:pending-requests";
  ipc.handle(channel,(event,...args:unknown[])=>{
    if(event.sender!==contents || !event.senderFrame || event.senderFrame!==contents.mainFrame ||
      !isTrustedRendererURL(event.senderFrame.url,developmentURL) || args.length!==1 || !args[0] || typeof args[0]!=="object")
      throw new Error("Invalid recovery request");
    return store.apply(args[0] as Parameters<PendingRequestStore["apply"]>[0]);
  });
  return ()=>ipc.removeHandler(channel);
}

export function isLoginPreferences(value: unknown): value is LoginPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join(",") === "loginId,remember" &&
    typeof v.loginId === "string" && v.loginId.length <= 254 && !/[\x00-\x1f\x7f]/.test(v.loginId) &&
    typeof v.remember === "boolean";
}

/** Fixed filename, exact schema; session-clear deliberately does not touch this file. */
export class LoginPreferencesStore {
  private file: string;
  private queue = Promise.resolve({ ok: true });
  constructor(directory: string) { this.file = path.join(directory, "office-login-preferences.json"); }
  async read(): Promise<LoginPreferences> {
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2048) throw new Error("Invalid preferences");
      const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!isLoginPreferences(value)) throw new Error("Invalid preferences");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { loginId: "", remember: false };
      throw new Error("로그인 편의 설정을 읽지 못했습니다.");
    }
  }
  save(value: LoginPreferences): Promise<{ ok: boolean }> {
    if (!isLoginPreferences(value)) return Promise.resolve({ ok: false });
    // Serialize checkbox/login saves so a slower old request cannot overwrite a new one.
    this.queue = this.queue.then(() => this.write({ loginId: value.loginId, remember: value.remember }));
    return this.queue;
  }
  private async write(value: LoginPreferences) {
    const tmp = this.file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      await rename(tmp, this.file);
      return { ok: true };
    } catch { return { ok: false }; }
    finally { await unlink(tmp).catch(() => {}); }
  }
}

export function registerLoginPreferencesIPC(
  ipc: Pick<IpcMain, "handle" | "removeHandler">, contents: WebContents,
  store: LoginPreferencesStore, developmentURL?: string,
) {
  for (const channel of PREFERENCE_CHANNELS) {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame ||
          !isTrustedRendererURL(event.senderFrame.url, developmentURL) ||
          !(channel === "office:login-preferences-save"
            ? args.length === 1 && isLoginPreferences(args[0]) : isValidBootstrapPayload(args))) {
        throw new Error("Invalid OFFICE login preferences request");
      }
      return channel === "office:login-preferences-read" ? store.read() : store.save(args[0] as LoginPreferences);
    });
  }
  return () => PREFERENCE_CHANNELS.forEach(channel => ipc.removeHandler(channel));
}

export function isSessionWrite(args: unknown[]): args is [SessionWrite] {
  if (args.length !== 1 || !args[0] || typeof args[0] !== "object" || Array.isArray(args[0])) return false;
  const value = args[0] as Record<string, unknown>;
  return Object.keys(value).sort().join(",") === "remember,token" &&
    typeof value.remember === "boolean" && isFinalSessionToken(value.token);
}

export function registerSessionIPC(
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  contents: WebContents,
  store: TokenStore,
  developmentURL?: string,
) {
  for (const channel of SESSION_CHANNELS) {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== contents || !event.senderFrame ||
          event.senderFrame !== contents.mainFrame ||
          !isTrustedRendererURL(event.senderFrame.url, developmentURL) ||
          !(channel === "office:session-commit" ? isSessionWrite(args) : isValidBootstrapPayload(args))) {
        throw new Error("Invalid OFFICE session request");
      }
      if (channel === "office:session-restore") return store.restore();
      if (channel === "office:session-clear") return store.clear();
      return store.commit(args[0] as SessionWrite);
    });
  }
  return () => SESSION_CHANNELS.forEach(channel => ipc.removeHandler(channel));
}
