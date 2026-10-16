const TOKEN_KEY = "x_token";
let desktop = false;
let memoryToken: string | null = null;

/** Called by the Desktop entry before mounting React; never fall back to Web storage. */
export function useDesktopTokenStorage(): void {
  desktop = true;
  memoryToken = null;
}

export function isDesktopTokenStorage(): boolean {
  return desktop;
}

export function getToken(): string | null {
  if (desktop) return memoryToken;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (desktop) { memoryToken = token; return; }
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore storage errors
  }
}

export function clearToken(): void {
  if (desktop) { memoryToken = null; return; }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}
