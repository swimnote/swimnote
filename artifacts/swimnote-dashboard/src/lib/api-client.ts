import { getToken, clearToken } from "./token";

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

if (!API_BASE) {
  throw new Error(
    "[swimnote-dashboard] VITE_API_BASE is not set. " +
    "Set it to https://swimnote-api.onrender.com/api in your .env file. " +
    "Do NOT fall back to /api."
  );
}

export type ApiError = {
  status: number;
  message: string;
};

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.location.replace("/admin/login");
    throw { status: 401, message: "인증이 만료되었습니다." } as ApiError;
  }

  if (!res.ok) {
    let message = `서버 오류 (${res.status})`;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch {
      // non-JSON error
    }
    throw { status: res.status, message } as ApiError;
  }

  return res.json() as Promise<T>;
}

export const api = {
  getBaseUrl: () => API_BASE as string,
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart/form-data upload — no Content-Type override (browser sets boundary) */
  postForm: async <T>(path: string, formData: FormData): Promise<T> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: formData });
    if (res.status === 401) { clearToken(); window.location.replace("/admin/login"); throw { status: 401, message: "인증이 만료되었습니다." } as ApiError; }
    if (!res.ok) {
      let message = `서버 오류 (${res.status})`;
      try { const b = await res.json(); message = b.error ?? b.message ?? message; } catch {}
      throw { status: res.status, message } as ApiError;
    }
    return res.json() as Promise<T>;
  },
};

/** Unauthenticated POST — for login flow */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `서버 오류 (${res.status})`;
    try {
      const b = await res.json();
      message = b.message ?? b.error ?? message;
    } catch {
      // ignore
    }
    throw { status: res.status, message } as ApiError;
  }

  return res.json() as Promise<T>;
}
