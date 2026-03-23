/**
 * (super)/risk-center.tsx — 장애·리스크 센터
 * 즉시 조치 버튼 확장: 각 리스크별 즉각 조치 가능
 * riskStore + operatorsStore + supportStore + backupStore + smsCreditStore
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useSupportStore } from "@/store/supportStore";
import { useRiskStore } from "@/store/riskStore";
import { useBackupStore } from "@/store/backupStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useSmsCreditStore } from "@/store/smsCreditStore";

const P = "#7C3AED";

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function hoursLeftStr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  if (h < 1) return "1시간 미만";
  return `${h}시간 후`;
}

interface RiskGroupProps {
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string; bg: string;
  count: number;
  children: React.ReactNode;
  onViewAll?: () => void;
}

function RiskGroup({ title, icon, color, bg, count, children, onViewAll }: RiskGroupProps) {
  if (count === 0) return null;
  return (
    <View style={g.group}>
      <View style={g.groupHeader}>
        <View style={[g.groupIcon, { backgroundColor: bg }]}>
          <Feather name={icon} size={14} color={color} />
        </View>
        <Text style={g.groupTitle}>{title}</Text>
        <View style={[g.countBadge, { backgroundColor: bg }]}>
          <Text style={[g.countTxt, { color }]}>{count}</Text>
        </View>
        {onViewAll && (
          <Pressable onPress={onViewAll} style={{ marginLeft: "auto" }}>
            <Text style={[g.viewAll, { color }]}>전체 보기</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

const EXTERNAL_SERVICES = [
  { name: "Supabase (DB)",           status: "normal" },
  { name: "Cloudflare R2 (스토리지)", status: "normal" },
  { name: "PortOne (PG)",             status: "normal" },
  { name: "Apple Push (APNs)",        status: "normal" },
  { name: "SMS Provider",             status: "normal" },
];

export default function RiskCenterScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const operators        = useOperatorsStore(s => s.operators);
  const updateOperator   = useOperatorsStore(s => s.updateOperator);
  const setOperatorReadonly  = useOperatorsStore(s => s.setOperatorReadonly);
  const setUploadBlocked = useOperatorsStore(s => s.setOperatorUploadBlocked);
  const scheduleDelete   = useOperatorsStore(s => s.scheduleAutoDelete);
  const clearAutoDelete  = useOperatorsStore(s => s.clearAutoDelete);
  const applyGrace       = useOperatorsStore(s => s.applyGrace);

  const createLog        = useAuditLogStore(s => s.createLog);
  const openCount        = useSupportStore(s => s.getOpenCount());
  const slaCount         = useSupportStore(s => s.getSlaOverdueCount());
  const allSnapshots     = useBackupStore(s => s.snapshots);
  const createSnapshot   = useBackupStore(s => s.createSnapshot);
  const latestSnap       = useMemo(() => allSnapshots.filter(s => s.scope === "platform")[0], [allSnapshots]);

  const smsAccounts      = useSmsCreditStore(s => s.accounts);
  const setSmsBlocked    = useSmsCreditStore(s => s.setBlocked);

  const paymentFailed    = useMemo(() => operators.filter(o => o.billingStatus === "payment_failed" || o.billingStatus === "grace"), [operators]);
  const storageDanger    = useMemo(() => operators.filter(o => o.storageBlocked95), [operators]);
  const deletionPending  = useMemo(() => operators.filter(o => !!o.autoDeleteScheduledAt), [operators]);
  const uploadSpike      = useMemo(() => operators.filter(o => o.uploadSpikeFlag), [operators]);
  const policyUnsigned   = useMemo(() => operators.filter(o => !o.policyRefundRead || !o.policyPrivacyRead), [operators]);
  const smsBlockedOps    = useMemo(() => smsAccounts.filter(a => a.smsBlocked), [smsAccounts]);
  const smsLowCredit     = useMemo(() => smsAccounts.filter(a => !a.smsBlocked && a.creditBalance < 50 && (a.freeQuotaMonthly - a.freeUsedMonthly) < 50), [smsAccounts]);
  const smsTotalFailed   = useMemo(() => {
    const seeds: Record<string, number> = { "op-001": 2, "op-002": 15, "op-003": 0, "op-004": 0 };
    return operators.reduce((acc, o) => acc + (seeds[o.id] ?? 0), 0);
  }, [operators]);
  const smsFailSpike     = smsTotalFailed >= 10;

  // ── 복구 실패 항목 (긴급 최우선) ──
  const RECOVERY_FAILURES = useMemo(() => [
    {
      id: "rf-001",
      operatorId: "op-007",
      operatorName: "서울수영아카데미",
      snapshotId: "서울수영아카데미_스냅샷_2026-03-21_09-00",
      failedAt: new Date(Date.now() - 2 * 3600000).toISOString(), // 2시간 전
      reason: "부분 복구 시도 후 회원 데이터 불일치 감지 (50명 누락)",
    },
  ], []);

  const totalRisk = paymentFailed.length + storageDanger.length + deletionPending.length + uploadSpike.length + smsBlockedOps.length + smsLowCredit.length + RECOVERY_FAILURES.length;

  function withProcessing(id: string, fn: () => void) {
    setProcessing(id);
    try { fn(); } finally { setTimeout(() => setProcessing(null), 500); }
  }

  // 결제 관련
  function applyGraceAction(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      applyGrace(op.id);
      createLog({ category: "결제", title: `${op.name} 유예 적용`, detail: "결제 실패 → 유예 상태 전환", actorName, impact: "medium", operatorId: op.id, operatorName: op.name });
    });
  }
  function rechargeBilling(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      createLog({ category: "결제", title: `${op.name} 재청구 요청`, detail: "결제 재시도 요청 발송", actorName, impact: "medium", operatorId: op.id, operatorName: op.name });
      Alert.alert("재청구 요청", `${op.name}에 재청구 요청을 발송했습니다.`);
    });
  }
  function setReadonly(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      setOperatorReadonly(op.id, "결제 실패 — 자동 ReadOnly 전환", actorName);
      Alert.alert("ReadOnly 전환", `${op.name} 운영자를 읽기전용으로 전환했습니다.`);
    });
  }

  // 저장공간 관련
  function allowStorage24h(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      const until = new Date(Date.now() + 24 * 3600000).toISOString();
      updateOperator(op.id, { storageOverrideUntil: until, storageOverrideBy: actorName });
      createLog({ category: "저장공간", title: `${op.name} 긴급 업로드 24h 허용`, detail: "스토리지 95% 초과에도 24h 임시 허용", actorName, impact: "medium", operatorId: op.id, operatorName: op.name });
      Alert.alert("완료", `${op.name} 긴급 업로드를 24시간 허용했습니다.`);
    });
  }
  function blockUpload(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      setUploadBlocked(op.id, true);
      createLog({ category: "저장공간", title: `${op.name} 업로드 차단`, detail: "저장공간 95% 초과 — 즉시 업로드 차단", actorName, impact: "high", operatorId: op.id, operatorName: op.name });
    });
  }

  // 삭제 관련
  function deferDeletion(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      const at = new Date(Date.now() + 48 * 3600000).toISOString();
      scheduleDelete(op.id, at);
      createLog({ category: "삭제", title: `${op.name} 자동삭제 48h 유예`, detail: "자동삭제 유예 48h 연장", actorName, impact: "high", operatorId: op.id, operatorName: op.name });
    });
  }
  function cancelDeletion(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      clearAutoDelete(op.id);
      createLog({ category: "삭제", title: `${op.name} 자동삭제 해제`, detail: "자동삭제 예약 취소", actorName, impact: "high", operatorId: op.id, operatorName: op.name });
    });
  }
  function createOpSnapshot(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      createSnapshot({ scope: "operator", operatorId: op.id, operatorName: op.name, actorName, note: "리스크 센터 즉시 스냅샷" });
      Alert.alert("완료", `${op.name} 스냅샷을 생성했습니다.`);
    });
  }

  // SMS 관련
  function unblockSms(operatorId: string) {
    withProcessing(operatorId, () => {
      setSmsBlocked(operatorId, false, actorName);
      Alert.alert("완료", "SMS 차단을 해제했습니다.");
    });
  }
  function blockSmsAction(operatorId: string, opName: string) {
    withProcessing(operatorId, () => {
      setSmsBlocked(operatorId, true, actorName);
      Alert.alert("완료", `${opName} SMS를 차단했습니다.`);
    });
  }

  // 정책 재알림
  function sendPolicyReminder(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      createLog({ category: "정책", title: `${op.name} 정책 재알림 발송`, detail: "정책 미확인 재알림 SMS 발송", actorName, impact: "low", operatorId: op.id, operatorName: op.name });
      Alert.alert("완료", `${op.name}에 정책 재알림을 발송했습니다.`);
    });
  }

  // 업로드 임시 제한
  function limitUpload(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      updateOperator(op.id, { uploadSpikeFlag: false, isUploadBlocked: true });
      createLog({ category: "저장공간", title: `${op.name} 업로드 임시 제한`, detail: "급증 탐지 — 업로드 임시 제한", actorName, impact: "medium", operatorId: op.id, operatorName: op.name });
      Alert.alert("완료", `${op.name} 업로드를 임시 제한했습니다.`);
    });
  }
  function sendSpikeNotice(op: typeof operators[0]) {
    withProcessing(op.id, () => {
      createLog({ category: "저장공간", title: `${op.name} 업로드 급증 알림`, detail: "운영자에게 업로드 급증 알림 발송", actorName, impact: "low", operatorId: op.id, operatorName: op.name });
      Alert.alert("완료", `${op.name}에 알림을 발송했습니다.`);
    });
  }

  // 외부 서비스
  function recheckService(name: string) {
    createLog({ category: "보안", title: `외부 서비스 재확인: ${name}`, detail: `${name} 상태 재확인 요청`, actorName, impact: "low" });
    Alert.alert("재확인", `${name} 상태를 재확인 요청했습니다.`);
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="장애·리스크 센터" homePath="/(super)/dashboard" />

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}>

        {/* 요약 헤더 */}
        <View style={s.summaryCard}>
          <View style={s.summaryRow}>
            <Feather name="shield" size={20} color={totalRisk > 0 ? "#F87171" : "#34D399"} />
            <Text style={[s.summaryTitle, totalRisk > 0 && { color: "#F87171" }]}>
              {totalRisk > 0 ? `리스크 ${totalRisk}건 처리 필요` : "현재 리스크 없음 ✓"}
            </Text>
          </View>
          <View style={s.riskGrid}>
            {[
              { label: "복구 실패",   count: RECOVERY_FAILURES.length, color: "#D96C6C" },
              { label: "결제 실패",   count: paymentFailed.length,  color: "#F87171" },
              { label: "저장 95%↑",  count: storageDanger.length,   color: "#C084FC" },
              { label: "삭제 예정",  count: deletionPending.length, color: "#4EA7D8" },
              { label: "업로드 급증", count: uploadSpike.length,    color: "#FBBF24" },
              { label: "정책 미확인", count: policyUnsigned.length, color: "#818CF8" },
              { label: "SLA 초과",   count: slaCount,               color: "#F87171" },
              { label: "SMS 실패",   count: smsTotalFailed,         color: "#FB923C" },
              { label: "SMS 차단",   count: smsBlockedOps.length,   color: "#A78BFA" },
            ].map(item => (
              <View key={item.label} style={s.riskTile}>
                <Text style={[s.riskNum, { color: item.count > 0 ? item.color : "#6F6B68" }]}>{item.count}</Text>
                <Text style={s.riskLbl}>{item.label}</Text>
              </View>
            ))}
          </View>
          {openCount > 0 && (
            <View style={s.supportRow}>
              <Feather name="message-circle" size={13} color="#38BDF8" />
              <Text style={s.supportTxt}>고객센터 미처리 {openCount}건{slaCount > 0 && ` · SLA 초과 ${slaCount}건`}</Text>
              <Pressable onPress={() => router.push("/(super)/support" as any)} style={s.supportLink}>
                <Text style={s.supportLinkTxt}>처리</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ══ 복구 실패 — 긴급 최우선 ══ */}
        <RiskGroup title="복구 실패 (긴급·비상)" icon="alert-octagon" color="#D96C6C" bg="#F9DEDA"
          count={RECOVERY_FAILURES.length}>
          {RECOVERY_FAILURES.map(rf => (
            <View key={rf.id} style={[g.item, { borderLeftWidth: 4, borderLeftColor: "#D96C6C", backgroundColor: "#FFF5F5" }]}>
              <View style={g.itemLeft}>
                <Text style={[g.itemName, { color: "#D96C6C" }]} numberOfLines={1}>
                  [{rf.operatorName}] 복구 실패
                </Text>
                <Text style={g.itemSub}>{rf.reason}</Text>
                <Text style={g.itemSub}>스냅샷: {rf.snapshotId}</Text>
                <Text style={[g.itemSub, { color: "#D96C6C" }]}>
                  복구에 실패했습니다. 관리자에게 문의해 주세요.
                </Text>
              </View>
              <View style={g.itemActions}>
                <Pressable
                  style={[g.btn, { backgroundColor: "#F9DEDA", paddingHorizontal: 10 }]}
                  onPress={() => {
                    createLog({
                      category: "복구", title: `복구 실패 문의: ${rf.operatorName}`,
                      actorName, impact: "high",
                      detail: `스냅샷: ${rf.snapshotId} / 실패 사유: ${rf.reason}`,
                    });
                    router.push({ pathname: "/(super)/support", params: { type: "recovery" } } as any);
                  }}>
                  <Feather name="message-circle" size={12} color="#D96C6C" />
                  <Text style={[g.btnTxt, { color: "#D96C6C" }]}>관리자 문의</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 결제 실패 ── */}
        <RiskGroup title="결제 실패 운영자" icon="credit-card" color="#D96C6C" bg="#F9DEDA"
          count={paymentFailed.length} onViewAll={() => router.push("/(super)/subscriptions" as any)}>
          {paymentFailed.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.representativeName} · {op.billingStatus === "grace" ? "유예 중" : "결제 실패"} · {op.paymentFailCount}회</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => applyGraceAction(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>유예</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#DDF2EF" }]} disabled={processing === op.id} onPress={() => rechargeBilling(op)}>
                  <Text style={[g.btnTxt, { color: "#1F8F86" }]}>재청구</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === op.id} onPress={() => setReadonly(op)}>
                  <Text style={[g.btnTxt, { color: "#D96C6C" }]}>RO</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 저장공간 95% 초과 ── */}
        <RiskGroup title="저장공간 위험 (95%↑)" icon="hard-drive" color={P} bg="#EEDDF5"
          count={storageDanger.length} onViewAll={() => router.push("/(super)/storage" as any)}>
          {storageDanger.slice(0, 5).map(op => {
            const pct = Math.round((op.storageUsedMb / Math.max(op.storageTotalMb, 1)) * 100);
            return (
              <View key={op.id} style={g.item}>
                <View style={g.itemLeft}>
                  <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                  <View style={g.barRow}>
                    <View style={g.barBg}>
                      <View style={[g.barFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: "#D96C6C" }]} />
                    </View>
                    <Text style={[g.pctTxt, { color: "#D96C6C" }]}>{pct}%</Text>
                  </View>
                </View>
                <View style={g.itemActions}>
                  <Pressable style={[g.btn, { backgroundColor: "#DDF2EF" }]} onPress={() => router.push("/(super)/subscription-products" as any)}>
                    <Text style={[g.btnTxt, { color: "#1F8F86" }]}>용량↑</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => allowStorage24h(op)}>
                    <Text style={[g.btnTxt, { color: "#D97706" }]}>24h</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === op.id} onPress={() => blockUpload(op)}>
                    <Text style={[g.btnTxt, { color: "#D96C6C" }]}>차단</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                    <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </RiskGroup>

        {/* ── 자동삭제 예정 ── */}
        <RiskGroup title="자동삭제 예정 (48h)" icon="trash-2" color="#1F8F86" bg="#ECFEFF"
          count={deletionPending.length} onViewAll={() => router.push("/(super)/kill-switch" as any)}>
          {deletionPending.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.representativeName} · 삭제 {hoursLeftStr(op.autoDeleteScheduledAt)}</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => deferDeletion(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>유예</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#DDF2EF" }]} disabled={processing === op.id} onPress={() => cancelDeletion(op)}>
                  <Text style={[g.btnTxt, { color: "#1F8F86" }]}>해제</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#ECFEFF" }]} disabled={processing === op.id} onPress={() => createOpSnapshot(op)}>
                  <Text style={[g.btnTxt, { color: "#1F8F86" }]}>스냅샷</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 업로드 급증 ── */}
        <RiskGroup title="업로드 급증 탐지" icon="trending-up" color="#D97706" bg="#FFF1BF"
          count={uploadSpike.length}>
          {uploadSpike.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.representativeName} · 7일 내 {op.uploadGrowth7dMb}MB 급증</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === op.id} onPress={() => limitUpload(op)}>
                  <Text style={[g.btnTxt, { color: "#D96C6C" }]}>제한</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => sendSpikeNotice(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>알림</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 정책 미확인 ── */}
        <RiskGroup title="정책 미확인 운영자" icon="file-text" color="#1F8F86" bg="#DDF2EF"
          count={policyUnsigned.length} onViewAll={() => router.push("/(super)/policy" as any)}>
          {policyUnsigned.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>
                  {!op.policyRefundRead ? "환불정책 미확인" : ""}
                  {!op.policyRefundRead && !op.policyPrivacyRead ? " · " : ""}
                  {!op.policyPrivacyRead ? "개인정보 미확인" : ""}
                </Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => sendPolicyReminder(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>재알림</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#DDF2EF" }]} onPress={() => router.push("/(super)/policy" as any)}>
                  <Text style={[g.btnTxt, { color: "#1F8F86" }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── SMS 발송 실패 급증 ── */}
        {smsFailSpike && (
          <RiskGroup title="SMS 발송 실패 급증" icon="alert-circle" color="#EA580C" bg="#FFF1BF"
            count={1} onViewAll={() => router.push("/(super)/sms-billing" as any)}>
            <View style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName}>플랫폼 전체 SMS 실패 {smsTotalFailed}건</Text>
                <Text style={g.itemSub}>임계값(10건) 초과 · Provider 확인 필요</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} onPress={() => recheckService("SMS Provider")}>
                  <Text style={[g.btnTxt, { color: "#EA580C" }]}>재확인</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} onPress={() => router.push("/(super)/sms-billing" as any)}>
                  <Text style={[g.btnTxt, { color: "#EA580C" }]}>정산</Text>
                </Pressable>
              </View>
            </View>
          </RiskGroup>
        )}

        {/* ── SMS 크레딧 부족 ── */}
        <RiskGroup title="SMS 크레딧 부족 운영자" icon="battery" color="#D97706" bg="#FFF1BF"
          count={smsLowCredit.length} onViewAll={() => router.push("/(super)/sms-billing" as any)}>
          {smsLowCredit.slice(0, 5).map(acc => {
            const op = operators.find(o => o.id === acc.operatorId);
            return (
              <View key={acc.operatorId} style={g.item}>
                <View style={g.itemLeft}>
                  <Text style={g.itemName} numberOfLines={1}>{acc.operatorName}</Text>
                  <Text style={g.itemSub}>잔액 {acc.creditBalance}건 · 무료 잔여 {Math.max(0, acc.freeQuotaMonthly - acc.freeUsedMonthly)}건</Text>
                </View>
                <View style={g.itemActions}>
                  <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} onPress={() => Alert.alert("충전 유도", `${acc.operatorName}에게 크레딧 충전 안내를 발송했습니다.`)}>
                    <Text style={[g.btnTxt, { color: "#D97706" }]}>안내</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === acc.operatorId} onPress={() => blockSmsAction(acc.operatorId, acc.operatorName)}>
                    <Text style={[g.btnTxt, { color: "#D96C6C" }]}>차단</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => router.push("/(super)/sms-billing" as any)}>
                    <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </RiskGroup>

        {/* ── SMS 차단 운영자 ── */}
        <RiskGroup title="SMS 차단 운영자" icon="slash" color="#7C3AED" bg="#EEDDF5"
          count={smsBlockedOps.length} onViewAll={() => router.push("/(super)/sms-billing" as any)}>
          {smsBlockedOps.slice(0, 5).map(acc => (
            <View key={acc.operatorId} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{acc.operatorName}</Text>
                <Text style={g.itemSub}>잔액 {acc.creditBalance}건 · 발송 차단 상태</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#DDF2EF" }]} disabled={processing === acc.operatorId} onPress={() => unblockSms(acc.operatorId)}>
                  <Text style={[g.btnTxt, { color: "#1F8F86" }]}>해제</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} onPress={() => Alert.alert("충전 유도", `${acc.operatorName}에 크레딧 충전 안내를 발송했습니다.`)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>안내</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => router.push("/(super)/sms-billing" as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 외부 서비스 상태 ── */}
        <View style={s.serviceCard}>
          <Text style={s.serviceTitle}>외부 서비스 상태</Text>
          {EXTERNAL_SERVICES.map(svc => (
            <View key={svc.name} style={s.serviceRow}>
              <View style={[s.serviceDot, { backgroundColor: svc.status === "normal" ? "#2E9B6F" : "#D96C6C" }]} />
              <Text style={s.serviceName}>{svc.name}</Text>
              <Text style={[s.serviceStatus, { color: svc.status === "normal" ? "#2E9B6F" : "#D96C6C" }]}>
                {svc.status === "normal" ? "정상" : "이상"}
              </Text>
              {svc.status !== "normal" && (
                <View style={s.serviceActions}>
                  <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} onPress={() => recheckService(svc.name)}>
                    <Text style={[g.btnTxt, { color: "#D97706" }]}>재확인</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => Alert.alert("장애 공지", `${svc.name} 장애 공지를 발송했습니다.`)}>
                    <Text style={[g.btnTxt, { color: "#D96C6C" }]}>공지</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          <View style={s.backupRow}>
            <Feather name="database" size={13} color="#6F6B68" />
            <Text style={s.backupTxt}>마지막 플랫폼 백업: {fmtAgo(latestSnap?.createdAt)}</Text>
          </View>
        </View>

        {totalRisk === 0 && openCount === 0 && (
          <View style={s.allClear}>
            <Feather name="check-circle" size={32} color="#2E9B6F" />
            <Text style={s.allClearTxt}>오늘 처리할 리스크가 없습니다</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#EEDDF5" },
  summaryCard:   { backgroundColor: "#1F1235", borderRadius: 14, padding: 16, gap: 12 },
  summaryRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FBF8F6" },
  riskGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  riskTile:      { flex: 1, minWidth: "28%", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 10, alignItems: "center" },
  riskNum:       { fontSize: 20, fontFamily: "Inter_700Bold", color: "#6F6B68" },
  riskLbl:       { fontSize: 10, fontFamily: "Inter_500Medium", color: "#9A948F", marginTop: 2, textAlign: "center" },
  supportRow:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(2,132,199,0.12)", borderRadius: 8, padding: 8 },
  supportTxt:    { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#38BDF8" },
  supportLink:   { backgroundColor: "#0284C7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  supportLinkTxt:{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  serviceCard:   { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: "#E9E2DD" },
  serviceTitle:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 4 },
  serviceRow:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  serviceDot:    { width: 8, height: 8, borderRadius: 4 },
  serviceName:   { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  serviceStatus: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  serviceActions:{ flexDirection: "row", gap: 4 },
  backupRow:     { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: "#F6F3F1", paddingTop: 8, marginTop: 4 },
  backupTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  allClear:      { alignItems: "center", paddingVertical: 40, gap: 10 },
  allClearTxt:   { fontSize: 14, fontFamily: "Inter_500Medium", color: "#6F6B68" },
});

const g = StyleSheet.create({
  group:       { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#E9E2DD" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#FBF8F6", borderBottomWidth: 1, borderBottomColor: "#F6F3F1" },
  groupIcon:   { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  groupTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  countBadge:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  countTxt:    { fontSize: 11, fontFamily: "Inter_700Bold" },
  viewAll:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  item:        { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#FBF8F6" },
  itemLeft:    { flex: 1, gap: 3, minWidth: 0 },
  itemName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  itemSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  itemActions: { flexDirection: "row", gap: 4, flexShrink: 0 },
  btn:         { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, minWidth: 36, alignItems: "center" },
  btnTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  barRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  barBg:       { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#F6F3F1", overflow: "hidden" },
  barFill:     { height: 4, borderRadius: 2 },
  pctTxt:      { fontSize: 11, fontFamily: "Inter_700Bold", width: 32, textAlign: "right" },
});
