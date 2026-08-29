/**
 * PoolSwitcherSheet — 수영장 선택 바텀시트
 *
 * 멤버십이 2개 이상일 때 "현재 수영장 ▼" 버튼 탭 → 이 시트 표시
 * 각 수영장 행 탭 → /auth/switch-pool 호출 → 세션 갱신 → 시트 닫기
 */
import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
const C = Colors.light;
import type { PoolMembership } from "@/context/auth/MembershipsContext";

interface Props {
  visible: boolean;
  memberships: PoolMembership[];
  currentPoolId: string | null;
  currentRole: string | null;
  onSwitch: (poolId: string, role: string) => Promise<void>;
  onClose: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  pool_admin: "원장",
  teacher: "선생님",
  sub_admin: "부관리자",
  parent_account: "학부모",
};

export default function PoolSwitcherSheet({
  visible,
  memberships,
  currentPoolId,
  currentRole,
  onSwitch,
  onClose,
}: Props) {
  const [switching, setSwitching] = useState<string | null>(null);

  async function handlePress(m: PoolMembership) {
    if (m.pool_id === currentPoolId && m.role === currentRole) {
      onClose();
      return;
    }
    setSwitching(`${m.pool_id}::${m.role}`);
    try {
      await onSwitch(m.pool_id, m.role);
      onClose();
    } catch (e: any) {
      Alert.alert("전환 실패", e?.message || "수영장 전환에 실패했습니다.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1} />
      <View style={styles.sheet}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>수영장 전환</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
            <Feather name="x" size={22} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />

        {/* 멤버십 목록 */}
        <FlatList
          data={memberships}
          keyExtractor={m => `${m.pool_id}::${m.role}`}
          style={styles.list}
          renderItem={({ item: m }) => {
            const isActive = m.pool_id === currentPoolId && m.role === currentRole;
            const key = `${m.pool_id}::${m.role}`;
            const isLoading = switching === key;
            return (
              <TouchableOpacity
                style={[styles.item, isActive && styles.itemActive]}
                onPress={() => handlePress(m)}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                <View style={styles.itemLeft}>
                  <View style={[styles.dot, isActive && styles.dotActive]} />
                  <View>
                    <Text style={[styles.poolName, isActive && styles.poolNameActive]}>
                      {m.pool_name}
                    </Text>
                    <Text style={styles.roleLabel}>
                      {ROLE_LABEL[m.role] ?? m.role}
                    </Text>
                  </View>
                </View>
                {isLoading ? (
                  <ActivityIndicator size="small" color={C.primaryAction} />
                ) : isActive ? (
                  <Feather name="check" size={18} color={C.primaryAction} />
                ) : null}
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "60%",
    paddingTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: C.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginHorizontal: 0,
  },
  list: {
    marginTop: 4,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  itemActive: {
    backgroundColor: C.surfaceElevated ?? "#F5F7FA",
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.border,
  },
  dotActive: {
    backgroundColor: C.primaryAction,
  },
  poolName: {
    fontSize: 15,
    fontWeight: "500",
    color: C.textPrimary,
  },
  poolNameActive: {
    color: C.primaryAction,
    fontWeight: "600",
  },
  roleLabel: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
});
