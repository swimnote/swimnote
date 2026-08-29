/**
 * PoolSwitcherButton — 헤더 "현재 수영장 ▼" 버튼
 *
 * 멤버십이 2개 이상일 때만 표시.
 * 탭 → PoolSwitcherSheet 열림.
 *
 * 사용법 (헤더 right 버튼 등):
 *   <PoolSwitcherButton />
 */
import React, { useState } from "react";
import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
const C = Colors.light;
import { useMemberships } from "@/context/auth/MembershipsContext";
import { useAuth } from "@/context/AuthContext";
import PoolSwitcherSheet from "./PoolSwitcherSheet";

export default function PoolSwitcherButton() {
  const [sheetVisible, setSheetVisible] = useState(false);
  const { memberships, hasManyPools, switchToPool } = useMemberships();
  const auth = useAuth();

  if (!hasManyPools) return null;

  const currentPool = memberships.find(
    m => m.pool_id === auth.pool?.id && m.role === auth.activeRole,
  );
  const poolName = currentPool?.pool_name ?? auth.pool?.name ?? "수영장";

  async function handleSwitch(poolId: string, role: string) {
    if (!auth.token) throw new Error("로그인이 필요합니다.");
    await switchToPool(auth.token, poolId, role, async (newToken, newPoolId, newRole, newPoolName) => {
      // 세션 갱신: token + role + pool
      // 현재 auth.setAdminSession / role switch 메커니즘 활용
      // newToken을 AsyncStorage에 저장 후 세션 복원
      const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
      await AsyncStorage.setItem("auth_token", newToken);
      // RoleContext.switchRole처럼 JWT 교체 + activeRole 갱신
      await auth.setActiveRole(newRole);
      await auth.setActivePoolId(newPoolId);
      // pool 정보 갱신
      await auth.refreshPool();
    });
  }

  const currentPoolId = auth.pool?.id ?? null;
  const currentRole = auth.activeRole;

  return (
    <>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setSheetVisible(true)}
        activeOpacity={0.75}
      >
        <Text style={styles.label} numberOfLines={1}>
          {poolName}
        </Text>
        <Feather name="chevron-down" size={14} color={C.textSecondary} />
      </TouchableOpacity>

      <PoolSwitcherSheet
        visible={sheetVisible}
        memberships={memberships}
        currentPoolId={currentPoolId}
        currentRole={currentRole}
        onSwitch={handleSwitch}
        onClose={() => setSheetVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.surfaceElevated ?? "#F5F7FA",
    maxWidth: 160,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: C.textPrimary,
    flexShrink: 1,
  },
});
