const TOKEN_KEY = "x_token";
let desktop = false;
let memoryToken: string | null = null;
let generation = 0;
export const getAuthGeneration = () => generation;

/** Called by the Desktop entry before mounting React; never fall back to Web storage. */
export function useDesktopTokenStorage(): void {
  desktop = true;
  memoryToken = null;
  generation++;
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
  if (desktop) { memoryToken = token; generation++; return; }
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore storage errors
  }
}

export function clearToken(): void {
  if (desktop) { memoryToken = null; generation++; return; }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}
