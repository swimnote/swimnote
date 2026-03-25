/**
 * RoleContext — 활성 역할, 활성 풀ID, 역할 전환 관리
 * 역할: 역할 판별(2단계) + 역할 전환(3단계)
 * - activeRole: 현재 사용 중인 역할 (lastUsedRole 대체)
 * - activePoolId: 현재 사용 중인 풀 ID (lastUsedTenant 대체)
 * - switchRole: 세션 재생성 없이 activeRole / activePoolId만 전환
 *   (서버 JWT는 백그라운드에서 교체, UI는 즉시 반응)
 *
 * [보안] last_used_role 오염 방지:
 * - 로드 완료 후 현재 adminUser.roles에 포함된 경우만 사용
 * - super 계열은 항상 last_used_role 무시
 * - switchRole() 시 서버 응답 roles 배열을 단일 진실로 사용 (merge 금지)
 */
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSession, API_BASE, safeJson, type AdminUser } from "./SessionContext";

const SUPER_ROLES = ["super_admin", "platform_admin", "super_manager"] as const;

interface RoleContextType {
  activeRole: string | null;
  activePoolId: string | null;
  lastSelectedStudent: string | null;
  setActiveRole: (role: string) => Promise<void>;
  setActivePoolId: (poolId: string) => Promise<void>;
  setLastSelectedStudent: (studentId: string) => Promise<void>;
  switchRole: (role: string) => Promise<void>;
  clearRole: () => Promise<void>;
}

export const RoleContext = createContext<RoleContextType | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { token, adminUser, applyRoleSwitch } = useSession();

  const [activeRole, setActiveRoleState] = useState<string | null>(null);
  const [activePoolId, setActivePoolIdState] = useState<string | null>(null);
  const [lastSelectedStudent, setLastSelectedStudentState] = useState<string | null>(null);

  // 스토리지 로드 완료 여부 추적 (검증은 로드 후에만 실행)
  const storageLoaded = useRef(false);

  useEffect(() => {
    async function loadStored() {
      try {
        const [storedRole, storedPoolId, storedStudent] = await Promise.all([
          AsyncStorage.getItem("last_used_role"),
          AsyncStorage.getItem("last_used_tenant"),
          AsyncStorage.getItem("last_selected_student"),
        ]);
        if (storedRole) setActiveRoleState(storedRole);
        if (storedPoolId) setActivePoolIdState(storedPoolId);
        if (storedStudent) setLastSelectedStudentState(storedStudent);
      } catch (err) {
        console.error("RoleContext loadStored error:", err);
      } finally {
        storageLoaded.current = true;
      }
    }
    loadStored();
  }, []);

  /**
   * last_used_role 검증:
   * - super 계열: 항상 초기화 (계정 간 오염 방지)
   * - 일반 계정: activeRole이 현재 사용자 roles에 없으면 roles[0]으로 재설정
   * storageLoaded 이후에만 실행 (로딩 전 덮어쓰기 방지)
   */
  useEffect(() => {
    if (!adminUser) return;

    // storageLoaded 확인 — 아직 로드 중이면 짧게 대기 후 재실행
    const validate = () => {
      if (SUPER_ROLES.includes(adminUser.role as any)) {
        // super 계열: last_used_role 완전 무시, 초기화
        setActiveRoleState(null);
        AsyncStorage.removeItem("last_used_role").catch(() => {});
        return;
      }

      const userRoles: string[] = adminUser.roles?.length
        ? adminUser.roles
        : [adminUser.role];

      setActiveRoleState(current => {
        if (!current) return current; // 저장된 값 없음 → 그대로
        if (userRoles.includes(current)) return current; // 유효 → 그대로
        // 유효하지 않은 role → 첫 번째 유효 역할로 재설정
        const fallback = userRoles[0] ?? null;
        (async () => {
          if (fallback) await AsyncStorage.setItem("last_used_role", fallback);
          else await AsyncStorage.removeItem("last_used_role");
        })();
        return fallback;
      });
    };

    if (storageLoaded.current) {
      validate();
    } else {
      // 스토리지 로드가 아직 완료되지 않은 경우, 완료 후 검증
      const timer = setInterval(() => {
        if (storageLoaded.current) {
          clearInterval(timer);
          validate();
        }
      }, 50);
      return () => clearInterval(timer);
    }
  }, [adminUser?.id]); // 계정 변경 시(로그인/로그아웃/계정 전환)만 재실행

  async function setActiveRole(role: string) {
    setActiveRoleState(role);
    await AsyncStorage.setItem("last_used_role", role);
  }

  async function setActivePoolId(poolId: string) {
    setActivePoolIdState(poolId);
    await AsyncStorage.setItem("last_used_tenant", poolId);
  }

  async function setLastSelectedStudent(studentId: string) {
    setLastSelectedStudentState(studentId);
    await AsyncStorage.setItem("last_selected_student", studentId);
  }

  async function clearRole() {
    setActiveRoleState(null);
    setActivePoolIdState(null);
    setLastSelectedStudentState(null);
    await AsyncStorage.multiRemove(["last_used_role", "last_used_tenant", "last_selected_student"]);
  }

  async function switchRole(role: string) {
    if (!token || !adminUser) return;
    const res = await fetch(`${API_BASE}/auth/switch-role`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || "역할 전환에 실패했습니다.");

    const newToken: string = data.token;
    // 서버 응답 roles 배열을 단일 진실로 사용 — 클라이언트 roles와 merge 금지
    if (!Array.isArray(data.roles)) {
      throw new Error("서버 응답 오류: roles 배열이 없습니다.");
    }
    const updatedUser: AdminUser = { ...adminUser, role: role as AdminUser["role"], roles: data.roles };

    await applyRoleSwitch(newToken, updatedUser);
    await setActiveRole(role);
  }

  return (
    <RoleContext.Provider value={{
      activeRole,
      activePoolId,
      lastSelectedStudent,
      setActiveRole,
      setActivePoolId,
      setLastSelectedStudent,
      switchRole,
      clearRole,
    }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
