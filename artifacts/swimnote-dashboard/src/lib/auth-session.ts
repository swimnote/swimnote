import { api } from "./api-client";

export type XMode = "x" | "x_trial" | "x_pending" | "normal" | "subscription_required" | "unknown";
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  swimming_pool_id: string | null;
  poolName?: string;
  xMode: XMode;
  hasX: boolean;
};

export class SessionAccessError extends Error {
  readonly status = 403;
}

/** Same canonical identity and access APIs for Web and Desktop, never JWT claims as authority. */
export async function readAuthSession(strict = false, signal?: AbortSignal): Promise<AuthUser> {
  const raw = await api.get<AuthUser>("/auth/me", { signal });
  if (raw.role !== "pool_admin" && raw.role !== "super_admin") {
    throw new SessionAccessError("이 계정은 PC 관리자 접근 권한이 없습니다.");
  }
  // Whitelist identity fields; /auth/me can contain unrelated sensitive server fields.
  const user = strict ? {
    id: raw.id, name: raw.name, email: raw.email, role: raw.role,
    swimming_pool_id: raw.swimming_pool_id,
  } : raw;
  if (strict && (typeof user.id !== "string" || !user.id)) {
    throw new Error("사용자 응답을 확인할 수 없습니다.");
  }
  if (user.role === "super_admin") {
    return { ...user, poolName: "슈퍼관리자", xMode: "x", hasX: true };
  }
  const [pools, mode] = await Promise.allSettled([
    api.get<Array<{ id: string; name: string }>>("/pools/my-pools", { signal }),
    api.get<{ pool_id?: string; mode?: string }>("/pools/x-mode", { signal }),
  ]);
  if (strict) {
    const permanent = [pools, mode].find(result => result.status === "rejected" &&
      [401, 403, 404].includes(result.reason?.status));
    if (permanent?.status === "rejected") throw permanent.reason;
    if (pools.status === "rejected") throw pools.reason;
    if (mode.status === "rejected") throw mode.reason;
    if (!user.swimming_pool_id || !Array.isArray(pools.value) ||
        !pools.value.some(pool => pool.id === user.swimming_pool_id) ||
        mode.value?.pool_id !== user.swimming_pool_id) {
      throw new SessionAccessError("현재 사용자와 수영장 연결을 확인할 수 없습니다.");
    }
    if (!["x", "x_trial", "x_pending", "normal", "subscription_required"].includes(mode.value.mode ?? "")) {
      throw new Error("X 접근 권한을 확인할 수 없습니다. 다시 확인해주세요.");
    }
  }
  const xMode = (mode.status === "fulfilled" ? mode.value?.mode ?? "unknown" : "unknown") as XMode;
  const poolName = pools.status === "fulfilled"
    ? (strict ? pools.value.find(pool => pool.id === user.swimming_pool_id)?.name : pools.value[0]?.name)
    : undefined;
  return { ...user, poolName, xMode, hasX: xMode === "x" || xMode === "x_trial" };
}
