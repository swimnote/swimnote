import { Ionicons } from "@expo/vector-icons";
import { CircleAlert, LogOut } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS, ROLE_SELECT_LABELS, type RoleConfig } from "@/constants/auth";
import { useAuth, type AccountEntry } from "@/context/AuthContext";

const C = Colors.light;

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

// 역할별 아이콘/색상 매핑 (ROLE_CONFIGS 기반, 없으면 기본값)
function getRoleDisplay(roleKey: string) {
  const cfg = ROLE_CONFIGS[roleKey];
  if (cfg) {
    return { label: cfg.title, icon: cfg.icon as any, color: cfg.color, bg: cfg.bgColor };
  }
  if (roleKey === "parent" || roleKey === "parent_account") {
    return { label: "학부모", icon: "heart" as any, color: "#E4A93A", bg: "#FFFBEB" };
  }
  return { label: roleKey, icon: "user" as any, color: "#64748B", bg: "#F1F5F9" };
}

export default function OrgRoleSelectScreen() {
  const { kind, adminUser, parentAccount, pool, logout, switchRole, allAccounts, setLastUsedRole, activateAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  const availableRoles: Array<{ entry: AccountEntry; cfg: RoleConfig; roleKey: string }> = useMemo(() => {
    const result: Array<{ entry: AccountEntry; cfg: RoleConfig; roleKey: string }> = [];

    for (const entry of allAccounts) {
      if (entry.kind === "parent") {
        const cfg = ROLE_CONFIGS["parent"];
        if (cfg && !result.find(x => x.roleKey === "parent")) {
          result.push({ entry, cfg, roleKey: "parent" });
        }
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

  async function handleSelectRole(item: typeof availableRoles[0]) {
    setLoading(true);
    try {
      const { entry, roleKey } = item;

      if (entry.kind !== kind && entry.token) {
        await activateAccount(entry);
      }

      if (entry.kind === "admin" && adminUser && adminUser.role !== roleKey && entry.token) {
        await switchRole(roleKey);
      }

      await setLastUsedRole(roleKey);

      const homePath = ROLE_HOME_MAP[roleKey] || "/org-role-select";
      router.replace(homePath as any);
    } catch (e) {
      console.error("role select error", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background, paddingBottom: insets.bottom }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 16) }]}>
        <View style={styles.headerNameWrap} pointerEvents="none">
          <View style={styles.orgNameRow}>
            <Ionicons name="water" size={16} color={C.tint} />
            <Text style={[styles.orgName, { color: C.text }]} numberOfLines={1}>{orgName}</Text>
          </View>
        </View>
        <Pressable onPress={logout} style={styles.logoutBtn} hitSlop={8}>
          <LogOut size={18} color={C.textMuted} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={C.tint} size="large" />
        ) : availableRoles.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconBox, { backgroundColor: "#FFF1BF" }]}>
              <CircleAlert size={32} color="#D97706" />
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
              const display = getRoleDisplay(item.roleKey);
              return (
                <Pressable
                  key={item.roleKey}
                  style={({ pressed }) => [styles.roleCard, { backgroundColor: C.card, opacity: pressed ? 0.82 : 1 }]}
                  onPress={() => handleSelectRole(item)}
                >
                  <View style={[styles.roleIconBox, { backgroundColor: display.bg }]}>
                    <LucideIcon name={display.icon} size={36} color={display.color} />
                  </View>
                  <Text style={[styles.roleTitle, { color: C.text }]}>{display.label}</Text>
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
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  headerNameWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  orgNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  orgName: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  logoutBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, marginLeft: "auto" },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 40 },
  emptyState: { alignItems: "center", gap: 14, paddingVertical: 60 },
  emptyIconBox: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  signupBtn: { marginTop: 4, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  signupBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },
  rolesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, justifyContent: "center" },
  roleCard: {
    width: 140, borderRadius: 24, paddingVertical: 36, paddingHorizontal: 16,
    alignItems: "center", gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  roleIconBox: {
    width: 84, height: 84, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
  },
  roleTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", textAlign: "center" },
});
