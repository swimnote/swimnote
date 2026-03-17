import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS, ROLE_SELECT_LABELS, type RoleConfig } from "@/constants/auth";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function OrgRoleSelectScreen() {
  const { kind, adminUser, parentAccount, pool, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);

  const availableRoles: RoleConfig[] = useMemo(() => {
    if (!kind) return [];
    if (kind === "parent") return [ROLE_CONFIGS.parent];
    if (kind === "admin") {
      const role = adminUser?.role;
      if (role === "super_admin") return [ROLE_CONFIGS.super_admin];
      if (role === "pool_admin") return [ROLE_CONFIGS.pool_admin];
      if (role === "teacher") return [ROLE_CONFIGS.teacher];
    }
    return [];
  }, [kind, adminUser?.role]);

  const orgName =
    pool?.name ||
    parentAccount?.pool_name ||
    (adminUser?.role === "super_admin" ? "스윔노트 플랫폼" : "수영장 선택");

  const orgInitial = orgName.charAt(0);

  function handleSelectRole(cfg: RoleConfig) {
    router.replace(cfg.route as any);
  }

  async function handleLogout() {
    await logout();
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background, paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 16) }]}>
        <Pressable
          style={[styles.orgSelector, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => setOrgMenuOpen(true)}
        >
          <View style={[styles.orgAvatar, { backgroundColor: C.tintLight }]}>
            <Text style={[styles.orgAvatarText, { color: C.tint }]}>{orgInitial}</Text>
          </View>
          <Text style={[styles.orgName, { color: C.text }]} numberOfLines={1}>{orgName}</Text>
          <Feather name="chevron-down" size={15} color={C.textMuted} />
        </Pressable>

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
        </View>

        {availableRoles.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="alert-circle" size={40} color={C.textMuted} />
            <Text style={[styles.emptyText, { color: C.textSecondary }]}>{ROLE_SELECT_LABELS.noRolesMsg}</Text>
          </View>
        ) : (
          <View style={styles.rolesGrid}>
            {availableRoles.map(cfg => (
              <Pressable
                key={cfg.key}
                style={({ pressed }) => [
                  styles.roleCard,
                  { backgroundColor: C.card, borderColor: cfg.color + "40", opacity: pressed ? 0.88 : 1 },
                ]}
                onPress={() => handleSelectRole(cfg)}
              >
                <View style={[styles.roleIconBox, { backgroundColor: cfg.bgColor }]}>
                  <Feather name={cfg.icon as any} size={30} color={cfg.color} />
                </View>
                <Text style={[styles.roleTitle, { color: C.text }]}>{cfg.title}</Text>
                <Text style={[styles.roleSub, { color: C.textSecondary }]}>{cfg.subtitle}</Text>
                <View style={[styles.enterBtn, { backgroundColor: cfg.color }]}>
                  <Text style={styles.enterBtnText}>{ROLE_SELECT_LABELS.enterModeBtn(cfg.title)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={orgMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOrgMenuOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setOrgMenuOpen(false)}>
          <View style={[styles.orgDropdown, { backgroundColor: C.card }]}>
            <Text style={[styles.dropdownTitle, { color: C.textSecondary }]}>
              {ROLE_SELECT_LABELS.orgSelectorLabel}
            </Text>
            <Pressable
              style={[styles.orgOption, { borderColor: C.tint + "50", backgroundColor: C.tintLight }]}
              onPress={() => setOrgMenuOpen(false)}
            >
              <View style={[styles.orgAvatar, { backgroundColor: C.tint + "30" }]}>
                <Text style={[styles.orgAvatarText, { color: C.tint }]}>{orgInitial}</Text>
              </View>
              <Text style={[styles.orgOptionText, { color: C.tint }]} numberOfLines={1}>{orgName}</Text>
              <Feather name="check" size={16} color={C.tint} />
            </Pressable>
            <Text style={[styles.orgDropdownNote, { color: C.textMuted }]}>
              여러 수영장에 소속된 경우 추후 전환 기능이 추가됩니다.
            </Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const CARD_SIZE = 158;

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  orgSelector: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 260,
  },
  orgAvatar: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  orgAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  orgName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  logoutBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  content: { gap: 24, paddingTop: 12 },
  titleArea: { alignItems: "center" },
  titleLabel: { fontSize: 13, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 60 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  rolesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "center",
  },
  roleCard: {
    width: CARD_SIZE,
    borderRadius: 20,
    padding: 20,
    gap: 10,
    alignItems: "center",
    borderWidth: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  roleIconBox: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  roleTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  roleSub: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },
  enterBtn: {
    width: "100%",
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  enterBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    paddingTop: Platform.OS === "web" ? 110 : 80,
    paddingLeft: 20,
  },
  orgDropdown: {
    borderRadius: 18,
    padding: 18,
    gap: 12,
    minWidth: 240,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  dropdownTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  orgOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  orgOptionText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  orgDropdownNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
});
