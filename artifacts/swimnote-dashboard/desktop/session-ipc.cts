import type { IpcMain, WebContents } from "electron";
import type { SessionWrite } from "./contracts.js";
import type { TokenStore } from "./token-store.cjs";
import { isFinalSessionToken } from "./token-store.cjs";
import { isTrustedRendererURL, isValidBootstrapPayload } from "./security.cjs";

export const SESSION_CHANNELS = ["office:session-restore", "office:session-commit", "office:session-clear"] as const;

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
