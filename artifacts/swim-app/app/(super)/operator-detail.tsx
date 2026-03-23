/**
 * (super)/operator-detail.tsx — 운영자 상세 (6탭)
 * 기본정보 / 구독·결제 / 저장공간 / 정책·동의 / 로그 / 강제조치
 * operatorsStore + auditLogStore — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useStorageStore } from "@/store/storageStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useOperatorEventLogStore } from "@/store/operatorEventLogStore";

const P = "#7C3AED";

const TABS = ["기본정보", "구독·결제", "저장공간", "정책·동의", "로그", "강제조치"] as const;
type Tab = typeof TABS[number];

function fmtMb(mb: number): string {
  if (!mb || mb === 0) return "0 MB";
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
  trial:          { label: "체험 중",      color: P,         bg: "#EEDDF5" },
  active:         { label: "구독 중",      color: "#1F8F86", bg: "#DDF2EF" },
  payment_failed: { label: "결제 실패",    color: "#D96C6C", bg: "#F9DEDA" },
  grace:          { label: "유예 기간",    color: "#D97706", bg: "#FFF1BF" },
  readonly:       { label: "읽기 전용",    color: "#6F6B68", bg: "#F6F3F1" },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "대기",    color: "#D97706", bg: "#FFF1BF" },
  active:     { label: "운영",    color: "#1F8F86", bg: "#DDF2EF" },
  rejected:   { label: "반려",    color: "#D96C6C", bg: "#F9DEDA" },
  restricted: { label: "제한",    color: "#D96C6C", bg: "#F9DEDA" },
  readonly:   { label: "읽기전용",color: "#6F6B68", bg: "#F6F3F1" },
};

const CAT_CFG: Record<string, { color: string; bg: string }> = {
  권한:     { color: "#D97706", bg: "#FFF1BF" },
  구독:     { color: P,         bg: "#EEDDF5" },
  저장공간: { color: "#1F8F86", bg: "#DDF2EF" },
  삭제:     { color: "#D96C6C", bg: "#F9DEDA" },
  정책:     { color: "#1F8F86", bg: "#DDF2EF" },
  결제:     { color: "#1F8F86", bg: "#ECFEFF" },
};

export default function OperatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const operators         = useOperatorsStore(s => s.operators);
  const approveOperator   = useOperatorsStore(s => s.approveOperator);
  const rejectOperator    = useOperatorsStore(s => s.rejectOperator);
  const setRestricted     = useOperatorsStore(s => s.setRestricted);
  const storagePolicies   = useStorageStore(s => s.policies);
  const setStoragePolicy  = useStorageStore(s => s.setStoragePolicy);
  const auditLogs         = useAuditLogStore(s => s.logs);
  const createLog         = useAuditLogStore(s => s.createLog);
  const getEventLogs      = useOperatorEventLogStore(s => s.getOperatorLogs);

  const op = operators.find(o => o.id === id);

  const [tab,        setTab]        = useState<Tab>("기본정보");
  const [action,     setAction]     = useState<string | null>(null);
  const [reason,     setReason]     = useState("");
  const [extraGB,    setExtraGB]    = useState("");
  const [processing, setProcessing] = useState(false);
  const [feedback,   setFeedback]   = useState("");

  if (!op) {
    return (
      <SafeAreaView style={d.safe} edges={[]}>
        <SubScreenHeader title="운영자 상세" homePath="/(super)/pools" />
        <ActivityIndicator color={P} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const storagePolicy  = storagePolicies.find(p => p.operatorId === id);
  const opLogs         = auditLogs.filter(l => l.operatorId === id || l.operatorName === op.name).slice(0, 20);
  const opEventLogs    = getEventLogs(id ?? "", 20);

  const statusCfg  = STATUS_CFG[op.status]  ?? STATUS_CFG.pending;
  const billingCfg = BILLING_CFG[op.billingStatus] ?? BILLING_CFG.trial;

  const usedMb  = storagePolicy?.usedMb  ?? op.storageUsedMb;
  const totalMb = storagePolicy?.totalMb ?? op.storageTotalMb;
  const usagePct = totalMb > 0 ? usedMb / totalMb * 100 : 0;
  const storageAlert = op.storageBlocked95;
  const storageWarn  = op.storageWarning80;
  const totalGbStr   = (totalMb / 1024).toFixed(1) + " GB";

  function doAction(act: string) {
    setProcessing(true);
    if (act === "approve") {
      approveOperator(op!.id, actorName);
      createLog({ category: '권한', title: `운영 승인: ${op!.name}`, detail: '수동 승인', actorName, operatorId: op!.id, operatorName: op!.name, impact: 'high' });
      setFeedback("운영 승인 완료");
    } else if (act === "reject") {
      rejectOperator(op!.id, reason || '수동 반려', actorName);
      createLog({ category: '권한', title: `반려 처리: ${op!.name}${reason ? " / " + reason : ""}`, detail: reason || '수동 반려', actorName, operatorId: op!.id, operatorName: op!.name, impact: 'high' });
      setFeedback("반려 처리 완료");
    } else if (act === "restrict") {
      setRestricted(op!.id, reason || '수동 제한');
      createLog({ category: '권한', title: `일시 제한: ${op!.name}${reason ? " / " + reason : ""}`, detail: reason || '수동 제한', actorName, operatorId: op!.id, operatorName: op!.name, impact: 'high' });
      setFeedback("일시 제한 처리 완료");
    } else if (act === "storage") {
      const mb = (parseFloat(extraGB) || 0) * 1024;
      setStoragePolicy(op!.id, { extraMb: Math.round(mb) });
      createLog({ category: '저장공간', title: `추가 용량 부여: ${op!.name} +${extraGB}GB`, detail: `추가 ${extraGB}GB`, actorName, operatorId: op!.id, operatorName: op!.name, impact: 'medium' });
      setFeedback("저장공간 변경 완료");
    }
    setAction(null); setReason(""); setExtraGB("");
    setTimeout(() => { setProcessing(false); setFeedback(""); }, 3000);
  }

  const totalMembers = op.normalMemberCount + op.pausedMemberCount + op.withdrawnMemberCount;

  return (
    <SafeAreaView style={d.safe} edges={[]}>
      <SubScreenHeader title={op.name} homePath="/(super)/pools" />

      <View style={d.banner}>
        <View style={d.bannerLeft}>
          <Text style={d.bannerName} numberOfLines={1}>{op.name}</Text>
          <Text style={d.bannerOwner}>{op.representativeName}</Text>
        </View>
        <View style={[d.badge, { backgroundColor: statusCfg.bg }]}>
          <Text style={[d.badgeTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
        <View style={[d.badge, { backgroundColor: billingCfg.bg }]}>
          <Text style={[d.badgeTxt, { color: billingCfg.color }]}>{billingCfg.label}</Text>
        </View>
      </View>

      {!!feedback && (
        <View style={d.feedbackBanner}>
          <Feather name="check-circle" size={14} color="#1F8F86" />
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
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>

        {tab === "기본정보" && (
          <>
            <View style={d.card}>
              <Text style={d.cardTitle}>운영 정보</Text>
              <InfoRow label="수영장명"    value={op.name} />
              <InfoRow label="운영자"      value={op.representativeName} />
              <InfoRow label="이메일"      value={op.email} />
              <InfoRow label="전화번호"    value={op.phone} />
              <InfoRow label="활성 회원"   value={`${op.activeMemberCount}명`} />
              <InfoRow label="전체 회원"   value={`${totalMembers}명`} />
              <InfoRow label="마지막 접속" value={fmtDateTime(op.lastLoginAt)} />
              <InfoRow label="가입일"      value={fmtDate(op.createdAt)} />
            </View>
            <View style={d.card}>
              <Text style={d.cardTitle}>상태 정보</Text>
              <InfoRow label="운영 상태"   value={statusCfg.label} />
              <InfoRow label="읽기 전용"   value={op.isReadOnly ? "예" : "아니오"} alert={op.isReadOnly} />
              <InfoRow label="업로드 차단" value={op.isUploadBlocked ? "차단됨" : "정상"} alert={op.isUploadBlocked} />
            </View>
          </>
        )}

        {tab === "구독·결제" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>구독 정보</Text>
            <InfoRow label="현재 상태"    value={billingCfg.label} />
            <InfoRow label="구독 플랜"    value={op.currentPlanName} />
            <InfoRow label="크레딧"       value={`${op.creditBalance} 크레딧`} />
            <InfoRow label="다음 결제일"  value={fmtDate(op.nextBillingAt)} />
            <InfoRow label="마지막 결제"  value={fmtDate(op.lastPaymentAt)} />
            <InfoRow label="결제 실패"    value={`${op.paymentFailCount}회`} alert={op.paymentFailCount > 0} />
            <InfoRow label="환불 분쟁"    value={op.hasRefundDispute ? "있음" : "없음"} alert={op.hasRefundDispute} />
            {(op.billingStatus === "payment_failed" || op.billingStatus === "readonly") && (
              <View style={d.alertBox}>
                <Feather name="alert-triangle" size={14} color="#D96C6C" />
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
                  <Text style={[d.storageCircleNum, storageAlert && { color: "#D96C6C" }]}>{usagePct.toFixed(0)}%</Text>
                  <Text style={d.storageCircleSub}>사용</Text>
                </View>
                <View style={d.storageDetails}>
                  <InfoRow label="사용량"      value={fmtMb(usedMb)} />
                  <InfoRow label="전체 용량"   value={totalGbStr} />
                  <InfoRow label="업로드 차단" value={op.isUploadBlocked ? "차단됨" : "정상"} alert={op.isUploadBlocked} />
                  <InfoRow label="급증 감지"   value={op.uploadSpikeFlag ? "감지됨" : "정상"} alert={op.uploadSpikeFlag} />
                </View>
              </View>
              {storageAlert && (
                <View style={d.alertBox}>
                  <Feather name="alert-triangle" size={14} color="#D96C6C" />
                  <Text style={d.alertTxt}>저장공간이 95% 이상 사용되었습니다.</Text>
                </View>
              )}
            </View>
            <Pressable style={d.actionCard} onPress={() => setAction("storage")}>
              <Feather name="hard-drive" size={18} color={P} />
              <Text style={d.actionCardTxt}>추가 용량 부여</Text>
              <Feather name="chevron-right" size={16} color="#9A948F" style={{ marginLeft: "auto" }} />
            </Pressable>
          </>
        )}

        {tab === "정책·동의" && (
          <View style={d.card}>
            <Text style={d.cardTitle}>약관 동의 현황</Text>
            <InfoRow label="환불 정책"   value={op.policyRefundRead ? "동의" : "미동의"} alert={!op.policyRefundRead} />
            <InfoRow label="개인정보 처리" value={op.policyPrivacyRead ? "동의" : "미동의"} alert={!op.policyPrivacyRead} />
            <InfoRow label="이용약관"     value={op.policyTermsAgreed ? "동의" : "미동의"} alert={!op.policyTermsAgreed} />
            <InfoRow label="마지막 확인"  value={fmtDate(op.policyLastConfirmedAt)} />
            <Pressable style={[d.actionCard, { marginTop: 12 }]} onPress={() => router.push("/(super)/policy" as any)}>
              <Feather name="file-text" size={18} color={P} />
              <Text style={d.actionCardTxt}>정책 편집 (슈퍼관리자)</Text>
              <Feather name="chevron-right" size={16} color="#9A948F" style={{ marginLeft: "auto" }} />
            </Pressable>
          </View>
        )}

        {tab === "로그" && (
          <>
            {/* 슈퍼관리자 감사 로그 */}
            <View style={d.card}>
              <Text style={d.cardTitle}>슈퍼관리자 감사 로그 ({opLogs.length})</Text>
              {opLogs.length === 0 && <Text style={d.empty}>감사 로그가 없습니다</Text>}
              {opLogs.map(log => {
                const catCfg = CAT_CFG[log.category] ?? { color: "#6F6B68", bg: "#F6F3F1" };
                return (
                  <View key={log.id} style={d.logItem}>
                    <View style={[d.logCat, { backgroundColor: catCfg.bg }]}>
                      <Text style={[d.logCatTxt, { color: catCfg.color }]}>{log.category}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={d.logDesc}>{log.title}</Text>
                      <Text style={d.logTime}>{fmtDateTime(log.createdAt)} · {log.actorName ?? "—"}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* 운영자 이벤트 로그 */}
            <View style={d.card}>
              <Text style={d.cardTitle}>수영장 운영 이벤트 ({opEventLogs.length})</Text>
              {opEventLogs.length === 0
                ? <Text style={d.empty}>이벤트 로그가 없습니다</Text>
                : opEventLogs.map(log => {
                  const roleCfg: Record<string, { color: string; bg: string }> = {
                    operator: { color: "#1F8F86", bg: "#DDF2EF" },
                    teacher:  { color: "#1F8F86", bg: "#DDF2EF" },
                    system:   { color: "#6F6B68", bg: "#F6F3F1" },
                  };
                  const cfg = roleCfg[log.actorRole] ?? roleCfg.system;
                  return (
                    <View key={log.id} style={d.logItem}>
                      <View style={[d.logCat, { backgroundColor: cfg.bg }]}>
                        <Text style={[d.logCatTxt, { color: cfg.color }]}>
                          {log.actorRole === "operator" ? "관리자" : log.actorRole === "teacher" ? "선생님" : "시스템"}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={d.logDesc}>{log.summary}</Text>
                        <Text style={d.logTime}>{fmtDateTime(log.createdAt)} · {log.actorName}</Text>
                      </View>
                    </View>
                  );
                })
              }
            </View>
          </>
        )}

        {tab === "강제조치" && (
          <>
            {[
              { act: "approve",  icon: "check-circle" as const, label: "운영 승인",  sub: "승인 대기 → 운영 상태로 변경", color: "#1F8F86", bg: "#DDF2EF" },
              { act: "reject",   icon: "x-circle" as const,     label: "반려",       sub: "운영 자격 박탈 · 사유 기록",  color: "#D96C6C", bg: "#F9DEDA" },
              { act: "restrict", icon: "pause-circle" as const,  label: "일시 제한",  sub: "구독 일시 정지 처리",         color: "#D97706", bg: "#FFF1BF" },
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
                <Feather name="alert-triangle" size={15} color="#D96C6C" />
                <Text style={[d.quickLinkTxt, { color: "#D96C6C" }]}>킬스위치 (데이터 삭제)</Text>
                <Feather name="chevron-right" size={14} color="#9A948F" style={{ marginLeft: "auto" }} />
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
                {action === "approve" ? "운영 승인"
                  : action === "reject" ? "반려 처리"
                  : action === "restrict" ? "일시 제한"
                  : "추가 용량 부여"}
              </Text>
              {(action === "reject" || action === "restrict") && (
                <TextInput style={m.input} value={reason} onChangeText={setReason}
                  placeholder="사유 (선택)" placeholderTextColor="#9A948F" />
              )}
              {action === "storage" && (
                <View>
                  <Text style={m.inputLabel}>추가 용량 (GB)</Text>
                  <TextInput style={m.input} value={extraGB} onChangeText={setExtraGB}
                    keyboardType="decimal-pad" placeholder="예: 10" placeholderTextColor="#9A948F" />
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
  safe:           { flex: 1, backgroundColor: "#EEDDF5" },
  banner:         { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                    borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  bannerLeft:     { flex: 1 },
  bannerName:     { fontSize: 15, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  bannerOwner:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeTxt:       { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  feedbackBanner: { flexDirection: "row", alignItems: "center", gap: 8,
                    backgroundColor: "#DDF2EF", paddingHorizontal: 16, paddingVertical: 8 },
  feedbackTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#065F46" },
  tabBar:         { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E9E2DD", flexGrow: 0 },
  tabContent:     { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:            { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                    borderWidth: 1.5, borderColor: "#E9E2DD" },
  tabActive:      { backgroundColor: P, borderColor: P },
  tabTxt:         { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6F6B68" },
  tabActiveTxt:   { color: "#fff" },
  card:           { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E9E2DD", gap: 8 },
  cardTitle:      { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 4 },
  infoRow:        { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#FBF8F6" },
  infoLabel:      { width: 90, fontSize: 12, fontFamily: "Inter_500Medium", color: "#9A948F" },
  infoVal:        { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  empty:          { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9A948F", textAlign: "center", paddingVertical: 12 },
  alertBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginTop: 4 },
  alertTxt:       { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#D96C6C" },
  storageCircleRow:{ flexDirection: "row", alignItems: "flex-start", gap: 16 },
  storageCircle:  { width: 80, height: 80, borderRadius: 40, borderWidth: 5, borderColor: P,
                    alignItems: "center", justifyContent: "center" },
  storageCircleNum:{ fontSize: 18, fontFamily: "Inter_700Bold", color: P },
  storageCircleSub:{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F" },
  storageDetails: { flex: 1, gap: 4 },
  actionCard:     { flexDirection: "row", alignItems: "center", gap: 12,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E9E2DD" },
  actionCardTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  forceCard:      { flexDirection: "row", alignItems: "center", gap: 14,
                    backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#E9E2DD" },
  forceIcon:      { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  forceTxt:       { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  forceSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  quickLink:      { flexDirection: "row", alignItems: "center", gap: 10,
                    paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F6F3F1" },
  quickLinkTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  logItem:        { flexDirection: "row", alignItems: "flex-start", gap: 8,
                    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#FBF8F6" },
  logCat:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 2 },
  logCatTxt:      { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  logDesc:        { fontSize: 12, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  logTime:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 16 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:      { fontSize: 18, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  inputLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", marginBottom: 6 },
  input:      { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F6F3F1" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  confirmBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  confirmTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
