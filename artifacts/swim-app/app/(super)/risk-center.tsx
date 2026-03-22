/**
 * (super)/risk-center.tsx — 장애·리스크 센터
 * riskStore + operatorsStore + supportStore + backupStore — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useSupportStore } from "@/store/supportStore";
import { useRiskStore } from "@/store/riskStore";
import { useBackupStore } from "@/store/backupStore";
import { useAuditLogStore } from "@/store/auditLogStore";

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
  { name: "Supabase (DB)",         status: "normal" },
  { name: "Cloudflare R2 (스토리지)", status: "normal" },
  { name: "PortOne (PG)",          status: "normal" },
  { name: "Apple Push (APNs)",     status: "normal" },
  { name: "SMS Provider",          status: "normal" },
];

// SMS 리스크 mock 데이터
const SMS_USAGE_SEED: Record<string, { sent: number; failed: number; blocked: boolean; unpaid: boolean }> = {
  "op-001": { sent: 320,  failed: 2,  blocked: false, unpaid: false },
  "op-002": { sent: 1240, failed: 15, blocked: false, unpaid: true  },
  "op-003": { sent: 501,  failed: 0,  blocked: false, unpaid: true  },
  "op-004": { sent: 88,   failed: 0,  blocked: false, unpaid: false },
  "op-005": { sent: 0,    failed: 0,  blocked: false, unpaid: false },
};

export default function RiskCenterScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const operators      = useOperatorsStore(s => s.operators);
  const scheduleDelete = useOperatorsStore(s => s.scheduleAutoDelete);
  const createLog      = useAuditLogStore(s => s.createLog);
  const openCount      = useSupportStore(s => s.getOpenCount());
  const slaCount       = useSupportStore(s => s.getSlaOverdueCount());
  const riskSummary    = useRiskStore(s => s.summary);
  const allSnapshots   = useBackupStore(s => s.snapshots);
  const latestSnap     = useMemo(() => allSnapshots.filter(s => s.scope === 'platform')[0], [allSnapshots]);

  const paymentFailed  = useMemo(() => operators.filter(o => o.billingStatus === 'payment_failed' || o.billingStatus === 'grace'), [operators]);
  const storageDanger  = useMemo(() => operators.filter(o => o.storageBlocked95), [operators]);
  const deletionPending = useMemo(() => operators.filter(o => !!o.autoDeleteScheduledAt), [operators]);
  const uploadSpike    = useMemo(() => operators.filter(o => o.uploadSpikeFlag), [operators]);
  const policyUnsigned = useMemo(() => operators.filter(o => !o.policyRefundRead || !o.policyPrivacyRead), [operators]);

  // SMS 리스크
  const smsBlockedOps  = useMemo(() => operators.filter(o => SMS_USAGE_SEED[o.id]?.blocked), [operators]);
  const smsUnpaidOps   = useMemo(() => operators.filter(o => SMS_USAGE_SEED[o.id]?.unpaid), [operators]);
  const smsTotalFailed = useMemo(() => operators.reduce((acc, o) => acc + (SMS_USAGE_SEED[o.id]?.failed ?? 0), 0), [operators]);
  const smsFailSpike   = smsTotalFailed >= 10; // 10건 이상이면 급증으로 판단

  const totalRisk = paymentFailed.length + storageDanger.length + deletionPending.length + uploadSpike.length + smsBlockedOps.length + smsUnpaidOps.length;

  function deferDeletion(id: string) {
    const op = operators.find(o => o.id === id);
    if (!op) return;
    setProcessing(id);
    const at = new Date(Date.now() + 48 * 3600000).toISOString();
    scheduleDelete(id, at);
    createLog({ category: '삭제', title: `${op.name} 자동삭제 48h 유예`, operatorId: id, operatorName: op.name, actorName, impact: 'high', detail: '자동삭제 유예 48시간 연장' });
    setTimeout(() => setProcessing(null), 500);
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

          {/* 리스크 개요 */}
          <View style={s.riskGrid}>
            {[
              { label: "결제 실패",   count: paymentFailed.length,  color: "#F87171" },
              { label: "저장 95%↑",  count: storageDanger.length,   color: "#C084FC" },
              { label: "삭제 예정",   count: deletionPending.length, color: "#60A5FA" },
              { label: "업로드 급증", count: uploadSpike.length,     color: "#FBBF24" },
              { label: "정책 미확인", count: policyUnsigned.length,  color: "#818CF8" },
              { label: "SLA 초과",   count: slaCount,               color: "#F87171" },
              { label: "SMS 실패",   count: smsTotalFailed,         color: "#FB923C" },
              { label: "SMS 미납",   count: smsUnpaidOps.length,    color: "#FCD34D" },
              { label: "SMS 차단",   count: smsBlockedOps.length,   color: "#A78BFA" },
            ].map(item => (
              <View key={item.label} style={s.riskTile}>
                <Text style={[s.riskNum, { color: item.count > 0 ? item.color : "#6B7280" }]}>{item.count}</Text>
                <Text style={s.riskLbl}>{item.label}</Text>
              </View>
            ))}
          </View>

          {openCount > 0 && (
            <View style={s.supportRow}>
              <Feather name="message-circle" size={13} color="#38BDF8" />
              <Text style={s.supportTxt}>
                고객센터 미처리 {openCount}건
                {slaCount > 0 && ` · SLA 초과 ${slaCount}건`}
              </Text>
              <Pressable onPress={() => router.push("/(super)/support" as any)} style={s.supportLink}>
                <Text style={s.supportLinkTxt}>처리</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* 결제 실패 */}
        <RiskGroup title="결제 실패 운영자" icon="credit-card" color="#DC2626" bg="#FEE2E2"
          count={paymentFailed.length} onViewAll={() => router.push("/(super)/subscriptions" as any)}>
          {paymentFailed.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.representativeName} · {op.billingStatus === 'grace' ? '유예 중' : '결제 실패'}</Text>
              </View>
              <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                <Text style={[g.btnTxt, { color: P }]}>상세</Text>
              </Pressable>
            </View>
          ))}
        </RiskGroup>

        {/* 저장공간 95% 초과 */}
        <RiskGroup title="저장공간 위험 (95%↑)" icon="hard-drive" color={P} bg="#EDE9FE"
          count={storageDanger.length} onViewAll={() => router.push("/(super)/storage" as any)}>
          {storageDanger.slice(0, 5).map(op => {
            const pct = Math.round((op.storageUsedMb / Math.max(op.storageTotalMb, 1)) * 100);
            return (
              <View key={op.id} style={g.item}>
                <View style={g.itemLeft}>
                  <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                  <View style={g.barRow}>
                    <View style={g.barBg}>
                      <View style={[g.barFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: "#DC2626" }]} />
                    </View>
                    <Text style={[g.pctTxt, { color: "#DC2626" }]}>{pct}%</Text>
                  </View>
                </View>
                <Pressable style={[g.btn, { backgroundColor: "#D1FAE5" }]}
                  onPress={() => router.push(`/(super)/storage` as any)}>
                  <Text style={[g.btnTxt, { color: "#059669" }]}>용량↑</Text>
                </Pressable>
              </View>
            );
          })}
        </RiskGroup>

        {/* 자동삭제 예정 */}
        <RiskGroup title="자동삭제 예정 (48h)" icon="trash-2" color="#0891B2" bg="#ECFEFF"
          count={deletionPending.length} onViewAll={() => router.push("/(super)/kill-switch" as any)}>
          {deletionPending.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.representativeName} · {hoursLeftStr(op.autoDeleteScheduledAt)}</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FEF3C7" }]}
                  onPress={() => deferDeletion(op.id)}
                  disabled={processing === op.id}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>유예</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                  onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* 업로드 급증 */}
        <RiskGroup title="업로드 급증 탐지" icon="trending-up" color="#D97706" bg="#FEF3C7"
          count={uploadSpike.length}>
          {uploadSpike.slice(0, 5).map(op => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.representativeName} · 7일 내 {op.uploadGrowth7dMb}MB 급증</Text>
              </View>
              <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                <Text style={[g.btnTxt, { color: P }]}>상세</Text>
              </Pressable>
            </View>
          ))}
        </RiskGroup>

        {/* 정책 미확인 */}
        <RiskGroup title="정책 미확인 운영자" icon="file-text" color="#4F46E5" bg="#EEF2FF"
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
              <Pressable style={[g.btn, { backgroundColor: "#EEF2FF" }]}
                onPress={() => router.push(`/(super)/policy` as any)}>
                <Text style={[g.btnTxt, { color: "#4F46E5" }]}>알림</Text>
              </Pressable>
            </View>
          ))}
        </RiskGroup>

        {/* SMS 발송 실패 급증 */}
        {smsFailSpike && (
          <RiskGroup title="SMS 발송 실패 급증" icon="alert-circle" color="#EA580C" bg="#FFF7ED"
            count={1} onViewAll={() => router.push("/(super)/sms-billing" as any)}>
            <View style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName}>플랫폼 전체 SMS 실패 {smsTotalFailed}건</Text>
                <Text style={g.itemSub}>임계값(10건) 초과 · SMS Provider 연결 확인 필요</Text>
              </View>
              <Pressable style={[g.btn, { backgroundColor: "#FFF7ED" }]}
                onPress={() => router.push("/(super)/sms-billing" as any)}>
                <Text style={[g.btnTxt, { color: "#EA580C" }]}>상세</Text>
              </Pressable>
            </View>
          </RiskGroup>
        )}

        {/* SMS 미납 운영자 */}
        <RiskGroup title="SMS 미납 운영자" icon="credit-card" color="#D97706" bg="#FEF3C7"
          count={smsUnpaidOps.length} onViewAll={() => router.push("/(super)/sms-billing" as any)}>
          {smsUnpaidOps.slice(0, 5).map(op => {
            const usage = SMS_USAGE_SEED[op.id];
            const excess = Math.max(0, (usage?.sent ?? 0) - 500);
            const charge = Math.round(excess * 9.9);
            return (
              <View key={op.id} style={g.item}>
                <View style={g.itemLeft}>
                  <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                  <Text style={g.itemSub}>발송 {usage?.sent ?? 0}건 · 초과 과금 ₩{charge.toLocaleString()}</Text>
                </View>
                <Pressable style={[g.btn, { backgroundColor: "#FEF3C7" }]}
                  onPress={() => router.push("/(super)/sms-billing" as any)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>과금</Text>
                </Pressable>
              </View>
            );
          })}
        </RiskGroup>

        {/* SMS 차단 운영자 */}
        {smsBlockedOps.length > 0 && (
          <RiskGroup title="SMS 차단 운영자" icon="slash" color="#7C3AED" bg="#EDE9FE"
            count={smsBlockedOps.length} onViewAll={() => router.push("/(super)/sms-billing" as any)}>
            {smsBlockedOps.slice(0, 5).map(op => (
              <View key={op.id} style={g.item}>
                <View style={g.itemLeft}>
                  <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                  <Text style={g.itemSub}>SMS 발송 차단 상태</Text>
                </View>
                <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                  onPress={() => router.push("/(super)/sms-billing" as any)}>
                  <Text style={[g.btnTxt, { color: "#7C3AED" }]}>해제</Text>
                </Pressable>
              </View>
            ))}
          </RiskGroup>
        )}

        {/* 외부 서비스 상태 */}
        <View style={s.serviceCard}>
          <Text style={s.serviceTitle}>외부 서비스 상태</Text>
          {EXTERNAL_SERVICES.map(svc => (
            <View key={svc.name} style={s.serviceRow}>
              <View style={[s.serviceDot, { backgroundColor: svc.status === "normal" ? "#10B981" : "#DC2626" }]} />
              <Text style={s.serviceName}>{svc.name}</Text>
              <Text style={[s.serviceStatus, { color: svc.status === "normal" ? "#10B981" : "#DC2626" }]}>
                {svc.status === "normal" ? "정상" : "이상"}
              </Text>
            </View>
          ))}
          <View style={s.backupRow}>
            <Feather name="database" size={13} color="#6B7280" />
            <Text style={s.backupTxt}>마지막 플랫폼 백업: {fmtAgo(latestSnap?.createdAt)}</Text>
          </View>
        </View>

        {totalRisk === 0 && openCount === 0 && (
          <View style={s.allClear}>
            <Feather name="check-circle" size={32} color="#10B981" />
            <Text style={s.allClearTxt}>오늘 처리할 리스크가 없습니다</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F5F3FF" },
  summaryCard:    { backgroundColor: "#1F1235", borderRadius: 14, padding: 16, gap: 12 },
  summaryRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  riskGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  riskTile:       { flex: 1, minWidth: "28%", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 10, alignItems: "center" },
  riskNum:        { fontSize: 22, fontFamily: "Inter_700Bold", color: "#6B7280" },
  riskLbl:        { fontSize: 10, fontFamily: "Inter_500Medium", color: "#9CA3AF", marginTop: 2, textAlign: "center" },
  supportRow:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(2,132,199,0.12)", borderRadius: 8, padding: 8 },
  supportTxt:     { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#38BDF8" },
  supportLink:    { backgroundColor: "#0284C7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  supportLinkTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  serviceCard:    { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  serviceTitle:   { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 4 },
  serviceRow:     { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  serviceDot:     { width: 8, height: 8, borderRadius: 4 },
  serviceName:    { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  serviceStatus:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  backupRow:      { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 8, marginTop: 4 },
  backupTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  allClear:       { alignItems: "center", paddingVertical: 40, gap: 10 },
  allClearTxt:    { fontSize: 14, fontFamily: "Inter_500Medium", color: "#6B7280" },
});

const g = StyleSheet.create({
  group:       { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  groupIcon:   { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  groupTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  countBadge:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  countTxt:    { fontSize: 11, fontFamily: "Inter_700Bold" },
  viewAll:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  item:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  itemLeft:    { flex: 1, gap: 3 },
  itemName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  itemSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  itemActions: { flexDirection: "row", gap: 6 },
  btn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 40, alignItems: "center" },
  btnTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  barRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  barBg:       { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#F3F4F6", overflow: "hidden" },
  barFill:     { height: 4, borderRadius: 2 },
  pctTxt:      { fontSize: 11, fontFamily: "Inter_700Bold", width: 32, textAlign: "right" },
});
