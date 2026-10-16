export const BOOTSTRAP_CHANNEL = "office:bootstrap-info";

export type BootstrapInfo = Readonly<{
  version: string;
  platform: string;
  packaged: boolean;
  stage: "F02" | "F03";
}>;

export type StorageError = "unavailable" | "decrypt-failed" | "expired" | "write-failed" | "clear-failed" | "invalid-token";
export type SessionWrite = Readonly<{ token: string; remember: boolean }>;
export type SessionResult = Readonly<{ ok: boolean; error?: StorageError }>;
export type SessionRestore = Readonly<{
  token: string | null;
  remembered: boolean;
  error?: StorageError;
}>;

/** Only login convenience; never credentials, temporary sessions or arbitrary settings. */
export type LoginPreferences = Readonly<{ loginId: string; remember: boolean }>;

export type OfficeDesktopBridge = Readonly<{
  getBootstrapInfo: () => Promise<BootstrapInfo>;
  restoreSession: () => Promise<SessionRestore>;
  commitSession: (session: SessionWrite) => Promise<SessionResult>;
  clearSession: () => Promise<SessionResult>;
  readLoginPreferences: () => Promise<LoginPreferences>;
  saveLoginPreferences: (preferences: LoginPreferences) => Promise<{ ok: boolean }>;
}>;
