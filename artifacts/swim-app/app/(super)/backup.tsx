/**
 * (super)/backup.tsx — 백업/복구/스냅샷
 * 스냅샷 생성, 단일 복구, 비교 복구 (diff 확인 → 실행)
 * 주의: 사진/영상 원본 복구 금지
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useBackupStore, type BackupRecord } from "@/store";
import { fmtDateTime, fmtRelative, fmtBytes, createAuditLog } from "@/utils/super-utils";

const P = "#7C3AED";

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "대기 중",  color: "#D97706", bg: "#FEF3C7" },
  running:  { label: "진행 중",  color: "#0891B2", bg: "#ECFEFF" },
  done:     { label: "완료",     color: "#059669", bg: "#D1FAE5" },
  failed:   { label: "실패",     color: "#DC2626", bg: "#FEE2E2" },
};

const TABS = [
  { key: "all",      label: "전체" },
  { key: "snapshot", label: "스냅샷" },
  { key: "operator", label: "운영자 백업" },
  { key: "platform", label: "플랫폼 백업" },
];

function BackupCard({
  item,
  onRestore,
  isCompareSelected,
  onToggleCompare,
}: {
  item: BackupRecord;
  onRestore: (item: BackupRecord) => void;
  isCompareSelected: boolean;
  onToggleCompare: (item: BackupRecord) => void;
}) {
  const cfg = STATUS_CFG[item.status] ?? STATUS_CFG.done;
  return (
    <View style={[bc.card, isCompareSelected && bc.cardSelected]}>
      <View style={bc.top}>
        <View style={[bc.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[bc.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {item.is_snapshot && (
          <View style={[bc.badge, { backgroundColor: "#EDE9FE" }]}>
            <Text style={[bc.badgeTxt, { color: P }]}>스냅샷</Text>
          </View>
        )}
        <Text style={bc.type}>{item.backup_type === "platform" ? "플랫폼 전체" : "운영자"}</Text>
        <Text style={bc.time}>{fmtRelative(item.created_at)}</Text>
      </View>

      <Text style={bc.name}>
        {item.operator_name ?? (item.backup_type === "platform" ? "플랫폼 전체" : "알 수 없음")}
      </Text>

      <View style={bc.meta}>
        {item.size_bytes != null && (
          <View style={bc.metaItem}>
            <Feather name="hard-drive" size={11} color="#6B7280" />
            <Text style={bc.metaVal}>{fmtBytes(item.size_bytes)}</Text>
          </View>
        )}
        <View style={bc.metaItem}>
          <Feather name="clock" size={11} color="#6B7280" />
          <Text style={bc.metaVal}>{fmtDateTime(item.created_at)}</Text>
        </View>
        {item.note && (
          <View style={bc.metaItem}>
            <Feather name="file-text" size={11} color="#6B7280" />
            <Text style={bc.metaVal} numberOfLines={1}>{item.note}</Text>
          </View>
        )}
      </View>

      <View style={bc.actions}>
        {item.status === "done" && (
          <Pressable style={[bc.btn, { backgroundColor: "#FEE2E2" }]} onPress={() => onRestore(item)}>
            <Feather name="rotate-ccw" size={12} color="#DC2626" />
            <Text style={[bc.btnTxt, { color: "#DC2626" }]}>복구</Text>
          </Pressable>
        )}
        <Pressable
          style={[bc.btn, { backgroundColor: isCompareSelected ? "#EDE9FE" : "#F3F4F6" }]}
          onPress={() => onToggleCompare(item)}
        >
          <Feather name="shuffle" size={12} color={isCompareSelected ? P : "#6B7280"} />
          <Text style={[bc.btnTxt, { color: isCompareSelected ? P : "#6B7280" }]}>비교 선택</Text>
        </Pressable>
      </View>
    </View>
  );
}

const bc = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10,
                 borderWidth: 1, borderColor: "#E5E7EB" },
  cardSelected:{ borderColor: P, borderWidth: 2 },
  top:         { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  badge:       { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt:    { fontSize: 10, fontFamily: "Inter_700Bold" },
  type:        { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280" },
  time:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
  name:        { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 8 },
  meta:        { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  metaItem:    { flexDirection: "row", alignItems: "center", gap: 4 },
  metaVal:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  actions:     { flexDirection: "row", gap: 8 },
  btn:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                 paddingVertical: 6, borderRadius: 7 },
  btnTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ── 복구 확인 모달 ────────────────────────────────────────────────
function RestoreModal({
  target,
  onClose,
  onConfirm,
}: {
  target: BackupRecord | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  if (!target) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F9FAFB" }} edges={["top"]}>
        <View style={rm.header}>
          <Pressable onPress={onClose}><Feather name="x" size={20} color="#6B7280" /></Pressable>
          <Text style={rm.title}>데이터 복구</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={rm.warningBox}>
            <Feather name="alert-triangle" size={20} color="#D97706" />
            <Text style={rm.warningTxt}>
              사진 및 영상 원본은 복구되지 않습니다.{"\n"}
              메타데이터 및 텍스트 데이터만 복구됩니다.
            </Text>
          </View>

          <View style={rm.infoBox}>
            <Text style={rm.infoLabel}>복구 대상</Text>
            <Text style={rm.infoVal}>{target.operator_name ?? "플랫폼 전체"}</Text>
            <Text style={rm.infoLabel}>백업 일시</Text>
            <Text style={rm.infoVal}>{fmtDateTime(target.created_at)}</Text>
            {target.size_bytes != null && (
              <>
                <Text style={rm.infoLabel}>백업 크기</Text>
                <Text style={rm.infoVal}>{fmtBytes(target.size_bytes)}</Text>
              </>
            )}
          </View>

          <View style={rm.diffBox}>
            <Text style={rm.diffTitle}>복구 예정 항목 (diff)</Text>
            {["출결 기록", "일지/메모", "쪽지", "회원 정보", "수업 일정"].map((item) => (
              <View key={item} style={rm.diffRow}>
                <Feather name="check-circle" size={14} color="#059669" />
                <Text style={rm.diffItem}>{item}</Text>
              </View>
            ))}
            <View style={rm.diffRow}>
              <Feather name="x-circle" size={14} color="#DC2626" />
              <Text style={[rm.diffItem, { color: "#DC2626" }]}>사진/영상 원본 (복구 불가)</Text>
            </View>
          </View>

          <View>
            <Text style={rm.inputLabel}>복구 사유 (필수)</Text>
            <TextInput
              style={rm.input}
              value={reason}
              onChangeText={setReason}
              placeholder="복구 사유를 입력하세요"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          <Pressable
            style={[rm.confirmBtn, !reason.trim() && { opacity: 0.4 }]}
            onPress={() => { if (reason.trim()) onConfirm(reason); }}
            disabled={!reason.trim()}
          >
            <Feather name="rotate-ccw" size={16} color="#fff" />
            <Text style={rm.confirmTxt}>복구 실행</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const rm = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                 padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:       { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  warningBox:  { flexDirection: "row", alignItems: "flex-start", gap: 10,
                 backgroundColor: "#FEF3C7", borderRadius: 10, padding: 14 },
  warningTxt:  { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#92400E", lineHeight: 20 },
  infoBox:     { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 14, gap: 4 },
  infoLabel:   { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  infoVal:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 6 },
  diffBox:     { backgroundColor: "#fff", borderRadius: 10, padding: 14, gap: 8,
                 borderWidth: 1, borderColor: "#E5E7EB" },
  diffTitle:   { fontSize: 12, fontFamily: "Inter_700Bold", color: "#374151", marginBottom: 4 },
  diffRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  diffItem:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#374151" },
  inputLabel:  { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:       { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8,
                 padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", height: 90 },
  confirmBtn:  { backgroundColor: "#DC2626", borderRadius: 10, flexDirection: "row", alignItems: "center",
                 justifyContent: "center", gap: 8, padding: 15 },
  confirmTxt:  { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ── 비교 복구 모달 ────────────────────────────────────────────────
function CompareModal({
  items,
  onClose,
}: {
  items: BackupRecord[];
  onClose: () => void;
}) {
  if (items.length < 2) return null;
  const [a, b] = items;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent>
      <View style={cm.overlay}>
        <Pressable style={cm.backdrop} onPress={onClose} />
        <View style={cm.sheet}>
          <View style={cm.header}>
            <Text style={cm.title}>스냅샷 비교</Text>
            <Pressable onPress={onClose}><Feather name="x" size={18} color="#6B7280" /></Pressable>
          </View>
          <View style={cm.row}>
            <View style={cm.col}>
              <Text style={cm.colLabel}>백업 A</Text>
              <Text style={cm.colName}>{a.operator_name ?? "플랫폼"}</Text>
              <Text style={cm.colDate}>{fmtDateTime(a.created_at)}</Text>
              <Text style={cm.colSize}>{fmtBytes(a.size_bytes ?? 0)}</Text>
            </View>
            <View style={cm.divider}><Feather name="shuffle" size={20} color={P} /></View>
            <View style={cm.col}>
              <Text style={cm.colLabel}>백업 B</Text>
              <Text style={cm.colName}>{b.operator_name ?? "플랫폼"}</Text>
              <Text style={cm.colDate}>{fmtDateTime(b.created_at)}</Text>
              <Text style={cm.colSize}>{fmtBytes(b.size_bytes ?? 0)}</Text>
            </View>
          </View>
          <View style={cm.diffSection}>
            <Text style={cm.diffTitle}>예상 변경사항 (시뮬레이션)</Text>
            {[
              ["출결 기록", "+12건", "#059669"],
              ["일지",     "+5건",  "#059669"],
              ["회원 정보", "변경 없음", "#6B7280"],
              ["사진/영상", "복구 불가", "#DC2626"],
            ].map(([k, v, c]) => (
              <View key={k} style={cm.diffRow}>
                <Text style={cm.diffKey}>{k}</Text>
                <Text style={[cm.diffVal, { color: c }]}>{v}</Text>
              </View>
            ))}
          </View>
          <Pressable style={cm.closeBtn} onPress={onClose}>
            <Text style={cm.closeBtnTxt}>닫기</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const cm = StyleSheet.create({
  overlay:    { flex: 1, justifyContent: "flex-end" },
  backdrop:   { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  row:        { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  col:        { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12 },
  colLabel:   { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  colName:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827", marginTop: 4 },
  colDate:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  colSize:    { fontSize: 11, fontFamily: "Inter_600SemiBold", color: P, marginTop: 4 },
  divider:    { width: 32, alignItems: "center" },
  diffSection:{ backgroundColor: "#F9FAFB", borderRadius: 10, padding: 14, gap: 8, marginBottom: 16 },
  diffTitle:  { fontSize: 12, fontFamily: "Inter_700Bold", color: "#374151", marginBottom: 4 },
  diffRow:    { flexDirection: "row", justifyContent: "space-between" },
  diffKey:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151" },
  diffVal:    { fontSize: 12, fontFamily: "Inter_700Bold" },
  closeBtn:   { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 14, alignItems: "center" },
  closeBtnTxt:{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
});

// ── 생성 모달 ─────────────────────────────────────────────────────
function CreateModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (type: "operator" | "platform", isSnapshot: boolean, operatorId: string, note: string) => void;
}) {
  const [type, setType] = useState<"operator" | "platform">("platform");
  const [isSnapshot, setIsSnapshot] = useState(false);
  const [operatorId, setOperatorId] = useState("");
  const [note, setNote] = useState("");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F9FAFB" }} edges={["top"]}>
        <View style={cr.header}>
          <Pressable onPress={onClose}><Feather name="x" size={20} color="#6B7280" /></Pressable>
          <Text style={cr.title}>백업/스냅샷 생성</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View>
            <Text style={cr.label}>백업 유형</Text>
            <View style={cr.segRow}>
              {(["platform", "operator"] as const).map((t) => (
                <Pressable key={t} style={[cr.seg, type === t && cr.segActive]} onPress={() => setType(t)}>
                  <Text style={[cr.segTxt, type === t && cr.segActiveTxt]}>
                    {t === "platform" ? "플랫폼 전체" : "운영자별"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {type === "operator" && (
            <View>
              <Text style={cr.label}>운영자 ID (풀 ID)</Text>
              <TextInput style={cr.input} value={operatorId} onChangeText={setOperatorId}
                placeholder="swimming_pool ID를 입력하세요" />
            </View>
          )}

          <View style={cr.switchRow}>
            <Text style={cr.label}>스냅샷으로 저장</Text>
            <Pressable
              style={[cr.toggle, isSnapshot && cr.toggleOn]}
              onPress={() => setIsSnapshot((v) => !v)}
            >
              <View style={[cr.toggleDot, isSnapshot && cr.toggleDotOn]} />
            </Pressable>
          </View>

          <View>
            <Text style={cr.label}>메모 (선택)</Text>
            <TextInput style={cr.input} value={note} onChangeText={setNote}
              placeholder="이 백업에 대한 메모를 입력하세요" multiline numberOfLines={2} />
          </View>

          <Pressable
            style={cr.confirmBtn}
            onPress={() => onCreate(type, isSnapshot, operatorId, note)}
          >
            <Feather name={isSnapshot ? "camera" : "save"} size={16} color="#fff" />
            <Text style={cr.confirmTxt}>{isSnapshot ? "스냅샷 생성" : "백업 생성"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const cr = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:        { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  label:        { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 8 },
  segRow:       { flexDirection: "row", gap: 8 },
  seg:          { flex: 1, padding: 10, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center" },
  segActive:    { backgroundColor: P },
  segTxt:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  segActiveTxt: { color: "#fff" },
  input:        { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8,
                  padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  switchRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  toggle:       { width: 48, height: 26, borderRadius: 13, backgroundColor: "#D1D5DB",
                  justifyContent: "center", padding: 2 },
  toggleOn:     { backgroundColor: P },
  toggleDot:    { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  toggleDotOn:  { alignSelf: "flex-end" },
  confirmBtn:   { backgroundColor: P, borderRadius: 10, flexDirection: "row", alignItems: "center",
                  justifyContent: "center", gap: 8, padding: 15 },
  confirmTxt:   { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function BackupScreen() {
  const { token, adminUser } = useAuth();
  const { backups, setBackups, loadingBackups, setLoadingBackups, addBackup } = useBackupStore();
  const [activeTab, setActiveTab] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [compareItems, setCompareItems] = useState<BackupRecord[]>([]);
  const [operating, setOperating] = useState(false);

  const load = useCallback(async () => {
    setLoadingBackups(true);
    try {
      const res = await apiRequest(token, "/super/backups");
      if (res.ok) {
        const d = await res.json();
        setBackups(d.backups ?? []);
      }
    } catch {}
    finally { setLoadingBackups(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, []);

  const filtered = backups.filter((b) => {
    if (activeTab === "snapshot") return b.is_snapshot;
    if (activeTab === "operator") return b.backup_type === "operator" && !b.is_snapshot;
    if (activeTab === "platform") return b.backup_type === "platform" && !b.is_snapshot;
    return true;
  });

  async function handleCreate(
    type: "operator" | "platform", isSnapshot: boolean, operatorId: string, note: string
  ) {
    setOperating(true);
    try {
      const res = await apiRequest(token, "/super/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: type === "operator" ? operatorId || null : null,
          backup_type: type,
          is_snapshot: isSnapshot,
          note: note || null,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        addBackup({
          id: d.id, operator_id: type === "operator" ? operatorId : undefined,
          backup_type: type, status: "done", is_snapshot: isSnapshot,
          note: note || undefined, created_at: new Date().toISOString(),
        });
        await createAuditLog(token, apiRequest, {
          category: "백업",
          title: isSnapshot ? "스냅샷 생성" : "백업 생성",
          actor: adminUser?.name ?? "슈퍼관리자",
          impact: "medium",
          detail: `유형: ${type}, 스냅샷: ${isSnapshot}`,
        });
        setCreateVisible(false);
        Alert.alert("완료", isSnapshot ? "스냅샷이 생성되었습니다." : "백업이 생성되었습니다.");
      }
    } catch {}
    finally { setOperating(false); }
  }

  async function handleRestore(reason: string) {
    if (!restoreTarget) return;
    setOperating(true);
    try {
      const res = await apiRequest(token, `/super/backups/${restoreTarget.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        await createAuditLog(token, apiRequest, {
          category: "백업",
          title: `데이터 복구 실행: ${restoreTarget.operator_name ?? "플랫폼"}`,
          actor: adminUser?.name ?? "슈퍼관리자",
          impact: "critical",
          reason,
          detail: `백업 ID: ${restoreTarget.id}`,
        });
        setRestoreTarget(null);
        Alert.alert("복구 완료", "데이터 복구가 기록되었습니다.\n(미디어 원본은 복구되지 않습니다.)");
      }
    } catch {}
    finally { setOperating(false); }
  }

  function toggleCompare(item: BackupRecord) {
    setCompareItems((prev) => {
      if (prev.some((b) => b.id === item.id)) return prev.filter((b) => b.id !== item.id);
      if (prev.length >= 2) return [prev[1], item];
      return [...prev, item];
    });
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="백업/복구/스냅샷" subtitle="운영자 데이터 보호 및 복구" />

      <View style={s.topBar}>
        <Pressable
          style={[s.createBtn, operating && { opacity: 0.5 }]}
          onPress={() => setCreateVisible(true)}
          disabled={operating}
        >
          <Feather name="save" size={14} color="#fff" />
          <Text style={s.createBtnTxt}>새 백업/스냅샷</Text>
        </Pressable>

        {compareItems.length === 2 && (
          <Pressable
            style={s.compareBtn}
            onPress={() => {}}
          >
            <Feather name="shuffle" size={14} color={P} />
            <Text style={[s.createBtnTxt, { color: P }]}>비교 보기 (2개 선택)</Text>
          </Pressable>
        )}
      </View>

      {compareItems.length > 0 && (
        <View style={s.compareBar}>
          <Feather name="info" size={13} color="#0891B2" />
          <Text style={s.compareBarTxt}>
            {compareItems.length}개 선택됨 — {compareItems.length < 2 ? "1개 더 선택하세요" : "비교 준비됨"}
          </Text>
          {compareItems.length === 2 && (
            <Pressable onPress={() => setCompareItems([])} style={s.clearCompare}>
              <Text style={s.clearCompareTxt}>초기화</Text>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabRow} style={{ flexGrow: 0 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={[s.tab, activeTab === t.key && s.tabActive]}
            onPress={() => setActiveTab(t.key)}>
            <Text style={[s.tabTxt, activeTab === t.key && s.tabActiveTxt]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loadingBackups && !refreshing ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BackupCard
              item={item}
              onRestore={setRestoreTarget}
              isCompareSelected={compareItems.some((b) => b.id === item.id)}
              onToggleCompare={toggleCompare}
            />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="save" size={36} color="#D1D5DB" />
              <Text style={s.emptyTxt}>백업 기록이 없습니다</Text>
              <Text style={s.emptySubTxt}>새 백업 또는 스냅샷을 생성하세요</Text>
            </View>
          }
        />
      )}

      <CreateModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreate={handleCreate}
      />

      <RestoreModal
        target={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
      />

      {compareItems.length === 2 && (
        <CompareModal
          items={compareItems}
          onClose={() => setCompareItems([])}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F9FAFB" },
  topBar:         { flexDirection: "row", gap: 8, margin: 16, marginBottom: 0 },
  createBtn:      { flexDirection: "row", alignItems: "center", gap: 6, flex: 1,
                    backgroundColor: P, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  createBtnTxt:   { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  compareBtn:     { flexDirection: "row", alignItems: "center", gap: 6, flex: 1,
                    backgroundColor: "#EDE9FE", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  compareBar:     { flexDirection: "row", alignItems: "center", gap: 6,
                    backgroundColor: "#ECFEFF", marginHorizontal: 16, marginTop: 10,
                    borderRadius: 8, padding: 10 },
  compareBarTxt:  { fontSize: 12, fontFamily: "Inter_500Medium", color: "#0891B2", flex: 1 },
  clearCompare:   { marginLeft: "auto" },
  clearCompareTxt:{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  tabRow:         { paddingHorizontal: 16, gap: 8, paddingTop: 12, paddingBottom: 4 },
  tab:            { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: "#F3F4F6" },
  tabActive:      { backgroundColor: P },
  tabTxt:         { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  tabActiveTxt:   { color: "#fff" },
  empty:          { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTxt:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  emptySubTxt:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#D1D5DB" },
});
