/**
 * (super)/pools.tsx — 운영자 관리 (대규모 운영 콘솔)
 * 14개 실데이터 · 13개 필터칩 · 다중선택 · 일괄처리
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore, type OperatorFilter } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { Operator } from "@/domain/types";
import { formatDateSafe, calcPercent } from "@/domain/formatters";

const P = "#7C3AED";

const FILTER_CHIPS: { key: OperatorFilter; label: string; color: string; bg: string }[] = [
  { key: "all",              label: "전체",         color: "#374151", bg: "#F3F4F6" },
  { key: "pending",          label: "승인 대기",     color: "#D97706", bg: "#FEF3C7" },
  { key: "payment_failed",   label: "결제 실패",     color: "#DC2626", bg: "#FEE2E2" },
  { key: "storage95",        label: "저장 95%↑",    color: P,         bg: "#EDE9FE" },
  { key: "deletion_pending", label: "삭제 예정",     color: "#0891B2", bg: "#ECFEFF" },
  { key: "credit",           label: "크레딧 보유",   color: "#059669", bg: "#D1FAE5" },
  { key: "new_this_week",    label: "이번 주 신규", color: "#6B7280", bg: "#F3F4F6" },
  { key: "free_over10",      label: "무료 체험",     color: "#6B7280", bg: "#F3F4F6" },
  { key: "policy_unsigned",  label: "정책 미확인",   color: "#4F46E5", bg: "#EEF2FF" },
  { key: "upload_spike",     label: "업로드 급증",   color: "#D97706", bg: "#FEF3C7" },
  { key: "refund_repeat",    label: "반복 환불",     color: "#DC2626", bg: "#FEE2E2" },
  { key: "solo_coach",       label: "🧑‍🏫 1인 코치",  color: "#059669", bg: "#D1FAE5" },
  { key: "franchise",        label: "🏢 프랜차이즈", color: P,         bg: "#EDE9FE" },
  { key: "readonly",         label: "읽기전용",      color: "#7C3AED", bg: "#EDE9FE" },
];

const SORT_OPTS = [
  { key: "createdAt",    label: "최신순" },
  { key: "name",         label: "이름순" },
  { key: "activeMemberCount", label: "회원 수↓" },
  { key: "storageUsedMb",   label: "저장 사용↓" },
  { key: "lastLoginAt",  label: "최근 활동순" },
];

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "대기",   color: "#D97706", bg: "#FEF3C7" },
  active:     { label: "운영",   color: "#059669", bg: "#D1FAE5" },
  rejected:   { label: "반려",   color: "#DC2626", bg: "#FEE2E2" },
  cancelled:  { label: "해지",   color: "#6B7280", bg: "#F3F4F6" },
  readonly:   { label: "읽기전용", color: "#7C3AED", bg: "#EDE9FE" },
  restricted: { label: "제한",   color: "#DC2626", bg: "#FEE2E2" },
};

const BILLING_CFG: Record<string, { label: string; color: string }> = {
  active:                { label: "정상",  color: "#059669" },
  payment_failed:        { label: "실패",  color: "#DC2626" },
  grace:                 { label: "유예",  color: "#D97706" },
  cancelled:             { label: "해지",  color: "#6B7280" },
  auto_delete_scheduled: { label: "삭제예정", color: "#0891B2" },
  readonly:              { label: "읽기전용", color: "#7C3AED" },
  free:                  { label: "무료",  color: "#4F46E5" },
};

const TYPE_CFG: Record<string, { label: string; color: string }> = {
  swimming_pool: { label: "수영장",    color: "#0891B2" },
  solo_coach:    { label: "1인 코치",  color: "#059669" },
  rental_team:   { label: "대관팀",    color: "#D97706" },
  franchise:     { label: "프랜차이즈", color: P },
};

const BULK_ACTIONS = [
  { key: "approve",         label: "승인",       color: "#059669", bg: "#D1FAE5" },
  { key: "reject",          label: "반려",       color: "#DC2626", bg: "#FEE2E2" },
  { key: "readonly_on",     label: "읽기전용",   color: "#7C3AED", bg: "#EDE9FE" },
  { key: "block_upload",    label: "업로드 차단", color: "#D97706", bg: "#FEF3C7" },
  { key: "policy_reminder", label: "정책 재알림", color: "#4F46E5", bg: "#EEF2FF" },
  { key: "terminate",       label: "종료",       color: "#7F1D1D", bg: "#FEE2E2" },
];

export default function SuperPoolsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';
  const { filter: initFilter } = useLocalSearchParams<{ filter?: string }>();

  const [filter, setFilter] = useState<OperatorFilter>((initFilter as OperatorFilter) || "all");
  const [search, setSearch] = useState("");
  const [sort,   setSort]   = useState("createdAt");
  const [refreshing, setRefreshing] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const storeFilter     = useOperatorsStore(s => s.filter);
  const storeSearch     = useOperatorsStore(s => s.search);
  const operators       = useOperatorsStore(s => s.operators);
  const setStoreFilter  = useOperatorsStore(s => s.setFilter);
  const setStoreSearch  = useOperatorsStore(s => s.setSearch);
  const getFiltered     = useOperatorsStore(s => s.getFiltered);
  const approveOp       = useOperatorsStore(s => s.approveOperator);
  const rejectOp        = useOperatorsStore(s => s.rejectOperator);
  const setReadonly     = useOperatorsStore(s => s.setOperatorReadonly);
  const blockUpload     = useOperatorsStore(s => s.setOperatorUploadBlocked);
  const createLog       = useAuditLogStore(s => s.createLog);

  // sync local filter to store
  React.useEffect(() => {
    setStoreFilter(filter);
    setStoreSearch(search);
  }, [filter, search]);

  const allFiltered = useMemo(() => getFiltered(), [storeFilter, storeSearch, operators]);

  // local sort
  const sorted = useMemo(() => {
    const list = [...allFiltered];
    switch (sort) {
      case 'name':              list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'activeMemberCount': list.sort((a, b) => b.activeMemberCount - a.activeMemberCount); break;
      case 'storageUsedMb':     list.sort((a, b) => b.storageUsedMb - a.storageUsedMb); break;
      case 'lastLoginAt':       list.sort((a, b) => new Date(b.lastLoginAt ?? 0).getTime() - new Date(a.lastLoginAt ?? 0).getTime()); break;
      default:                  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); break;
    }
    return list;
  }, [allFiltered, sort]);

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function executeBulk(action: string) {
    if (selected.size === 0) return;
    if (action === "terminate") {
      setBulkModal(null); setMultiSelect(false);
      router.push("/(super)/kill-switch" as any); return;
    }
    setProcessing(true);
    const ids = Array.from(selected);
    try {
      ids.forEach(id => {
        const op = sorted.find(o => o.id === id);
        if (!op) return;
        if (action === "approve") {
          approveOp(id, actorName);
          createLog({ category: '운영자관리', title: `${op.name} 승인`, operatorId: id, operatorName: op.name, actorName, impact: 'medium', detail: '일괄 승인' });
        } else if (action === "reject") {
          rejectOp(id, rejectReason || '기준 미달', actorName);
          createLog({ category: '운영자관리', title: `${op.name} 반려`, operatorId: id, operatorName: op.name, actorName, impact: 'medium', detail: rejectReason || '기준 미달' });
        } else if (action === "readonly_on") {
          setReadonly(id, '관리자 설정', actorName);
          createLog({ category: '읽기전용 전환', title: `${op.name} 읽기전용 전환`, operatorId: id, operatorName: op.name, actorName, impact: 'high', detail: '일괄 읽기전용' });
        } else if (action === "block_upload") {
          blockUpload(id, true);
          createLog({ category: '저장공간', title: `${op.name} 업로드 차단`, operatorId: id, operatorName: op.name, actorName, impact: 'high', detail: '업로드 차단' });
        } else if (action === "policy_reminder") {
          createLog({ category: '정책', title: `${op.name} 정책 재알림`, operatorId: id, operatorName: op.name, actorName, impact: 'low', detail: '정책 확인 알림 발송' });
        }
      });
      setBulkModal(null); setSelected(new Set()); setMultiSelect(false); setRejectReason("");
    } finally { setProcessing(false); }
  }

  function quickAction(op: Operator, action: "approve" | "reject" | "restrict") {
    if (action === "approve") {
      approveOp(op.id, actorName);
      createLog({ category: '운영자관리', title: `${op.name} 승인`, operatorId: op.id, operatorName: op.name, actorName, impact: 'medium', detail: '단건 승인' });
    } else if (action === "reject") {
      rejectOp(op.id, '기준 미달', actorName);
      createLog({ category: '운영자관리', title: `${op.name} 반려`, operatorId: op.id, operatorName: op.name, actorName, impact: 'medium', detail: '기준 미달 반려' });
    } else if (action === "restrict") {
      setReadonly(op.id, '제한', actorName);
      createLog({ category: '운영자관리', title: `${op.name} 읽기전용`, operatorId: op.id, operatorName: op.name, actorName, impact: 'high', detail: '운영자 제한' });
    }
  }

  const renderItem = ({ item }: { item: Operator }) => {
    const isSelected = selected.has(item.id);
    const sCfg   = STATUS_CFG[item.status] ?? STATUS_CFG.pending;
    const bCfg   = BILLING_CFG[item.billingStatus] ?? { label: item.billingStatus, color: "#6B7280" };
    const tCfg   = TYPE_CFG[item.type] ?? { label: "수영장", color: "#0891B2" };
    const pct    = Math.round((item.storageUsedMb / Math.max(item.storageTotalMb, 1)) * 100);
    const pctStr = `${pct}%`;
    const isDanger  = item.storageBlocked95;
    const isWarn    = item.storageWarning80 && !isDanger;
    const barColor  = isDanger ? "#DC2626" : isWarn ? "#F59E0B" : "#10B981";
    const loginStr  = item.lastLoginAt ? formatDateSafe(item.lastLoginAt) : "—";
    const isPending = item.status === 'pending';
    const isDeletion = !!item.autoDeleteScheduledAt;

    return (
      <Pressable
        style={[s.row, isSelected && s.rowSelected, isDeletion && s.rowDanger, isDanger && s.rowStorageDanger]}
        onPress={() => {
          if (multiSelect) { toggleSelect(item.id); return; }
          router.push(`/(super)/operator-detail?id=${item.id}` as any);
        }}
        onLongPress={() => { setMultiSelect(true); toggleSelect(item.id); }}>

        {/* 체크박스 */}
        {multiSelect && (
          <View style={[s.checkbox, isSelected && s.checkboxChecked]}>
            {isSelected && <Feather name="check" size={12} color="#fff" />}
          </View>
        )}

        {/* 메인 정보 */}
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
            <View style={[s.badge, { backgroundColor: sCfg.bg }]}>
              <Text style={[s.badgeTxt, { color: sCfg.color }]}>{sCfg.label}</Text>
            </View>
            {isDeletion && (
              <View style={[s.badge, { backgroundColor: "#ECFEFF" }]}>
                <Text style={[s.badgeTxt, { color: "#0891B2" }]}>삭제예정</Text>
              </View>
            )}
            {item.uploadSpikeFlag && (
              <View style={[s.badge, { backgroundColor: "#FEF3C7" }]}>
                <Text style={[s.badgeTxt, { color: "#D97706" }]}>업로드급증</Text>
              </View>
            )}
          </View>

          <View style={s.rowMeta}>
            <Text style={s.rowOwner} numberOfLines={1}>{item.representativeName}</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={[s.metaTag, { color: tCfg.color }]}>{tCfg.label}</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={s.metaTag}>{item.activeMemberCount}명</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={s.metaTag} numberOfLines={1}>{item.currentPlanName}</Text>
          </View>

          {/* 저장 바 */}
          <View style={s.storageRow}>
            <View style={s.storageBarBg}>
              <View style={[s.storageBarFill,
                { width: `${Math.min(pct, 100)}%` as any, backgroundColor: barColor }]} />
            </View>
            <Text style={[s.storagePct, { color: isDanger ? "#DC2626" : "#6B7280" }]}>{pctStr}</Text>
          </View>

          <View style={s.rowBottom}>
            <Text style={[s.billingBadge, { color: bCfg.color }]}>{bCfg.label}</Text>
            <Text style={s.rowDot}>·</Text>
            <Text style={s.loginDate}>{loginStr}</Text>
          </View>
        </View>

        {/* 빠른 액션 */}
        {!multiSelect && (
          <View style={s.actions}>
            {isPending && (
              <>
                <Pressable style={[s.actBtn, { backgroundColor: "#D1FAE5" }]} onPress={() => quickAction(item, "approve")}>
                  <Text style={[s.actTxt, { color: "#059669" }]}>승인</Text>
                </Pressable>
                <Pressable style={[s.actBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => quickAction(item, "reject")}>
                  <Text style={[s.actTxt, { color: "#DC2626" }]}>반려</Text>
                </Pressable>
              </>
            )}
            {!isPending && (
              <Pressable style={[s.actBtn, { backgroundColor: "#F3F4F6" }]}
                onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
                <Text style={[s.actTxt, { color: "#374151" }]}>상세</Text>
              </Pressable>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const filterChip = FILTER_CHIPS.find(f => f.key === filter) ?? FILTER_CHIPS[0];

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 일괄처리 모달 */}
      <Modal visible={!!bulkModal} transparent animationType="fade" onRequestClose={() => setBulkModal(null)}>
        <Pressable style={s.overlay} onPress={() => setBulkModal(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>{BULK_ACTIONS.find(a => a.key === bulkModal)?.label} ({selected.size}건)</Text>
            {bulkModal === "reject" && (
              <TextInput style={s.sheetInput} value={rejectReason} onChangeText={setRejectReason}
                placeholder="반려 사유" multiline numberOfLines={2} />
            )}
            <View style={s.sheetBtns}>
              <Pressable style={[s.sheetBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => setBulkModal(null)}>
                <Text style={{ color: "#374151", fontFamily: "Inter_600SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable style={[s.sheetBtn, { backgroundColor: BULK_ACTIONS.find(a => a.key === bulkModal)?.bg ?? "#F3F4F6" }]}
                disabled={processing} onPress={() => executeBulk(bulkModal!)}>
                <Text style={{ color: BULK_ACTIONS.find(a => a.key === bulkModal)?.color ?? "#374151", fontFamily: "Inter_600SemiBold" }}>
                  확인
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <SubScreenHeader title="운영자 관리" />

      {/* 검색 + 정렬 */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <Feather name="search" size={14} color="#9CA3AF" />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch}
            placeholder="운영자명, 코드, 담당자 검색" placeholderTextColor="#9CA3AF" />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={14} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {SORT_OPTS.map(o => (
            <Pressable key={o.key} style={[s.sortChip, sort === o.key && s.sortChipActive]}
              onPress={() => setSort(o.key)}>
              <Text style={[s.sortChipTxt, sort === o.key && s.sortChipTxtActive]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* 필터 칩 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipsScroll}
        contentContainerStyle={s.chipsContent}>
        {FILTER_CHIPS.map(chip => (
          <Pressable key={chip.key} style={[s.chip, filter === chip.key && { backgroundColor: chip.bg }]}
            onPress={() => setFilter(chip.key)}>
            <Text style={[s.chipTxt, filter === chip.key && { color: chip.color }]}>{chip.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 헤더: 카운트 + 다중선택 토글 */}
      <View style={s.listHeader}>
        <Text style={s.listCount}>
          <Text style={{ color: filterChip.color, fontFamily: "Inter_700Bold" }}>{sorted.length}</Text>
          <Text>/{useOperatorsStore.getState().operators.length}개</Text>
          {multiSelect && <Text style={{ color: P }}> · {selected.size}개 선택됨</Text>}
        </Text>
        <View style={s.listHeaderRight}>
          {multiSelect && selected.size > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {BULK_ACTIONS.map(a => (
                <Pressable key={a.key} style={[s.bulkBtn, { backgroundColor: a.bg }]}
                  onPress={() => setBulkModal(a.key)}>
                  <Text style={[s.bulkTxt, { color: a.color }]}>{a.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable style={[s.multiBtn, multiSelect && s.multiBtnActive]}
            onPress={() => { setMultiSelect(!multiSelect); setSelected(new Set()); }}>
            <Feather name="check-square" size={14} color={multiSelect ? P : "#6B7280"} />
            <Text style={[s.multiBtnTxt, multiSelect && { color: P }]}>
              {multiSelect ? "완료" : "다중선택"}
            </Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="inbox" size={40} color="#D1D5DB" />
            <Text style={s.emptyTxt}>해당 조건의 운영자가 없습니다</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: "#fff" },
  overlay:           { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  sheet:             { backgroundColor: "#fff", borderRadius: 16, padding: 20, width: "85%", gap: 12 },
  sheetTitle:        { fontFamily: "Inter_700Bold", fontSize: 16, color: "#111827" },
  sheetInput:        { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, color: "#111827", fontFamily: "Inter_400Regular", minHeight: 60 },
  sheetBtns:         { flexDirection: "row", gap: 10 },
  sheetBtn:          { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  searchRow:         { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  searchBox:         { flexDirection: "row", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  searchInput:       { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: "#111827" },
  sortChip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "#F3F4F6", marginRight: 6 },
  sortChipActive:    { backgroundColor: "#EDE9FE" },
  sortChipTxt:       { fontFamily: "Inter_400Regular", fontSize: 12, color: "#6B7280" },
  sortChipTxtActive: { color: P, fontFamily: "Inter_600SemiBold" },
  chipsScroll:       { maxHeight: 40 },
  chipsContent:      { paddingHorizontal: 16, gap: 6 },
  chip:              { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: "#F3F4F6", marginRight: 6 },
  chipTxt:           { fontFamily: "Inter_500Medium", fontSize: 12, color: "#6B7280" },
  listHeader:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  listCount:         { fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151" },
  listHeaderRight:   { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkBtn:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 4 },
  bulkTxt:           { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  multiBtn:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#F3F4F6" },
  multiBtnActive:    { backgroundColor: "#EDE9FE" },
  multiBtnTxt:       { fontFamily: "Inter_500Medium", fontSize: 12, color: "#6B7280" },
  row:               { backgroundColor: "#fff", marginHorizontal: 16, marginVertical: 4, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: "#F3F4F6" },
  rowSelected:       { borderColor: P, backgroundColor: "#F5F3FF" },
  rowDanger:         { borderColor: "#BAE6FD" },
  rowStorageDanger:  { borderColor: "#FCA5A5" },
  checkbox:          { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 2 },
  checkboxChecked:   { backgroundColor: P, borderColor: P },
  rowMain:           { flex: 1, gap: 4 },
  rowTop:            { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowName:           { fontFamily: "Inter_700Bold", fontSize: 15, color: "#111827", flex: 1 },
  badge:             { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeTxt:          { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  rowMeta:           { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  rowOwner:          { fontFamily: "Inter_400Regular", fontSize: 12, color: "#6B7280" },
  rowDot:            { color: "#D1D5DB", fontSize: 10 },
  metaTag:           { fontFamily: "Inter_400Regular", fontSize: 12, color: "#374151" },
  storageRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  storageBarBg:      { flex: 1, height: 4, backgroundColor: "#F3F4F6", borderRadius: 2, overflow: "hidden" },
  storageBarFill:    { height: 4, borderRadius: 2 },
  storagePct:        { fontFamily: "Inter_600SemiBold", fontSize: 11, minWidth: 34, textAlign: "right" },
  rowBottom:         { flexDirection: "row", alignItems: "center", gap: 4 },
  billingBadge:      { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  loginDate:         { fontFamily: "Inter_400Regular", fontSize: 11, color: "#9CA3AF" },
  actions:           { flexDirection: "column", gap: 4, marginLeft: 8 },
  actBtn:            { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  actTxt:            { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  empty:             { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTxt:          { fontFamily: "Inter_400Regular", fontSize: 14, color: "#9CA3AF" },
});
