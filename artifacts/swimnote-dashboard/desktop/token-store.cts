import { lstat, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { SessionRestore, SessionResult, SessionWrite } from "./contracts.js";

type Crypto = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

/** Shape guard ONLY. The renderer must still validate the final token with canonical APIs. */
export function isFinalSessionToken(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return payload !== null && typeof payload === "object" &&
      typeof payload.userId === "string" && !!payload.userId &&
      typeof payload.role === "string" && !!payload.role &&
      !("totpPending" in payload) && !("purpose" in payload) &&
      typeof payload.exp === "number" && payload.exp > Date.now() / 1000;
  } catch { return false; }
}

/** Only a final token is ever encrypted. Passwords, OTPs and temporary sessions have no storage API. */
export class TokenStore {
  private memory: string | null = null;
  private remembered = false;
  private queue: Promise<unknown> = Promise.resolve();
  readonly filePath: string;

  constructor(userData: string, private crypto: Crypto, private platform: string) {
    this.filePath = path.join(userData, "office-session.bin");
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private encryptionAvailable(): boolean {
    // Windows is the approved host. Never enable Linux basic_text/plaintext fallback.
    return this.platform === "win32" && this.crypto.isEncryptionAvailable();
  }

  private async removeFile(file = this.filePath) {
    try { await unlink(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  restore(): Promise<SessionRestore> {
    return this.serial(async () => {
      if (this.memory && isFinalSessionToken(this.memory)) {
        return { token: this.memory, remembered: this.remembered };
      }
      this.memory = null;
      try {
        const info = await lstat(this.filePath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error("Invalid storage");
        if (!this.encryptionAvailable()) return { token: null, remembered: false, error: "unavailable" };
        const token = this.crypto.decryptString(await readFile(this.filePath));
        if (!isFinalSessionToken(token)) {
          await this.removeFile();
          return { token: null, remembered: false, error: "expired" };
        }
        this.memory = token;
        this.remembered = true;
        return { token, remembered: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { token: null, remembered: false };
        try { await this.removeFile(); }
        catch { return { token: null, remembered: false, error: "clear-failed" }; }
        return { token: null, remembered: false, error: "decrypt-failed" };
      }
    });
  }

  commit(input: SessionWrite): Promise<SessionResult> {
    return this.serial(async () => {
      if (!isFinalSessionToken(input.token)) return { ok: false, error: "invalid-token" };
      this.memory = null;
      this.remembered = false;
      try {
        // Replacing an account or choosing OFF first removes any previous persisted session.
        await this.removeFile();
        if (input.remember) {
          if (!this.encryptionAvailable()) return { ok: false, error: "unavailable" };
          const encrypted = this.crypto.encryptString(input.token);
          const temporary = this.filePath + ".tmp";
          try {
            await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx" });
            await rename(temporary, this.filePath);
          } finally {
            await this.removeFile(temporary);
          }
        }
        this.memory = input.token;
        this.remembered = input.remember;
        return { ok: true };
      } catch { return { ok: false, error: "write-failed" }; }
    });
  }

  clear(): Promise<SessionResult> {
    return this.serial(async () => {
      this.memory = null;
      this.remembered = false;
      try {
        await this.removeFile();
        await this.removeFile(this.filePath + ".tmp");
        return { ok: true };
      } catch { return { ok: false, error: "clear-failed" }; }
    });
  }
}
