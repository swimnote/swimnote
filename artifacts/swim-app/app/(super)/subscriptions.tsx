import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Pool {
  id: string; name: string; owner_name: string; approval_status: string;
  subscription_status: "trial" | "active" | "expired" | "suspended" | "cancelled";
  subscription_start_at?: string | null; subscription_end_at?: string | null;
  member_count?: number | null;
}

const SUB_CONFIG: Record<string, { label: string; color: string; bg: string; icon: "check-circle" | "clock" | "alert-triangle" | "pause-circle" | "x-circle" }> = {
  trial: { label: "체험 중", color: Colors.light.trial, bg: "#F3E8FF", icon: "clock" },
  active: { label: "구독 중", color: Colors.light.active, bg: "#D1FAE5", icon: "check-circle" },
  expired: { label: "만료됨", color: Colors.light.expired, bg: "#F3F4F6", icon: "alert-triangle" },
  suspended: { label: "정지됨", color: Colors.light.suspended, bg: "#FEF3C7", icon: "pause-circle" },
  cancelled: { label: "해지됨", color: Colors.light.cancelled, bg: "#FEE2E2", icon: "x-circle" },
};

const SUB_OPTIONS = ["trial", "active", "expired", "suspended", "cancelled"];

export default function SubscriptionsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editModal, setEditModal] = useState<Pool | null>(null);
  const [newStatus, setNewStatus] = useState<string>("active");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchPools() {
    try {
      const res = await apiRequest(token, "/admin/pools?approval_status=approved");
      const data = await res.json();
      setPools(Array.isArray(data) ? data : []);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchPools(); }, []);

  function openEdit(pool: Pool) {
    setEditModal(pool);
    setNewStatus(pool.subscription_status);
    setStartDate(pool.subscription_start_at ? pool.subscription_start_at.split("T")[0] : "");
    setEndDate(pool.subscription_end_at ? pool.subscription_end_at.split("T")[0] : "");
    setNote("");
  }

  async function handleSave() {
    if (!editModal) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/pools/${editModal.id}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          subscription_status: newStatus,
          subscription_start_at: startDate || null,
          subscription_end_at: endDate || null,
          note,
        }),
      });
      const data = await res.json();
      setPools(prev => prev.map(p => p.id === editModal.id ? { ...p, ...data } : p));
      setEditModal(null);
    } finally { setSaving(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.badge, { color: "#7C3AED" }]}>슈퍼관리자</Text>
          <Text style={[styles.title, { color: C.text }]}>구독 관리</Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: "#F3E8FF" }]}>
          <Text style={[styles.countText, { color: "#7C3AED" }]}>승인 {pools.length}개</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={pools}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPools(); }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="credit-card" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>승인된 수영장이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const sc = SUB_CONFIG[item.subscription_status] || SUB_CONFIG.expired;
            return (
              <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardLeft}>
                    <Text style={[styles.poolName, { color: C.text }]}>{item.name}</Text>
                    <Text style={[styles.ownerText, { color: C.textSecondary }]}>{item.owner_name}</Text>
                  </View>
                  <View style={[styles.subBadge, { backgroundColor: sc.bg }]}>
                    <Feather name={sc.icon} size={12} color={sc.color} />
                    <Text style={[styles.subText, { color: sc.color }]}>{sc.label}</Text>
                  </View>
                </View>

                <View style={styles.dateRow}>
                  {item.subscription_start_at ? (
                    <View style={styles.dateItem}>
                      <Text style={[styles.dateLabel, { color: C.textMuted }]}>시작</Text>
                      <Text style={[styles.dateValue, { color: C.text }]}>{new Date(item.subscription_start_at).toLocaleDateString("ko-KR")}</Text>
                    </View>
                  ) : null}
                  {item.subscription_end_at ? (
                    <View style={styles.dateItem}>
                      <Text style={[styles.dateLabel, { color: C.textMuted }]}>만료</Text>
                      <Text style={[styles.dateValue, { color: item.subscription_status === "expired" ? C.error : C.text }]}>
                        {new Date(item.subscription_end_at).toLocaleDateString("ko-KR")}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.dateItem}>
                    <Text style={[styles.dateLabel, { color: C.textMuted }]}>회원</Text>
                    <Text style={[styles.dateValue, { color: C.text }]}>{item.member_count || 0}명</Text>
                  </View>
                </View>

                <Pressable
                  style={({ pressed }) => [styles.editBtn, { backgroundColor: "#F3E8FF", opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => openEdit(item)}
                >
                  <Feather name="edit-2" size={14} color="#7C3AED" />
                  <Text style={[styles.editText, { color: "#7C3AED" }]}>구독 상태 변경</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!editModal} animationType="slide" transparent onRequestClose={() => setEditModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text }]}>구독 상태 변경</Text>
            <Text style={[styles.modalSub, { color: C.textSecondary }]}>{editModal?.name}</Text>

            <Text style={[styles.label, { color: C.textSecondary }]}>구독 상태</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {SUB_OPTIONS.map((s) => {
                const sc = SUB_CONFIG[s];
                return (
                  <Pressable
                    key={s}
                    style={[styles.statusOption, { backgroundColor: newStatus === s ? sc.bg : C.background, borderColor: newStatus === s ? sc.color : C.border }]}
                    onPress={() => setNewStatus(s)}
                  >
                    <Feather name={sc.icon} size={14} color={newStatus === s ? sc.color : C.textMuted} />
                    <Text style={[styles.statusOptionText, { color: newStatus === s ? sc.color : C.textSecondary }]}>{sc.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {[
              { key: "start", label: "구독 시작일", value: startDate, onChange: setStartDate, placeholder: "2024-01-01" },
              { key: "end", label: "구독 만료일", value: endDate, onChange: setEndDate, placeholder: "2024-12-31" },
              { key: "note", label: "메모", value: note, onChange: setNote, placeholder: "처리 사유 등" },
            ].map(({ key, label, value, onChange, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={value}
                  onChangeText={onChange}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                />
              </View>
            ))}

            <View style={styles.modalBtns}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => setEditModal(null)}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, { backgroundColor: "#7C3AED" }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>저장</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 12 },
  badge: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  countBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  countText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, padding: 16, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardLeft: { flex: 1, gap: 2 },
  poolName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  ownerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  subBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  subText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  dateRow: { flexDirection: "row", gap: 20 },
  dateItem: { gap: 2 },
  dateLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  dateValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  editBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  editText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 8 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -8 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  statusOption: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  statusOptionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  field: { gap: 6 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  saveBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
