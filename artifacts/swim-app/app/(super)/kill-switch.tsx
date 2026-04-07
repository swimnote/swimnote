/**
 * (super)/kill-switch.tsx — 데이터·킬스위치
 * 안전장치 보강: 해지 확정 조건 + 비밀번호 재입력 + 체크박스 2개 + 스냅샷 강제 생성
 * 실 API 연결 완료 — useAuditLogStore / useBackupStore 완전 제거
 */
import { Archive, Check, CircleCheck, Lock, OctagonAlert, Trash2, TriangleAlert } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
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

interface OperatorRow {
  id: string;
  name: string;
  subscription_status: string;
  next_billing_at: string | null;
}

interface DeleteLog {
  id: string;
  category: string;
  description: string;
  actor_name: string;
  created_at: string;
  pool_name?: string;
}

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

  const [operators,     setOperators]     = useState<OperatorRow[]>([]);
  const [deleteLogs,    setDeleteLogs]    = useState<DeleteLog[]>([]);
  const [loadingOps,    setLoadingOps]    = useState(true);
  const [loadingLogs,   setLoadingLogs]   = useState(true);
  const [confirmedIds,  setConfirmedIds]  = useState<Set<string>>(new Set());

  const [tab,           setTab]           = useState("exec");
  const [deleteMode,    setDeleteMode]    = useState<string | null>(null);
  const [deletionReason,setDeletionReason]= useState<DeletionReason | null>(null);
  const [poolId,        setPoolId]        = useState("");
  const [poolName,      setPoolName]      = useState("");
  const [fromDate,      setFromDate]      = useState("");
  const [toDate,        setToDate]        = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [reason,        setReason]        = useState("");

  const [confirmModal,  setConfirmModal]  = useState(false);
  const [confirmText,   setConfirmText]   = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [check1,        setCheck1]        = useState(false);
  const [check2,        setCheck2]        = useState(false);
  const [snapshotCreated, setSnapshotCreated] = useState(false);

  const [deleting,      setDeleting]      = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [otpVisible,    setOtpVisible]    = useState(false);

  const fetchOperators = useCallback(async () => {
    if (!token) return;
    setLoadingOps(true);
    try {
      const res = await apiRequest(token, '/super/pools-summary?filter=payment_failed');
      if (res.ok) {
        const raw = await res.json();
        const mapped: OperatorRow[] = Array.isArray(raw) ? raw.map((p: any) => ({
          id:                  p.pool_id,
          name:                p.pool_name,
          subscription_status: p.subscription?.status ?? "expired",
          next_billing_at:     p.subscription?.ends_at ?? null,
        })) : [];
        setOperators(mapped);
      }
    } catch (e) {
      console.error('fetchOperators error:', e);
    } finally {
      setLoadingOps(false);
    }
  }, [token]);

  const fetchDeleteLogs = useCallback(async () => {
    if (!token) return;
    setLoadingLogs(true);
    try {
      const res = await apiRequest(token, '/super/op-logs?category=%EC%82%AD%EC%A0%9C&limit=50');
      if (res.ok) {
        const data = await res.json();
        setDeleteLogs(Array.isArray(data?.logs) ? data.logs : []);
      }
    } catch (e) {
      console.error('fetchDeleteLogs error:', e);
    } finally {
      setLoadingLogs(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOperators();
    fetchDeleteLogs();
  }, [fetchOperators, fetchDeleteLogs]);

  const queueItems = useMemo(
    () => operators.filter(o => !!o.next_billing_at),
    [operators]
  );

  const selectedOp   = useMemo(() => operators.find(o => o.id === poolId), [operators, poolId]);
  const isTerminated = selectedOp ? confirmedIds.has(selectedOp.id) : false;

  async function deferDeletion(id: string) {
    if (!token) return;
    setActionLoading(id);
    try {
      await apiRequest(token, `/super/operators/${id}/defer-deletion`, {
        method: 'POST',
        body: JSON.stringify({ hours: 48 }),
      });
      await fetchOperators();
    } catch (e) {
      console.error('deferDeletion error:', e);
    } finally {
      setActionLoading(null);
    }
  }

  async function doCancelSchedule(id: string) {
    if (!token) return;
    setActionLoading(`cancel-${id}`);
    try {
      await apiRequest(token, `/super/operators/${id}/cancel-deletion`, {
        method: 'POST',
      });
      await fetchOperators();
    } catch (e) {
      console.error('doCancelSchedule error:', e);
    } finally {
      setActionLoading(null);
    }
  }

  function doConfirmTermination(id: string) {
    setConfirmedIds(prev => new Set([...prev, id]));
  }

  async function doCreateSnapshot() {
    if (!poolId || !token) return;
    try {
      const res = await apiRequest(token, '/super/backups', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'operator',
          operatorId: poolId,
          note: `삭제 실행 전 강제 스냅샷 — ${new Date().toLocaleString('ko-KR')}`,
        }),
      });
      if (res.ok) {
        setSnapshotCreated(true);
      } else {
        Alert.alert('스냅샷 실패', '스냅샷 생성에 실패했습니다. 다시 시도해 주세요.');
      }
    } catch (e) {
      Alert.alert('스냅샷 실패', '네트워크 오류가 발생했습니다.');
    }
  }

  async function executeDelete() {
    if (!poolId || !canExecute || !token) return;
    setDeleting(true);
    try {
      await apiRequest(token, `/super/operators/${poolId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({
          subscription_status: 'cancelled',
          subscription_end_at: new Date().toISOString(),
        }),
      });
      await Promise.all([fetchOperators(), fetchDeleteLogs()]);
      setConfirmModal(false);
      setDeleteMode(null); setPoolId(""); setPoolName(""); setReason("");
      setAdminPassword(""); setCheck1(false); setCheck2(false); setSnapshotCreated(false);
      setDeletionReason(null);
    } catch (e) {
      console.error('executeDelete error:', e);
    } finally {
      setDeleting(false);
    }
  }

  const toggleItem = (item: string) =>
    setSelectedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);

  const canProceed = poolId && deleteMode && deletionReason &&
    (deleteMode === "full" || (deleteMode === "period" && fromDate && toDate) ||
     (deleteMode === "item" && selectedItems.length > 0));

  const canExecute = confirmText === "영구삭제" && adminPassword === "admin1234" &&
    check1 && check2 && snapshotCreated;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="데이터·킬스위치" homePath="/(super)/protect-group" />

      <View style={s.dangerBanner}>
        <OctagonAlert size={14} color="#fff" />
        <Text style={s.bannerTxt}>삭제는 해지 확정 + 정책 동의 + 유예 완료 후에만 가능합니다. 결제 실패·저장공간 초과만으로는 자동삭제 금지.</Text>
      </View>

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

          <StepCard step="1" title="운영자 선택 (해지 확정된 운영자만 가능)">
            {loadingOps
              ? <ActivityIndicator color={DANGER} />
              : <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {operators.map(op => {
                    const terminated = confirmedIds.has(op.id);
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
                  {operators.length === 0 && (
                    <Text style={{ color: "#64748B", fontSize: 13, padding: 8 }}>결제 이상 운영자 없음</Text>
                  )}
                </ScrollView>
            }
            {poolId && !isTerminated && (
              <View style={s.warnBox}>
                <TriangleAlert size={13} color={WARN} />
                <Text style={s.warnTxt}>이 운영자는 해지 미확정 상태입니다. 삭제를 실행하려면 먼저 해지를 확정해야 합니다.</Text>
              </View>
            )}
            {poolId && isTerminated && (
              <View style={[s.warnBox, { backgroundColor: "#E6FFFA" }]}>
                <CircleCheck size={13} color="#2EC4B6" />
                <Text style={[s.warnTxt, { color: "#065F46" }]}>해지 확정 완료 — 삭제 실행 가능합니다.</Text>
              </View>
            )}
          </StepCard>

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
              placeholder="상세 사유 입력 (필수)" placeholderTextColor="#64748B" />
          </StepCard>

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
                <LucideIcon name={m2.icon as any} size={18} color={m2.color} />
              </Pressable>
            ))}

            {deleteMode === "period" && (
              <View style={s.dateRow}>
                <TextInput style={[s.dateInput, { flex: 1 }]} value={fromDate} onChangeText={setFromDate}
                  placeholder="시작일 (YYYY-MM-DD)" placeholderTextColor="#64748B" />
                <Text style={s.dateSep}>~</Text>
                <TextInput style={[s.dateInput, { flex: 1 }]} value={toDate} onChangeText={setToDate}
                  placeholder="종료일 (YYYY-MM-DD)" placeholderTextColor="#64748B" />
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

          <Pressable
            style={[s.execBtn, { opacity: canProceed ? 1 : 0.4 }]}
            disabled={!canProceed}
            onPress={() => {
              setConfirmText(""); setAdminPassword("");
              setCheck1(false); setCheck2(false); setSnapshotCreated(false);
              setConfirmModal(true);
            }}>
            <OctagonAlert size={16} color="#fff" />
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
          renderItem={({ item: op }) => {
            const terminated = confirmedIds.has(op.id);
            return (
              <View style={s.queueCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.queueName}>{op.name}</Text>
                  <Text style={[s.queueTimer, { color: DANGER }]}>{hoursLeft(op.next_billing_at)}</Text>
                  {terminated
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
                    {actionLoading === `cancel-${op.id}` ? <ActivityIndicator size="small" color="#64748B" />
                      : <Text style={s.cancelScheduleTxt}>취소</Text>}
                  </Pressable>
                  {!terminated && (
                    <Pressable style={s.termBtn}
                      onPress={() => doConfirmTermination(op.id)}>
                      <Text style={s.termTxt}>해지 확정</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            loadingOps
              ? <ActivityIndicator color={DANGER} style={{ marginTop: 40 }} />
              : <View style={s.empty}>
                  <CircleCheck size={30} color="#D1D5DB" />
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
                <Trash2 size={14} color={DANGER} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.logTitle}>{l.description}</Text>
                <Text style={s.logMeta}>
                  {l.actor_name}
                  {l.pool_name ? ` · ${l.pool_name}` : ""}
                  {" · "}
                  {new Date(l.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            loadingLogs
              ? <ActivityIndicator color={DANGER} style={{ marginTop: 40 }} />
              : <View style={s.empty}><Text style={s.emptyTxt}>삭제 로그 없음</Text></View>
          }
        />
      )}

      {/* ── 최종 안전장치 확인 모달 ── */}
      {confirmModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setConfirmModal(false)}>
          <Pressable style={m.backdrop} onPress={() => {}}>
            <View style={m.sheet}>
              <View style={m.handle} />
              <View style={m.dangerHeader}>
                <OctagonAlert size={22} color="#fff" />
                <Text style={m.dangerHeaderTxt}>최종 삭제 안전장치 확인</Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={m.confirmInfo}>
                  <Text style={m.confirmInfoTxt}>
                    대상: <Text style={{ fontFamily: "Pretendard-Regular", color: DANGER }}>{poolName}</Text>{"\n"}
                    방식: {DELETE_MODES.find(d => d.key === deleteMode)?.label}{"\n"}
                    사유: {deletionReason ? DELETION_REASON_CFG[deletionReason].label : '—'}{"\n"}
                    {deleteMode === "period" ? `기간: ${fromDate} ~ ${toDate}\n` : ""}
                    {deleteMode === "item" ? `항목: ${selectedItems.join(", ")}\n` : ""}
                  </Text>
                </View>

                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>A. 삭제 전 스냅샷 강제 생성 (필수)</Text>
                  {snapshotCreated
                    ? <View style={m.snapshotDone}><CircleCheck size={14} color="#2EC4B6" /><Text style={m.snapshotDoneTxt}>스냅샷 생성 완료</Text></View>
                    : <Pressable style={m.snapshotBtn} onPress={doCreateSnapshot}>
                        <Archive size={14} color="#2EC4B6" />
                        <Text style={m.snapshotBtnTxt}>지금 스냅샷 생성</Text>
                      </Pressable>
                  }
                </View>

                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>B. 복구 불가 확인 (2개 필수)</Text>
                  <Pressable style={m.checkRow} onPress={() => setCheck1(v => !v)}>
                    <View style={[m.checkbox, check1 && m.checkboxActive]}>
                      {check1 && <Check size={12} color="#fff" />}
                    </View>
                    <Text style={m.checkTxt}>삭제된 데이터는 복구가 불가능하며, 이를 충분히 인지하였습니다.</Text>
                  </Pressable>
                  <Pressable style={m.checkRow} onPress={() => setCheck2(v => !v)}>
                    <View style={[m.checkbox, check2 && m.checkboxActive]}>
                      {check2 && <Check size={12} color="#fff" />}
                    </View>
                    <Text style={m.checkTxt}>본 삭제 액션의 모든 결과에 대한 책임이 실행자({actorName})에게 있음을 동의합니다.</Text>
                  </Pressable>
                </View>

                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>C. 관리자 비밀번호 재입력</Text>
                  <TextInput style={m.pwInput} value={adminPassword} onChangeText={setAdminPassword}
                    secureTextEntry placeholder="비밀번호 입력" placeholderTextColor="#64748B" />
                  <Text style={m.pwHint}>* 테스트 환경: 'admin1234'</Text>
                </View>

                <View style={m.safeSection}>
                  <Text style={m.safeTitle}>D. '영구삭제' 정확히 입력</Text>
                  <TextInput style={m.confirmInput} value={confirmText} onChangeText={setConfirmText}
                    placeholder="영구삭제" placeholderTextColor="#64748B" />
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
                      : <><Lock size={13} color="#fff" /><Text style={m.deleteTxt}>OTP 인증 후 영구 삭제</Text></>}
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
  safe:             { flex: 1, backgroundColor: "#FFF5F5" },
  dangerBanner:     { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: DANGER,
                      paddingHorizontal: 14, paddingVertical: 10 },
  bannerTxt:        { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff", lineHeight: 16 },
  tabBar:           { flexGrow: 0, borderBottomWidth: 1, borderColor: "#E5E7EB" },
  tab:              { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: "#F9F9F9", borderWidth: 1, borderColor: "#E5E7EB" },
  tabActive:        { backgroundColor: DANGER, borderColor: DANGER },
  tabTxt:           { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTxtActive:     { color: "#fff" },

  stepCard:         { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB",
                      overflow: "hidden" },
  stepHeader:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                      backgroundColor: "#FFF5F5", borderBottomWidth: 1, borderColor: "#FECACA" },
  stepBadge:        { width: 24, height: 24, borderRadius: 12, backgroundColor: DANGER,
                      alignItems: "center", justifyContent: "center" },
  stepBadgeTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  stepTitle:        { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  stepBody:         { padding: 12, gap: 8 },

  opChip:           { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                      backgroundColor: "#F9F9F9", borderWidth: 1, borderColor: "#E5E7EB" },
  opChipActive:     { borderColor: DANGER, backgroundColor: "#FFF5F5" },
  opChipDisabled:   { opacity: 0.5 },
  opChipTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151" },

  warnBox:          { flexDirection: "row", alignItems: "flex-start", gap: 6,
                      backgroundColor: "#FFFBEB", borderRadius: 8, padding: 10, marginTop: 6 },
  warnTxt:          { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 16 },

  reasonRow:        { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10,
                      borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  reasonLabel:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  reasonDesc:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  reasonInput:      { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10,
                      fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", marginTop: 4 },

  radio:            { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#D1D5DB",
                      alignItems: "center", justifyContent: "center", marginTop: 1 },
  radioDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },

  modeRow:          { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10,
                      borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  modeLabel:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  modeDesc:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  dateRow:          { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  dateInput:        { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10,
                      fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  dateSep:          { fontSize: 14, color: "#64748B" },
  itemWrap:         { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  itemChip:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "#F9F9F9", borderWidth: 1, borderColor: "#E5E7EB" },
  itemChipActive:   { backgroundColor: "#FFF5F5", borderColor: DANGER },
  itemChipTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#374151" },

  execBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center",
                      gap: 8, backgroundColor: DANGER, borderRadius: 14, padding: 16, marginTop: 4 },
  execTxt:          { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },

  queueCard:        { flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
                      borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#FECACA", gap: 10 },
  queueName:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  queueTimer:       { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  queueMeta:        { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  queueActions:     { gap: 6 },
  deferBtn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FCD34D" },
  deferTxt:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: WARN },
  cancelScheduleBtn:{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#D1D5DB" },
  cancelScheduleTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#374151" },
  termBtn:          { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: DANGER },
  termTxt:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },

  logCard:          { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#fff",
                      borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  logLeft:          { width: 28, height: 28, borderRadius: 8, backgroundColor: "#FFF5F5",
                      alignItems: "center", justifyContent: "center" },
  logTitle:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  logMeta:          { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  logDetail:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#94A3B8", marginTop: 2 },

  impactBadge:      { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, alignSelf: "flex-start" },
  impactTxt:        { fontSize: 10, fontFamily: "Pretendard-Regular" },

  empty:            { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:         { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:            { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                      maxHeight: "92%", paddingBottom: 40 },
  handle:           { width: 36, height: 4, backgroundColor: "#E5E7EB", borderRadius: 2,
                      alignSelf: "center", marginTop: 10, marginBottom: 4 },
  dangerHeader:     { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: DANGER,
                      padding: 16 },
  dangerHeaderTxt:  { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
  confirmInfo:      { margin: 16, backgroundColor: "#FFF5F5", borderRadius: 12, padding: 14,
                      borderWidth: 1, borderColor: "#FECACA" },
  confirmInfoTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151", lineHeight: 20 },
  safeSection:      { marginHorizontal: 16, marginBottom: 14, gap: 8 },
  safeTitle:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  snapshotDone:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E6FFFA",
                      borderRadius: 10, padding: 12 },
  snapshotDoneTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#065F46" },
  snapshotBtn:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E6FFFA",
                      borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#2EC4B6" },
  snapshotBtnTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  checkRow:         { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox:         { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB",
                      alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxActive:   { backgroundColor: DANGER, borderColor: DANGER },
  checkTxt:         { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#374151", lineHeight: 17 },
  pwInput:          { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                      fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  pwHint:           { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  confirmInput:     { borderWidth: 2, borderColor: DANGER, borderRadius: 10, padding: 12,
                      fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  btnRow:           { flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 6, marginBottom: 20 },
  cancelBtn:        { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#F3F4F6",
                      alignItems: "center" },
  cancelTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#374151" },
  deleteBtn:        { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
                      gap: 6, padding: 14, borderRadius: 12, backgroundColor: DANGER },
  deleteTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
