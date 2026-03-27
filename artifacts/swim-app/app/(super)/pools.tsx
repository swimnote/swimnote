/**
 * (super)/pools.tsx — 운영자 관리 (대규모 운영 콘솔)
 * 14개 실데이터 · 13개 필터칩 · 다중선택 · 일괄처리
 */
import { Check, Inbox, Search, SquareCheck, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { API_BASE } from "@/context/auth/SessionContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore, type OperatorFilter } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { Operator } from "@/domain/types";
import { formatDateSafe, calcPercent } from "@/domain/formatters";

const P = "#7C3AED";

const FILTER_CHIPS: { key: OperatorFilter; label: string; color: string; bg: string }[] = [
  { key: "all",              label: "전체",         color: "#0F172A", bg: "#FFFFFF" },
  { key: "pending",          label: "승인 대기",     color: "#D97706", bg: "#FFF1BF" },
  { key: "payment_failed",   label: "결제 실패",     color: "#D96C6C", bg: "#F9DEDA" },
  { key: "storage95",        label: "저장 95%↑",    color: P,         bg: "#EEDDF5" },
  { key: "deletion_pending", label: "삭제 예정",     color: "#2EC4B6", bg: "#ECFEFF" },
  { key: "credit",           label: "크레딧 보유",   color: "#2EC4B6", bg: "#E6FFFA" },
  { key: "new_this_week",    label: "이번 주 신규", color: "#64748B", bg: "#FFFFFF" },
  { key: "free_over10",      label: "무료 체험",     color: "#64748B", bg: "#FFFFFF" },
  { key: "policy_unsigned",  label: "정책 미확인",   color: "#2EC4B6", bg: "#E6FFFA" },
  { key: "upload_spike",     label: "업로드 급증",   color: "#D97706", bg: "#FFF1BF" },
  { key: "refund_repeat",    label: "반복 환불",     color: "#D96C6C", bg: "#F9DEDA" },
  { key: "solo_coach",       label: "🧑‍🏫 1인 코치",  color: "#2EC4B6", bg: "#E6FFFA" },
  { key: "franchise",        label: "🏢 프랜차이즈", color: P,         bg: "#EEDDF5" },
  { key: "readonly",         label: "읽기전용",      color: "#7C3AED", bg: "#EEDDF5" },
];

const SORT_OPTS = [
  { key: "createdAt",    label: "최신순" },
  { key: "name",         label: "이름순" },
  { key: "activeMemberCount", label: "회원 수↓" },
  { key: "storageUsedMb",   label: "저장 사용↓" },
  { key: "lastLoginAt",  label: "최근 활동순" },
];

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "대기",   color: "#D97706", bg: "#FFF1BF" },
  active:     { label: "운영",   color: "#2EC4B6", bg: "#E6FFFA" },
  rejected:   { label: "반려",   color: "#D96C6C", bg: "#F9DEDA" },
  cancelled:  { label: "해지",   color: "#64748B", bg: "#FFFFFF" },
  readonly:   { label: "읽기전용", color: "#7C3AED", bg: "#EEDDF5" },
  restricted: { label: "제한",   color: "#D96C6C", bg: "#F9DEDA" },
};

const BILLING_CFG: Record<string, { label: string; color: string }> = {
  active:                { label: "정상",  color: "#2EC4B6" },
  payment_failed:        { label: "실패",  color: "#D96C6C" },
  grace:                 { label: "유예",  color: "#D97706" },
  cancelled:             { label: "해지",  color: "#64748B" },
  auto_delete_scheduled: { label: "삭제예정", color: "#2EC4B6" },
  readonly:              { label: "읽기전용", color: "#7C3AED" },
  free:                  { label: "무료",  color: "#2EC4B6" },
};

const TYPE_CFG: Record<string, { label: string; color: string }> = {
  swimming_pool: { label: "수영장",    color: "#2EC4B6" },
  solo_coach:    { label: "1인 코치",  color: "#2EC4B6" },
  rental_team:   { label: "대관팀",    color: "#D97706" },
  franchise:     { label: "프랜차이즈", color: P },
};

const BULK_ACTIONS = [
  { key: "approve",         label: "승인",       color: "#2EC4B6", bg: "#E6FFFA" },
  { key: "reject",          label: "반려",       color: "#D96C6C", bg: "#F9DEDA" },
  { key: "readonly_on",     label: "읽기전용",   color: "#7C3AED", bg: "#EEDDF5" },
  { key: "block_upload",    label: "업로드 차단", color: "#D97706", bg: "#FFF1BF" },
  { key: "policy_reminder", label: "정책 재알림", color: "#2EC4B6", bg: "#E6FFFA" },
  { key: "terminate",       label: "종료",       color: "#7F1D1D", bg: "#F9DEDA" },
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
  const loading         = useOperatorsStore(s => s.loading);
  const setStoreFilter  = useOperatorsStore(s => s.setFilter);
  const setStoreSearch  = useOperatorsStore(s => s.setSearch);
  const getFiltered     = useOperatorsStore(s => s.getFiltered);
  const approveOp       = useOperatorsStore(s => s.approveOperator);
  const rejectOp        = useOperatorsStore(s => s.rejectOperator);
  const setReadonly     = useOperatorsStore(s => s.setOperatorReadonly);
  const blockUpload     = useOperatorsStore(s => s.setOperatorUploadBlocked);
  const fetchOperators  = useOperatorsStore(s => s.fetchOperators);
  const createLog       = useAuditLogStore(s => s.createLog);

  const { token } = useAuth();

  // API에서 실데이터 로드
  const loadOperators = useCallback(async () => {
    if (!token) return;
    await fetchOperators(token, API_BASE);
  }, [token, fetchOperators]);

  useEffect(() => { loadOperators(); }, [loadOperators]);

  // sync local filter to store
  useEffect(() => {
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
    const bCfg   = BILLING_CFG[item.billingStatus] ?? { label: item.billingStatus, color: "#64748B" };
    const tCfg   = TYPE_CFG[item.type] ?? { label: "수영장", color: "#2EC4B6" };
    const pct    = Math.round((item.storageUsedMb / Math.max(item.storageTotalMb, 1)) * 100);
    const pctStr = `${pct}%`;
    const isDanger  = item.storageBlocked95;
    const isWarn    = item.storageWarning80 && !isDanger;
    const barColor  = isDanger ? "#D96C6C" : isWarn ? "#E4A93A" : "#2E9B6F";
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
            {isSelected && <Check size={12} color="#fff" />}
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
                <Text style={[s.badgeTxt, { color: "#2EC4B6" }]}>삭제예정</Text>
              </View>
            )}
            {item.uploadSpikeFlag && (
              <View style={[s.badge, { backgroundColor: "#FFF1BF" }]}>
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
            <Text style={[s.storagePct, { color: isDanger ? "#D96C6C" : "#64748B" }]}>{pctStr}</Text>
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
                <Pressable style={[s.actBtn, { backgroundColor: "#E6FFFA" }]} onPress={() => quickAction(item, "approve")}>
                  <Text style={[s.actTxt, { color: "#2EC4B6" }]}>승인</Text>
                </Pressable>
                <Pressable style={[s.actBtn, { backgroundColor: "#F9DEDA" }]} onPress={() => quickAction(item, "reject")}>
                  <Text style={[s.actTxt, { color: "#D96C6C" }]}>반려</Text>
                </Pressable>
              </>
            )}
            {!isPending && (
              <Pressable style={[s.actBtn, { backgroundColor: "#FFFFFF" }]}
                onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
                <Text style={[s.actTxt, { color: "#0F172A" }]}>상세</Text>
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
              <Pressable style={[s.sheetBtn, { backgroundColor: "#FFFFFF" }]} onPress={() => setBulkModal(null)}>
                <Text style={{ color: "#0F172A", fontFamily: "Pretendard-SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable style={[s.sheetBtn, { backgroundColor: BULK_ACTIONS.find(a => a.key === bulkModal)?.bg ?? "#FFFFFF" }]}
                disabled={processing} onPress={() => executeBulk(bulkModal!)}>
                <Text style={{ color: BULK_ACTIONS.find(a => a.key === bulkModal)?.color ?? "#0F172A", fontFamily: "Pretendard-SemiBold" }}>
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
          <Search size={14} color="#64748B" />
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch}
            placeholder="운영자명, 코드, 담당자 검색" placeholderTextColor="#64748B" />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <X size={14} color="#64748B" />
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

      {/* 필터 칩 — 전체 표시 (wrap) */}
      <View style={s.chipsWrap}>
        {FILTER_CHIPS.map(chip => (
          <Pressable key={chip.key} style={[s.chip, filter === chip.key && { backgroundColor: chip.bg }]}
            onPress={() => setFilter(chip.key)}>
            <Text style={[s.chipTxt, filter === chip.key && { color: chip.color }]}>{chip.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* 헤더: 카운트 + 다중선택 토글 */}
      <View style={s.listHeader}>
        <Text style={s.listCount}>
          <Text style={{ color: filterChip.color, fontFamily: "Pretendard-Bold" }}>{sorted.length}</Text>
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
            <SquareCheck size={14} color={multiSelect ? P : "#64748B"} />
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
          onRefresh={async () => { setRefreshing(true); await loadOperators(); setRefreshing(false); }} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={s.empty}>
            <Inbox size={40} color="#D1D5DB" />
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
  sheetTitle:        { fontFamily: "Pretendard-Bold", fontSize: 16, color: "#0F172A" },
  sheetInput:        { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, color: "#0F172A", fontFamily: "Pretendard-Regular", minHeight: 60 },
  sheetBtns:         { flexDirection: "row", gap: 10 },
  sheetBtn:          { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  searchRow:         { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  searchBox:         { flexDirection: "row", alignItems: "center", backgroundColor: "#F1F5F9", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  searchInput:       { flex: 1, fontFamily: "Pretendard-Regular", fontSize: 14, color: "#0F172A" },
  sortChip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "#FFFFFF", marginRight: 6 },
  sortChipActive:    { backgroundColor: "#EEDDF5" },
  sortChipTxt:       { fontFamily: "Pretendard-Regular", fontSize: 12, color: "#64748B" },
  sortChipTxtActive: { color: P, fontFamily: "Pretendard-SemiBold" },
  chipsWrap:         { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, paddingVertical: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  chip:              { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: "#FFFFFF" },
  chipTxt:           { fontFamily: "Pretendard-Medium", fontSize: 12, color: "#64748B" },
  listHeader:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  listCount:         { fontFamily: "Pretendard-Regular", fontSize: 13, color: "#0F172A" },
  listHeaderRight:   { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkBtn:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 4 },
  bulkTxt:           { fontFamily: "Pretendard-SemiBold", fontSize: 11 },
  multiBtn:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#FFFFFF" },
  multiBtnActive:    { backgroundColor: "#EEDDF5" },
  multiBtnTxt:       { fontFamily: "Pretendard-Medium", fontSize: 12, color: "#64748B" },
  row:               { backgroundColor: "#fff", marginHorizontal: 16, marginVertical: 4, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: "#FFFFFF" },
  rowSelected:       { borderColor: P, backgroundColor: "#EEDDF5" },
  rowDanger:         { borderColor: "#BAE6FD" },
  rowStorageDanger:  { borderColor: "#FCA5A5" },
  checkbox:          { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 2 },
  checkboxChecked:   { backgroundColor: P, borderColor: P },
  rowMain:           { flex: 1, gap: 4 },
  rowTop:            { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowName:           { fontFamily: "Pretendard-Bold", fontSize: 15, color: "#0F172A", flex: 1 },
  badge:             { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeTxt:          { fontFamily: "Pretendard-SemiBold", fontSize: 10 },
  rowMeta:           { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  rowOwner:          { fontFamily: "Pretendard-Regular", fontSize: 12, color: "#64748B" },
  rowDot:            { color: "#D1D5DB", fontSize: 10 },
  metaTag:           { fontFamily: "Pretendard-Regular", fontSize: 12, color: "#0F172A" },
  storageRow:        { flexDirection: "row", alignItems: "center", gap: 6 },
  storageBarBg:      { flex: 1, height: 4, backgroundColor: "#FFFFFF", borderRadius: 2, overflow: "hidden" },
  storageBarFill:    { height: 4, borderRadius: 2 },
  storagePct:        { fontFamily: "Pretendard-SemiBold", fontSize: 11, minWidth: 34, textAlign: "right" },
  rowBottom:         { flexDirection: "row", alignItems: "center", gap: 4 },
  billingBadge:      { fontFamily: "Pretendard-SemiBold", fontSize: 11 },
  loginDate:         { fontFamily: "Pretendard-Regular", fontSize: 11, color: "#64748B" },
  actions:           { flexDirection: "column", gap: 4, marginLeft: 8 },
  actBtn:            { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  actTxt:            { fontFamily: "Pretendard-SemiBold", fontSize: 11 },
  empty:             { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTxt:          { fontFamily: "Pretendard-Regular", fontSize: 14, color: "#64748B" },
});
