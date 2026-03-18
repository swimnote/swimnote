import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { ScreenLayout }  from "@/components/common/ScreenLayout";
import { ConfirmModal }  from "@/components/common/ConfirmModal";
import { FilterChips, FilterChipItem } from "@/components/common/FilterChips";
import { EmptyState }    from "@/components/common/EmptyState";

const C = Colors.light;
const PURPLE = "#7C3AED";

interface SubscriptionTier { tier: string; label: string; isFree: boolean; }
interface Pool {
  id: string; name: string; name_en: string | null; address: string;
  phone: string; owner_name: string; owner_email: string;
  business_reg_number: string | null;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null; subscription_status: string;
  member_count: number; subscription_tier: SubscriptionTier; created_at: string;
  business_license_status?: string; bank_account_verification_status?: string;
}

const TIER_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  unapproved:      { color: "#D97706", bg: "#FEF3C7", border: "#F59E0B" },
  free:            { color: "#059669", bg: "#D1FAE5", border: "#10B981" },
  paid_100:        { color: "#1A5CFF", bg: "#EEF3FF", border: "#3B82F6" },
  paid_300:        { color: "#1A5CFF", bg: "#EEF3FF", border: "#3B82F6" },
  paid_500:        { color: PURPLE,    bg: "#F3E8FF", border: PURPLE     },
  paid_1000:       { color: PURPLE,    bg: "#F3E8FF", border: PURPLE     },
  paid_enterprise: { color: "#DC2626", bg: "#FEE2E2", border: "#EF4444" },
};

type FilterKey = "all" | "pending" | "free" | "paid" | "rejected";
type SortMode  = "ko" | "en";

function tierStyleOf(pool: Pool) {
  if (pool.approval_status === "rejected") return { color: "#DC2626", bg: "#FEE2E2", border: "#EF4444" };
  return TIER_STYLE[pool.subscription_tier?.tier] || TIER_STYLE.free;
}
function tierLabelOf(pool: Pool) {
  if (pool.approval_status === "rejected") return "반려됨";
  if (pool.approval_status === "pending")  return "미승인";
  return pool.subscription_tier?.label || "무료 이용";
}
function matchesFilter(pool: Pool, filterKey: string): boolean {
  if (filterKey === "all")      return true;
  if (filterKey === "pending")  return pool.approval_status === "pending";
  if (filterKey === "rejected") return pool.approval_status === "rejected";
  if (filterKey === "free")     return pool.approval_status === "approved" && pool.subscription_tier?.isFree;
  if (filterKey === "paid")     return pool.approval_status === "approved" && !pool.subscription_tier?.isFree;
  return true;
}

function DocStatus({ label, status }: { label: string; status?: string }) {
  const isOK = status === "uploaded" || status === "verified";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: isOK ? "#D1FAE5" : "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
        <Feather name={isOK ? "check" : "alert-circle"} size={11} color={isOK ? "#059669" : "#DC2626"} />
      </View>
      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: isOK ? "#059669" : "#DC2626" }}>
        {label}: {status || "미제출"}
      </Text>
    </View>
  );
}

function InfoRow({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  return (
    <View style={s.infoRow}>
      <Feather name={icon} size={12} color={C.textMuted} />
      <Text style={[s.infoText, { color: C.textSecondary }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

export default function SuperPoolsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [pools,      setPools]      = useState<Pool[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [filter,     setFilter]     = useState<FilterKey>("all");
  const [sort,       setSort]       = useState<SortMode>("ko");
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectPool, setRejectPool] = useState<Pool | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailPool, setDetailPool] = useState<Pool | null>(null);
  const [approveTarget, setApproveTarget] = useState<Pool | null>(null);

  const fetchPools = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/pools");
      if (res.ok) setPools(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchPools(); }, [fetchPools]);

  const displayed = useMemo(() => {
    let list = pools.filter(p => matchesFilter(p, filter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.name_en || "").toLowerCase().includes(q) ||
        p.owner_name.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) =>
      sort === "ko"
        ? a.name.localeCompare(b.name, "ko")
        : (a.name_en || a.name).localeCompare(b.name_en || b.name, "en")
    );
  }, [pools, search, filter, sort]);

  const counts = useMemo(() => {
    const keys: FilterKey[] = ["all", "pending", "free", "paid", "rejected"];
    const c: Record<FilterKey, number> = { all: 0, pending: 0, free: 0, paid: 0, rejected: 0 };
    keys.forEach(k => { c[k] = pools.filter(p => matchesFilter(p, k)).length; });
    return c;
  }, [pools]);

  async function doApprove(pool: Pool) {
    setApproveTarget(null);
    setProcessing(pool.id);
    const res = await apiRequest(token, `/admin/pools/${pool.id}/approve`, { method: "PATCH" });
    if (res.ok) await fetchPools();
    setProcessing(null);
  }

  function handleApprove(pool: Pool) {
    setApproveTarget(pool);
  }

  async function handleRejectSubmit() {
    if (!rejectPool) return;
    setProcessing(rejectPool.id);
    const res = await apiRequest(token, `/admin/pools/${rejectPool.id}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ reason: rejectReason || "기준 미달" }),
    });
    if (res.ok) await fetchPools();
    setRejectPool(null); setRejectReason(""); setProcessing(null);
  }

  // 필터칩 정의
  const filterChips: FilterChipItem<FilterKey>[] = [
    { key: "all",      label: "전체",    count: counts.all,      activeColor: PURPLE, activeBg: "#F3E8FF" },
    { key: "pending",  label: "미승인",  count: counts.pending,  activeColor: "#D97706", activeBg: "#FEF3C7" },
    { key: "free",     label: "무료 이용", count: counts.free,   activeColor: "#059669", activeBg: "#D1FAE5" },
    { key: "paid",     label: "유료 이용", count: counts.paid,   activeColor: "#1A5CFF", activeBg: "#EEF3FF" },
    { key: "rejected", label: "반려",    count: counts.rejected, activeColor: "#DC2626", activeBg: "#FEE2E2" },
  ];

  // 고정 헤더
  const header = (
    <>
      {/* 타이틀 영역 */}
      <View style={[s.titleArea, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.superLabel, { color: PURPLE }]}>슈퍼관리자</Text>
          <Text style={[s.title, { color: C.text }]}>수영장 관리</Text>
        </View>
      </View>

      {/* 검색 + 정렬 */}
      <View style={s.searchRow}>
        <View style={[s.searchBox, { backgroundColor: C.card, borderColor: C.border }]}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={[s.searchInput, { color: C.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="수영장 이름으로 검색"
            placeholderTextColor={C.textMuted}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[s.sortBtn, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => setSort(v => v === "ko" ? "en" : "ko")}
        >
          <Feather name="bar-chart-2" size={14} color={PURPLE} />
          <Text style={[s.sortText, { color: PURPLE }]}>{sort === "ko" ? "가나다" : "ABC"}</Text>
        </Pressable>
      </View>

      {/* 상태 필터칩 (고정 크기) */}
      <FilterChips<FilterKey>
        chips={filterChips}
        active={filter}
        onChange={setFilter}
      />
    </>
  );

  return (
    <>
      <ScreenLayout header={header}>
        {loading ? (
          <ActivityIndicator color={PURPLE} style={{ marginTop: 80 }} />
        ) : (
          <FlatList
            data={displayed}
            keyExtractor={item => item.id}
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPools(); }} tintColor={PURPLE} />}
            ListEmptyComponent={
              <EmptyState
                icon="inbox"
                title={search ? `"${search}" 검색 결과가 없습니다` : "해당하는 수영장이 없습니다"}
                subtitle="필터를 변경하거나 검색어를 확인해주세요"
              />
            }
            renderItem={({ item: pool }) => {
              const ts       = tierStyleOf(pool);
              const label    = tierLabelOf(pool);
              const isPending = pool.approval_status === "pending";
              return (
                <Pressable
                  style={[s.card, { backgroundColor: C.card, borderLeftColor: ts.border }]}
                  onPress={() => setDetailPool(pool)}
                >
                  {/* 상단: 이름 + 상태 */}
                  <View style={s.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.poolName, { color: C.text }]} numberOfLines={1}>{pool.name}</Text>
                      {pool.name_en && <Text style={[s.poolNameEn, { color: C.textMuted }]}>{pool.name_en}</Text>}
                    </View>
                    <View style={[s.tierBadge, { backgroundColor: ts.bg }]}>
                      <Text style={[s.tierText, { color: ts.color }]}>{label}</Text>
                    </View>
                  </View>

                  {/* 회원수 (승인된 경우) */}
                  {pool.approval_status === "approved" && (
                    <View style={[s.memberRow, { backgroundColor: ts.bg }]}>
                      <Feather name="users" size={13} color={ts.color} />
                      <Text style={[s.memberCount, { color: ts.color }]}>
                        현재 회원 <Text style={{ fontFamily: "Inter_700Bold" }}>{pool.member_count}명</Text>
                      </Text>
                      <View style={[s.dot, { backgroundColor: ts.color }]} />
                      <Text style={[s.memberTier, { color: ts.color }]}>{pool.subscription_tier?.label}</Text>
                    </View>
                  )}

                  {/* 기본 정보 */}
                  <View style={s.infoRows}>
                    <InfoRow icon="map-pin"   text={pool.address} />
                    <InfoRow icon="user"      text={`${pool.owner_name} · ${pool.owner_email}`} />
                    <InfoRow icon="calendar"  text={`신청: ${new Date(pool.created_at).toLocaleDateString("ko-KR")}`} />
                    {pool.business_reg_number && <InfoRow icon="file-text" text={`사업자번호: ${pool.business_reg_number}`} />}
                    {pool.rejection_reason && (
                      <View style={[s.rejectNote, { backgroundColor: "#FEE2E2" }]}>
                        <Feather name="alert-circle" size={12} color="#DC2626" />
                        <Text style={[s.rejectNoteText, { color: "#DC2626" }]}>반려 사유: {pool.rejection_reason}</Text>
                      </View>
                    )}
                  </View>

                  {/* 서류 상태 섹션 제거 — 기본 정보 확인 후 수동 승인 */}

                  {/* 승인/반려 버튼 (미승인 시) */}
                  {isPending && (
                    <View style={s.actionRow}>
                      <Pressable
                        style={[s.approveBtn, { backgroundColor: C.success, opacity: processing === pool.id ? 0.6 : 1 }]}
                        onPress={() => handleApprove(pool)}
                        disabled={!!processing}
                      >
                        {processing === pool.id
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <><Feather name="check" size={14} color="#fff" /><Text style={s.actionText}>승인</Text></>
                        }
                      </Pressable>
                      <Pressable
                        style={[s.rejectBtn, { borderColor: C.error, opacity: processing === pool.id ? 0.6 : 1 }]}
                        onPress={() => { setRejectPool(pool); setRejectReason(""); }}
                        disabled={!!processing}
                      >
                        <Feather name="x" size={14} color={C.error} />
                        <Text style={[s.actionText, { color: C.error }]}>반려</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        )}
      </ScreenLayout>

      {/* 반려 사유 모달 */}
      <Modal visible={!!rejectPool} animationType="slide" transparent onRequestClose={() => setRejectPool(null)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[s.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 24 }]}>
            <View style={s.handle} />
            <Text style={[s.sheetTitle, { color: C.text }]}>반려 사유 입력</Text>
            <Text style={[s.sheetSub, { color: C.textSecondary }]}>{rejectPool?.name}</Text>
            <TextInput
              style={[s.textarea, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="반려 사유를 입력해주세요 (미입력 시 '기준 미달')"
              placeholderTextColor={C.textMuted}
              multiline numberOfLines={3} textAlignVertical="top"
            />
            <View style={s.sheetBtns}>
              <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={() => { setRejectPool(null); setRejectReason(""); }}>
                <Text style={[s.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.rejectConfirmBtn, { backgroundColor: C.error, opacity: processing ? 0.6 : 1 }]}
                onPress={handleRejectSubmit} disabled={!!processing}
              >
                {processing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.actionText}>반려 처리</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 상세 모달 */}
      <Modal visible={!!detailPool} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailPool(null)}>
        {detailPool && <PoolDetailModal pool={detailPool} onClose={() => setDetailPool(null)} />}
      </Modal>

      {/* 승인 확인 모달 */}
      <ConfirmModal
        visible={!!approveTarget}
        title="승인 확인"
        message={`${approveTarget?.name}을 승인하시겠습니까?\n승인 후 무료 이용(~50명)으로 시작됩니다.`}
        confirmText="승인"
        cancelText="취소"
        onConfirm={() => approveTarget && doApprove(approveTarget)}
        onCancel={() => setApproveTarget(null)}
      />
    </>
  );
}

// ── 풀 상세 모달 ──────────────────────────────────────────────
function PoolDetailModal({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const ts = tierStyleOf(pool);

  const rows = [
    { label: "수영장 이름", value: pool.name },
    { label: "영문표시명",  value: pool.name_en || "미설정" },
    { label: "주소",        value: pool.address },
    { label: "대표 전화",   value: pool.phone },
    { label: "대표자",      value: pool.owner_name },
    { label: "이메일",  value: pool.owner_email },
    { label: "신청일",  value: new Date(pool.created_at).toLocaleDateString("ko-KR") },
  ];

  return (
    <View style={[d.root, { backgroundColor: C.background }]}>
      <View style={[d.header, { paddingTop: insets.top + 16, borderBottomColor: C.border }]}>
        <Pressable onPress={onClose}><Feather name="x" size={22} color={C.text} /></Pressable>
        <Text style={[d.title, { color: C.text }]} numberOfLines={1}>{pool.name}</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20, paddingBottom: insets.bottom + 40 }}>
        <View style={[d.tierCard, { backgroundColor: ts.bg, borderColor: ts.border }]}>
          <View style={d.tierCardRow}>
            <View>
              <Text style={[d.tierLabel, { color: ts.color }]}>현재 상태</Text>
              <Text style={[d.tierValue, { color: ts.color }]}>{tierLabelOf(pool)}</Text>
            </View>
            {pool.approval_status === "approved" && (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[d.tierCount, { color: ts.color }]}>{pool.member_count}</Text>
                <Text style={[d.tierCountLabel, { color: ts.color }]}>명</Text>
              </View>
            )}
          </View>
          {pool.approval_status === "approved" && (
            <View style={[d.tierProgress, { backgroundColor: "rgba(0,0,0,0.08)" }]}>
              <Text style={[d.tierProgressText, { color: ts.color }]}>
                {pool.subscription_tier?.isFree
                  ? `무료 한도: ${pool.member_count}/50명`
                  : `유료 구간: ${pool.member_count}명`}
              </Text>
            </View>
          )}
        </View>

        <View style={[d.card, { backgroundColor: C.card }]}>
          <Text style={[d.sectionTitle, { color: C.text }]}>수영장 정보</Text>
          {rows.map(r => (
            <View key={r.label} style={d.row}>
              <Text style={[d.rowLabel, { color: C.textMuted }]}>{r.label}</Text>
              <Text style={[d.rowValue, { color: C.text }]}>{r.value}</Text>
            </View>
          ))}
        </View>

        <View style={[d.card, { backgroundColor: C.card }]}>
          <Text style={[d.sectionTitle, { color: C.text }]}>구독 단계 기준</Text>
          {[
            { range: "0 ~ 50명",    tier: "무료 이용",       color: "#059669" },
            { range: "51 ~ 100명",  tier: "유료 100명",       color: "#1A5CFF" },
            { range: "101 ~ 300명", tier: "유료 300명",       color: "#1A5CFF" },
            { range: "301 ~ 500명", tier: "유료 500명",       color: PURPLE    },
            { range: "501 ~ 1000명",tier: "유료 1000명",      color: PURPLE    },
            { range: "1001명+",     tier: "유료 엔터프라이즈", color: "#DC2626" },
          ].map(t => (
            <View key={t.range} style={d.tierRow}>
              <View style={[d.dot, { backgroundColor: t.color }]} />
              <Text style={[d.tierRange, { color: C.textSecondary }]}>{t.range}</Text>
              <Text style={[d.tierTier, { color: t.color }]}>{t.tier}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  titleArea: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: C.background,
  },
  superLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase" },
  title:      { fontSize: 24, fontFamily: "Inter_700Bold", color: C.text },
  iconBtn:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  searchRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 4 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  sortText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  list: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },

  card: {
    borderRadius: 16, borderLeftWidth: 4,
    padding: 16, gap: 10,
  },
  cardHead:   { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  poolName:   { fontSize: 16, fontFamily: "Inter_700Bold" },
  poolNameEn: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  tierBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tierText:   { fontSize: 11, fontFamily: "Inter_700Bold" },
  memberRow:  { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  memberCount:{ fontSize: 13, fontFamily: "Inter_400Regular" },
  dot:        { width: 4, height: 4, borderRadius: 2 },
  memberTier: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  infoRows:   { gap: 5 },
  infoRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  infoText:   { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  rejectNote: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8 },
  rejectNoteText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  actionRow:  { flexDirection: "row", gap: 10 },
  approveBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12 },
  rejectBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, borderWidth: 1.5 },
  actionText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:   { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  handle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sheetSub:   { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -8 },
  textarea:   { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, height: 96, fontSize: 15, fontFamily: "Inter_400Regular" },
  sheetBtns:  { flexDirection: "row", gap: 10 },
  cancelBtn:  { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rejectConfirmBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 48, borderRadius: 12, gap: 6 },
});

const d = StyleSheet.create({
  root:   { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  title:  { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },
  tierCard:     { borderRadius: 16, borderWidth: 1.5, padding: 18, gap: 10 },
  tierCardRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tierLabel:    { fontSize: 12, fontFamily: "Inter_500Medium" },
  tierValue:    { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  tierCount:    { fontSize: 36, fontFamily: "Inter_700Bold" },
  tierCountLabel:{ fontSize: 14, fontFamily: "Inter_500Medium" },
  tierProgress: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tierProgressText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  card:         { borderRadius: 16, padding: 18, gap: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  row:          { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel:     { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  rowValue:     { fontSize: 13, fontFamily: "Inter_500Medium", flex: 2, textAlign: "right" },
  tierRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  tierRange:    { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  tierTier:     { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
