const API_BASE = import.meta.env.VITE_API_BASE || "/api";

function getToken(): string | null {
  return localStorage.getItem("sw_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || err.message || "요청 실패"), { status: res.status, data: err });
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => req<T>("GET", path),
  post: <T>(path: string, body: unknown) => req<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => req<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => req<T>("PATCH", path, body),
  delete: <T>(path: string) => req<T>("DELETE", path),
};

export { getToken, authHeaders };
