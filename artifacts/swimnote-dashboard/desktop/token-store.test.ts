import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, access, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TokenStore, isFinalSessionToken } from "./token-store.cts";
import { isSessionWrite, registerSessionIPC, SESSION_CHANNELS } from "./session-ipc.cts";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

// Synthetic JWT shapes. These are not signed credentials.
const jwt = (claims: object) => ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");
const token = () => jwt({ userId: "fixture-user", role: "pool_admin", exp: Math.floor(Date.now() / 1000) + 600 });
let directory: string;
const fakeCrypto = () => {
  const values = new Map<string, string>();
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => {
      const encrypted = Buffer.from("OPAQUE-MOCK-" + values.size);
      values.set(encrypted.toString(), value);
      return encrypted;
    }),
    decryptString: vi.fn((encrypted: Buffer) => {
      const value = values.get(encrypted.toString());
      if (!value) throw new Error("MOCK decryption failure");
      return value;
    }),
  };
};
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "office-f03-store-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("final token storage boundary (crypto API mocked, NOT Windows DPAPI evidence)", () => {
  it("OFF stays memory-only, survives renderer reload but not process restart", async () => {
    const crypto = fakeCrypto();
    const store = new TokenStore(directory, crypto, "win32");
    const value = token();
    expect(await store.commit({ token: value, remember: false })).toEqual({ ok: true });
    expect((await store.restore()).token).toBe(value);
    expect(await new TokenStore(directory, crypto, "win32").restore()).toEqual({ token: null, remembered: false });
    expect(crypto.encryptString).not.toHaveBeenCalled();
    await expect(access(store.filePath)).rejects.toThrow();
  });
  it("ON writes only the crypto output and restores through decryption", async () => {
    const crypto = fakeCrypto();
    const store = new TokenStore(directory, crypto, "win32");
    const value = token();
    expect(await store.commit({ token: value, remember: true })).toEqual({ ok: true });
    const bytes = await readFile(store.filePath);
    expect(bytes.toString()).toMatch(/^OPAQUE-MOCK-/);
    expect(bytes.includes(Buffer.from(value))).toBe(false);
    expect(await new TokenStore(directory, crypto, "win32").restore()).toEqual({ token: value, remembered: true });
  });
  it.each(["win32", "linux"])("never falls back to plaintext when encryption unavailable on %s", async platform => {
    const crypto = fakeCrypto();
    crypto.isEncryptionAvailable.mockReturnValue(false);
    const store = new TokenStore(directory, crypto, platform);
    expect(await store.commit({ token: token(), remember: true })).toEqual({ ok: false, error: "unavailable" });
    expect(crypto.encryptString).not.toHaveBeenCalled();
    await expect(access(store.filePath)).rejects.toThrow();
  });
  it("rejects temporary TOTP/PIN sessions, delegation tokens and expired tokens", async () => {
    const store = new TokenStore(directory, fakeCrypto(), "win32");
    for (const value of [
      jwt({ userId: "fixture-user", totpPending: true, exp: Date.now() / 1000 + 600 }),
      jwt({ userId: "fixture-user", role: "pool_admin", totpPending: true, exp: Date.now() / 1000 + 600 }),
      jwt({ userId: "fixture-user", role: "pool_admin", purpose: "delegation", exp: Date.now() / 1000 + 600 }),
      jwt({ userId: "fixture-user", role: "pool_admin", exp: 1 }),
      "1234", "password", "{}",
    ]) {
      expect(isFinalSessionToken(value)).toBe(false);
      expect((await store.commit({ token: value, remember: true })).ok).toBe(false);
    }
    await expect(access(store.filePath)).rejects.toThrow();
  });
  it("decryption failure discards the unreadable blob, never exposes an exception/token", async () => {
    const store = new TokenStore(directory, fakeCrypto(), "win32");
    await writeFile(store.filePath, "unreadable");
    expect(await store.restore()).toEqual({ token: null, remembered: false, error: "decrypt-failed" });
    await expect(access(store.filePath)).rejects.toThrow();
  });
  it("expired decrypted token returns to login and removes ciphertext", async () => {
    const crypto = fakeCrypto();
    crypto.decryptString.mockReturnValue(jwt({ userId: "fixture-user", role: "pool_admin", exp: 1 }));
    const store = new TokenStore(directory, crypto, "win32");
    await writeFile(store.filePath, "expired-ciphertext");
    expect((await store.restore()).error).toBe("expired");
    await expect(access(store.filePath)).rejects.toThrow();
  });
  it("write failure and failed cleanup are explicit", async () => {
    const crypto = fakeCrypto();
    crypto.encryptString.mockImplementation(() => { throw new Error("PRIVATE crypto detail"); });
    const store = new TokenStore(directory, crypto, "win32");
    expect(await store.commit({ token: token(), remember: true })).toEqual({ ok: false, error: "write-failed" });
    await mkdir(store.filePath);
    expect(await store.clear()).toEqual({ ok: false, error: "clear-failed" });
  });
  it("OFF removes an older ON session and logout wins over an in-flight save", async () => {
    const crypto = fakeCrypto();
    const store = new TokenStore(directory, crypto, "win32");
    await store.commit({ token: token(), remember: true });
    await store.commit({ token: token(), remember: false });
    await expect(access(store.filePath)).rejects.toThrow();
    await Promise.all([store.commit({ token: token(), remember: true }), store.clear()]);
    expect(await store.restore()).toEqual({ token: null, remembered: false });
    expect(await new TokenStore(directory, crypto, "win32").restore()).toEqual({ token: null, remembered: false });
  });
});

describe("narrow session IPC", () => {
  it("accepts only an exact final-token/boolean payload", () => {
    expect(isSessionWrite([{ token: token(), remember: true }])).toBe(true);
    for (const args of [[], [null], ["token"], [{ token: token(), remember: 1 }],
      [{ token: token(), remember: true, pin: "1234" }], [{ token: token(), remember: true }, null]]) {
      expect(isSessionWrite(args)).toBe(false);
    }
  });
  it("rejects a foreign sender, child frame, untrusted origin and extra arguments", async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((name, handler) => { handlers.set(name, handler); }),
      removeHandler: vi.fn(name => handlers.delete(name)),
    } as unknown as Pick<IpcMain, "handle" | "removeHandler">;
    const frame = { url: "app://office/admin/login" };
    const contents = { mainFrame: frame } as unknown as WebContents;
    const store = new TokenStore(directory, fakeCrypto(), "win32");
    const cleanup = registerSessionIPC(ipc, contents, store);
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const restore = handlers.get("office:session-restore")!;
    expect(await restore(event, null)).toEqual({ token: null, remembered: false });
    expect(() => restore({ ...event, sender: {} } as IpcMainInvokeEvent, null)).toThrow("Invalid OFFICE");
    expect(() => restore({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent, null)).toThrow();
    frame.url = "https://remote.example/admin/login";
    expect(() => restore(event, null)).toThrow();
    frame.url = "app://office/admin/login";
    expect(() => restore(event, null, "extra")).toThrow();
    const commit = handlers.get("office:session-commit")!;
    expect(() => commit(event, { token: "1234", remember: true })).toThrow();
    expect(await commit(event, { token: token(), remember: false })).toEqual({ ok: true });
    cleanup();
    expect(ipc.removeHandler).toHaveBeenCalledTimes(SESSION_CHANNELS.length);
  });
});
