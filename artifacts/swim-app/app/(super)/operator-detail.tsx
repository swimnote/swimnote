/**
 * (super)/operator-detail.tsx — 운영자 상세 (6탭)
 * 기본정보 / 구독·결제 / 저장공간 / 정책·동의 / 로그 / 강제조치
 * Zustand 완전 제거 → GET /super/operators/:id 실 API 연동
 */
import { ChevronRight, CircleCheck, FileText, HardDrive, Lock, TriangleAlert } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";

const TABS = ["기본정보", "구독·결제", "저장공간", "정책·동의", "로그", "강제조치"] as const;
type Tab = typeof TABS[number];

const TIER_NAME: Record<string, string> = {
  basic:    "베이직",
  standard: "스탠다드",
  growth:   "어드밴스",
  premium:  "프리미엄",
  trial:    "무료 체험",
};

function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / 1048576;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function InfoRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={d.infoRow}>
      <Text style={d.infoLabel}>{label}</Text>
      <Text style={[d.infoVal, alert && { color: "#D96C6C" }]}>{value}</Text>
    </View>
  );
}

const BILLING_CFG: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: "체험 중",   color: P,         bg: "#EEDDF5" },
  active:    { label: "구독 중",   color: "#2EC4B6", bg: "#E6FFFA" },
  expired:   { label: "만료됨",    color: "#D96C6C", bg: "#F9DEDA" },
  suspended: { label: "일시 정지", color: "#D97706", bg: "#FFF1BF" },
  cancelled: { label: "해지됨",    color: "#64748B", bg: "#FFFFFF" },
};

const APPROVAL_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "대기",    color: "#D97706", bg: "#FFF1BF" },
  approved: { label: "운영",    color: "#2EC4B6", bg: "#E6FFFA" },
  rejected: { label: "반려",    color: "#D96C6C", bg: "#F9DEDA" },
};

const CAT_CFG: Record<string, { color: string; bg: string }> = {
  권한:         { color: "#D97706", bg: "#FFF1BF" },
  구독:         { color: P,         bg: "#EEDDF5" },
  저장공간:     { color: "#2EC4B6", bg: "#E6FFFA" },
  삭제:         { color: "#D96C6C", bg: "#F9DEDA" },
  정책:         { color: "#2EC4B6", bg: "#E6FFFA" },
  결제:         { color: "#2EC4B6", bg: "#ECFEFF" },
  "읽기전용 전환": { color: "#64748B", bg: "#FFFFFF" },
};

export default function OperatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, adminUser } = useAuth() as any;

  const [pool, setPool]       = useState<any>(null);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [logs, setLogs]       = useState<any[]>([]);
  const [policy, setPolicy]   = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tab,        setTab]        = useState<Tab>("기본정보");
  const [action,     setAction]     = useState<string | null>(null);
  const [reason,     setReason]     = useState("");
  const [processing, setProcessing] = useState(false);
  const [feedback,   setFeedback]   = useState("");
  const [otpVisible, setOtpVisible] = useState(false);

  const SENSITIVE_ACTIONS = ["approve", "reject", "restrict"];

  const load = useCallback(async (isRefresh = false) => {
    if (!id) return;
    if (!isRefresh) setLoading(true);
    try {
      const data = await apiRequest(token, `/super/operators/${id}`);
      setPool(data.pool ?? null);
      setTeachers(data.teachers ?? []);
      setLogs(data.logs ?? []);
      setPolicy(data.policy ?? {});
    } catch {
      setPool(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  async function doAction(act: string) {
    setProcessing(true);
    try {
      if (act === "approve") {
        await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" });
        setFeedback("운영 승인 완료");
      } else if (act === "reject") {
        await apiRequest(token, `/super/operators/${id}/reject`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || "기준 미달" }),
        });
        setFeedback("반려 처리 완료");
      } else if (act === "restrict") {
        await apiRequest(token, `/super/operators/${id}/restrict`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || "운영 위반" }),
        });
        setFeedback("일시 제한 처리 완료");
      }
      await load(true);
    } catch {
      Alert.alert("오류", "처리에 실패했습니다.");
    }
    setAction(null);
    setReason("");
    setTimeout(() => { setProcessing(false); setFeedback(""); }, 3000);
  }

  if (loading) {
    return (
      <SafeAreaView style={d.safe} edges={[]}>
        <SubScreenHeader title="운영자 상세" homePath="/(super)/pools" />
        <ActivityIndicator color={P} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!pool) {
    return (
      <SafeAreaView style={d.safe} edges={[]}>
        <SubScreenHeader title="운영자 상세" homePath="/(super)/pools" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#64748B", fontFamily: "Pretendard-Regular" }}>운영자 정보를 불러올 수 없습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const approvalCfg = APPROVAL_CFG[pool.approval_status] ?? APPROVAL_CFG.pending;
  const billingCfg  = BILLING_CFG[pool.subscription_status] ?? BILLING_CFG.trial;

  const usedBytes   = pool.used_storage_bytes ?? 0;
  const totalGb     = pool.total_storage_gb ?? (pool.base_storage_gb ?? 5);
  const usagePct    = pool.usage_pct ?? 0;
  const storageAlert = usagePct >= 95;
  const storageWarn  = usagePct >= 80 && usagePct < 95;

  const isPaymentIssue = pool.subscription_status === "expired" || pool.subscription_status === "suspended";
  const isSuspended    = pool.subscription_status === "suspended";

  return (
    <SafeAreaView style={d.safe} edges={[]}>
      <SubScreenHeader title={pool.name} homePath="/(super)/pools" />

      <View style={d.banner}>
        <View style={d.bannerLeft}>
          <Text style={d.bannerName} numberOfLines={1}>{pool.name}</Text>
          <Text style={d.bannerOwner}>{pool.owner_name ?? "—"}</Text>
        </View>
        <View style={[d.badge, { backgroundColor: approvalCfg.bg }]}>
          <Text style={[d.badgeTxt, { color: approvalCfg.color }]}>{approvalCfg.label}</Text>
        </View>
        <View style={[d.badge, { backgroundColor: billingCfg.bg }]}>
          <Text style={[d.badgeTxt, { color: billingCfg.color }]}>{billingCfg.label}</Text>
        </View>
      </View>

      {!!feedback && (
        <View style={d.feedbackBanner}>
          <CircleCheck size={14} color="#2EC4B6" />
          <Text style={d.feedbackTxt}>{feedback}</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={d.tabBar} contentContainerStyle={d.tabContent}>
        {TABS.map(t => (
          <Pressable key={t} style={[d.tab, tab === t && d.tabActive]} onPress={() => setTab(t)}>
            <Text style={[d.tabTxt, tab === t && d.tabActiveTxt]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(true); }} />}>

        {tab === "기본정보" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>운영 정보</Text>
              <InfoRow label="수영장명"    value={pool.name ?? "—"} />
              <InfoRow label="운영자"      value={pool.owner_name ?? "—"} />
              <InfoRow label="이메일"      value={pool.email ?? "—"} />
              <InfoRow label="전화번호"    value={pool.phone ?? "—"} />
              <InfoRow label="활성 회원"   value={`${pool.active_member_count ?? 0}명`} />
              <InfoRow label="전체 회원"   value={`${pool.total_member_count ?? 0}명`} />
              <InfoRow label="전체 수업"   value={`${pool.total_class_count ?? 0}개`} />
              <InfoRow label="가입일"      value={fmtDate(pool.created_at)} />
            </View>
            <View style={d.card}>
              <Text style={d.cardTitle}>상태 정보</Text>
              <InfoRow label="운영 상태"   value={approvalCfg.label} />
              <InfoRow label="읽기 전용"   value={pool.is_readonly ? "예" : "아니오"} alert={!!pool.is_readonly} />
              <InfoRow label="업로드 차단" value={pool.upload_blocked ? "차단됨" : "정상"} alert={!!pool.upload_blocked} />
            </View>
            {teachers.length > 0 && (
              <View style={d.card}>
                <Text style={d.cardTitle}>관리자·선생님 ({teachers.length}명)</Text>
                {teachers.map((t: any) => (
                  <View key={t.id} style={d.infoRow}>
                    <Text style={d.infoLabel}>{t.role === "pool_admin" ? "관리자" : "선생님"}</Text>
                    <Text style={d.infoVal}>{t.name} · {t.email ?? "—"}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {tab === "구독·결제" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>구독 정보</Text>
            <InfoRow label="현재 상태"    value={billingCfg.label} />
            <InfoRow label="구독 플랜"    value={TIER_NAME[pool.subscription_tier ?? "trial"] ?? (pool.subscription_tier ?? "—")} />
            <InfoRow label="크레딧"       value={`${pool.credit_balance ?? 0} 크레딧`} />
            <InfoRow label="구독 만료일"  value={fmtDate(pool.subscription_end_at)} />
            <InfoRow label="운영 유형"    value={pool.pool_type ?? "swimming_pool"} />
            {isPaymentIssue && (
              <View style={d.alertBox}>
                <TriangleAlert size={14} color="#D96C6C" />
                <Text style={d.alertTxt}>결제 이슈가 있는 운영자입니다. 강제조치 탭에서 처리할 수 있습니다.</Text>
              </View>
            )}
          </View>
        )}

        {tab === "저장공간" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>저장공간 현황</Text>
              <View style={d.storageCircleRow}>
                <View style={[d.storageCircle,
                  storageAlert && { borderColor: "#D96C6C" },
                  storageWarn && !storageAlert && { borderColor: "#E4A93A" }]}>
                  <Text style={[d.storageCircleNum, storageAlert && { color: "#D96C6C" }]}>{usagePct}%</Text>
                  <Text style={d.storageCircleSub}>사용</Text>
                </View>
                <View style={d.storageDetails}>
                  <InfoRow label="사용량"      value={fmtBytes(usedBytes)} />
                  <InfoRow label="전체 용량"   value={`${totalGb} GB`} />
                  <InfoRow label="기본 용량"   value={`${pool.base_storage_gb ?? 5} GB`} />
                  <InfoRow label="추가 용량"   value={`${pool.extra_storage_gb ?? 0} GB`} />
                  <InfoRow label="업로드 차단" value={pool.upload_blocked ? "차단됨" : "정상"} alert={!!pool.upload_blocked} />
                </View>
              </View>
              {storageAlert && (
                <View style={d.alertBox}>
                  <TriangleAlert size={14} color="#D96C6C" />
                  <Text style={d.alertTxt}>저장공간이 95% 이상 사용되었습니다.</Text>
                </View>
              )}
            </View>
            <Pressable style={[d.actionCard, { marginTop: 12 }]}
              onPress={() => router.push(`/(super)/storage?operatorId=${id}` as any)}>
              <HardDrive size={18} color={P} />
              <Text style={d.actionCardTxt}>추가 용량 부여</Text>
              <ChevronRight size={16} color="#64748B" style={{ marginLeft: "auto" }} />
            </Pressable>
          </>
        )}

        {tab === "정책·동의" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>약관 동의 현황</Text>
            <InfoRow label="환불 정책"     value={policy.refund_policy  ? "동의" : "미동의"} alert={!policy.refund_policy} />
            <InfoRow label="개인정보 처리" value={policy.privacy_policy ? "동의" : "미동의"} alert={!policy.privacy_policy} />
            <InfoRow label="이용약관"      value={policy.terms          ? "동의" : "미동의"} alert={!policy.terms} />
            {policy.refund_policy && (
              <InfoRow label="마지막 확인" value={fmtDate(policy.refund_policy)} />
            )}
            <Pressable style={[d.actionCard, { marginTop: 12 }]} onPress={() => router.push("/(super)/policy" as any)}>
              <FileText size={18} color={P} />
              <Text style={d.actionCardTxt}>정책 편집 (슈퍼관리자)</Text>
              <ChevronRight size={16} color="#64748B" style={{ marginLeft: "auto" }} />
            </Pressable>
          </View>
        )}

        {tab === "로그" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>운영 이벤트 로그 ({logs.length})</Text>
            {logs.length === 0 && <Text style={d.empty}>이벤트 로그가 없습니다</Text>}
            {logs.map((log: any) => {
              const catCfg = CAT_CFG[log.category] ?? { color: "#64748B", bg: "#FFFFFF" };
              return (
                <View key={log.id} style={d.logItem}>
                  <View style={[d.logCat, { backgroundColor: catCfg.bg }]}>
                    <Text style={[d.logCatTxt, { color: catCfg.color }]}>{log.category}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={d.logDesc}>{log.description ?? "—"}</Text>
                    <Text style={d.logTime}>{fmtDateTime(log.created_at)} · {log.actor_name ?? "시스템"}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {tab === "강제조치" && (
          <>
            {[
              ...(isSuspended || pool.approval_status === "rejected" ? [
                { act: "approve", icon: "check-circle" as const, label: "운영 재승인", sub: "운영 정지·반려 → 운영 상태로 복구", color: "#2EC4B6", bg: "#E6FFFA" },
              ] : []),
              { act: "reject",   icon: "x-circle" as const,     label: "반려",       sub: "운영 자격 박탈 · 사유 기록",   color: "#D96C6C", bg: "#F9DEDA" },
              { act: "restrict", icon: "pause-circle" as const,  label: "일시 제한",  sub: "구독 일시 정지 처리",           color: "#D97706", bg: "#FFF1BF" },
            ].map(item => (
              <Pressable key={item.act} style={d.forceCard} onPress={() => setAction(item.act)}>
                <View style={[d.forceIcon, { backgroundColor: item.bg }]}>
                  <LucideIcon name={item.icon} size={22} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={d.forceTxt}>{item.label}</Text>
                  <Text style={d.forceSub}>{item.sub}</Text>
                </View>
                <ChevronRight size={16} color="#D1D5DB" />
              </Pressable>
            ))}

            <View style={[d.card, { marginTop: 8 }]}>
              <Text style={d.cardTitle}>빠른 링크</Text>
              <Pressable style={d.quickLink} onPress={() => router.push("/(super)/kill-switch" as any)}>
                <TriangleAlert size={15} color="#D96C6C" />
                <Text style={[d.quickLinkTxt, { color: "#D96C6C" }]}>킬스위치 (데이터 삭제)</Text>
                <ChevronRight size={14} color="#64748B" style={{ marginLeft: "auto" }} />
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {action && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setAction(null)}>
          <Pressable style={m.backdrop} onPress={() => setAction(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>
                {action === "approve" ? "운영 재승인"
                  : action === "reject" ? "반려 처리"
                  : "일시 제한"}
              </Text>
              {(action === "reject" || action === "restrict") && (
                <TextInput style={m.input} value={reason} onChangeText={setReason}
                  placeholder="사유 (선택)" placeholderTextColor="#64748B" />
              )}
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setAction(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.confirmBtn, { opacity: processing ? 0.6 : 1 }]}
                  onPress={() => {
                    if (SENSITIVE_ACTIONS.includes(action!)) {
                      setOtpVisible(true);
                    } else {
                      doAction(action!);
                    }
                  }}
                  disabled={processing}>
                  {processing ? <ActivityIndicator color="#fff" size="small" />
                    : SENSITIVE_ACTIONS.includes(action!) ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Lock size={13} color="#fff" />
                        <Text style={m.confirmTxt}>OTP 인증 후 실행</Text>
                      </View>
                    ) : <Text style={m.confirmTxt}>확인</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <OtpGateModal
        visible={otpVisible}
        token={token}
        title={
          action === "approve" ? "운영 재승인 OTP 인증"
          : action === "reject" ? "반려 처리 OTP 인증"
          : "일시 제한 OTP 인증"
        }
        desc="운영자 자격·상태 강제 변경은 OTP 인증이 필요합니다."
        onSuccess={() => { setOtpVisible(false); doAction(action!); }}
        onCancel={() => setOtpVisible(false)}
      />
    </SafeAreaView>
  );
}

const d = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.background },
  banner:         { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                    borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  bannerLeft:     { flex: 1 },
  bannerName:     { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  bannerOwner:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeTxt:       { fontSize: 11, fontFamily: "Pretendard-Medium" },
  feedbackBanner: { flexDirection: "row", alignItems: "center", gap: 8,
                    backgroundColor: "#E6FFFA", paddingHorizontal: 16, paddingVertical: 8 },
  feedbackTxt:    { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#065F46" },
  tabBar:         { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:     { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:            { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                    borderWidth: 1.5, borderColor: "#E5E7EB" },
  tabActive:      { backgroundColor: P, borderColor: P },
  tabTxt:         { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B" },
  tabActiveTxt:   { color: "#fff" },
  card:           { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB", gap: 8 },
  cardTitle:      { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#0F172A", marginBottom: 4 },
  infoRow:        { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  infoLabel:      { width: 90, fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B" },
  infoVal:        { flex: 1, fontSize: 12, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  empty:          { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", paddingVertical: 12 },
  alertBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginTop: 4 },
  alertTxt:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Medium", color: "#D96C6C" },
  storageCircleRow:{ flexDirection: "row", alignItems: "flex-start", gap: 16 },
  storageCircle:  { width: 80, height: 80, borderRadius: 40, borderWidth: 5, borderColor: P,
                    alignItems: "center", justifyContent: "center" },
  storageCircleNum:{ fontSize: 18, fontFamily: "Pretendard-SemiBold", color: P },
  storageCircleSub:{ fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  storageDetails: { flex: 1, gap: 4 },
  actionCard:     { flexDirection: "row", alignItems: "center", gap: 12,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB" },
  actionCardTxt:  { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  forceCard:      { flexDirection: "row", alignItems: "center", gap: 14,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E5E7EB" },
  forceIcon:      { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  forceTxt:       { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  forceSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  quickLink:      { flexDirection: "row", alignItems: "center", gap: 10,
                    paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#FFFFFF" },
  quickLinkTxt:   { fontSize: 13, fontFamily: "Pretendard-Medium" },
  logItem:        { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  logCat:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 2 },
  logCatTxt:      { fontSize: 10, fontFamily: "Pretendard-Medium" },
  logDesc:        { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  logTime:        { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 16 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:      { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  cancelTxt:  { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  confirmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  confirmTxt: { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#fff" },
});
