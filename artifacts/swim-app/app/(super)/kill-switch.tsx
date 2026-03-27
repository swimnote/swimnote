/**
 * (super)/kill-switch.tsx — 데이터·킬스위치
 * 안전장치 보강: 해지 확정 조건 + 비밀번호 재입력 + 체크박스 2개 + 스냅샷 강제 생성
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useBackupStore } from "@/store/backupStore";
import type { DeletionReason } from "@/domain/types";

const DANGER = "#D96C6C";
const WARN   = "#D97706";
const P      = "#7C3AED";

const DELETE_MODES = [
  { key: "full",   label: "전체 데이터 삭제",   color: DANGER, icon: "trash-2",    desc: "운영자 전체 데이터 영구 삭제" },
  { key: "period", label: "기간 지정 삭제",      color: WARN,   icon: "calendar",   desc: "특정 기간 내 데이터만 삭제" },
  { key: "item",   label: "항목별 삭제",          color: "#D97706", icon: "list",   desc: "특정 항목(영상/사진/일지)만 삭제" },
];

const DELETE_ITEMS = ["수업 영상", "사진", "일지", "출석 기록", "결제 기록"];

const DELETION_REASON_CFG: Record<DeletionReason, { label: string; desc: string }> = {
  operator_terminated: { label: '운영자 해지 확정', desc: '운영자가 해지 확정 및 정책 동의 완료' },
  manual_by_admin:     { label: '슈퍼관리자 수동 삭제', desc: '슈관 직접 판단 삭제 (감사 로그 필수)' },
  policy_violation:    { label: '정책 위반', desc: '약관 위반으로 인한 강제 삭제 (법무 승인 필요)' },
};

function hoursLeft(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  return `${h}h 후 삭제`;
}

export default function KillSwitchScreen() {
  const { adminUser, token } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const operators          = useOperatorsStore(s => s.operators);
  const updateOperator     = useOperatorsStore(s => s.updateOperator);
  const scheduleAutoDelete = useOperatorsStore(s => s.scheduleAutoDelete);
  const auditLogs          = useAuditLogStore(s => s.logs);
  const createLog          = useAuditLogStore(s => s.createLog);
  const createSnapshot     = useBackupStore(s => s.createSnapshot);

  const [tab,           setTab]           = useState("exec");
  const [deleteMode,    setDeleteMode]    = useState<string | null>(null);
  const [deletionReason,setDeletionReason]= useState<DeletionReason | null>(null);
  const [poolId,        setPoolId]        = useState("");
  const [poolName,      setPoolName]      = useState("");
  const [fromDate,      setFromDate]      = useState("");
  const [toDate,        setToDate]        = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [reason,        setReason]        = useState("");

  // 안전장치
  const [confirmModal,  setConfirmModal]  = useState(false);
  const [confirmText,   setConfirmText]   = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [check1,        setCheck1]        = useState(false);  // 복구 불가 체크
  const [check2,        setCheck2]        = useState(false);  // 삭제 책임 체크
  const [snapshotCreated, setSnapshotCreated] = useState(false);

  const [deleting,      setDeleting]      = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [otpVisible,    setOtpVisible]    = useState(false);

  const queueItems = useMemo(() => operators.filter(o => !!o.autoDeleteScheduledAt), [operators]);
  const deleteLogs = useMemo(() => auditLogs.filter(l => l.category === '삭제'), [auditLogs]);

  // 선택된 운영자의 해지 확정 여부
  const selectedOp = useMemo(() => operators.find(o => o.id === poolId), [operators, poolId]);
  const isTerminated = selectedOp?.isTerminationConfirmed === true;

  function deferDeletion(id: string) {
    setActionLoading(id);
    const at = new Date(Date.now() + 48 * 3600000).toISOString();
    scheduleAutoDelete(id, at);
    const op = operators.find(o => o.id === id);
    createLog({ category: '삭제', title: `삭제 유예 48h: ${op?.name ?? id}`, detail: '48시간 유예 연장', actorName, impact: 'medium' });
    setTimeout(() => setActionLoading(null), 500);
  }

  function doCancelSchedule(id: string) {
    setActionLoading(`cancel-${id}`);
    scheduleAutoDelete(id, null as any);
    updateOperator(id, { autoDeleteScheduledAt: null } as any);
    const op = operators.find(o => o.id === id);
    createLog({ category: '삭제', title: `삭제 예약 취소: ${op?.name ?? id}`, detail: '삭제 예약 해제', actorName, impact: 'high' });
    setTimeout(() => setActionLoading(null), 400);
  }

  function doConfirmTermination(id: string) {
    setActionLoading(`term-${id}`);
    updateOperator(id, {
      isTerminationConfirmed: true,
      terminationConfirmedAt: new Date().toISOString(),
    } as any);
    const op = operators.find(o => o.id === id);
    createLog({ category: '삭제', title: `해지 확정: ${op?.name ?? id}`, detail: '운영자 해지 확정 처리', actorName, impact: 'high' });
    setTimeout(() => setActionLoading(null), 400);
  }

  function doCreateSnapshot() {
    if (!poolId) return;
    createSnapshot({
      bucket: 'operator_snapshot',
      scope: 'operator',
      operatorId: poolId,
      operatorName: poolName,
      includes: ['media', 'journals', 'billing', 'members'],
      note: `삭제 실행 전 강제 스냅샷 — ${new Date().toLocaleString('ko-KR')}`,
      createdBy: actorName,
    });
    createLog({ category: '백업', title: `삭제 전 스냅샷 생성: ${poolName}`, detail: '킬스위치 실행 전 강제 백업', actorName, impact: 'high', operatorId: poolId, operatorName: poolName });
    setSnapshotCreated(true);
  }

  function executeDelete() {
    if (!poolId || !canExecute) return;
    setDeleting(true);
    updateOperator(poolId, { status: 'deleted' as any });
    createLog({
      category: '삭제',
      title: `데이터 삭제 실행: ${poolName || poolId}`,
      detail: `방식: ${DELETE_MODES.find(m => m.key === deleteMode)?.label ?? deleteMode} / 사유: ${DELETION_REASON_CFG[deletionReason!]?.label}`,
      actorName,
      impact: 'critical',
      operatorId: poolId,
      operatorName: poolName,
      reason: reason,
      metadata: { deleteMode, deletionReason, snapshotCreated },
    });
    setTimeout(() => {
      setDeleting(false); setConfirmModal(false);
      setDeleteMode(null); setPoolId(""); setPoolName(""); setReason("");
      setAdminPassword(""); setCheck1(false); setCheck2(false); setSnapshotCreated(false);
      setDeletionReason(null);
    }, 800);
  }

  const toggleItem = (item: string) =>
    setSelectedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);

  const canProceed = poolId && deleteMode && deletionReason &&
    (deleteMode === "full" || (deleteMode === "period" && fromDate && toDate) ||
     (deleteMode === "item" && selectedItems.length > 0));

  // 최종 실행 가능 조건
  const canExecute = confirmText === "영구삭제" && adminPassword === "admin1234" &&
    check1 && check2 && snapshotCreated;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="데이터·킬스위치" homePath="/(super)/dashboard" />

      {/* 경고 배너 */}
      <View style={s.dangerBanner}>
        <Feather name="alert-octagon" size={14} color="#fff" />
        <Text style={s.bannerTxt}>삭제는 해지 확정 + 정책 동의 + 유예 완료 후에만 가능합니다. 결제 실패·저장공간 초과만으로는 자동삭제 금지.</Text>
      </View>

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4 }}>
        {[
          { key: "exec",  label: "삭제 실행" },
          { key: "queue", label: `삭제 예정 (${queueItems.length})` },
          { key: "log",   label: "삭제 로그" },
        ].map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── 삭제 실행 탭 ── */}
      {tab === "exec" && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}>

          {/* STEP 1: 운영자 선택 */}
          <StepCard step="1" title="운영자 선택 (해지 확정된 운영자만 가능)">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {operators.filter(o => o.billingStatus === 'cancelled' || o.status === 'suspended').map(op => {
                const terminated = op.isTerminationConfirmed === true;
                return (
                  <Pressable key={op.id}
                    style={[s.opChip, poolId === op.id && s.opChipActive, !terminated && s.opChipDisabled]}
                    onPress={() => {
                      if (!terminated) return;
                      setPoolId(op.id); setPoolName(op.name);
                    }}>
                    <Text style={[s.opChipTxt, poolId === op.id && { color: DANGER }]}>
                      {op.name}
                      {!terminated ? ' ⚠️' : ' ✓'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {poolId && !isTerminated && (
              <View style={s.warnBox}>
                <Feather name="alert-triangle" size={13} color={WARN} />
                <Text style={s.warnTxt}>이 운영자는 해지 미확정 상태입니다. 삭제를 실행하려면 먼저 해지를 확정해야 합니다.</Text>
              </View>
            )}
            {poolId && isTerminated && (
              <View style={[s.warnBox, { backgroundColor: "#E6FFFA" }]}>
                <Feather name="check-circle" size={13} color="#2EC4B6" />
                <Text style={[s.warnTxt, { color: "#065F46" }]}>해지 확정 완료 — 삭제 실행 가능합니다.</Text>
              </View>
            )}
          </StepCard>

          {/* STEP 2: 삭제 사유 */}
          <StepCard step="2" title="삭제 사유 선택 (필수)">
            {(Object.keys(DELETION_REASON_CFG) as DeletionReason[]).map(r => {
              const cfg = DELETION_REASON_CFG[r];
              return (
                <Pressable key={r}
                  style={[s.reasonRow, deletionReason === r && { borderColor: DANGER, backgroundColor: "#FEF2F2" }]}
                  onPress={() => setDeletionReason(r)}>
                  <View style={[s.radio, deletionReason === r && { backgroundColor: DANGER, borderColor: DANGER }]}>
                    {deletionReason === r && <View style={s.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.reasonLabel, deletionReason === r && { color: DANGER }]}>{cfg.label}</Text>
                    <Text style={s.reasonDesc}>{cfg.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
            <TextInput style={s.reasonInput} value={reason} onChangeText={setReason}
              placeholder="상세 사유 입력 (필수)" placeholderTextColor="#9CA3AF" />
          </StepCard>

          {/* STEP 3: 삭제 방식 */}
          <StepCard step="3" title="삭제 방식">
            {DELETE_MODES.map(m2 => (
              <Pressable key={m2.key} style={[s.modeRow, deleteMode === m2.key && { borderColor: m2.color, borderWidth: 2 }]}
                onPress={() => setDeleteMode(m2.key)}>
                <View style={[s.radio, deleteMode === m2.key && { backgroundColor: m2.color, borderColor: m2.color }]}>
                  {deleteMode === m2.key && <View style={s.radioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.modeLabel, { color: m2.color }]}>{m2.label}</Text>
                  <Text style={s.modeDesc}>{m2.desc}</Text>
                </View>
                <Feather name={m2.icon as any} size={18} color={m2.color} />
              </Pressable>
            ))}

            {deleteMode === "period" && (
              <View style={s.dateRow}>
                <TextInput style={[s.dateInput, { flex: 1 }]} value={fromDate} onChangeText={setFromDate}
                  placeholder="시작일 (YYYY-MM-DD)" placeholderTextColor="#9CA3AF" />
                <Text style={s.dateSep}>~</Text>
                <TextInput style={[s.dateInput, { flex: 1 }]} value={toDate} onChangeText={setToDate}
                  placeholder="종료일 (YYYY-MM-DD)" placeholderTextColor="#9CA3AF" />
              </View>
            )}
            {deleteMode === "item" && (
              <View style={s.itemWrap}>
                {DELETE_ITEMS.map(it => (
                  <Pressable key={it} style={[s.itemChip, selectedItems.includes(it) && s.itemChipActive]}
                    onPress={() => toggleItem(it)}>
                    <Text style={[s.itemChipTxt, selectedItems.includes(it) && { color: DANGER }]}>{it}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </StepCard>

          {/* STEP 4: 최종 실행 */}
          <Pressable
            style={[s.execBtn, { opacity: canProceed ? 1 : 0.4 }]}
            disabled={!canProceed}
            onPress={() => {
              setConfirmText(""); setAdminPassword("");
              setCheck1(false); setCheck2(false); setSnapshotCreated(false);
              setConfirmModal(true);
            }}>
            <Feather name="alert-octagon" size={16} color="#fff" />
            <Text style={s.execTxt}>안전장치 확인 후 삭제 진행</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ── 삭제 예정 탭 ── */}
      {tab === "queue" && (
        <FlatList
          data={queueItems}
          keyExtractor={o => o.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          renderItem={({ item: op }) => (
            <View style={s.queueCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.queueName}>{op.name}</Text>
                <Text style={[s.queueTimer, { color: DANGER }]}>{hoursLeft(op.autoDeleteScheduledAt)}</Text>
                {op.isTerminationConfirmed
                  ? <Text style={[s.queueMeta, { color: '#2EC4B6' }]}>해지 확정 ✓</Text>
                  : <Text style={[s.queueMeta, { color: WARN }]}>해지 미확정 ⚠️</Text>
                }
              </View>
              <View style={s.queueActions}>
                <Pressable style={s.deferBtn} disabled={actionLoading === op.id}
                  onPress={() => deferDeletion(op.id)}>
                  {actionLoading === op.id ? <ActivityIndicator size="small" color={WARN} />
                    : <Text style={s.deferTxt}>48h 유예</Text>}
                </Pressable>
                <Pressable style={s.cancelScheduleBtn} disabled={actionLoading === `cancel-${op.id}`}
                  onPress={() => doCancelSchedule(op.id)}>
                  <Text style={s.cancelScheduleTxt}>취소</Text>
                </Pressable>
                {!op.isTerminationConfirmed && (
                  <Pressable style={s.termBtn} disabled={actionLoading === `term-${op.id}`}
                    onPress={() => doConfirmTermination(op.id)}>
                    {actionLoading === `term-${op.id}` ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={s.termTxt}>해지 확정</Text>}
                  </Pressable>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="check-circle" size={30} color="#D1D5DB" />
              <Text style={s.emptyTxt}>삭제 예정 운영자 없음</Text>
            </View>
          }
        />
      )}

      {/* ── 삭제 로그 탭 ── */}
      {tab === "log" && (
        <FlatList
          data={deleteLogs}
          keyExtractor={l => l.id}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 80 }}
          renderItem={({ item: l }) => (
            <View style={s.logCard}>
              <View style={s.logLeft}>
                <Feather name="trash-2" size={14} color={DANGER} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.logTitle}>{l.title}</Text>
                <Text style={s.logMeta}>{l.actorName} · {new Date(l.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>
                {l.detail ? <Text style={s.logDetail}>{l.detail}</Text> : null}
              </View>
              <View style={[s.impactBadge, { backgroundColor: l.impact === 'critical' ? '#F9DEDA' : '#FFF1BF' }]}>
                <Text style={[s.impactTxt, { color: l.impact === 'critical' ? DANGER : WARN }]}>{l.impact}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>삭제 로그 없음</Text></View>}
        />
      )}

      {/* ── 최종 안전장치 확인 모달 ── */}
      {confirmModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setConfirmModal(false)}>
          <Pressable style={m.backdrop} onPress={() => {}}>
            <View style={m.sheet}>
              <View style={m.handle} />
              <View style={m.dangerHeader}>
                <Feather name="alert-octagon" size={22} color="#fff" />
                <Text style={m.dangerHeaderTxt}>최종 삭제 안전장치 확인</Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={m.confirmInfo}>
                  <Text style={m.confirmInfoTxt}>
                    대상: <Text style={{ fontFamily: "Inter_700Bold", color: DANGER }}>{poolName}</Text>{"\n"}
                    방식: {DELETE_MODES.find(d => d.key === deleteMode)?.label}{"\n"}
                    사유: {deletionReason ? DELETION_REASON_CFG[deletionReason].label : '—'}{"\n"}
                    {deleteMode === "period" ? `기간: ${fromDate} ~ ${toDate}\n` : ""}
                    {deleteMode === "item" ? `항목: ${selectedItems.join(", ")}\n` : ""}
                  </Text>
                </View>

                {/* STEP A: 스냅샷 생성 */}
                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>A. 삭제 전 스냅샷 강제 생성 (필수)</Text>
                  {snapshotCreated
                    ? <View style={m.snapshotDone}><Feather name="check-circle" size={14} color="#2EC4B6" /><Text style={m.snapshotDoneTxt}>스냅샷 생성 완료</Text></View>
                    : <Pressable style={m.snapshotBtn} onPress={doCreateSnapshot}>
                        <Feather name="archive" size={14} color="#2EC4B6" />
                        <Text style={m.snapshotBtnTxt}>지금 스냅샷 생성</Text>
                      </Pressable>
                  }
                </View>

                {/* STEP B: 복구 불가 체크 */}
                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>B. 복구 불가 확인 (2개 필수)</Text>
                  <Pressable style={m.checkRow} onPress={() => setCheck1(v => !v)}>
                    <View style={[m.checkbox, check1 && m.checkboxActive]}>
                      {check1 && <Feather name="check" size={12} color="#fff" />}
                    </View>
                    <Text style={m.checkTxt}>삭제된 데이터는 복구가 불가능하며, 이를 충분히 인지하였습니다.</Text>
                  </Pressable>
                  <Pressable style={m.checkRow} onPress={() => setCheck2(v => !v)}>
                    <View style={[m.checkbox, check2 && m.checkboxActive]}>
                      {check2 && <Feather name="check" size={12} color="#fff" />}
                    </View>
                    <Text style={m.checkTxt}>본 삭제 액션의 모든 결과에 대한 책임이 실행자({actorName})에게 있음을 동의합니다.</Text>
                  </Pressable>
                </View>

                {/* STEP C: 비밀번호 */}
                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>C. 관리자 비밀번호 재입력</Text>
                  <TextInput style={m.pwInput} value={adminPassword} onChangeText={setAdminPassword}
                    secureTextEntry placeholder="비밀번호 입력" placeholderTextColor="#9CA3AF" />
                  <Text style={m.pwHint}>* mock 환경: 'admin1234'</Text>
                </View>

                {/* STEP D: "영구삭제" 입력 */}
                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>D. '영구삭제' 정확히 입력</Text>
                  <TextInput style={m.confirmInput} value={confirmText} onChangeText={setConfirmText}
                    placeholder="영구삭제" placeholderTextColor="#9CA3AF" />
                </View>

                <View style={m.btnRow}>
                  <Pressable style={m.cancelBtn} onPress={() => setConfirmModal(false)}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[m.deleteBtn, { opacity: canExecute && !deleting ? 1 : 0.4 }]}
                    disabled={!canExecute || deleting}
                    onPress={() => setOtpVisible(true)}>
                    {deleting ? <ActivityIndicator color="#fff" size="small" />
                      : <><Feather name="lock" size={13} color="#fff" /><Text style={m.deleteTxt}>OTP 인증 후 영구 삭제</Text></>}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      )}
      <OtpGateModal
        visible={otpVisible}
        token={token}
        title="영구 삭제 OTP 인증"
        desc="킬스위치 실행은 되돌릴 수 없습니다. OTP를 인증한 후에만 실행됩니다."
        onSuccess={() => { setOtpVisible(false); executeDelete(); }}
        onCancel={() => setOtpVisible(false)}
      />
    </SafeAreaView>
  );
}

function StepCard({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <View style={s.stepCard}>
      <View style={s.stepHeader}>
        <View style={s.stepBadge}><Text style={s.stepBadgeTxt}>{step}</Text></View>
        <Text style={s.stepTitle}>{title}</Text>
      </View>
      <View style={s.stepBody}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FFF5F5" },
  dangerBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: DANGER,
                  paddingHorizontal: 14, paddingVertical: 10 },
  bannerTxt:    { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#fff", lineHeight: 16 },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tab:          { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  tabActive:    { backgroundColor: "#F9DEDA" },
  tabTxt:       { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabTxtActive: { color: DANGER, fontFamily: "Inter_700Bold" },

  stepCard:     { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden",
                  shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1 },
  stepHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#FFF5F5",
                  borderBottomWidth: 1, borderBottomColor: "#F9DEDA" },
  stepBadge:    { width: 24, height: 24, borderRadius: 12, backgroundColor: DANGER, alignItems: "center", justifyContent: "center" },
  stepBadgeTxt: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  stepTitle:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827", flex: 1 },
  stepBody:     { padding: 12, gap: 10 },

  opChip:       { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                  borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F1F5F9" },
  opChipActive: { borderColor: DANGER, backgroundColor: "#FFF5F5" },
  opChipDisabled:{ opacity: 0.5 },
  opChipTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },

  warnBox:      { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFF1BF",
                  padding: 10, borderRadius: 10 },
  warnTxt:      { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },

  reasonRow:    { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 10,
                  borderWidth: 1.5, borderColor: "#E5E7EB" },
  reasonLabel:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  reasonDesc:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  reasonInput:  { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                  fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },

  modeRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10,
                  borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FAFAFA" },
  modeLabel:    { fontSize: 14, fontFamily: "Inter_700Bold" },
  modeDesc:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  radio:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D1D5DB",
                  alignItems: "center", justifyContent: "center" },
  radioDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  dateRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  dateInput:    { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 10,
                  fontSize: 13, fontFamily: "Inter_400Regular", color: "#111827" },
  dateSep:      { fontSize: 14, color: "#9CA3AF" },
  itemWrap:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  itemChip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                  borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F1F5F9" },
  itemChipActive:{ borderColor: DANGER, backgroundColor: "#FEF2F2" },
  itemChipTxt:  { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },

  execBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  backgroundColor: DANGER, borderRadius: 14, padding: 16 },
  execTxt:      { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },

  queueCard:    { backgroundColor: "#fff", borderRadius: 12, padding: 14, flexDirection: "row",
                  alignItems: "center", gap: 10,
                  shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 2, elevation: 1 },
  queueName:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  queueTimer:   { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  queueMeta:    { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  queueActions: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },
  deferBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFF1BF", minWidth: 60, alignItems: "center" },
  deferTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold", color: WARN },
  cancelScheduleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F8FAFC" },
  cancelScheduleTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  termBtn:      { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#2EC4B6" },
  termTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },

  logCard:      { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#fff",
                  borderRadius: 10, padding: 12 },
  logLeft:      { width: 28, height: 28, borderRadius: 8, backgroundColor: "#F9DEDA",
                  alignItems: "center", justifyContent: "center" },
  logTitle:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  logMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  logDetail:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  impactBadge:  { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  impactTxt:    { fontSize: 10, fontFamily: "Inter_700Bold" },

  empty:        { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  sheet:          { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                    borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", paddingBottom: 30 },
  handle:         { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 12, marginBottom: 8 },
  dangerHeader:   { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: DANGER,
                    paddingHorizontal: 20, paddingVertical: 14 },
  dangerHeaderTxt:{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  confirmInfo:    { margin: 16, padding: 12, backgroundColor: "#FFF5F5", borderRadius: 12, borderWidth: 1, borderColor: "#FCA5A5" },
  confirmInfoTxt: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#111827", lineHeight: 20 },
  safeSection:    { marginHorizontal: 16, marginBottom: 12, gap: 8 },
  safeTitle:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  snapshotBtn:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10,
                    backgroundColor: "#ECFEFF", borderWidth: 1.5, borderColor: "#2EC4B6" },
  snapshotBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#2EC4B6" },
  snapshotDone:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, backgroundColor: "#E6FFFA" },
  snapshotDoneTxt:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#2EC4B6" },
  checkRow:       { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 },
  checkbox:       { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB",
                    alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxActive: { backgroundColor: DANGER, borderColor: DANGER },
  checkTxt:       { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#111827", lineHeight: 18 },
  pwInput:        { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                    fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  pwHint:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  confirmInput:   { borderWidth: 2, borderColor: DANGER, borderRadius: 10, padding: 12,
                    fontSize: 14, fontFamily: "Inter_700Bold", color: DANGER },
  btnRow:         { flexDirection: "row", gap: 10, justifyContent: "flex-end", padding: 16, paddingTop: 8 },
  cancelBtn:      { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F8FAFC" },
  cancelTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  deleteBtn:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20,
                    paddingVertical: 10, borderRadius: 10, backgroundColor: DANGER },
  deleteTxt:      { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
});
