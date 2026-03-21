/**
 * (super)/kill-switch.tsx — 데이터·킬스위치
 * 탭: 삭제 실행 / 삭제 유예 큐 / 실행 로그
 * 삭제 방식: 전체 / 기간별 / 항목별 / 삭제 유예
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";

const DANGER = "#DC2626";

const TABS = [
  { key: "exec",   label: "삭제 실행" },
  { key: "queue",  label: "삭제 예정 큐" },
  { key: "logs",   label: "실행 로그" },
];

const DELETE_MODES = [
  { key: "full",   label: "전체 삭제",   icon: "trash-2" as const,   desc: "운영자 계정·데이터·미디어 전부 삭제",       color: DANGER,    bg: "#FEE2E2" },
  { key: "period", label: "기간별 삭제", icon: "calendar" as const,  desc: "지정 기간 이전 데이터만 선택적 삭제",       color: "#D97706", bg: "#FEF3C7" },
  { key: "item",   label: "항목별 삭제", icon: "layers" as const,    desc: "회원/출석/강습/미디어 중 항목 선택 삭제", color: "#4F46E5", bg: "#EEF2FF" },
];

const DATA_ITEMS = ["회원", "출석 기록", "강습 기록", "미디어 파일", "알림 기록", "결제 기록"];

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function hoursLeft(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  if (h < 1) return "1시간 미만";
  return `${h}시간 후 삭제`;
}

export default function KillSwitchScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const operators          = useOperatorsStore(s => s.operators);
  const setOperatorStatus  = useOperatorsStore(s => s.setOperatorStatus);
  const scheduleAutoDelete = useOperatorsStore(s => s.scheduleAutoDelete);
  const auditLogs          = useAuditLogStore(s => s.logs);
  const createLog          = useAuditLogStore(s => s.createLog);

  const [tab,          setTab]          = useState("exec");
  const [deleteMode,   setDeleteMode]   = useState<string | null>(null);
  const [poolId,       setPoolId]       = useState("");
  const [poolName,     setPoolName]     = useState("");
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");
  const [selectedItems,setSelectedItems]= useState<string[]>([]);
  const [confirmModal, setConfirmModal] = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [actionLoading,setActionLoading]= useState<string | null>(null);

  const queueItems = operators.filter(o => !!o.autoDeleteScheduledAt);
  const deleteLogs = auditLogs.filter(l => l.category === '삭제');

  function deferDeletion(id: string) {
    setActionLoading(id);
    const at = new Date(Date.now() + 48 * 3600000).toISOString();
    scheduleAutoDelete(id, at);
    const op = operators.find(o => o.id === id);
    createLog({ category: '삭제', title: `삭제 유예 48h: ${op?.name ?? id}`, actorName, impact: 'medium' });
    setTimeout(() => setActionLoading(null), 500);
  }

  function executeDelete() {
    if (!poolId) return;
    setDeleting(true);
    setOperatorStatus(poolId, 'deleted' as any);
    createLog({
      category: '삭제',
      title: `데이터 삭제 실행: ${poolName || poolId} (${DELETE_MODES.find(m => m.key === deleteMode)?.label})`,
      actorName,
      impact: 'critical',
    });
    setTimeout(() => {
      setDeleting(false); setConfirmModal(false);
      setDeleteMode(null); setPoolId(""); setPoolName("");
    }, 800);
  }

  const toggleItem = (item: string) => {
    setSelectedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);
  };

  const canProceed = poolId && deleteMode &&
    (deleteMode === "full" || (deleteMode === "period" && fromDate && toDate) ||
     (deleteMode === "item" && selectedItems.length > 0));

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="데이터·킬스위치" homePath="/(super)/dashboard" />

      {/* 탭 */}
      <View style={s.tabRow}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── 삭제 실행 탭 ── */}
      {tab === "exec" && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 60 }}>
          {/* 경고 배너 */}
          <View style={s.warnBanner}>
            <Feather name="alert-octagon" size={16} color={DANGER} />
            <View style={{ flex: 1 }}>
              <Text style={s.warnTitle}>복구 불가 작업</Text>
              <Text style={s.warnDesc}>아래 작업은 실행 후 취소할 수 없습니다. 반드시 운영자 동의 및 법적 근거를 확인하세요.</Text>
            </View>
          </View>

          {/* 운영자 ID 입력 */}
          <View style={s.card}>
            <Text style={s.cardTitle}>대상 운영자</Text>
            <TextInput style={s.input} value={poolId} onChangeText={setPoolId}
              placeholder="운영자 ID 입력 (풀 ID)" placeholderTextColor="#9CA3AF" autoCapitalize="none" />
            <TextInput style={s.input} value={poolName} onChangeText={setPoolName}
              placeholder="운영자 이름 (확인용)" placeholderTextColor="#9CA3AF" />
            <Text style={s.inputHint}>빠른 선택: 삭제 예정 큐 탭에서 운영자를 확인하세요</Text>
          </View>

          {/* 삭제 방식 선택 */}
          <View style={s.card}>
            <Text style={s.cardTitle}>삭제 방식</Text>
            {DELETE_MODES.map(m => (
              <Pressable key={m.key} style={[s.modeRow, deleteMode === m.key && { borderColor: m.color, borderWidth: 2 }]}
                onPress={() => setDeleteMode(m.key)}>
                <View style={[s.modeIcon, { backgroundColor: m.bg }]}>
                  <Feather name={m.icon} size={16} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.modeLabel}>{m.label}</Text>
                  <Text style={s.modeDesc}>{m.desc}</Text>
                </View>
                <View style={[s.radio, deleteMode === m.key && { backgroundColor: m.color, borderColor: m.color }]}>
                  {deleteMode === m.key && <View style={s.radioDot} />}
                </View>
              </Pressable>
            ))}
          </View>

          {/* 기간별 삭제 옵션 */}
          {deleteMode === "period" && (
            <View style={s.card}>
              <Text style={s.cardTitle}>삭제 기간 설정</Text>
              <TextInput style={s.input} value={fromDate} onChangeText={setFromDate}
                placeholder="시작 날짜 (YYYY-MM-DD)" placeholderTextColor="#9CA3AF" />
              <TextInput style={s.input} value={toDate} onChangeText={setToDate}
                placeholder="종료 날짜 (YYYY-MM-DD)" placeholderTextColor="#9CA3AF" />
            </View>
          )}

          {/* 항목별 삭제 옵션 */}
          {deleteMode === "item" && (
            <View style={s.card}>
              <Text style={s.cardTitle}>삭제 항목 선택</Text>
              <View style={s.itemGrid}>
                {DATA_ITEMS.map(item => {
                  const isSelected = selectedItems.includes(item);
                  return (
                    <Pressable key={item} style={[s.itemBtn, isSelected && s.itemBtnActive]} onPress={() => toggleItem(item)}>
                      {isSelected && <Feather name="check" size={12} color={DANGER} />}
                      <Text style={[s.itemBtnTxt, isSelected && { color: DANGER }]}>{item}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* 예상 삭제 범위 표시 */}
          {canProceed && (
            <View style={s.previewBox}>
              <Feather name="info" size={14} color="#4F46E5" />
              <View style={{ flex: 1 }}>
                <Text style={s.previewTitle}>삭제 예상 범위</Text>
                <Text style={s.previewDesc}>
                  운영자: {poolName || poolId}{"\n"}
                  방식: {DELETE_MODES.find(m => m.key === deleteMode)?.label}{"\n"}
                  {deleteMode === "period" && `기간: ${fromDate} ~ ${toDate}\n`}
                  {deleteMode === "item" && `항목: ${selectedItems.join(", ")}\n`}
                  ※ 실행 후 복구 불가
                </Text>
              </View>
            </View>
          )}

          <Pressable
            style={[s.execBtn, !canProceed && { opacity: 0.4 }]}
            onPress={() => { if (canProceed) setConfirmModal(true); }}
            disabled={!canProceed}>
            <Feather name="alert-triangle" size={16} color="#fff" />
            <Text style={s.execBtnTxt}>삭제 실행</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ── 삭제 예정 큐 탭 ── */}
      {tab === "queue" && (
          <FlatList
            data={queueItems}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
            refreshControl={<RefreshControl refreshing={false} tintColor={DANGER} onRefresh={() => {}} />}
            renderItem={({ item }) => (
              <View style={s.queueRow}>
                <View style={s.queueLeft}>
                  <Text style={s.queueName}>{item.name}</Text>
                  <Text style={s.queueSub}>{item.representativeName}</Text>
                  <Text style={[s.queueTimer, { color: DANGER }]}>{hoursLeft(item.autoDeleteScheduledAt)}</Text>
                </View>
                <View style={s.queueActions}>
                  <Pressable style={[s.qBtn, { backgroundColor: "#FEF3C7" }]}
                    onPress={() => deferDeletion(item.id)} disabled={actionLoading === item.id}>
                    {actionLoading === item.id
                      ? <ActivityIndicator size="small" color="#D97706" />
                      : <><Feather name="clock" size={12} color="#D97706" /><Text style={[s.qBtnTxt, { color: "#D97706" }]}>48h 유예</Text></>}
                  </Pressable>
                  <Pressable style={[s.qBtn, { backgroundColor: "#EDE9FE" }]}
                    onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
                    <Feather name="eye" size={12} color="#7C3AED" />
                    <Text style={[s.qBtnTxt, { color: "#7C3AED" }]}>상세</Text>
                  </Pressable>
                  <Pressable style={[s.qBtn, { backgroundColor: "#FEE2E2" }]}
                    onPress={() => { setTab("exec"); setPoolId(item.id); setPoolName(item.name); }}>
                    <Feather name="trash-2" size={12} color={DANGER} />
                    <Text style={[s.qBtnTxt, { color: DANGER }]}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Feather name="check-circle" size={30} color="#10B981" />
                <Text style={s.emptyTxt}>삭제 예정 운영자가 없습니다</Text>
              </View>
            }
          />
      )}

      {/* ── 실행 로그 탭 ── */}
      {tab === "logs" && (
          <FlatList
            data={deleteLogs}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 80 }}
            refreshControl={<RefreshControl refreshing={false} tintColor={DANGER} onRefresh={() => {}} />}
            renderItem={({ item }) => (
              <View style={s.logRow}>
                <View style={s.logDot} />
                <View style={{ flex: 1 }}>
                  <Text style={s.logDesc}>{item.title}</Text>
                  <View style={s.logMeta}>
                    <Text style={s.logMetaTxt}>{item.operatorName ?? "—"}</Text>
                    <Text style={s.logMetaDot}>·</Text>
                    <Text style={s.logMetaTxt}>{item.actorName}</Text>
                    <Text style={s.logMetaDot}>·</Text>
                    <Text style={s.logMetaTxt}>{fmtDate(item.createdAt)}</Text>
                  </View>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <Feather name="activity" size={28} color="#D1D5DB" />
                <Text style={s.emptyTxt}>실행 로그가 없습니다</Text>
              </View>
            }
          />
      )}

      {/* 삭제 확인 모달 */}
      {confirmModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setConfirmModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setConfirmModal(false)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <View style={m.dangerHeader}>
                <Feather name="alert-octagon" size={24} color={DANGER} />
                <Text style={m.dangerTitle}>정말 삭제하시겠습니까?</Text>
              </View>
              <View style={m.dangerBox}>
                <Text style={m.dangerInfo}>
                  운영자: {poolName || poolId}{"\n"}
                  방식: {DELETE_MODES.find(m2 => m2.key === deleteMode)?.label}{"\n"}
                  {deleteMode === "period" && `기간: ${fromDate} ~ ${toDate}\n`}
                  {deleteMode === "item" && `항목: ${selectedItems.join(", ")}\n`}
                  {"\n"}이 작업은 절대 취소할 수 없습니다.
                </Text>
              </View>

              <View style={m.section}>
                <Text style={m.label}>확인을 위해 "영구삭제"를 입력하세요</Text>
                <TextInput style={[m.input, { borderColor: confirmText === "영구삭제" ? DANGER : "#E5E7EB" }]}
                  value={confirmText} onChangeText={setConfirmText}
                  placeholder="영구삭제" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setConfirmModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.deleteBtn, { opacity: confirmText !== "영구삭제" || deleting ? 0.4 : 1 }]}
                  onPress={executeDelete} disabled={confirmText !== "영구삭제" || deleting}>
                  {deleting ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="trash-2" size={14} color="#fff" /><Text style={m.deleteTxt}>영구 삭제 실행</Text></>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FFF5F5" },
  tabRow:       { flexDirection: "row", backgroundColor: "#fff",
                  borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:          { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: DANGER },
  tabTxt:       { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  tabTxtActive: { color: DANGER, fontFamily: "Inter_700Bold" },
  warnBanner:   { flexDirection: "row", alignItems: "flex-start", gap: 10,
                  backgroundColor: "#FEE2E2", borderRadius: 12, padding: 14 },
  warnTitle:    { fontSize: 14, fontFamily: "Inter_700Bold", color: DANGER },
  warnDesc:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#7F1D1D", lineHeight: 18, marginTop: 2 },
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 10,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  cardTitle:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  input:        { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                  fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  inputHint:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  modeRow:      { flexDirection: "row", alignItems: "center", gap: 12,
                  borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12 },
  modeIcon:     { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeLabel:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  modeDesc:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  radio:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D1D5DB",
                  alignItems: "center", justifyContent: "center" },
  radioDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  itemGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  itemBtn:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                  borderWidth: 1.5, borderColor: "#E5E7EB", flexDirection: "row", alignItems: "center", gap: 5 },
  itemBtnActive:{ borderColor: DANGER, backgroundColor: "#FEE2E2" },
  itemBtnTxt:   { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  previewBox:   { flexDirection: "row", gap: 10, backgroundColor: "#EEF2FF",
                  borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#C7D2FE" },
  previewTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#4F46E5" },
  previewDesc:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 20, marginTop: 4 },
  execBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  backgroundColor: DANGER, borderRadius: 14, paddingVertical: 16 },
  execBtnTxt:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  queueRow:     { backgroundColor: "#fff", borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: "#FECACA", gap: 8 },
  queueLeft:    { gap: 2 },
  queueName:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  queueSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  queueTimer:   { fontSize: 12, fontFamily: "Inter_700Bold" },
  queueActions: { flexDirection: "row", gap: 8 },
  qBtn:         { flexDirection: "row", alignItems: "center", gap: 5,
                  paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  qBtnTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  logRow:       { flexDirection: "row", alignItems: "flex-start", gap: 10,
                  backgroundColor: "#fff", borderRadius: 10, padding: 12,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  logDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: DANGER, marginTop: 4, flexShrink: 0 },
  logDesc:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },
  logMeta:      { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  logMetaTxt:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  logMetaDot:   { fontSize: 9, color: "#D1D5DB" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                  borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40,
                  maxHeight: "75%", gap: 14 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  dangerHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dangerTitle:  { fontSize: 17, fontFamily: "Inter_700Bold", color: DANGER },
  dangerBox:    { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 14,
                  borderWidth: 1, borderColor: "#FECACA" },
  dangerInfo:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#7F1D1D", lineHeight: 20 },
  section:      { gap: 6 },
  label:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:        { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                  fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  btnRow:       { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:    { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  deleteBtn:    { flexDirection: "row", alignItems: "center", gap: 6,
                  paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: DANGER },
  deleteTxt:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
});
