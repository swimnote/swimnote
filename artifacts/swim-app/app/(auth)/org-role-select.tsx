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
          <View style={[styles.orgAvatar, { backgroundColor: C.tintLight }]}>
            <Text style={[styles.orgAvatarText, { color: C.tint }]}>{orgInitial}</Text>
          </View>
          <Text style={[styles.orgName, { color: C.text }]} numberOfLines={1}>{orgName}</Text>
        </View>
        <Pressable onPress={handleLogout} style={styles.logoutBtn} hitSlop={8}>
          <Feather name="log-out" size={18} color={C.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: 24, paddingBottom: 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleArea}>
          <Text style={[styles.titleLabel, { color: C.textMuted }]}>
            {ROLE_SELECT_LABELS.title}
          </Text>
          <Text style={[styles.titleSub, { color: C.textSecondary }]}>
            어떤 역할로 진입하시겠어요?
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={C.tint} size="large" style={{ marginTop: 40 }} />
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
            {availableRoles.map(item => (
              <Pressable
                key={item.roleKey}
                style={({ pressed }) => [
                  styles.roleCard,
                  { backgroundColor: C.card, borderColor: item.cfg.color + "40", opacity: pressed ? 0.88 : 1 },
                ]}
                onPress={() => handleSelectRole(item)}
              >
                <View style={[styles.roleIconBox, { backgroundColor: item.cfg.bgColor }]}>
                  <Feather name={item.cfg.icon as any} size={30} color={item.cfg.color} />
                </View>
                <Text style={[styles.roleTitle, { color: C.text }]}>{item.cfg.title}</Text>
                <Text style={[styles.roleSub, { color: C.textSecondary }]}>{item.cfg.subtitle}</Text>
                <View style={[styles.enterBtn, { backgroundColor: item.cfg.color }]}>
                  <Text style={styles.enterBtnText}>{ROLE_SELECT_LABELS.enterModeBtn(item.cfg.title)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const CARD_SIZE = 158;

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  orgSelector: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 260 },
  orgAvatar: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  orgAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  orgName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  logoutBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  content: { gap: 24, paddingTop: 12 },
  titleArea: { alignItems: "center", gap: 6 },
  titleLabel: { fontSize: 13, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  titleSub: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingVertical: 60 },
  emptyIconBox: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  signupBtn: { marginTop: 4, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  signupBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rolesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center" },
  roleCard: { width: CARD_SIZE, borderRadius: 20, padding: 20, gap: 10, alignItems: "center", borderWidth: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  roleIconBox: { width: 68, height: 68, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  roleTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  roleSub: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },
  enterBtn: { width: "100%", height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 4 },
  enterBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
