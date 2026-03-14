import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const PURPLE = "#7C3AED";

interface SubscriptionTier {
  tier: string;
  label: string;
  isFree: boolean;
}

interface Pool {
  id: string;
  name: string;
  name_en: string | null;
  address: string;
  phone: string;
  owner_name: string;
  owner_email: string;
  business_reg_number: string | null;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  subscription_status: string;
  member_count: number;
  subscription_tier: SubscriptionTier;
  created_at: string;
  business_license_status?: string;
  bank_account_verification_status?: string;
}

// ── 구독 단계별 색상 ─────────────────────────────────────────────────
const TIER_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  unapproved:       { color: "#D97706", bg: "#FEF3C7", border: "#F59E0B" },
  free:             { color: "#059669", bg: "#D1FAE5", border: "#10B981" },
  paid_100:         { color: "#1A5CFF", bg: "#EEF3FF", border: "#3B82F6" },
  paid_300:         { color: "#1A5CFF", bg: "#EEF3FF", border: "#3B82F6" },
  paid_500:         { color: PURPLE,    bg: "#F3E8FF", border: PURPLE     },
  paid_1000:        { color: PURPLE,    bg: "#F3E8FF", border: PURPLE     },
  paid_enterprise:  { color: "#DC2626", bg: "#FEE2E2", border: "#EF4444" },
};

const STATUS_FILTER = [
  { key: "all",      label: "전체" },
  { key: "pending",  label: "미승인" },
  { key: "free",     label: "무료 이용" },
  { key: "paid",     label: "유료 이용" },
  { key: "rejected", label: "반려" },
];

function DocStatus({ label, status }: { label: string; status?: string }) {
  const isOK = status === "uploaded" || status === "verified";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: isOK ? "#D1FAE5" : "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
        <Feather name={isOK ? "check" : "alert-circle"} size={12} color={isOK ? "#059669" : "#DC2626"} />
      </View>
      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: isOK ? "#059669" : "#DC2626" }}>
        {label}: {status || "notUploaded"} {status === "verified" ? "✓" : ""}
      </Text>
    </View>
  );
}

type SortMode = "ko" | "en";

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
  if (filterKey === "all") return true;
  if (filterKey === "pending")  return pool.approval_status === "pending";
  if (filterKey === "rejected") return pool.approval_status === "rejected";
  if (filterKey === "free") return pool.approval_status === "approved" && pool.subscription_tier?.isFree;
  if (filterKey === "paid") return pool.approval_status === "approved" && !pool.subscription_tier?.isFree;
  return true;
}

export default function SuperPoolsScreen() {
  const { token, logout } = useAuth();
  const insets = useSafeAreaInsets();

  const [pools, setPools]         = useState<Pool[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState("all");
  const [sort, setSort]           = useState<SortMode>("ko");
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<Pool | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailModal, setDetailModal] = useState<Pool | null>(null);

  const fetchPools = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/pools");
      if (res.ok) setPools(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchPools(); }, [fetchPools]);

  // 검색 + 필터 + 정렬
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

    list = [...list].sort((a, b) => {
      if (sort === "ko") return a.name.localeCompare(b.name, "ko");
      return (a.name_en || a.name).localeCompare(b.name_en || b.name, "en");
    });

    return list;
  }, [pools, search, filter, sort]);

  // 필터별 카운트
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    STATUS_FILTER.forEach(f => { c[f.key] = pools.filter(p => matchesFilter(p, f.key)).length; });
    return c;
  }, [pools]);

  async function handleApprove(pool: Pool) {
    // 필수 서류 확인
    const businessOK = pool.business_license_status === "uploaded" || pool.business_license_status === "verified";
    const bankOK = pool.bank_account_verification_status === "uploaded" || pool.bank_account_verification_status === "verified";
    if (!businessOK || !bankOK) {
      Alert.alert("승인 불가", "필수 서류(사업자등록증, 자동이체 계좌인증)가 모두 업로드되어야 승인할 수 있습니다.");
      return;
    }
    Alert.alert("승인 확인", `${pool.name}을 승인하시겠습니까?\n승인 후 무료 이용(~50명)으로 시작됩니다.`, [
      { text: "취소", style: "cancel" },
      { text: "승인", onPress: async () => {
        setProcessing(pool.id);
        const res = await apiRequest(token, `/admin/pools/${pool.id}/approve`, { method: "PATCH" });
        if (res.ok) await fetchPools();
        setProcessing(null);
      }},
    ]);
  }

  async function handleRejectSubmit() {
    if (!rejectModal) return;
    setProcessing(rejectModal.id);
    const res = await apiRequest(token, `/admin/pools/${rejectModal.id}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ reason: rejectReason || "기준 미달" }),
    });
    if (res.ok) await fetchPools();
    setRejectModal(null); setRejectReason(""); setProcessing(null);
  }

  const renderPool = ({ item }: { item: Pool }) => {
    const ts = tierStyleOf(item);
    const label = tierLabelOf(item);
    const isPending = item.approval_status === "pending";
    return (
      <Pressable
        style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow, borderLeftColor: ts.border }]}
        onPress={() => setDetailModal(item)}
      >
        {/* 상단: 이름 + 상태 배지 */}
        <View style={styles.cardHead}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.poolName, { color: C.text }]} numberOfLines={1}>{item.name}</Text>
            {item.name_en && <Text style={[styles.poolNameEn, { color: C.textMuted }]}>{item.name_en}</Text>}
          </View>
          <View style={[styles.tierBadge, { backgroundColor: ts.bg }]}>
            <Text style={[styles.tierText, { color: ts.color }]}>{label}</Text>
          </View>
        </View>

        {/* 회원 수 + 구독 단계 */}
        {item.approval_status === "approved" && (
          <View style={[styles.memberRow, { backgroundColor: ts.bg }]}>
            <Feather name="users" size={13} color={ts.color} />
            <Text style={[styles.memberCount, { color: ts.color }]}>
              현재 회원 <Text style={{ fontFamily: "Inter_700Bold" }}>{item.member_count}명</Text>
            </Text>
            <View style={[styles.memberDot, { backgroundColor: ts.color }]} />
            <Text style={[styles.memberTier, { color: ts.color }]}>{item.subscription_tier?.label}</Text>
          </View>
        )}

        {/* 기본 정보 */}
        <View style={styles.infoRows}>
          <InfoRow icon="map-pin" text={item.address} />
          <InfoRow icon="user" text={`${item.owner_name} · ${item.owner_email}`} />
          <InfoRow icon="calendar" text={`신청: ${new Date(item.created_at).toLocaleDateString("ko-KR")}`} />
          {item.business_reg_number && (
            <InfoRow icon="file-text" text={`사업자번호: ${item.business_reg_number}`} />
          )}
          {item.rejection_reason && (
            <View style={[styles.rejectReason, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={12} color="#DC2626" />
              <Text style={[styles.rejectReasonText, { color: "#DC2626" }]}>반려 사유: {item.rejection_reason}</Text>
            </View>
          )}
        </View>

        {/* 미승인 - 필수 서류 상태 */}
        {isPending && (
          <View style={{ gap: 8, marginBottom: 8 }}>
            <DocStatus label="사업자등록증" status={item.business_license_status} />
            <DocStatus label="자동이체 계좌인증" status={item.bank_account_verification_status} />
          </View>
        )}

        {/* 미승인 → 승인/반려 버튼 */}
        {isPending && (
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.approveBtn, { backgroundColor: C.success, opacity: processing === item.id ? 0.6 : 1 }]}
              onPress={() => handleApprove(item)} disabled={!!processing}
            >
              {processing === item.id
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check" size={15} color="#fff" /><Text style={styles.actionText}>승인</Text></>
              }
            </Pressable>
            <Pressable
              style={[styles.rejectBtn, { borderColor: C.error, opacity: processing === item.id ? 0.6 : 1 }]}
              onPress={() => { setRejectModal(item); setRejectReason(""); }}
              disabled={!!processing}
            >
              <Feather name="x" size={15} color={C.error} />
              <Text style={[styles.actionText, { color: C.error }]}>반려</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.superLabel, { color: PURPLE }]}>슈퍼관리자</Text>
          <Text style={[styles.title, { color: C.text }]}>수영장 관리</Text>
        </View>
        <Pressable style={[styles.logoutBtn, { backgroundColor: C.card }]} onPress={logout}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      {/* 검색창 */}
      <View style={[styles.searchWrap, { marginHorizontal: 20, marginBottom: 12 }]}>
        <View style={[styles.searchBox, { backgroundColor: C.card, borderColor: C.border }]}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: C.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="수영장 이름으로 검색"
            placeholderTextColor={C.textMuted}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && Platform.OS !== "ios" && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>
        {/* 정렬 토글 */}
        <Pressable
          style={[styles.sortBtn, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => setSort(s => s === "ko" ? "en" : "ko")}
        >
          <Feather name="bar-chart-2" size={14} color={PURPLE} />
          <Text style={[styles.sortText, { color: PURPLE }]}>{sort === "ko" ? "가나다" : "ABC"}</Text>
        </Pressable>
      </View>

      {/* 필터 탭 */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 12 }}
      >
        {STATUS_FILTER.map(f => (
          <Pressable
            key={f.key}
            style={[styles.filterTab, {
              backgroundColor: filter === f.key ? PURPLE : C.card,
              borderColor: filter === f.key ? PURPLE : C.border,
            }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, { color: filter === f.key ? "#fff" : C.textSecondary }]}>
              {f.label}
            </Text>
            <View style={[styles.filterCount, { backgroundColor: filter === f.key ? "rgba(255,255,255,0.3)" : C.tintLight }]}>
              <Text style={[styles.filterCountText, { color: filter === f.key ? "#fff" : C.tint }]}>{counts[f.key] ?? 0}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* 풀 리스트 */}
      {loading ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPools(); }} tintColor={PURPLE} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={42} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>
                {search ? `"${search}" 검색 결과 없음` : "해당하는 수영장이 없습니다"}
              </Text>
            </View>
          }
          renderItem={renderPool}
        />
      )}

      {/* 반려 모달 */}
      <Modal visible={!!rejectModal} animationType="slide" transparent onRequestClose={() => setRejectModal(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>반려 사유 입력</Text>
            <Text style={[styles.sheetSub, { color: C.textSecondary }]}>{rejectModal?.name}</Text>
            <TextInput
              style={[styles.textarea, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="반려 사유를 입력해주세요 (미입력 시 '기준 미달')"
              placeholderTextColor={C.textMuted}
              multiline numberOfLines={3} textAlignVertical="top"
            />
            <View style={styles.sheetBtns}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => { setRejectModal(null); setRejectReason(""); }}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.rejectConfirmBtn, { backgroundColor: C.error, opacity: processing ? 0.6 : 1 }]}
                onPress={handleRejectSubmit} disabled={!!processing}
              >
                {processing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionText}>반려 처리</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 상세 모달 */}
      <Modal visible={!!detailModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailModal(null)}>
        {detailModal && <PoolDetailModal pool={detailModal} onClose={() => setDetailModal(null)} />}
      </Modal>
    </View>
  );
}

function InfoRow({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={12} color={C.textMuted} />
      <Text style={[styles.infoText, { color: C.textSecondary }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function PoolDetailModal({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const ts = tierStyleOf(pool);

  const rows: { label: string; value: string }[] = [
    { label: "수영장 이름", value: pool.name },
    { label: "영문표시명", value: pool.name_en || "미설정" },
    { label: "주소", value: pool.address },
    { label: "대표 전화", value: pool.phone },
    { label: "대표자", value: pool.owner_name },
    { label: "이메일", value: pool.owner_email },
    { label: "사업자번호", value: pool.business_reg_number || "미제출" },
    { label: "신청일", value: new Date(pool.created_at).toLocaleDateString("ko-KR") },
  ];

  return (
    <View style={[styles.detailRoot, { backgroundColor: C.background }]}>
      <View style={[styles.detailHeader, { paddingTop: insets.top + 16, borderBottomColor: C.border }]}>
        <Pressable onPress={onClose}>
          <Feather name="x" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.detailTitle, { color: C.text }]} numberOfLines={1}>{pool.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, gap: 20, paddingBottom: insets.bottom + 40 }}>
        {/* 구독 상태 카드 */}
        <View style={[styles.tierCard, { backgroundColor: ts.bg, borderColor: ts.border }]}>
          <View style={styles.tierCardRow}>
            <View>
              <Text style={[styles.tierCardLabel, { color: ts.color }]}>현재 상태</Text>
              <Text style={[styles.tierCardValue, { color: ts.color }]}>{tierLabelOf(pool)}</Text>
            </View>
            {pool.approval_status === "approved" && (
              <View style={styles.tierCardRight}>
                <Text style={[styles.tierCardCount, { color: ts.color }]}>{pool.member_count}</Text>
                <Text style={[styles.tierCardCountLabel, { color: ts.color }]}>명</Text>
              </View>
            )}
          </View>
          {pool.approval_status === "approved" && (
            <View style={[styles.tierProgress, { backgroundColor: "rgba(0,0,0,0.08)" }]}>
              <Text style={[styles.tierProgressText, { color: ts.color }]}>
                {pool.subscription_tier?.isFree
                  ? `무료 한도: ${pool.member_count}/50명`
                  : `유료 구간: ${pool.member_count}명`}
              </Text>
            </View>
          )}
        </View>

        {/* 수영장 상세 정보 */}
        <View style={[styles.detailCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <Text style={[styles.detailSectionTitle, { color: C.text }]}>수영장 정보</Text>
          {rows.map(r => (
            <View key={r.label} style={styles.detailRow}>
              <Text style={[styles.detailRowLabel, { color: C.textMuted }]}>{r.label}</Text>
              <Text style={[styles.detailRowValue, { color: C.text }]}>{r.value}</Text>
            </View>
          ))}
        </View>

        {/* 구독 단계 안내 */}
        <View style={[styles.detailCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <Text style={[styles.detailSectionTitle, { color: C.text }]}>구독 단계 기준</Text>
          {[
            { range: "0 ~ 50명", tier: "무료 이용", color: "#059669" },
            { range: "51 ~ 100명", tier: "유료 100명", color: "#1A5CFF" },
            { range: "101 ~ 300명", tier: "유료 300명", color: "#1A5CFF" },
            { range: "301 ~ 500명", tier: "유료 500명", color: PURPLE },
            { range: "501 ~ 1000명", tier: "유료 1000명", color: PURPLE },
            { range: "1001명+", tier: "유료 엔터프라이즈", color: "#DC2626" },
          ].map(t => (
            <View key={t.range} style={styles.tierRow}>
              <View style={[styles.tierDot, { backgroundColor: t.color }]} />
              <Text style={[styles.tierRangeText, { color: C.textSecondary }]}>{t.range}</Text>
              <Text style={[styles.tierLabelText, { color: t.color }]}>{t.tier}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 16 },
  superLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  searchWrap: { flexDirection: "row", gap: 8 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  sortText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  filterTab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  filterCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, minWidth: 22, alignItems: "center" },
  filterCountText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  card: { borderRadius: 16, borderLeftWidth: 4, backgroundColor: C.card, padding: 16, gap: 10, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  poolName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  poolNameEn: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tierText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  memberCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
  memberDot: { width: 4, height: 4, borderRadius: 2 },
  memberTier: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  infoRows: { gap: 5 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  rejectReason: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8 },
  rejectReasonText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  actionRow: { flexDirection: "row", gap: 10 },
  approveBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: 12 },
  rejectBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: 12, borderWidth: 1.5 },
  actionText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  // 반려 모달
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sheetSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -8 },
  textarea: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, height: 96, fontSize: 15, fontFamily: "Inter_400Regular" },
  sheetBtns: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rejectConfirmBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 48, borderRadius: 12, gap: 6 },
  // 상세 모달
  detailRoot: { flex: 1 },
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  detailTitle: { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },
  tierCard: { borderRadius: 16, borderWidth: 1.5, padding: 18, gap: 10 },
  tierCardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tierCardLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tierCardValue: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  tierCardRight: { alignItems: "flex-end" },
  tierCardCount: { fontSize: 36, fontFamily: "Inter_700Bold" },
  tierCardCountLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  tierProgress: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tierProgressText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  detailCard: { borderRadius: 16, padding: 18, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  detailSectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailRowLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  detailRowValue: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 2, textAlign: "right" },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  tierRangeText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  tierLabelText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
