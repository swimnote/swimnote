/**
 * (super)/operator-detail.tsx — 운영자 상세 (6탭)
 * 기본정보 / 구독·결제 / 저장공간 / 정책·동의 / 로그 / 강제조치
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

const TABS = ["기본정보", "구독·결제", "저장공간", "정책·동의", "로그", "강제조치"] as const;
type Tab = typeof TABS[number];

function fmtBytes(b: number) {
  if (!b) return "0 B";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function InfoRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={d.infoRow}>
      <Text style={d.infoLabel}>{label}</Text>
      <Text style={[d.infoVal, alert && { color: "#DC2626" }]}>{value}</Text>
    </View>
  );
}

const SUB_CFG: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: "체험 중",  color: P,         bg: "#EDE9FE" },
  active:    { label: "구독 중",  color: "#059669", bg: "#D1FAE5" },
  expired:   { label: "만료됨",   color: "#6B7280", bg: "#F3F4F6" },
  suspended: { label: "정지됨",   color: "#D97706", bg: "#FEF3C7" },
  cancelled: { label: "해지됨",   color: "#DC2626", bg: "#FEE2E2" },
};

const APPROVAL_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "대기",  color: "#D97706", bg: "#FEF3C7" },
  approved: { label: "운영",  color: "#059669", bg: "#D1FAE5" },
  rejected: { label: "반려",  color: "#DC2626", bg: "#FEE2E2" },
};

const CAT_CFG: Record<string, { color: string; bg: string }> = {
  권한:    { color: "#D97706", bg: "#FEF3C7" },
  구독:    { color: P,         bg: "#EDE9FE" },
  저장공간: { color: "#059669", bg: "#D1FAE5" },
  삭제:    { color: "#DC2626", bg: "#FEE2E2" },
  정책:    { color: "#4F46E5", bg: "#EEF2FF" },
  결제:    { color: "#0891B2", bg: "#ECFEFF" },
};

export default function OperatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [data,       setData]       = useState<any | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<Tab>("기본정보");
  const [action,     setAction]     = useState<string | null>(null);
  const [reason,     setReason]     = useState("");
  const [extraGB,    setExtraGB]    = useState("");
  const [processing, setProcessing] = useState(false);
  const [feedback,   setFeedback]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/super/operators/${id}`);
      if (res.ok) setData(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  async function doAction(act: string) {
    setProcessing(true);
    try {
      if (act === "approve" || act === "reject" || act === "restrict") {
        await apiRequest(token, `/super/operators/${id}/${act}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || undefined }),
        });
        setFeedback("처리 완료");
      } else if (act === "storage") {
        await apiRequest(token, `/super/storage/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra_storage_gb: parseFloat(extraGB) || 0 }),
        });
        setFeedback("저장공간 변경 완료");
      }
      setAction(null); setReason(""); setExtraGB("");
      setTimeout(() => setFeedback(""), 3000);
      load();
    } catch {}
    finally { setProcessing(false); }
  }

  if (loading || !data) {
    return (
      <SafeAreaView style={d.safe} edges={[]}>
        <SubScreenHeader title="운영자 상세" homePath="/(super)/pools" />
        <ActivityIndicator color={P} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const pool      = data.pool;
  const teachers  = data.teachers ?? [];
  const logs      = data.logs ?? [];
  const appCfg    = APPROVAL_CFG[pool.approval_status] ?? APPROVAL_CFG.pending;
  const subCfg    = SUB_CFG[pool.subscription_status]  ?? SUB_CFG.expired;
  const usagePct  = pool.usage_pct ?? 0;
  const storageAlert = usagePct >= 95;
  const storageWarn  = usagePct >= 80;
  const totalGB   = pool.total_storage_gb ?? ((pool.base_storage_gb || 5) + (pool.extra_storage_gb || 0));

  return (
    <SafeAreaView style={d.safe} edges={[]}>
      <SubScreenHeader title={pool.name} homePath="/(super)/pools" />

      {/* 상태 배너 */}
      <View style={d.banner}>
        <View style={d.bannerLeft}>
          <Text style={d.bannerName} numberOfLines={1}>{pool.name}</Text>
          <Text style={d.bannerOwner}>{pool.owner_name}</Text>
        </View>
        <View style={[d.badge, { backgroundColor: appCfg.bg }]}>
          <Text style={[d.badgeTxt, { color: appCfg.color }]}>{appCfg.label}</Text>
        </View>
        <View style={[d.badge, { backgroundColor: subCfg.bg }]}>
          <Text style={[d.badgeTxt, { color: subCfg.color }]}>{subCfg.label}</Text>
        </View>
      </View>

      {!!feedback && (
        <View style={d.feedbackBanner}>
          <Feather name="check-circle" size={14} color="#059669" />
          <Text style={d.feedbackTxt}>{feedback}</Text>
        </View>
      )}

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={d.tabBar} contentContainerStyle={d.tabContent}>
        {TABS.map(t => (
          <Pressable key={t} style={[d.tab, tab === t && d.tabActive]} onPress={() => setTab(t)}>
            <Text style={[d.tabTxt, tab === t && d.tabActiveTxt]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>

        {/* ── 기본 정보 ── */}
        {tab === "기본정보" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>운영 정보</Text>
              <InfoRow label="수영장명"   value={pool.name} />
              <InfoRow label="운영자"     value={pool.owner_name} />
              <InfoRow label="활성 회원"  value={`${pool.active_member_count ?? 0}명`} />
              <InfoRow label="전체 회원"  value={`${pool.total_member_count ?? 0}명`} />
              <InfoRow label="반 수"      value={`${pool.total_class_count ?? 0}개`} />
              <InfoRow label="마지막 접속" value={fmtDateTime(pool.last_login_at)} />
              <InfoRow label="가입일"      value={fmtDate(pool.created_at)} />
            </View>
            <View style={d.card}>
              <Text style={d.cardTitle}>코치·담당자 ({teachers.length}명)</Text>
              {teachers.length === 0 && <Text style={d.empty}>등록된 코치가 없습니다</Text>}
              {teachers.map((t: any) => (
                <View key={t.id} style={d.teacherRow}>
                  <View style={d.teacherAvatar}>
                    <Text style={d.teacherAvatarTxt}>{(t.name || "?")[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={d.teacherName}>{t.name}</Text>
                    <Text style={d.teacherMeta}>{t.role === "pool_admin" ? "관리자" : "코치"} · 마지막접속 {fmtDate(t.last_login_at)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── 구독·결제 ── */}
        {tab === "구독·결제" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>구독 정보</Text>
            <InfoRow label="현재 상태" value={subCfg.label} />
            <InfoRow label="구독 플랜" value={pool.subscription_tier?.label ?? "무료 이용"} />
            <InfoRow label="크레딧"    value={`${pool.credit_balance ?? 0} 크레딧`} />
            <InfoRow label="다음 결제일" value={fmtDate(pool.next_billing_at ?? pool.subscription_end_at)} />
            <InfoRow label="구독 시작" value={fmtDate(pool.subscription_start_at)} />
            <InfoRow label="구독 종료" value={fmtDate(pool.subscription_end_at)} />
            {pool.subscription_status in ["expired","suspended","cancelled"] && (
              <View style={d.alertBox}>
                <Feather name="alert-triangle" size={14} color="#DC2626" />
                <Text style={d.alertTxt}>결제 이슈가 있는 운영자입니다. 강제조치 탭에서 처리할 수 있습니다.</Text>
              </View>
            )}
          </View>
        )}

        {/* ── 저장공간 ── */}
        {tab === "저장공간" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>저장공간 현황</Text>
              <View style={d.storageCircleRow}>
                <View style={[d.storageCircle, storageAlert && { borderColor: "#DC2626" }, storageWarn && !storageAlert && { borderColor: "#F59E0B" }]}>
                  <Text style={[d.storageCircleNum, storageAlert && { color: "#DC2626" }]}>{usagePct}%</Text>
                  <Text style={d.storageCircleSub}>사용</Text>
                </View>
                <View style={d.storageDetails}>
                  <InfoRow label="사용량"      value={fmtBytes(pool.used_storage_bytes || 0)} />
                  <InfoRow label="전체 용량"   value={`${totalGB} GB`} />
                  <InfoRow label="기본 용량"   value={`${pool.base_storage_gb || 5} GB`} />
                  <InfoRow label="추가 용량"   value={`${pool.extra_storage_gb || 0} GB`} />
                  <InfoRow label="업로드 차단" value={pool.upload_blocked ? "차단됨" : "정상"} alert={pool.upload_blocked} />
                </View>
              </View>
              {storageAlert && (
                <View style={d.alertBox}>
                  <Feather name="alert-triangle" size={14} color="#DC2626" />
                  <Text style={d.alertTxt}>저장공간이 95% 이상 사용되었습니다.</Text>
                </View>
              )}
            </View>
            <Pressable style={d.actionCard} onPress={() => setAction("storage")}>
              <Feather name="hard-drive" size={18} color={P} />
              <Text style={d.actionCardTxt}>추가 용량 부여</Text>
              <Feather name="chevron-right" size={16} color="#9CA3AF" style={{ marginLeft: "auto" }} />
            </Pressable>
          </>
        )}

        {/* ── 정책·동의 ── */}
        {tab === "정책·동의" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>약관 동의 현황</Text>
            <Text style={d.empty}>정책 동의 기록 기능은 추후 추가될 예정입니다.</Text>
            <Pressable style={[d.actionCard, { marginTop: 12 }]} onPress={() => router.push("/(super)/policy" as any)}>
              <Feather name="file-text" size={18} color={P} />
              <Text style={d.actionCardTxt}>정책 편집 (슈퍼관리자)</Text>
              <Feather name="chevron-right" size={16} color="#9CA3AF" style={{ marginLeft: "auto" }} />
            </Pressable>
          </View>
        )}

        {/* ── 로그 ── */}
        {tab === "로그" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>최근 운영 로그</Text>
            {logs.length === 0 && <Text style={d.empty}>로그가 없습니다</Text>}
            {logs.map((log: any) => {
              const catCfg = CAT_CFG[log.category] ?? { color: "#6B7280", bg: "#F3F4F6" };
              return (
                <View key={log.id} style={d.logItem}>
                  <View style={[d.logCat, { backgroundColor: catCfg.bg }]}>
                    <Text style={[d.logCatTxt, { color: catCfg.color }]}>{log.category}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={d.logDesc}>{log.description}</Text>
                    <Text style={d.logTime}>{fmtDateTime(log.created_at)} · {log.actor_name ?? "—"}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── 강제조치 ── */}
        {tab === "강제조치" && (
          <>
            {[
              { act: "approve", icon: "check-circle" as const, label: "운영 승인", sub: "승인 대기 → 운영 상태로 변경", color: "#059669", bg: "#D1FAE5" },
              { act: "reject",  icon: "x-circle" as const,     label: "반려",      sub: "운영 자격 박탈 · 사유 기록",  color: "#DC2626", bg: "#FEE2E2" },
              { act: "restrict",icon: "pause-circle" as const, label: "일시 제한", sub: "구독 일시 정지 처리",         color: "#D97706", bg: "#FEF3C7" },
            ].map(item => (
              <Pressable key={item.act} style={d.forceCard} onPress={() => setAction(item.act)}>
                <View style={[d.forceIcon, { backgroundColor: item.bg }]}>
                  <Feather name={item.icon} size={22} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={d.forceTxt}>{item.label}</Text>
                  <Text style={d.forceSub}>{item.sub}</Text>
                </View>
                <Feather name="chevron-right" size={16} color="#D1D5DB" />
              </Pressable>
            ))}

            <View style={[d.card, { marginTop: 8 }]}>
              <Text style={d.cardTitle}>빠른 링크</Text>
              <Pressable style={d.quickLink} onPress={() => router.push("/(super)/kill-switch" as any)}>
                <Feather name="alert-triangle" size={15} color="#DC2626" />
                <Text style={[d.quickLinkTxt, { color: "#DC2626" }]}>킬스위치 (데이터 삭제)</Text>
                <Feather name="chevron-right" size={14} color="#9CA3AF" style={{ marginLeft: "auto" }} />
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* 액션 모달 */}
      {action && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setAction(null)}>
          <Pressable style={m.backdrop} onPress={() => setAction(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>
                {action === "approve" ? "운영 승인"
                  : action === "reject" ? "반려 처리"
                  : action === "restrict" ? "일시 제한"
                  : "추가 용량 부여"}
              </Text>
              {(action === "reject" || action === "restrict") && (
                <TextInput style={m.input} value={reason} onChangeText={setReason}
                  placeholder="사유 (선택)" placeholderTextColor="#9CA3AF" />
              )}
              {action === "storage" && (
                <View>
                  <Text style={m.inputLabel}>추가 용량 (GB)</Text>
                  <TextInput style={m.input} value={extraGB} onChangeText={setExtraGB}
                    keyboardType="decimal-pad" placeholder="예: 10" placeholderTextColor="#9CA3AF" />
                </View>
              )}
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setAction(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.confirmBtn, { opacity: processing ? 0.6 : 1 }]}
                  onPress={() => doAction(action!)} disabled={processing}>
                  {processing ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.confirmTxt}>확인</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const d = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F5F3FF" },
  banner:         { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                    borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  bannerLeft:     { flex: 1 },
  bannerName:     { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  bannerOwner:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeTxt:       { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  feedbackBanner: { flexDirection: "row", alignItems: "center", gap: 8,
                    backgroundColor: "#D1FAE5", paddingHorizontal: 16, paddingVertical: 8 },
  feedbackTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#065F46" },
  tabBar:         { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:     { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:            { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                    borderWidth: 1.5, borderColor: "#E5E7EB" },
  tabActive:      { backgroundColor: P, borderColor: P },
  tabTxt:         { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabActiveTxt:   { color: "#fff" },
  card:           { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB", gap: 8 },
  cardTitle:      { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 4 },
  infoRow:        { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  infoLabel:      { width: 90, fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  infoVal:        { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  empty:          { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", paddingVertical: 12 },
  alertBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginTop: 4 },
  alertTxt:       { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#DC2626" },
  teacherRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  teacherAvatar:  { width: 32, height: 32, borderRadius: 16, backgroundColor: "#EDE9FE",
                    alignItems: "center", justifyContent: "center" },
  teacherAvatarTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: P },
  teacherName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  teacherMeta:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  storageCircleRow:{ flexDirection: "row", alignItems: "flex-start", gap: 16 },
  storageCircle:  { width: 80, height: 80, borderRadius: 40, borderWidth: 5, borderColor: P,
                    alignItems: "center", justifyContent: "center" },
  storageCircleNum:{ fontSize: 18, fontFamily: "Inter_700Bold", color: P },
  storageCircleSub:{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  storageDetails: { flex: 1, gap: 4 },
  actionCard:     { flexDirection: "row", alignItems: "center", gap: 12,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB" },
  actionCardTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  forceCard:      { flexDirection: "row", alignItems: "center", gap: 14,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB" },
  forceIcon:      { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  forceTxt:       { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  forceSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  quickLink:      { flexDirection: "row", alignItems: "center", gap: 10,
                    paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  quickLinkTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  logItem:        { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  logCat:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 2 },
  logCatTxt:      { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  logDesc:        { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  logTime:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 16 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:      { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  inputLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  confirmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  confirmTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
