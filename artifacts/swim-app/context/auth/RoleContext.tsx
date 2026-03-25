/**
 * RoleContext — 활성 역할, 활성 풀ID, 역할 전환 관리
 * 역할: 역할 판별(2단계) + 역할 전환(3단계)
 * - activeRole: 현재 사용 중인 역할 (lastUsedRole 대체)
 * - activePoolId: 현재 사용 중인 풀 ID (lastUsedTenant 대체)
 * - switchRole: 세션 재생성 없이 activeRole / activePoolId만 전환
 *   (서버 JWT는 백그라운드에서 교체, UI는 즉시 반응)
 */
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSession, API_BASE, safeJson, type AdminUser } from "./SessionContext";

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
      }
    }
    loadStored();
  }, []);

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
    const updatedUser: AdminUser = { ...adminUser, role: role as AdminUser["role"] };

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
