/**
 * (super)/operator-detail.tsx — 운영처 상세 관리 콘솔
 * 기본정보 / X모드 / 구독·결제 / 저장공간 / 정책·동의 / 로그 / 강제조치
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {ActivityIndicator, Alert, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { useOperatorsStore } from "@/store/operatorsStore";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";

const TABS = ["기본정보", "X모드", "구독·결제", "저장공간", "정책·동의", "로그", "강제조치"] as const;
type Tab = typeof TABS[number];

const TIER_LABEL: Record<string, string> = {
  free:       "Free",
  starter:    "Coach30",
  basic:      "Coach50",
  standard:   "Coach100",
  center_200: "Premier200",
  advance:    "Premier300",
  pro:        "Premier500",
  max:        "Premier1000",
  trial:      "무료 체험",
};
const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: "체험 중",   color: P,         bg: "#EEDDF5" },
  active:    { label: "구독 중",   color: C.brandStrong, bg: C.brandSoft },
  expired:   { label: "만료됨",    color: "#D96C6C", bg: "#F9DEDA" },
  suspended: { label: "일시 정지", color: "#D97706", bg: "#FFF1BF" },
  cancelled: { label: "해지됨",    color: C.textSecondary, bg: C.backgroundSoft },
  payment_failed: { label: "결제 실패", color: "#D96C6C", bg: "#F9DEDA" },
};
const APPROVAL_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "대기",    color: "#D97706", bg: "#FFF1BF" },
  approved: { label: "운영",    color: C.brandStrong, bg: C.brandSoft },
  rejected: { label: "반려",    color: "#D96C6C", bg: "#F9DEDA" },
};
const CAT_CFG: Record<string, { color: string; bg: string }> = {
  권한:         { color: "#D97706", bg: "#FFF1BF" },
  구독:         { color: P,         bg: "#EEDDF5" },
  저장공간:     { color: C.brandStrong, bg: C.brandSoft },
  삭제:         { color: "#D96C6C", bg: "#F9DEDA" },
  정책:         { color: C.brandStrong, bg: C.brandSoft },
  결제:         { color: C.brandStrong, bg: "#ECFEFF" },
  "읽기전용 전환": { color: C.textSecondary, bg: C.backgroundSoft },
};
const ROLE_LABEL: Record<string, string> = {
  pool_admin: "대표관리자", sub_admin: "관리자", teacher: "선생님",
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

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={d.statBox}>
      <Text style={[d.statNum, color ? { color } : {}]}>{value}</Text>
      <Text style={d.statLabel}>{label}</Text>
    </View>
  );
}

export default function OperatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth() as any;
  const removeOperator = useOperatorsStore(s => s.removeOperator);

  const [pool,     setPool]     = useState<any>(null);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [logs,     setLogs]     = useState<any[]>([]);
  const [policy,   setPolicy]   = useState<any>({});
  const [support,  setSupport]  = useState<any>({ total_count: 0, open_count: 0, resolved_count: 0 });
  const [plans,    setPlans]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tab,        setTab]        = useState<Tab>("기본정보");
  const [action,     setAction]     = useState<string | null>(null);
  const [reason,     setReason]     = useState("");
  const [processing, setProcessing] = useState(false);
  const [feedback,   setFeedback]   = useState("");
  const [otpVisible, setOtpVisible] = useState(false);
  const [pendingOtpAction, setPendingOtpAction] = useState<string | null>(null);

  // 구독 조정 모달
  const [subModal,   setSubModal]   = useState(false);
  const [subStatus,  setSubStatus]  = useState("");
  const [subTier,    setSubTier]    = useState("");
  const [subEndAt,   setSubEndAt]   = useState("");
  const [subCredit,  setSubCredit]  = useState("");
  const [subMemberLimit, setSubMemberLimit] = useState("");
  const [subSaving,  setSubSaving]  = useState(false);

  // 삭제 확인 모달
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  // X 사용권 수동 제어
  const [xmodeLoading, setXmodeLoading] = useState(false);

  // X 설정 심사 승인
  const [configLoading, setConfigLoading] = useState(false);

  const SENSITIVE_ACTIONS = ["approve", "reject", "restrict"];

  const load = useCallback(async (isRefresh = false) => {
    if (!id) return;
    if (!isRefresh) setLoading(true);
    try {
      const res  = await apiRequest(token, `/super/operators/${id}`);
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { console.error("[operator-detail] JSON 파싱 실패:", text.slice(0, 200)); }
      if (!res.ok) {
        console.error(`[operator-detail] API 오류 ${res.status}:`, data?.error, data?.detail);
        setPool(null);
        return;
      }
      setPool(data.pool ?? null);
      setTeachers(data.teachers ?? []);
      setLogs(data.logs ?? []);
      setPolicy(data.policy ?? {});
      setSupport(data.support ?? { total_count: 0, open_count: 0, resolved_count: 0 });
      setPlans(data.plans ?? []);
    } catch (e: any) {
      console.error("[operator-detail] 네트워크 오류:", e?.message);
      setPool(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  // 화면 포커스 복귀 시 자동 재조회 (구독 변경 등 다른 화면에서 돌아왔을 때 반영)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function doAction(act: string) {
    setProcessing(true);
    try {
      if (act === "approve") {
        await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" });
        setFeedback("운영 재승인 완료");
      } else if (act === "reject") {
        await apiRequest(token, `/super/operators/${id}/reject`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || "기준 미달" }),
        });
        setFeedback("반려 처리 완료");
      } else if (act === "restrict") {
        await apiRequest(token, `/super/operators/${id}/restrict`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || "운영 위반" }),
        });
        setFeedback("일시 제한 완료");
      }
      await load(true);
    } catch {
      Alert.alert("오류", "처리에 실패했습니다.");
    }
    setAction(null);
    setReason("");
    setTimeout(() => { setProcessing(false); setFeedback(""); }, 3000);
  }

  async function doConfigStatusChange(nextStatus: "READY" | "CURRICULUM_PENDING") {
    if (configLoading) return;
    const isApprove = nextStatus === "READY";
    const title   = isApprove ? "X MODE 설정을 승인할까요?" : "심사 상태로 되돌릴까요?";
    const message = isApprove
      ? "이 운영처의 X MODE 설정 상태를 READY로 변경합니다.\nX 사용권이 활성 상태라면 즉시 X MODE가 활성화됩니다."
      : "설정 상태를 심사 중(CURRICULUM_PENDING)으로 되돌립니다.\nX MODE는 다시 심사 대기 상태가 됩니다.";
    Alert.alert(title, message, [
      { text: "취소", style: "cancel" },
      {
        text: isApprove ? "승인" : "확인",
        onPress: async () => {
          setConfigLoading(true);
          try {
            const res = await apiRequest(token, `/super/operators/${id}/xmode`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ xmode_config_status: nextStatus }),
            });
            const d = await res.json();
            if (d.ok) {
              await load(true);
            } else {
              Alert.alert("오류", "설정 상태 변경에 실패했습니다.\n잠시 후 다시 시도해주세요.");
              console.warn("[xmode config]", id, res.status, d.error);
            }
          } catch (e: any) {
            Alert.alert("오류", "설정 상태 변경에 실패했습니다.\n잠시 후 다시 시도해주세요.");
            console.warn("[xmode config]", id, e?.message);
          }
          setConfigLoading(false);
        },
      },
    ]);
  }

  async function doXmodeToggle(activate: boolean) {
    if (xmodeLoading) return;
    const title   = activate ? "X 사용권을 활성화할까요?" : "X 사용권을 비활성화할까요?";
    const message = activate
      ? "결제 없이 이 운영처에\nSWIMNOTE X 사용권이 부여됩니다."
      : "이 운영처의 SWIMNOTE X 사용 권한이 회수됩니다.\n운영 데이터는 삭제되지 않습니다.";
    Alert.alert(title, message, [
      { text: "취소", style: "cancel" },
      {
        text: "확인",
        onPress: async () => {
          setXmodeLoading(true);
          try {
            const res = await apiRequest(token, `/super/operators/${id}/xmode`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ xmode_entitlement: activate }),
            });
            const d = await res.json();
            if (d.ok) {
              await load(true);
            } else {
              Alert.alert("오류", "X 사용권 변경에 실패했습니다.\n잠시 후 다시 시도해주세요.");
              console.warn("[xmode]", id, res.status, d.error);
            }
          } catch (e: any) {
            Alert.alert("오류", "X 사용권 변경에 실패했습니다.\n잠시 후 다시 시도해주세요.");
            console.warn("[xmode]", id, e?.message);
          }
          setXmodeLoading(false);
        },
      },
    ]);
  }

  async function saveSubscription() {
    const body: any = {};
    if (subStatus)  body.subscription_status  = subStatus;
    if (subTier)    body.subscription_tier     = subTier;
    if (subCredit !== "") body.credit_amount   = Number(subCredit);
    if (subEndAt)   body.subscription_end_at   = subEndAt;
    if (subMemberLimit !== "") body.member_limit = Number(subMemberLimit);

    if (Object.keys(body).length === 0) {
      Alert.alert("알림", "변경할 항목을 입력해주세요."); return;
    }
    setSubSaving(true);
    try {
      const res = await apiRequest(token, `/super/operators/${id}/subscription`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok) {
        setFeedback("구독 정보 업데이트 완료");
        setSubModal(false);
        setSubStatus(""); setSubTier(""); setSubEndAt("");
        setSubCredit(""); setSubMemberLimit("");
        setTimeout(() => setFeedback(""), 3000);
        await load(true);
      } else {
        Alert.alert("오류", d.error ?? "업데이트 실패");
      }
    } catch {
      Alert.alert("오류", "서버 오류가 발생했습니다.");
    }
    setSubSaving(false);
  }

  async function doDelete() {
    setDeleting(true);
    try {
      const res  = await apiRequest(token, `/super/operators/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        removeOperator(id);
        setDeleteModal(false);
        Alert.alert("삭제 완료", data.message ?? "운영처가 삭제되었습니다.", [
          { text: "확인", onPress: () => router.replace("/(super)/pools" as any) },
        ]);
      } else {
        Alert.alert("삭제 실패", data.error ?? "오류가 발생했습니다.");
      }
    } catch {
      Alert.alert("오류", "서버 오류가 발생했습니다.");
    }
    setDeleting(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={d.safe} edges={[]}>
        <SubScreenHeader title="운영처 상세" homePath="/(super)/pools" />
        <ActivityIndicator color={P} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!pool) {
    return (
      <SafeAreaView style={d.safe} edges={[]}>
        <SubScreenHeader title="운영처 상세" homePath="/(super)/pools" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: C.textSecondary, fontFamily: "Pretendard-Regular" }}>수영장 정보를 불러올 수 없습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const approvalCfg = APPROVAL_CFG[pool.approval_status] ?? APPROVAL_CFG.pending;
  const billingCfg  = STATUS_CFG[pool.subscription_status]  ?? STATUS_CFG.trial;
  const usedBytes   = pool.used_storage_bytes ?? 0;
  const storageMb   = pool.storage_mb ?? 512;
  const totalGb     = storageMb / 1024;
  const usagePct    = pool.usage_pct ??
    (usedBytes > 0 ? Math.min(Math.round(usedBytes / (storageMb * 1048576) * 100), 100) : 0);
  const storageAlert = usagePct >= 95;
  const storageWarn  = usagePct >= 80 && usagePct < 95;
  const isPaymentIssue = ["expired", "suspended", "payment_failed"].includes(pool.subscription_status ?? "");
  const teacherCount = pool.teacher_count ?? teachers.filter((t:any) => t.role === "teacher").length;
  const memberCount  = pool.active_member_count ?? 0;
  const memberTotal  = pool.total_member_count ?? 0;

  return (
    <SafeAreaView style={d.safe} edges={[]}>
      <SubScreenHeader title={pool.name} homePath="/(super)/pools" />

      {/* 상단 배너 */}
      <View style={d.banner}>
        <View style={d.bannerLeft}>
          <Text style={d.bannerName} numberOfLines={1}>{pool.name}</Text>
          <Text style={d.bannerOwner}>{pool.owner_name ?? "—"} · {fmtDate(pool.created_at)} 가입</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={[d.badge, { backgroundColor: approvalCfg.bg }]}>
            <Text style={[d.badgeTxt, { color: approvalCfg.color }]}>{approvalCfg.label}</Text>
          </View>
          <View style={[d.badge, { backgroundColor: billingCfg.bg }]}>
            <Text style={[d.badgeTxt, { color: billingCfg.color }]}>{billingCfg.label}</Text>
          </View>
        </View>
      </View>

      {/* 핵심 통계 박스 */}
      <View style={d.statsRow}>
        <StatBox label="활성회원" value={memberCount} color={C.textPrimary} />
        <View style={d.statDivider} />
        <StatBox label="전체회원" value={memberTotal} color={C.textPrimary} />
        <View style={d.statDivider} />
        <StatBox label="선생님" value={teacherCount} color={P} />
        <View style={d.statDivider} />
        <StatBox label="수업" value={pool.total_class_count ?? 0} />
        <View style={d.statDivider} />
        <StatBox label="고객센터" value={support.open_count > 0 ? `${support.open_count}건` : "0"} color={support.open_count > 0 ? "#D97706" : C.textSecondary} />
      </View>

      {!!feedback && (
        <View style={d.feedbackBanner}>
          <LucideIcon name="check-circle" size={14} color={C.brandStrong} />
          <Text style={d.feedbackTxt}>{feedback}</Text>
        </View>
      )}

      {/* 탭 바 */}
      <KeyboardAwareScrollView horizontal showsHorizontalScrollIndicator={false}
        style={d.tabBar} contentContainerStyle={d.tabContent}>
        {TABS.map(t => (
          <Pressable key={t} style={[d.tab, tab === t && d.tabActive]} onPress={() => setTab(t)}>
            <Text style={[d.tabTxt, tab === t && d.tabActiveTxt]}>{t}</Text>
          </Pressable>
        ))}
      </KeyboardAwareScrollView>

      <KeyboardAwareScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(true); }} />}>

        {/* ── 기본정보 탭 ── */}
        {tab === "기본정보" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>운영처 정보</Text>
              <InfoRow label="운영처명"  value={pool.name ?? "—"} />
              <InfoRow label="주소"      value={pool.address ?? "—"} />
              <InfoRow label="전화번호"  value={pool.phone ?? "—"} />
              <InfoRow label="운영 유형" value={pool.pool_type ?? "swimming_pool"} />
              <InfoRow label="영문 명칭" value={pool.name_en ?? "—"} />
            </View>

            <View style={d.card}>
              <Text style={d.cardTitle}>운영자 정보</Text>
              <InfoRow label="대표자"      value={pool.owner_name ?? "—"} />
              <InfoRow label="대표 이메일" value={pool.owner_email ?? pool.admin_email ?? "—"} />
              <InfoRow label="관리자명"    value={pool.admin_name ?? "—"} />
              <InfoRow label="관리자 전화" value={pool.admin_phone ?? "—"} />
              <InfoRow label="가입일"      value={fmtDate(pool.created_at)} />
            </View>

            <View style={d.card}>
              <Text style={d.cardTitle}>운영 현황</Text>
              <InfoRow label="활성 회원"   value={`${memberCount}명`} />
              <InfoRow label="전체 회원"   value={`${memberTotal}명`} />
              <InfoRow label="선생님"      value={`${teacherCount}명`} />
              <InfoRow label="전체 스태프" value={`${pool.staff_count ?? 0}명`} />
              <InfoRow label="전체 수업"   value={`${pool.total_class_count ?? 0}개`} />
              <InfoRow label="운영 상태"   value={approvalCfg.label} />
              <InfoRow label="읽기 전용"   value={pool.is_readonly ? "예" : "아니오"} alert={!!pool.is_readonly} />
              <InfoRow label="업로드 차단" value={pool.upload_blocked ? "차단됨" : "정상"} alert={!!pool.upload_blocked} />
            </View>

            {/* 스태프 목록 */}
            {teachers.length > 0 && (
              <View style={d.card}>
                <Text style={d.cardTitle}>스태프 ({teachers.length}명)</Text>
                {teachers.map((t: any) => (
                  <View key={t.id} style={[d.infoRow, { alignItems: "flex-start" }]}>
                    <Text style={[d.infoLabel, { width: 80, paddingTop: 2 }]}>{ROLE_LABEL[t.role] ?? t.role}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={d.infoVal}>{t.name}</Text>
                      <Text style={{ fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular" }}>
                        {t.email ?? "—"}{t.phone ? ` · ${t.phone}` : ""}
                      </Text>
                      <Text style={{ fontSize: 10, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>
                        최근 접속: {fmtDate(t.last_login_at)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* 고객센터 요약 */}
            <View style={d.card}>
              <Text style={d.cardTitle}>고객센터</Text>
              <InfoRow label="전체 문의"   value={`${support.total_count}건`} />
              <InfoRow label="미처리"      value={`${support.open_count}건`} alert={support.open_count > 0} />
              <InfoRow label="처리 완료"   value={`${support.resolved_count}건`} />
              {support.open_count > 0 && (
                <Pressable style={[d.actionCard, { marginTop: 8 }]}
                  onPress={() => router.push("/(super)/support?backTo=operator-detail" as any)}>
                  <Text style={[d.actionCardTxt, { color: "#D97706" }]}>미처리 문의 확인 →</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {/* ── X모드 탭 ── */}
        {tab === "X모드" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>SWIMNOTE X 상태</Text>

              {/* X 사용권 활성 여부 */}
              <View style={[d.infoRow, { alignItems: "center" }]}>
                <Text style={d.infoLabel}>X 사용권</Text>
                <View style={{
                  paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
                  backgroundColor: pool.xmode_entitlement ? C.brandSoft : C.backgroundSoft,
                }}>
                  <Text style={{
                    fontSize: 12, fontFamily: "Pretendard-Regular",
                    color: pool.xmode_entitlement ? C.brandStrong : C.textSecondary,
                  }}>
                    {pool.xmode_entitlement ? "X 활성" : "X 비활성"}
                  </Text>
                </View>
              </View>

              {/* 설정 상태 */}
              <View style={[d.infoRow, { alignItems: "center" }]}>
                <Text style={d.infoLabel}>설정 상태</Text>
                {(() => {
                  const cs: string = (pool.xmode_config_status as string) ?? "NOT_CONFIGURED";
                  const cfgMap: Record<string, { label: string; color: string; bg: string }> = {
                    NOT_CONFIGURED:     { label: "미설정",  color: C.textSecondary, bg: C.backgroundSoft },
                    CURRICULUM_PENDING: { label: "심사 중", color: "#D97706", bg: "#FFF1BF" },
                    READY:              { label: "승인 완료", color: C.brandStrong, bg: C.brandSoft },
                  };
                  const cfg = cfgMap[cs] ?? cfgMap.NOT_CONFIGURED;
                  return (
                    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, backgroundColor: cfg.bg }}>
                      <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: cfg.color }}>
                        {cfg.label}
                      </Text>
                    </View>
                  );
                })()}
              </View>

              <InfoRow label="구독 시작일" value={fmtDate(pool.xmode_purchased_at)} />
              <InfoRow label="구독 만료일" value={fmtDate(pool.xmode_subscription_end_at)} />
            </View>

            {/* X 설정 심사 */}
            <View style={d.card}>
              <Text style={d.cardTitle}>X 설정 심사</Text>
              {(() => {
                const cs: string = (pool.xmode_config_status as string) ?? "NOT_CONFIGURED";
                const isReady = cs === "READY";
                const canReview = cs === "CURRICULUM_PENDING";
                return (
                  <>
                    {!isReady && (
                      <>
                        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18, marginBottom: 14 }}>
                          {"설정 심사를 통과한 운영처에 승인을 부여합니다.\n승인 시 X 사용권이 활성이면 즉시 X MODE가 시작됩니다."}
                        </Text>
                        <Pressable
                          disabled={configLoading}
                          onPress={() => doConfigStatusChange("READY")}
                          style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "center",
                            paddingVertical: 10, borderRadius: 10,
                            backgroundColor: configLoading ? C.backgroundSoft : "#EDE9FE",
                            borderWidth: 1, borderColor: configLoading ? C.border : "#7C3AED",
                            opacity: configLoading ? 0.6 : 1,
                          }}
                        >
                          {configLoading
                            ? <ActivityIndicator size="small" color={C.textMuted} />
                            : <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#7C3AED" }}>X 설정 승인</Text>
                          }
                        </Pressable>
                      </>
                    )}
                    {isReady && (
                      <>
                        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18, marginBottom: 14 }}>
                          {"현재 승인 완료 상태입니다.\n설정을 재검토가 필요한 경우 심사 상태로 되돌릴 수 있습니다."}
                        </Text>
                        <Pressable
                          disabled={configLoading}
                          onPress={() => doConfigStatusChange("CURRICULUM_PENDING")}
                          style={{
                            flexDirection: "row", alignItems: "center", justifyContent: "center",
                            paddingVertical: 10, borderRadius: 10,
                            backgroundColor: configLoading ? C.backgroundSoft : "#FFF9EC",
                            borderWidth: 1, borderColor: configLoading ? C.border : "#D97706",
                            opacity: configLoading ? 0.6 : 1,
                          }}
                        >
                          {configLoading
                            ? <ActivityIndicator size="small" color={C.textMuted} />
                            : <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#D97706" }}>심사 상태로 되돌리기</Text>
                          }
                        </Pressable>
                      </>
                    )}
                  </>
                );
              })()}
            </View>

            {/* X 사용권 수동 제어 */}
            <View style={d.card}>
              <Text style={d.cardTitle}>X 사용권 수동 제어</Text>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18, marginBottom: 6 }}>
                {"결제 여부와 관계없이 이 운영처에\nSWIMNOTE X 사용권을 직접 부여하거나 회수합니다."}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, lineHeight: 17, marginBottom: 14 }}>
                {"사용권이 활성화되어도 설정 상태가 READY가 아니면\nX모드는 심사 대기 상태로 유지됩니다."}
              </Text>
              {pool.xmode_entitlement ? (
                <Pressable
                  disabled={xmodeLoading}
                  onPress={() => doXmodeToggle(false)}
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "center",
                    paddingVertical: 10, borderRadius: 10,
                    backgroundColor: xmodeLoading ? C.backgroundSoft : "#FFF5F5",
                    borderWidth: 1, borderColor: xmodeLoading ? C.border : "#FCA5A5",
                    opacity: xmodeLoading ? 0.6 : 1,
                  }}
                >
                  {xmodeLoading
                    ? <ActivityIndicator size="small" color={C.textMuted} />
                    : <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#D96C6C" }}>X 사용권 비활성화</Text>
                  }
                </Pressable>
              ) : (
                <Pressable
                  disabled={xmodeLoading}
                  onPress={() => doXmodeToggle(true)}
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "center",
                    paddingVertical: 10, borderRadius: 10,
                    backgroundColor: xmodeLoading ? C.backgroundSoft : "#7C3AED",
                    borderWidth: 1, borderColor: xmodeLoading ? C.border : "#6D28D9",
                    opacity: xmodeLoading ? 0.6 : 1,
                  }}
                >
                  {xmodeLoading
                    ? <ActivityIndicator size="small" color={C.textMuted} />
                    : <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.brandStrong }}>X 사용권 활성화</Text>
                  }
                </Pressable>
              )}
            </View>
          </>
        )}

        {/* ── 구독·결제 탭 ── */}
        {tab === "구독·결제" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>현재 구독 정보</Text>
              <InfoRow label="구독 상태"   value={billingCfg.label} />
              <InfoRow label="구독 플랜"   value={pool.plan_name ?? pool.subscription_tier ?? "—"} />
              <InfoRow label="회원 한도"   value={
                pool.member_limit != null
                  ? `${pool.member_limit}명`
                  : "—"
              } />
              <InfoRow label="스토리지"    value={pool.display_storage ?? "—"} />
              <InfoRow label="크레딧 잔액" value={`${(pool.credit_balance ?? 0).toLocaleString()}원`} />
              <InfoRow label="구독 시작일" value={fmtDate(pool.subscription_start_at ?? pool.created_at)} />
              <InfoRow label="구독 만료일" value={pool.subscription_end_at ? fmtDate(pool.subscription_end_at) : "—"} />
              <InfoRow label="체험 종료일" value={fmtDate(pool.trial_end_at)} />
              <InfoRow label="결제 플랫폼" value={pool.payment_platform ?? "—"} />
              {isPaymentIssue && (
                <View style={d.alertBox}>
                  <LucideIcon name="alert-triangle" size={14} color="#D96C6C" />
                  <Text style={d.alertTxt}>결제 이슈가 있습니다. 아래 구독 조정 버튼으로 직접 처리할 수 있습니다.</Text>
                </View>
              )}
            </View>

            {/* 구독 직접 조정 */}
            <Pressable style={d.primaryBtn} onPress={() => {
              setSubStatus(pool.subscription_status ?? "");
              setSubTier(pool.subscription_tier ?? "");
              setSubModal(true);
            }}>
              <LucideIcon name="credit-card" size={18} color="#fff" />
              <Text style={d.primaryBtnTxt}>구독 직접 조정</Text>
            </Pressable>

            {/* 구독 플랜 목록 참고 */}
            {plans.length > 0 && (
              <View style={d.card}>
                <Text style={d.cardTitle}>이용 가능한 플랜</Text>
                {plans.map((p: any) => (
                  <View key={p.plan_id} style={d.infoRow}>
                    <Text style={d.infoLabel}>{p.name ?? p.plan_id}</Text>
                    <Text style={d.infoVal}>{p.price === 0 ? "무료" : `₩${p.price.toLocaleString()}/월`} · 회원 {p.member_limit}명</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── 저장공간 탭 ── */}
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
                  <InfoRow label="전체 용량"   value={pool.display_storage ?? `${totalGb.toFixed(1)} GB`} />
                  <InfoRow label="사용률"      value={`${usagePct}%`} />
                  <InfoRow label="업로드 차단" value={pool.upload_blocked ? "차단됨" : "정상"} alert={!!pool.upload_blocked} />
                </View>
              </View>
              {storageAlert && (
                <View style={d.alertBox}>
                  <LucideIcon name="alert-triangle" size={14} color="#D96C6C" />
                  <Text style={d.alertTxt}>저장공간이 95% 이상 사용되었습니다.</Text>
                </View>
              )}
            </View>
            <Pressable style={d.actionCard} onPress={() => router.push(`/(super)/storage?operatorId=${id}&backTo=operator-detail` as any)}>
              <LucideIcon name="hard-drive" size={18} color={P} />
              <Text style={d.actionCardTxt}>추가 용량 부여</Text>
              <LucideIcon name="chevron-right" size={16} color={C.textSecondary} style={{ marginLeft: "auto" }} />
            </Pressable>
          </>
        )}

        {/* ── 정책·동의 탭 ── */}
        {tab === "정책·동의" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>약관 동의 현황</Text>
            <InfoRow label="환불 정책"     value={policy.refund_policy  ? "동의" : "미동의"} alert={!policy.refund_policy} />
            {policy.refund_policy && <InfoRow label="환불 동의일" value={fmtDate(policy.refund_policy)} />}
            <InfoRow label="개인정보 처리" value={policy.privacy_policy ? "동의" : "미동의"} alert={!policy.privacy_policy} />
            {policy.privacy_policy && <InfoRow label="개인정보 동의일" value={fmtDate(policy.privacy_policy)} />}
            <InfoRow label="이용약관"      value={policy.terms          ? "동의" : "미동의"} alert={!policy.terms} />
            {policy.terms && <InfoRow label="약관 동의일" value={fmtDate(policy.terms)} />}
            <Pressable style={[d.actionCard, { marginTop: 8 }]}
              onPress={() => router.push("/(super)/policy?backTo=operator-detail" as any)}>
              <LucideIcon name="file-text" size={18} color={P} />
              <Text style={d.actionCardTxt}>정책 편집</Text>
              <LucideIcon name="chevron-right" size={16} color={C.textSecondary} style={{ marginLeft: "auto" }} />
            </Pressable>
          </View>
        )}

        {/* ── 로그 탭 ── */}
        {tab === "로그" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>운영 이벤트 로그 ({logs.length})</Text>
            {logs.length === 0 && <Text style={d.empty}>이벤트 로그가 없습니다</Text>}
            {logs.map((log: any) => {
              const catCfg = CAT_CFG[log.category] ?? { color: C.textSecondary, bg: C.backgroundSoft };
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

        {/* ── 강제조치 탭 ── */}
        {tab === "강제조치" && (
          <>
            {[
              ...((pool.approval_status === "rejected" || pool.subscription_status === "suspended") ? [
                { act: "approve", icon: "check-circle" as const, label: "운영 재승인", sub: "정지·반려 → 운영 상태로 복구", color: C.brandStrong, bg: C.brandSoft },
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
                <LucideIcon name="chevron-right" size={16} color="#D1D5DB" />
              </Pressable>
            ))}

            <View style={d.card}>
              <Text style={d.cardTitle}>빠른 링크</Text>
              <Pressable style={d.quickLink} onPress={() => router.push("/(super)/kill-switch?backTo=operator-detail" as any)}>
                <LucideIcon name="alert-triangle" size={15} color="#D96C6C" />
                <Text style={[d.quickLinkTxt, { color: "#D96C6C" }]}>킬스위치 (데이터 삭제)</Text>
                <LucideIcon name="chevron-right" size={14} color={C.textSecondary} style={{ marginLeft: "auto" }} />
              </Pressable>
              <Pressable style={d.quickLink} onPress={() => router.push(`/(super)/storage?operatorId=${id}&backTo=operator-detail` as any)}>
                <LucideIcon name="hard-drive" size={15} color={P} />
                <Text style={[d.quickLinkTxt, { color: P }]}>저장공간 조정</Text>
                <LucideIcon name="chevron-right" size={14} color={C.textSecondary} style={{ marginLeft: "auto" }} />
              </Pressable>
            </View>

            {/* 운영처 완전 삭제 */}
            <View style={[d.card, { borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" }]}>
              <Text style={[d.cardTitle, { color: "#D96C6C" }]}>위험 구역</Text>
              <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular", marginBottom: 8 }}>
                운영처를 완전히 삭제합니다. 회원, 수업, 출결, 스태프 등 모든 데이터가 영구 삭제되며 복구할 수 없습니다.
              </Text>
              <Pressable style={d.deleteBtn} onPress={() => setDeleteModal(true)}>
                <LucideIcon name="trash-2" size={16} color="#fff" />
                <Text style={d.deleteBtnTxt}>운영처 완전 삭제</Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAwareScrollView>

      {/* ─────── 강제조치 확인 모달 ─────── */}
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
                  placeholder="사유 (선택)" placeholderTextColor={C.textMuted} />
              )}
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setAction(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.confirmBtn, { opacity: processing ? 0.6 : 1 }]}
                  disabled={processing}
                  onPress={() => {
                    if (SENSITIVE_ACTIONS.includes(action!)) {
                      setPendingOtpAction(action);
                      setOtpVisible(true);
                    } else {
                      doAction(action!);
                    }
                  }}>
                  {processing ? <ActivityIndicator color="#fff" size="small" />
                    : SENSITIVE_ACTIONS.includes(action!) ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <LucideIcon name="lock" size={13} color="#fff" />
                        <Text style={m.confirmTxt}>OTP 인증 후 실행</Text>
                      </View>
                    ) : <Text style={m.confirmTxt}>확인</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* ─────── 구독 조정 모달 ─────── */}
      <Modal visible={subModal} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setSubModal(false)}>
        <Pressable style={m.backdrop} onPress={() => setSubModal(false)}>
          <Pressable style={[m.sheet, { maxHeight: "85%" }]} onPress={() => {}}>
            <KeyboardAwareScrollView showsVerticalScrollIndicator={false}>
              <View style={m.handle} />
              <Text style={m.title}>구독 직접 조정</Text>
              <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular", marginBottom: 12 }}>
                {pool.name} — 빈 칸은 변경하지 않습니다.
              </Text>

              <Text style={m.fieldLabel}>구독 상태</Text>
              <View style={m.pickerRow}>
                {["trial","active","expired","suspended","cancelled","payment_failed"].map(s => (
                  <Pressable key={s} style={[m.chip, subStatus === s && m.chipActive]}
                    onPress={() => setSubStatus(subStatus === s ? "" : s)}>
                    <Text style={[m.chipTxt, subStatus === s && m.chipActiveTxt]}>
                      {STATUS_CFG[s]?.label ?? s}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={m.fieldLabel}>구독 티어</Text>
              <View style={m.pickerRow}>
                {["free","starter","basic","standard","center_200","advance","pro","max","trial"].map(t => (
                  <Pressable key={t} style={[m.chip, subTier === t && m.chipActive]}
                    onPress={() => setSubTier(subTier === t ? "" : t)}>
                    <Text style={[m.chipTxt, subTier === t && m.chipActiveTxt]}>
                      {TIER_LABEL[t] ?? t}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={m.fieldLabel}>구독 만료일 (빈칸=변경 없음, "null"=삭제)</Text>
              <TextInput style={m.input} value={subEndAt} onChangeText={setSubEndAt}
                placeholder="예: 2026-12-31T23:59:59Z" placeholderTextColor={C.textMuted}
                autoCapitalize="none" />

              <Text style={m.fieldLabel}>크레딧 잔액 (원)</Text>
              <TextInput style={m.input} value={subCredit} onChangeText={setSubCredit}
                placeholder="예: 50000" placeholderTextColor={C.textMuted} keyboardType="numeric" />

              <Text style={m.fieldLabel}>회원 한도 (명)</Text>
              <TextInput style={m.input} value={subMemberLimit} onChangeText={setSubMemberLimit}
                placeholder="예: 50" placeholderTextColor={C.textMuted} keyboardType="numeric" />

              <View style={[m.btnRow, { marginTop: 8 }]}>
                <Pressable style={m.cancelBtn} onPress={() => setSubModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.confirmBtn, { opacity: subSaving ? 0.6 : 1 }]}
                  onPress={saveSubscription} disabled={subSaving}>
                  {subSaving ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.confirmTxt}>저장</Text>}
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─────── 운영처 삭제 확인 모달 ─────── */}
      <Modal visible={deleteModal} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setDeleteModal(false)}>
        <Pressable style={m.backdrop} onPress={() => !deleting && setDeleteModal(false)}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <LucideIcon name="trash-2" size={20} color="#D96C6C" />
              <Text style={[m.title, { color: "#D96C6C" }]}>운영처 완전 삭제</Text>
            </View>
            <View style={{ backgroundColor: "#FFF5F5", borderRadius: 10, padding: 14, marginBottom: 16, gap: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#B91C1C" }}>⚠ 이 작업은 되돌릴 수 없습니다</Text>
              <Text style={{ fontSize: 13, color: C.textSecondary, fontFamily: "Pretendard-Regular", lineHeight: 20 }}>
                {`· 운영처: `}<Text style={{ fontWeight: "700", color: C.textPrimary }}>{pool.name}</Text>{`\n· 회원, 수업, 출결, 선생님 등 모든 데이터 영구 삭제\n· 삭제 후 복구 불가`}
              </Text>
            </View>
            <Text style={{ fontSize: 13, color: C.textPrimary, fontFamily: "Pretendard-SemiBold", marginBottom: 16 }}>
              정말로 이 운영처를 삭제하시겠습니까?
            </Text>
            <View style={m.btnRow}>
              <Pressable style={m.cancelBtn} onPress={() => setDeleteModal(false)} disabled={deleting}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable
                style={[m.confirmBtn, { backgroundColor: "#D96C6C", opacity: deleting ? 0.6 : 1 }]}
                onPress={doDelete}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={m.confirmTxt}>삭제 확인</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <OtpGateModal
        visible={otpVisible}
        token={token}
        title={
          pendingOtpAction === "approve" ? "운영 재승인 OTP 인증"
          : pendingOtpAction === "reject" ? "반려 처리 OTP 인증"
          : "일시 제한 OTP 인증"
        }
        desc="운영자 자격·상태 강제 변경은 OTP 인증이 필요합니다."
        onSuccess={() => { setOtpVisible(false); if (pendingOtpAction) doAction(pendingOtpAction); }}
        onCancel={() => setOtpVisible(false)}
      />
    </SafeAreaView>
  );
}

const d = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.background },
  banner:         { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                    borderBottomWidth: 1, borderBottomColor: C.border },
  bannerLeft:     { flex: 1 },
  bannerName:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  bannerOwner:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeTxt:       { fontSize: 11, fontFamily: "Pretendard-Regular" },
  statsRow:       { flexDirection: "row", backgroundColor: "#fff", paddingVertical: 10,
                    paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.border,
                    alignItems: "center" },
  statBox:        { flex: 1, alignItems: "center", gap: 2 },
  statNum:        { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  statLabel:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statDivider:    { width: 1, height: 28, backgroundColor: C.border },
  feedbackBanner: { flexDirection: "row", alignItems: "center", gap: 8,
                    backgroundColor: C.brandSoft, paddingHorizontal: 16, paddingVertical: 8 },
  feedbackTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#065F46" },
  tabBar:         { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border, flexGrow: 0 },
  tabContent:     { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:            { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                    borderWidth: 1.5, borderColor: C.border },
  tabActive:      { backgroundColor: P, borderColor: P },
  tabTxt:         { fontSize: 12, lineHeight: 17, color: C.textSecondary },
  tabActiveTxt:   { color: "#fff" },
  card:           { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: C.border, gap: 8 },
  cardTitle:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 4 },
  infoRow:        { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.backgroundSoft },
  infoLabel:      { width: 90, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  infoVal:        { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  empty:          { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", paddingVertical: 12 },
  alertBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginTop: 4 },
  alertTxt:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  storageCircleRow:{ flexDirection: "row", alignItems: "flex-start", gap: 16 },
  storageCircle:  { width: 80, height: 80, borderRadius: 40, borderWidth: 5, borderColor: P,
                    alignItems: "center", justifyContent: "center" },
  storageCircleNum:{ fontSize: 18, fontFamily: "Pretendard-Regular", color: P },
  storageCircleSub:{ fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  storageDetails: { flex: 1, gap: 4 },
  actionCard:     { flexDirection: "row", alignItems: "center", gap: 12,
                    backgroundColor: "#fff", borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: C.border },
  actionCardTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  primaryBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: P, borderRadius: 14, padding: 14 },
  primaryBtnTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  deleteBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: "#D96C6C", borderRadius: 10, padding: 12 },
  deleteBtnTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  forceCard:      { flexDirection: "row", alignItems: "center", gap: 14,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: C.border },
  forceIcon:      { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  forceTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  forceSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  quickLink:      { flexDirection: "row", alignItems: "center", gap: 10,
                    paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.backgroundSoft },
  quickLinkTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  logItem:        { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.backgroundSoft },
  logCat:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 2 },
  logCatTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular" },
  logDesc:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  logTime:        { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
});

const m = StyleSheet.create({
  backdrop:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:         { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                   borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 12 },
  handle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:         { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  fieldLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 6 },
  input:         { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12,
                   fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 8 },
  pickerRow:     { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip:          { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                   borderWidth: 1.5, borderColor: C.border, backgroundColor: C.backgroundSoft },
  chipActive:    { backgroundColor: P, borderColor: P },
  chipTxt:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  chipActiveTxt: { color: "#fff" },
  btnRow:        { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  cancelBtn:     { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: C.backgroundSoft },
  cancelTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  confirmBtn:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  confirmTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
