import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS, ROLE_SELECT_LABELS, type RoleConfig } from "@/constants/auth";
import { useAuth, type AccountEntry } from "@/context/AuthContext";

const C = Colors.light;

// 역할 키 → 홈 경로
const ROLE_HOME_MAP: Record<string, string> = {
  super_admin:    "/(super)/dashboard",
  platform_admin: "/(super)/dashboard",
  super_manager:  "/(super)/dashboard",
  pool_admin:     "/(admin)/dashboard",
  sub_admin:      "/(admin)/dashboard",
  teacher:        "/(teacher)/today-schedule",
  parent:         "/(parent)/home",
  parent_account: "/(parent)/home",
};

export default function OrgRoleSelectScreen() {
  const { kind, adminUser, parentAccount, pool, logout, switchRole, allAccounts, setLastUsedRole, activateAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  // 사용 가능한 역할 목록 구성 (전체 계정에서 추출)
  const availableRoles: Array<{ entry: AccountEntry; cfg: RoleConfig; roleKey: string }> = useMemo(() => {
    const result: Array<{ entry: AccountEntry; cfg: RoleConfig; roleKey: string }> = [];

    for (const entry of allAccounts) {
      if (entry.kind === "parent") {
        const cfg = ROLE_CONFIGS["parent"];
        if (cfg) result.push({ entry, cfg, roleKey: "parent" });
      } else if (entry.kind === "admin" && entry.user) {
        const roles: string[] = entry.user.roles?.length ? entry.user.roles : [entry.user.role];
        for (const r of roles) {
          const cfg = ROLE_CONFIGS[r];
          if (cfg && !result.find(x => x.roleKey === r)) {
            result.push({ entry, cfg, roleKey: r });
          }
        }
      }
    }

    // fallback: allAccounts 비어있으면 현재 세션에서 추출
    if (result.length === 0) {
      if (kind === "parent") {
        const cfg = ROLE_CONFIGS["parent"];
        if (cfg) result.push({ entry: { kind: "parent", token: "", parent: parentAccount! }, cfg, roleKey: "parent" });
      } else if (kind === "admin" && adminUser) {
        const roles = adminUser.roles?.length ? adminUser.roles : [adminUser.role];
        for (const r of roles) {
          const cfg = ROLE_CONFIGS[r];
          if (cfg) result.push({ entry: { kind: "admin", token: "", user: adminUser }, cfg, roleKey: r });
        }
      }
    }

    return result;
  }, [allAccounts, kind, adminUser, parentAccount]);

  const orgName =
    pool?.name ||
    parentAccount?.pool_name ||
    (adminUser?.role === "super_admin" || adminUser?.role === "platform_admin" ? "스윔노트 플랫폼" : "수영장 선택");

  const orgInitial = orgName.charAt(0);

  async function handleSelectRole(item: typeof availableRoles[0]) {
    setLoading(true);
    try {
      const { entry, roleKey } = item;

      // 다른 계정 종류면 먼저 activate
      if (entry.kind !== kind && entry.token) {
        await activateAccount(entry);
      }

      // 같은 admin 계정이지만 role이 다르면 switch-role
      if (entry.kind === "admin" && adminUser && adminUser.role !== roleKey && entry.token) {
        await switchRole(roleKey);
      }

      // last_used_role 저장
      await setLastUsedRole(roleKey);

      const homePath = ROLE_HOME_MAP[roleKey] || "/org-role-select";
      router.replace(homePath as any);
    } catch (e) {
      console.error("role select error", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background, paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 16) }]}>
        <View style={[styles.orgSelector, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.orgName, { color: C.text }]} numberOfLines={1}>{orgName}</Text>
        </View>
        <Pressable onPress={handleLogout} style={styles.logoutBtn} hitSlop={8}>
          <Feather name="log-out" size={18} color={C.textMuted} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={C.tint} size="large" />
        ) : availableRoles.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconBox, { backgroundColor: "#FFF1BF" }]}>
              <Feather name="alert-circle" size={32} color="#D97706" />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>이용 가능한 권한이 없습니다</Text>
            <Text style={[styles.emptyText, { color: C.textSecondary }]}>
              현재 승인된 역할이 없습니다.{"\n"}관리자에게 문의하거나 새로 가입해주세요.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.signupBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push("/signup-role" as any)}
            >
              <Text style={styles.signupBtnText}>회원가입하기</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.rolesGrid}>
            {availableRoles.map(item => {
              const isAdmin = ["pool_admin", "sub_admin", "super_admin", "platform_admin", "super_manager"].includes(item.roleKey);
              const icon = isAdmin ? "briefcase" : "edit-3";
              const label = isAdmin ? "운영자" : "선생님";
              return (
                <Pressable
                  key={item.roleKey}
                  style={({ pressed }) => [styles.roleCard, { backgroundColor: C.card, opacity: pressed ? 0.82 : 1 }]}
                  onPress={() => handleSelectRole(item)}
                >
                  <View style={styles.roleIconBox}>
                    <Feather name={icon as any} size={36} color="#1B4965" />
                  </View>
                  <Text style={[styles.roleTitle, { color: C.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  orgSelector: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 260 },
  orgAvatar: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  orgAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  orgName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  logoutBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 40 },
  emptyState: { alignItems: "center", gap: 14, paddingVertical: 60 },
  emptyIconBox: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  signupBtn: { marginTop: 4, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  signupBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rolesGrid: { flexDirection: "row", gap: 16, justifyContent: "center" },
  roleCard: {
    flex: 1, maxWidth: 160, borderRadius: 24, paddingVertical: 36, paddingHorizontal: 16,
    alignItems: "center", gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  roleIconBox: {
    width: 84, height: 84, borderRadius: 26,
    backgroundColor: "#DFF6F4",
    alignItems: "center", justifyContent: "center",
  },
  roleTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
});
