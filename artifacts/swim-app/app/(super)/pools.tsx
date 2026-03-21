/**
 * (super)/pools.tsx — 운영자 관리 (대규모 운영 콘솔)
 * - 리스트형(행형) 구조
 * - 다중 선택 + 일괄 처리
 * - 강화된 필터 칩
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface Operator {
  id: string;
  name: string;
  owner_name: string;
  approval_status: "pending" | "approved" | "rejected";
  subscription_status: string;
  subscription_tier: any;
  pool_type: string;
  active_member_count: number;
  usage_pct: number;
  total_storage_gb: number;
  last_login_at: string | null;
  next_billing_at: string | null;
  deletion_pending: boolean;
  created_at: string;
}

type FilterKey = "all" | "pending" | "payment_failed" | "storage_alert" | "deletion_pending" | "this_week" | "free_over30" |
  "type_swimming" | "type_coach" | "type_rental" | "type_franchise";

const FILTER_CHIPS: { key: FilterKey; label: string; color: string; bg: string }[] = [
  { key: "all",              label: "전체",          color: "#374151", bg: "#F3F4F6" },
  { key: "pending",          label: "승인 대기",      color: "#D97706", bg: "#FEF3C7" },
  { key: "payment_failed",   label: "결제 실패",      color: "#DC2626", bg: "#FEE2E2" },
  { key: "storage_alert",    label: "저장 95%↑",     color: P,         bg: "#EDE9FE" },
  { key: "deletion_pending", label: "삭제 예정",      color: "#0891B2", bg: "#ECFEFF" },
  { key: "this_week",        label: "이번 주 신규",  color: "#059669", bg: "#D1FAE5" },
  { key: "free_over30",      label: "무료 체험",      color: "#6B7280", bg: "#F3F4F6" },
];

const TYPE_CHIPS: { key: FilterKey; label: string; color: string; bg: string }[] = [
  { key: "type_swimming",  label: "🏊 수영장",    color: "#0891B2", bg: "#ECFEFF" },
  { key: "type_coach",     label: "🧑‍🏫 1인 코치", color: "#059669", bg: "#D1FAE5" },
  { key: "type_rental",    label: "🏟 대관팀",    color: "#D97706", bg: "#FEF3C7" },
  { key: "type_franchise", label: "🏢 프랜차이즈", color: P,         bg: "#EDE9FE" },
];

const POOL_TYPE_CFG: Record<string, { label: string; color: string }> = {
  swimming_pool: { label: "수영장",    color: "#0891B2" },
  solo_coach:    { label: "1인 코치",  color: "#059669" },
  rental_team:   { label: "대관팀",    color: "#D97706" },
  franchise:     { label: "프랜차이즈", color: P },
};

const SORT_OPTS = [
  { key: "created_at", label: "최신순" },
  { key: "name",       label: "이름순" },
  { key: "members",    label: "회원 수↓" },
  { key: "storage",    label: "저장 사용↓" },
];

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: "대기",   color: "#D97706", bg: "#FEF3C7" },
  approved:  { label: "운영",   color: "#059669", bg: "#D1FAE5" },
  rejected:  { label: "반려",   color: "#DC2626", bg: "#FEE2E2" },
};

const SUB_CFG: Record<string, { label: string; color: string }> = {
  trial:     { label: "체험",   color: P },
  active:    { label: "구독",   color: "#059669" },
  expired:   { label: "만료",   color: "#6B7280" },
  suspended: { label: "정지",   color: "#D97706" },
  cancelled: { label: "해지",   color: "#DC2626" },
};

const BULK_ACTIONS = [
  { key: "approve",    label: "승인",   color: "#059669", bg: "#D1FAE5" },
  { key: "reject",     label: "반려",   color: "#DC2626", bg: "#FEE2E2" },
  { key: "restrict",   label: "제한",   color: "#D97706", bg: "#FEF3C7" },
  { key: "terminate",  label: "종료",   color: "#7F1D1D", bg: "#FEE2E2" },
];

export default function SuperPoolsScreen() {
  const { token } = useAuth();
  const { filter: initFilter } = useLocalSearchParams<{ filter?: FilterKey }>();

  const [operators,   setOperators]   = useState<Operator[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filter,      setFilter]      = useState<FilterKey>((initFilter as FilterKey) || "all");
  const [sort,        setSort]        = useState("created_at");
  const [search,      setSearch]      = useState("");
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [bulkModal,   setBulkModal]   = useState<string | null>(null);
  const [processing,  setProcessing]  = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOperators = useCallback(async (f: FilterKey, s: string, so: string) => {
    try {
      const params = new URLSearchParams({ sort: so });
      if (f !== "all") params.set("filter", f);
      if (s.trim())    params.set("search", s.trim());
      const res = await apiRequest(token, `/super/operators?${params}`);
      if (res.ok) { const d = await res.json(); setOperators(d.operators ?? d ?? []); }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOperators(filter, search, sort), 300);
  }, [filter, search, sort]);

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function executeBulk(action: string) {
    if (selected.size === 0) return;
    if (action === "terminate") {
      setBulkModal(null); setMultiSelect(false);
      router.push("/(super)/kill-switch" as any); return;
    }
    setProcessing(true);
    try {
      await apiRequest(token, "/super/operators/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), action, reason: rejectReason || undefined }),
      });
      setBulkModal(null); setSelected(new Set()); setMultiSelect(false); setRejectReason("");
      fetchOperators(filter, search, sort);
    } catch {}
    finally { setProcessing(false); }
  }

  async function quickAction(id: string, action: "approve" | "reject" | "restrict") {
    setProcessing(true);
    await apiRequest(token, `/super/operators/${id}/${action}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "기준 미달" }),
    }).catch(() => {});
    setProcessing(false);
    fetchOperators(filter, search, sort);
  }

  const filterCfg = FILTER_CHIPS.find(f => f.key === filter) ?? FILTER_CHIPS[0];

  const renderItem = ({ item }: { item: Operator }) => {
    const isSelected = selected.has(item.id);
    const approvalCfg = STATUS_CFG[item.approval_status] ?? STATUS_CFG.pending;
    const subCfg = SUB_CFG[item.subscription_status] ?? { label: item.subscription_status, color: "#6B7280" };
    const storagePct = item.usage_pct ?? 0;
    const storageAlert = storagePct >= 95;
    const storageWarn  = storagePct >= 80;

    return (
      <Pressable
        style={[s.row, isSelected && s.rowSelected, item.deletion_pending && s.rowDanger]}
        onPress={() => {
          if (multiSelect) { toggleSelect(item.id); return; }
          router.push(`/(super)/operator-detail?id=${item.id}` as any);
        }}
        onLongPress={() => { setMultiSelect(true); toggleSelect(item.id); }}>

        {/* 선택 체크 */}
        {multiSelect && (
          <View style={[s.checkbox, isSelected && s.checkboxChecked]}>
            {isSelected && <Feather name="check" size={12} color="#fff" />}
          </View>
        )}

        {/* 메인 정보 */}
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
            <View style={[s.statusBadge, { backgroundColor: approvalCfg.bg }]}>
              <Text style={[s.statusBadgeTxt, { color: approvalCfg.color }]}>{approvalCfg.label}</Text>
            </View>
            {item.deletion_pending && (
              <View style={[s.statusBadge, { backgroundColor: "#ECFEFF" }]}>
                <Text style={[s.statusBadgeTxt, { color: "#0891B2" }]}>삭제예정</Text>
              </View>
            )}
          </View>

          <View style={s.rowMeta}>
            <Text style={s.rowOwner} numberOfLines={1}>{item.owner_name}</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={[s.rowSub, { color: subCfg.color }]}>{subCfg.label}</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={s.rowMembers}>{item.active_member_count}명</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={[s.rowSub, { color: POOL_TYPE_CFG[item.pool_type]?.color ?? "#6B7280" }]}>
              {POOL_TYPE_CFG[item.pool_type]?.label ?? "수영장"}
            </Text>
          </View>

          {/* 저장 바 */}
          <View style={s.storageRow}>
            <View style={s.storageBarBg}>
              <View style={[
                s.storageBarFill,
                { width: `${Math.min(storagePct, 100)}%` as any,
                  backgroundColor: storageAlert ? "#DC2626" : storageWarn ? "#F59E0B" : "#10B981" }
              ]} />
            </View>
            <Text style={[s.storagePct, storageAlert && { color: "#DC2626" }]}>{storagePct}%</Text>
          </View>
        </View>

        {/* 빠른 액션 */}
        {!multiSelect && (
          <View style={s.rowActions}>
            <Pressable style={s.rowBtn}
              onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
              <Feather name="eye" size={14} color={P} />
            </Pressable>
            {item.approval_status === "pending" && (
              <Pressable style={s.rowBtn}
                onPress={() => quickAction(item.id, "approve")}
                disabled={processing}>
                <Feather name="check" size={14} color="#059669" />
              </Pressable>
            )}
            {item.approval_status === "approved" && (
              <Pressable style={s.rowBtn}
                onPress={() => quickAction(item.id, "restrict")}
                disabled={processing}>
                <Feather name="pause" size={14} color="#D97706" />
              </Pressable>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const currentFilterChip = FILTER_CHIPS.find(f => f.key === filter);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="운영자 관리" homePath="/(super)/dashboard" />

      {/* 검색 + 정렬 */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <Feather name="search" size={15} color="#9CA3AF" />
          <TextInput
            style={s.searchInput}
            value={search} onChangeText={setSearch}
            placeholder="이름 검색..." placeholderTextColor="#9CA3AF"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x-circle" size={15} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {SORT_OPTS.map(o => (
            <Pressable key={o.key}
              style={[s.sortChip, sort === o.key && s.sortChipActive]}
              onPress={() => setSort(o.key)}>
              <Text style={[s.sortChipTxt, sort === o.key && { color: "#fff" }]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* 필터 칩 — 상태 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.filterBar} contentContainerStyle={s.filterContent}>
        {FILTER_CHIPS.map(f => (
          <Pressable key={f.key}
            style={[s.filterChip, filter === f.key && { backgroundColor: f.color, borderColor: f.color }]}
            onPress={() => { setFilter(f.key); setSelected(new Set()); setMultiSelect(false); }}>
            <Text style={[s.filterTxt, filter === f.key && { color: "#fff" }]}>{f.label}</Text>
            {filter === f.key && operators.length > 0 && (
              <View style={s.filterCount}>
                <Text style={s.filterCountTxt}>{operators.length}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>

      {/* 필터 칩 — 운영 유형 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={[s.filterBar, { borderTopWidth: 0, paddingTop: 0 }]} contentContainerStyle={s.filterContent}>
        {TYPE_CHIPS.map(f => (
          <Pressable key={f.key}
            style={[s.filterChip, { borderStyle: "dashed" }, filter === f.key && { backgroundColor: f.color, borderColor: f.color, borderStyle: "solid" }]}
            onPress={() => { setFilter(filter === f.key ? "all" : f.key); setSelected(new Set()); setMultiSelect(false); }}>
            <Text style={[s.filterTxt, filter === f.key && { color: "#fff" }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 다중 선택 툴바 */}
      {multiSelect && (
        <View style={s.bulkBar}>
          <Pressable onPress={() => { setMultiSelect(false); setSelected(new Set()); }}>
            <Feather name="x" size={18} color="#374151" />
          </Pressable>
          <Text style={s.bulkBarTxt}>{selected.size}개 선택</Text>
          <Pressable style={s.bulkSelectAll}
            onPress={() => setSelected(new Set(operators.map(o => o.id)))}>
            <Text style={s.bulkSelectAllTxt}>전체 선택</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {BULK_ACTIONS.map(a => (
            <Pressable key={a.key}
              style={[s.bulkBtn, { backgroundColor: a.bg }, selected.size === 0 && { opacity: 0.4 }]}
              onPress={() => { if (selected.size > 0) setBulkModal(a.key); }}
              disabled={selected.size === 0}>
              <Text style={[s.bulkBtnTxt, { color: a.color }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 리스트 */}
      {loading ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={operators}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); fetchOperators(filter, search, sort); }} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="users" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>운영자가 없습니다</Text>
            </View>
          }
        />
      )}

      {/* 다중 선택 시작 버튼 (일반 상태) */}
      {!multiSelect && operators.length > 0 && (
        <Pressable style={s.fab} onPress={() => setMultiSelect(true)}>
          <Feather name="check-square" size={18} color="#fff" />
          <Text style={s.fabTxt}>다중 선택</Text>
        </Pressable>
      )}

      {/* 일괄 처리 확인 모달 */}
      {bulkModal && (
        <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={() => setBulkModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setBulkModal(null)}>
            <Pressable style={m.dialog} onPress={() => {}}>
              <Text style={m.title}>
                {BULK_ACTIONS.find(a => a.key === bulkModal)?.label} 확인
              </Text>
              <Text style={m.body}>
                선택한 {selected.size}개 운영자를 일괄{" "}
                <Text style={{ fontFamily: "Inter_700Bold" }}>
                  {BULK_ACTIONS.find(a => a.key === bulkModal)?.label}
                </Text>
                하시겠습니까?
              </Text>
              {(bulkModal === "reject" || bulkModal === "restrict") && (
                <TextInput
                  style={m.reasonInput}
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  placeholder="사유 (선택)"
                  placeholderTextColor="#9CA3AF"
                />
              )}
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setBulkModal(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.confirmBtn, { opacity: processing ? 0.6 : 1 }]}
                  onPress={() => executeBulk(bulkModal!)} disabled={processing}>
                  {processing
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.confirmTxt}>{BULK_ACTIONS.find(a => a.key === bulkModal)?.label}</Text>
                  }
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F5F3FF" },
  searchRow:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  searchBox:      { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
                    borderRadius: 10, borderWidth: 1.5, borderColor: "#E5E7EB", paddingHorizontal: 10, height: 40 },
  searchInput:    { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#111827" },
  sortChip:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginRight: 4,
                    backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB" },
  sortChipActive: { backgroundColor: P, borderColor: P },
  sortChipTxt:    { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280" },
  filterBar:      { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  filterContent:  { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: "row" },
  filterChip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7,
                    borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  filterTxt:      { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  filterCount:    { backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  filterCountTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },

  bulkBar:        { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10,
                    backgroundColor: "#1F1235", borderBottomWidth: 1, borderBottomColor: "#2D1B4E" },
  bulkBarTxt:     { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  bulkSelectAll:  { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  bulkSelectAllTxt:{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  bulkBtn:        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  bulkBtnTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  row:            { flexDirection: "row", alignItems: "center", gap: 10,
                    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowSelected:    { backgroundColor: "#F5F3FF" },
  rowDanger:      { borderLeftWidth: 3, borderLeftColor: "#0891B2" },
  checkbox:       { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB",
                    alignItems: "center", justifyContent: "center" },
  checkboxChecked:{ backgroundColor: P, borderColor: P },
  rowMain:        { flex: 1, gap: 4 },
  rowTop:         { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName:        { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  statusBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta:        { flexDirection: "row", alignItems: "center", gap: 4 },
  rowOwner:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  rowDot:         { fontSize: 10, color: "#D1D5DB" },
  rowSub:         { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  rowMembers:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  storageRow:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  storageBarBg:   { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#F3F4F6", overflow: "hidden" },
  storageBarFill: { height: 4, borderRadius: 2 },
  storagePct:     { fontSize: 10, fontFamily: "Inter_500Medium", color: "#9CA3AF", width: 30, textAlign: "right" },
  rowActions:     { flexDirection: "row", gap: 4 },
  rowBtn:         { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F3F4F6",
                    alignItems: "center", justifyContent: "center" },
  empty:          { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:       { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  fab:            { position: "absolute", bottom: 20, right: 16, flexDirection: "row", alignItems: "center",
                    gap: 6, backgroundColor: P, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
                    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },
  fabTxt:         { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const m = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  dialog:      { backgroundColor: "#fff", borderRadius: 20, padding: 24, width: "85%", gap: 16 },
  title:       { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  body:        { fontSize: 14, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 22 },
  reasonInput: { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                 fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  btnRow:      { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:   { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  confirmBtn:  { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  confirmTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
