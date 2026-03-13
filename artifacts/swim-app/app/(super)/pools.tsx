import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Pool {
  id: string; name: string; address: string; phone: string; owner_name: string; owner_email: string;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  subscription_status: string; member_count?: number | null; created_at: string;
}

const APPROVAL_CONFIG = {
  pending: { label: "승인 대기", color: Colors.light.warning, bg: "#FEF3C7" },
  approved: { label: "승인됨", color: Colors.light.approved, bg: "#D1FAE5" },
  rejected: { label: "반려됨", color: Colors.light.rejected, bg: "#FEE2E2" },
};

const FILTER_TABS = [
  { key: "all", label: "전체" },
  { key: "pending", label: "대기" },
  { key: "approved", label: "승인" },
  { key: "rejected", label: "반려" },
];

export default function SuperPoolsScreen() {
  const { token, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [rejectModal, setRejectModal] = useState<Pool | null>(null);
  const [reason, setReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  async function fetchPools() {
    try {
      const res = await apiRequest(token, "/admin/pools");
      const data = await res.json();
      setPools(Array.isArray(data) ? data : []);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchPools(); }, []);

  async function handleApprove(pool: Pool) {
    Alert.alert("승인 확인", `${pool.name} 수영장을 승인하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "승인", onPress: async () => {
        setProcessing(pool.id);
        const res = await apiRequest(token, `/admin/pools/${pool.id}/approve`, { method: "PATCH" });
        const data = await res.json();
        setPools(prev => prev.map(p => p.id === pool.id ? { ...p, ...data } : p));
        setProcessing(null);
      }},
    ]);
  }

  async function handleReject() {
    if (!rejectModal) return;
    setProcessing(rejectModal.id);
    const res = await apiRequest(token, `/admin/pools/${rejectModal.id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) });
    const data = await res.json();
    setPools(prev => prev.map(p => p.id === rejectModal.id ? { ...p, ...data } : p));
    setRejectModal(null);
    setReason("");
    setProcessing(null);
  }

  const filtered = filter === "all" ? pools : pools.filter(p => p.approval_status === filter);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.badge, { color: "#7C3AED" }]}>슈퍼관리자</Text>
          <Text style={[styles.title, { color: C.text }]}>수영장 승인 관리</Text>
        </View>
        <Pressable onPress={logout} style={[styles.logoutBtn, { backgroundColor: C.card }]}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }}>
        {FILTER_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.filterTab, { backgroundColor: filter === tab.key ? "#7C3AED" : C.card, borderColor: filter === tab.key ? "#7C3AED" : C.border }]}
            onPress={() => setFilter(tab.key)}
          >
            <Text style={[styles.filterText, { color: filter === tab.key ? "#fff" : C.textSecondary }]}>
              {tab.label} {tab.key === "all" ? `(${pools.length})` : `(${pools.filter(p => tab.key === "all" || p.approval_status === tab.key).length})`}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPools(); }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>해당하는 수영장이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const ac = APPROVAL_CONFIG[item.approval_status];
            return (
              <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.poolName, { color: C.text }]}>{item.name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: ac.bg }]}>
                    <Text style={[styles.statusText, { color: ac.color }]}>{ac.label}</Text>
                  </View>
                </View>
                <View style={styles.infoRows}>
                  {[
                    { icon: "map-pin" as const, text: item.address },
                    { icon: "phone" as const, text: item.phone },
                    { icon: "user" as const, text: `${item.owner_name} · ${item.owner_email}` },
                    { icon: "calendar" as const, text: `신청일: ${new Date(item.created_at).toLocaleDateString("ko-KR")}` },
                  ].map(({ icon, text }) => (
                    <View key={icon} style={styles.infoRow}>
                      <Feather name={icon} size={13} color={C.textMuted} />
                      <Text style={[styles.infoText, { color: C.textSecondary }]}>{text}</Text>
                    </View>
                  ))}
                  {item.rejection_reason ? (
                    <View style={[styles.reasonBox, { backgroundColor: "#FEE2E2" }]}>
                      <Text style={[styles.reasonText, { color: C.error }]}>반려 사유: {item.rejection_reason}</Text>
                    </View>
                  ) : null}
                </View>
                {item.approval_status === "pending" && (
                  <View style={styles.actionRow}>
                    <Pressable
                      style={({ pressed }) => [styles.approveBtn, { backgroundColor: C.success, opacity: pressed ? 0.85 : 1 }]}
                      onPress={() => handleApprove(item)}
                      disabled={!!processing}
                    >
                      {processing === item.id ? <ActivityIndicator color="#fff" size="small" /> : (
                        <>
                          <Feather name="check" size={16} color="#fff" />
                          <Text style={styles.actionBtnText}>승인</Text>
                        </>
                      )}
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.rejectBtn, { borderColor: C.error, opacity: pressed ? 0.85 : 1 }]}
                      onPress={() => setRejectModal(item)}
                      disabled={!!processing}
                    >
                      <Feather name="x" size={16} color={C.error} />
                      <Text style={[styles.rejectBtnText, { color: C.error }]}>반려</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!rejectModal} animationType="slide" transparent onRequestClose={() => setRejectModal(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalSheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: C.text }]}>반려 사유 입력</Text>
            <Text style={[styles.modalSub, { color: C.textSecondary }]}>{rejectModal?.name}</Text>
            <TextInput
              style={[styles.textarea, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
              value={reason}
              onChangeText={setReason}
              placeholder="반려 사유를 입력해주세요"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.modalBtns}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => { setRejectModal(null); setReason(""); }}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.rejectConfirmBtn, { backgroundColor: C.error }]} onPress={handleReject} disabled={!!processing}>
                <Text style={styles.actionBtnText}>반려 처리</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 12 },
  badge: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  filterTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  card: { borderRadius: 16, padding: 16, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  poolName: { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  infoRows: { gap: 6 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  infoText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  reasonBox: { borderRadius: 8, padding: 10 },
  reasonText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  actionRow: { flexDirection: "row", gap: 10 },
  approveBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12 },
  rejectBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, borderWidth: 1.5 },
  actionBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rejectBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 8 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -8 },
  textarea: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, height: 100, fontSize: 15, fontFamily: "Inter_400Regular" },
  modalBtns: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rejectConfirmBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
