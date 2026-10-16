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
