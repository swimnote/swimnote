/**
 * MembershipsContext — Multi-Pool Membership 데이터 관리
 *
 * 역할:
 *   - /me/memberships API 호출 → memberships[] 상태 관리
 *   - switchToPool(poolId, role): /auth/switch-pool 호출 → 새 JWT 수신 → 세션 갱신
 *   - 멤버십이 2개 이상일 때 PoolSwitcherSheet 표시 여부 제어
 *
 * 사용처:
 *   - useAuth()를 통해 memberships, switchToPool, hasManyPools 노출
 *   - PoolSwitcherButton: 헤더에 "현재 수영장 ▼" 버튼으로 표시
 */
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE, safeJson } from "./SessionContext";

export interface PoolMembership {
  pool_id: string;
  pool_name: string;
  role: string;
  status: "active" | "inactive" | "pending";
}

interface MembershipsContextType {
  memberships: PoolMembership[];
  hasManyPools: boolean;
  isLoading: boolean;
  loadMemberships: (token: string) => Promise<void>;
  switchToPool: (
    token: string,
    poolId: string,
    role: string,
    onSuccess: (newToken: string, poolId: string, role: string, poolName: string) => void,
  ) => Promise<void>;
  clearMemberships: () => void;
}

const MembershipsContext = createContext<MembershipsContextType | null>(null);

export function MembershipsProvider({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<PoolMembership[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const hasManyPools = memberships.length >= 2;

  const loadMemberships = useCallback(async (token: string) => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/me/memberships`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await safeJson(res);
        const list: PoolMembership[] = Array.isArray(data?.memberships) ? data.memberships : [];
        setMemberships(list);
        // SecureStore에 캐시 (다음 앱 시작 시 즉시 표시)
        AsyncStorage.setItem("cached_memberships", JSON.stringify(list)).catch(() => {});
      }
    } catch (e) {
      console.warn("[MembershipsContext] loadMemberships 실패:", e);
      // 캐시에서 복원
      try {
        const cached = await AsyncStorage.getItem("cached_memberships");
        if (cached) setMemberships(JSON.parse(cached));
      } catch {}
    } finally {
      setIsLoading(false);
    }
  }, []);

  const switchToPool = useCallback(async (
    token: string,
    poolId: string,
    role: string,
    onSuccess: (newToken: string, poolId: string, role: string, poolName: string) => void,
  ) => {
    const res = await fetch(`${API_BASE}/auth/switch-pool`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pool_id: poolId, role }),
    });
    if (!res.ok) {
      const body = await safeJson(res).catch(() => ({}));
      throw new Error(body?.message || "수영장 전환에 실패했습니다.");
    }
    const data = await safeJson(res);
    const newToken: string = data.token;
    const poolName: string = data.pool_name ?? poolId;
    if (!newToken) throw new Error("토큰 발급 실패");

    // 새 멤버십 목록 갱신
    await loadMemberships(newToken);

    onSuccess(newToken, poolId, role, poolName);
  }, [loadMemberships]);

  const clearMemberships = useCallback(() => {
    setMemberships([]);
    AsyncStorage.removeItem("cached_memberships").catch(() => {});
  }, []);

  // 앱 시작 시 캐시에서 즉시 복원
  useEffect(() => {
    AsyncStorage.getItem("cached_memberships").then(cached => {
      if (cached) {
        try { setMemberships(JSON.parse(cached)); } catch {}
      }
    }).catch(() => {});
  }, []);

  return (
    <MembershipsContext.Provider value={{
      memberships,
      hasManyPools,
      isLoading,
      loadMemberships,
      switchToPool,
      clearMemberships,
    }}>
      {children}
    </MembershipsContext.Provider>
  );
}

export function useMemberships() {
  const ctx = useContext(MembershipsContext);
  if (!ctx) throw new Error("useMemberships must be used within MembershipsProvider");
  return ctx;
}
