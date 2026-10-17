import { getToken, clearToken, isDesktopTokenStorage, getAuthGeneration } from "./token";
import { OFFICE_STAGE3_ACTIVE, isOfficeStage3Request } from "./office-stage3-policy";

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
  const generation = getAuthGeneration();
  const assertSession = () => {
    if (isDesktopTokenStorage() && generation !== getAuthGeneration()) {
      throw new DOMException("이전 로그인 조회를 취소했습니다.", "AbortError");
    }
  };
  if (isDesktopTokenStorage() && options.method && options.method !== "GET" &&
      !isOfficeStage3Request(path, options.method, OFFICE_STAGE3_ACTIVE)) {
    throw { status: 403, message: "현재 Desktop은 조회 전용입니다." } as ApiError;
  }
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
  assertSession();

  if (res.status === 401) {
    if (!isDesktopTokenStorage() || getToken() === token) clearToken();
    if (!isDesktopTokenStorage()) window.location.replace("/admin/login");
    else window.dispatchEvent(new Event("office:session-invalid"));
    throw { status: 401, message: "인증이 만료되었습니다." } as ApiError;
  }

  if (!res.ok) {
    let message = `서버 오류 (${res.status})`;
    try {
      const body = await res.json();
      assertSession();
      message = body.message ?? body.error ?? message;
    } catch {
      // non-JSON error
    }
    throw { status: res.status, message } as ApiError;
  }

  const body = await res.json();
  assertSession();
  return body as T;
}

export const api = {
  getBaseUrl: () => API_BASE as string,
  get: <T>(path: string, options?: RequestInit) => request<T>(path, options),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart/form-data upload — no Content-Type override (browser sets boundary) */
  postForm: async <T>(path: string, formData: FormData): Promise<T> => {
    if (isDesktopTokenStorage()) throw { status: 403, message: "현재 Desktop은 조회 전용입니다." } as ApiError;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: formData });
    if (res.status === 401) {
      if (!isDesktopTokenStorage() || getToken() === token) clearToken();
      if (!isDesktopTokenStorage()) window.location.replace("/admin/login");
      throw { status: 401, message: "인증이 만료되었습니다." } as ApiError;
    }
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
