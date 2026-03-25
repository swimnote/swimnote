/**
 * (super)/backup.tsx — 백업/복구 관리 (실제 API 연동)
 *
 * GET  /super/backups             — 백업 목록
 * POST /super/backups             — 수동 백업 생성
 * GET  /super/backup-settings     — 자동 백업 설정 조회
 * PUT  /super/backup-settings     — 자동 백업 설정 변경
 * POST /super/backups/:id/restore — 복구 기록
 * GET  /super/backups/:id/download — 다운로드
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, Share, StyleSheet, Switch,
  Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";
const GREEN = "#1F8F86";
const DANGER = "#D96C6C";
const WARN = "#D97706";

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface BackupRecord {
  id: string;
  operator_name: string | null;
  backup_type: string;
  backup_type_v2: "manual" | "auto";
  status: "pending" | "running" | "done" | "failed";
  is_snapshot: boolean;
  size_bytes: number | null;
  note: string | null;
  file_path: string | null;
  file_name: string | null;
  storage_type: "database" | "object_storage" | null;
  super_db_tables: number | null;
  pool_db_tables: number | null;
  total_tables: number | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

interface BackupSettings {
  auto_enabled: boolean;
  schedule_type: "daily" | "every_6h" | "every_12h" | "weekly";
  run_hour: number;
  run_minute: number;
  retention_days: number;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, "0");
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "대기 중", color: WARN,    bg: "#FFF1BF" },
  running: { label: "진행 중", color: GREEN,   bg: "#ECFEFF" },
  done:    { label: "완료",    color: GREEN,   bg: "#DDF2EF" },
  failed:  { label: "실패",    color: DANGER,  bg: "#F9DEDA" },
};

const TABS = [
  { key: "all",    label: "전체" },
  { key: "manual", label: "수동 백업" },
  { key: "auto",   label: "자동 백업" },
];

const SCHEDULE_OPTIONS: { key: BackupSettings["schedule_type"]; label: string }[] = [
  { key: "daily",     label: "매일" },
  { key: "every_12h", label: "12시간마다" },
  { key: "every_6h",  label: "6시간마다" },
  { key: "weekly",    label: "매주 일요일" },
];

// ── 백업 카드 ─────────────────────────────────────────────────────────────────
function BackupCard({
  item,
  onRestore,
  onDownload,
}: {
  item: BackupRecord;
  onRestore: (item: BackupRecord) => void;
  onDownload: (item: BackupRecord) => void;
}) {
  const cfg = STATUS_CFG[item.status] ?? STATUS_CFG.done;
  const isAuto = item.backup_type_v2 === "auto";

  return (
    <View style={bc.card}>
      <View style={bc.top}>
        <View style={[bc.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[bc.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={[bc.badge, { backgroundColor: isAuto ? "#ECFEFF" : "#EEDDF5" }]}>
          <Text style={[bc.badgeTxt, { color: isAuto ? GREEN : P }]}>{isAuto ? "자동" : "수동"}</Text>
        </View>
        {item.storage_type === "database" && (
          <View style={[bc.badge, { backgroundColor: "#FFF1BF" }]}>
            <Text style={[bc.badgeTxt, { color: WARN }]}>DB저장</Text>
          </View>
        )}
        <Text style={bc.time}>{fmtRelative(item.created_at)}</Text>
      </View>

      <Text style={bc.name}>{item.operator_name || "전체 통합 백업"}</Text>

      <View style={bc.meta}>
        {item.total_tables != null && (
          <View style={bc.metaItem}>
            <Feather name="layers" size={11} color="#6F6B68" />
            <Text style={bc.metaVal}>{item.total_tables}개 테이블</Text>
          </View>
        )}
        <View style={bc.metaItem}>
          <Feather name="hard-drive" size={11} color="#6F6B68" />
          <Text style={bc.metaVal}>{fmtSize(item.size_bytes)}</Text>
        </View>
        <View style={bc.metaItem}>
          <Feather name="clock" size={11} color="#6F6B68" />
          <Text style={bc.metaVal}>{fmtDateTime(item.created_at)}</Text>
        </View>
        {item.created_by && (
          <View style={bc.metaItem}>
            <Feather name="user" size={11} color="#6F6B68" />
            <Text style={bc.metaVal}>{item.created_by}</Text>
          </View>
        )}
        {item.note && (
          <View style={bc.metaItem}>
            <Feather name="file-text" size={11} color="#6F6B68" />
            <Text style={bc.metaVal} numberOfLines={1}>{item.note}</Text>
          </View>
        )}
      </View>

      {item.status === "done" && (
        <View style={bc.actions}>
          <Pressable style={[bc.btn, { backgroundColor: "#EFF6FF" }]} onPress={() => onDownload(item)}>
            <Feather name="download" size={12} color="#0284C7" />
            <Text style={[bc.btnTxt, { color: "#0284C7" }]}>다운로드</Text>
          </Pressable>
          <Pressable style={[bc.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => onRestore(item)}>
            <Feather name="rotate-ccw" size={12} color={DANGER} />
            <Text style={[bc.btnTxt, { color: DANGER }]}>복구</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const bc = StyleSheet.create({
  card:     { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#E9E2DD" },
  top:      { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  badge:    { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },
  time:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginLeft: "auto" },
  name:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 8 },
  meta:     { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaVal:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  actions:  { flexDirection: "row", gap: 8 },
  btn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  btnTxt:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ── 수동 백업 생성 모달 ───────────────────────────────────────────────────────
function CreateModal({
  visible, busy, onClose, onCreate,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#FBF8F6" }} edges={["top"]}>
        <View style={cr.header}>
          <Pressable onPress={onClose} disabled={busy}><Feather name="x" size={20} color="#6F6B68" /></Pressable>
          <Text style={cr.title}>수동 백업 생성</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
          <View style={cr.infoBox}>
            <Feather name="info" size={14} color="#0284C7" />
            <Text style={cr.infoTxt}>
              슈퍼관리자 DB와 수영장 운영 DB 전체를 백업합니다.{"\n"}
              소요 시간: 약 10~30초 (DB 크기에 따라 다름)
            </Text>
          </View>
          <View>
            <Text style={cr.label}>메모 (선택)</Text>
            <TextInput style={cr.input} value={note} onChangeText={setNote} editable={!busy}
              placeholder="이 백업에 대한 메모를 입력하세요" placeholderTextColor="#9A948F"
              multiline numberOfLines={2} />
          </View>
          <Pressable style={[cr.confirmBtn, busy && { opacity: 0.5 }]} onPress={() => onCreate(note)} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#fff" size="small" />
              : <Feather name="save" size={16} color="#fff" />
            }
            <Text style={cr.confirmTxt}>{busy ? "백업 생성 중..." : "백업 생성"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const cr = StyleSheet.create({
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  title:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  label:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", marginBottom: 8 },
  input:      { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  confirmBtn: { backgroundColor: P, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 15 },
  confirmTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  infoBox:    { flexDirection: "row", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 8, padding: 12, alignItems: "flex-start" },
  infoTxt:    { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#0284C7", lineHeight: 18 },
});

// ── 복구 확인 모달 ────────────────────────────────────────────────────────────
function RestoreModal({ target, onClose, onConfirm, busy }: {
  target: BackupRecord | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  if (!target) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#FBF8F6" }} edges={["top"]}>
        <View style={rm.header}>
          <Pressable onPress={onClose} disabled={busy}><Feather name="x" size={20} color="#6F6B68" /></Pressable>
          <Text style={rm.title}>데이터 복구</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
          <View style={rm.warningBox}>
            <Feather name="alert-triangle" size={20} color={WARN} />
            <Text style={rm.warningTxt}>
              사진 및 영상 원본은 복구되지 않습니다.{"\n"}메타데이터 및 텍스트 데이터만 복구됩니다.
            </Text>
          </View>
          <View style={rm.infoBox}>
            <Text style={rm.infoLabel}>백업 일시</Text>
            <Text style={rm.infoVal}>{fmtDateTime(target.created_at)}</Text>
            <Text style={rm.infoLabel}>백업 크기</Text>
            <Text style={rm.infoVal}>{fmtSize(target.size_bytes)}</Text>
            {target.total_tables != null && (
              <>
                <Text style={rm.infoLabel}>테이블 수</Text>
                <Text style={rm.infoVal}>{target.total_tables}개</Text>
              </>
            )}
          </View>
          <View>
            <Text style={rm.inputLabel}>복구 사유 (필수)</Text>
            <TextInput style={rm.input} value={reason} onChangeText={setReason} editable={!busy}
              placeholder="복구 사유를 입력하세요" placeholderTextColor="#9A948F"
              multiline numberOfLines={3} textAlignVertical="top" />
          </View>
          <Pressable style={[rm.confirmBtn, (!reason.trim() || busy) && { opacity: 0.4 }]}
            onPress={() => { if (reason.trim()) onConfirm(reason); }}
            disabled={!reason.trim() || busy}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="rotate-ccw" size={16} color="#fff" />}
            <Text style={rm.confirmTxt}>{busy ? "처리 중..." : "복구 실행"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const rm = StyleSheet.create({
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  title:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#FFF1BF", borderRadius: 10, padding: 14 },
  warningTxt: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#92400E", lineHeight: 20 },
  infoBox:    { backgroundColor: "#FBF8F6", borderRadius: 10, padding: 14, gap: 4 },
  infoLabel:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  infoVal:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 6 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", marginBottom: 6 },
  input:      { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F", height: 90 },
  confirmBtn: { backgroundColor: DANGER, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 15 },
  confirmTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ── 자동 백업 설정 패널 ───────────────────────────────────────────────────────
function AutoBackupPanel({ token }: { token: string | null }) {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [draft, setDraft]       = useState<BackupSettings | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/super/backup-settings")
      .then(r => r.json())
      .then((d: any) => { setSettings(d.settings); setDraft(d.settings); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  async function saveSettings() {
    if (!draft || !token) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, "/super/backup-settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "저장 실패");
      setSettings(d.settings);
      setDraft(d.settings);
      Alert.alert("저장 완료", "자동 백업 설정이 업데이트되었습니다.");
    } catch (e: any) {
      Alert.alert("오류", e.message);
    } finally { setSaving(false); }
  }

  if (loading) return <ActivityIndicator color={P} style={{ padding: 20 }} />;
  if (!draft)  return null;

  const isDirty = JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <View style={ap.wrap}>
      <View style={ap.row}>
        <View style={{ flex: 1 }}>
          <Text style={ap.label}>자동 백업 활성화</Text>
          <Text style={ap.sub}>{draft.auto_enabled ? "매 스케줄마다 자동 실행" : "수동 백업만 가능"}</Text>
        </View>
        <Switch value={draft.auto_enabled} onValueChange={v => setDraft({ ...draft, auto_enabled: v })}
          trackColor={{ true: P, false: "#E9E2DD" }} thumbColor="#fff" />
      </View>

      {draft.auto_enabled && (
        <>
          <View style={ap.divider} />
          <Text style={ap.label}>백업 주기</Text>
          <View style={ap.segRow}>
            {SCHEDULE_OPTIONS.map(o => (
              <Pressable key={o.key} style={[ap.seg, draft.schedule_type === o.key && ap.segActive]}
                onPress={() => setDraft({ ...draft, schedule_type: o.key })}>
                <Text style={[ap.segTxt, draft.schedule_type === o.key && ap.segActiveTxt]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={ap.divider} />
          <View style={ap.row}>
            <Text style={ap.label}>실행 시간</Text>
            <View style={ap.hourPicker}>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, run_hour: (draft.run_hour - 1 + 24) % 24 })}>
                <Feather name="chevron-left" size={16} color="#1F1F1F" />
              </Pressable>
              <Text style={ap.hourVal}>{p2(draft.run_hour)}:00</Text>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, run_hour: (draft.run_hour + 1) % 24 })}>
                <Feather name="chevron-right" size={16} color="#1F1F1F" />
              </Pressable>
            </View>
          </View>

          <View style={ap.divider} />
          <View style={ap.row}>
            <Text style={ap.label}>보관 기간</Text>
            <View style={ap.hourPicker}>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, retention_days: Math.max(1, draft.retention_days - 1) })}>
                <Feather name="chevron-left" size={16} color="#1F1F1F" />
              </Pressable>
              <Text style={ap.hourVal}>{draft.retention_days}일</Text>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, retention_days: Math.min(90, draft.retention_days + 1) })}>
                <Feather name="chevron-right" size={16} color="#1F1F1F" />
              </Pressable>
            </View>
          </View>
        </>
      )}

      {isDirty && (
        <Pressable style={[ap.saveBtn, saving && { opacity: 0.5 }]} onPress={saveSettings} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="check" size={14} color="#fff" />}
          <Text style={ap.saveTxt}>{saving ? "저장 중..." : "설정 저장"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const ap = StyleSheet.create({
  wrap:        { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: "#E9E2DD", marginBottom: 10 },
  row:         { flexDirection: "row", alignItems: "center", gap: 10 },
  label:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", flex: 1 },
  sub:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  divider:     { height: 1, backgroundColor: "#F6F3F1" },
  segRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  seg:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#F6F3F1" },
  segActive:   { backgroundColor: P },
  segTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  segActiveTxt:{ color: "#fff" },
  hourPicker:  { flexDirection: "row", alignItems: "center", gap: 8 },
  hourBtn:     { width: 30, height: 30, borderRadius: 8, backgroundColor: "#F6F3F1", alignItems: "center", justifyContent: "center" },
  hourVal:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", minWidth: 50, textAlign: "center" },
  saveBtn:     { backgroundColor: P, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, marginTop: 4 },
  saveTxt:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function BackupScreen() {
  const { token } = useAuth();

  const [backups,       setBackups]       = useState<BackupRecord[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createBusy,    setCreateBusy]    = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [restoreBusy,   setRestoreBusy]   = useState(false);
  const [downloadBusy,  setDownloadBusy]  = useState<string | null>(null);
  const [activeTab,     setActiveTab]     = useState("all");
  const [showSettings,  setShowSettings]  = useState(false);

  const loadBackups = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/super/backups");
      const data = await res.json();
      setBackups(data.backups ?? []);
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => {
    loadBackups().finally(() => setLoading(false));
  }, [loadBackups]);

  async function onRefresh() {
    setRefreshing(true);
    await loadBackups();
    setRefreshing(false);
  }

  async function handleCreate(note: string) {
    if (!token) return;
    setCreateBusy(true);
    try {
      const res = await apiRequest(token, "/super/backups", {
        method: "POST",
        body: JSON.stringify({ note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "백업 생성 실패");
      setCreateVisible(false);
      await loadBackups();
      Alert.alert("백업 완료", `${data.file_name ?? "백업"} 생성 완료\n크기: ${fmtSize(data.size_bytes)}`);
    } catch (e: any) {
      Alert.alert("오류", e.message);
    } finally { setCreateBusy(false); }
  }

  async function handleRestore(reason: string) {
    if (!restoreTarget || !token) return;
    setRestoreBusy(true);
    try {
      const res = await apiRequest(token, `/super/backups/${restoreTarget.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "복구 실패");
      setRestoreTarget(null);
      Alert.alert("복구 기록 완료", "복구 요청이 감사 로그에 기록되었습니다.\n실제 데이터 복구는 백업 JSON 파일을 이용하세요.");
    } catch (e: any) {
      Alert.alert("오류", e.message);
    } finally { setRestoreBusy(false); }
  }

  async function handleDownload(item: BackupRecord) {
    if (!token) return;
    setDownloadBusy(item.id);
    try {
      const res = await apiRequest(token, `/super/backups/${item.id}/download`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "다운로드 실패" }));
        throw new Error(d.error ?? "다운로드 실패");
      }
      const text = await res.text();
      const fileName = item.file_name ?? `${item.id}.json`;
      const path = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
      await Share.share({
        title: fileName,
        message: `백업 파일: ${fileName}\n크기: ${fmtSize(item.size_bytes)}\n\n데이터 미리보기:\n${text.slice(0, 300)}...`,
      });
    } catch (e: any) {
      Alert.alert("다운로드 실패", e.message);
    } finally { setDownloadBusy(null); }
  }

  const filtered = useMemo(() => {
    if (activeTab === "manual") return backups.filter(b => b.backup_type_v2 === "manual");
    if (activeTab === "auto")   return backups.filter(b => b.backup_type_v2 === "auto");
    return backups;
  }, [activeTab, backups]);

  const latestBackup = backups[0];
  const totalSize = backups.reduce((s, b) => s + (b.size_bytes ?? 0), 0);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="백업/복구" subtitle="DB 전체 백업 및 복구 관리" />

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <BackupCard
            item={item}
            onRestore={setRestoreTarget}
            onDownload={b => { if (!downloadBusy) handleDownload(b); }}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 16 }}>
            {/* 요약 카드 */}
            <View style={s.summaryRow}>
              <View style={s.summaryCard}>
                <Feather name="clock" size={16} color={P} />
                <Text style={s.summaryVal}>{latestBackup ? fmtRelative(latestBackup.created_at) : "없음"}</Text>
                <Text style={s.summaryKey}>최근 백업</Text>
              </View>
              <View style={s.summaryCard}>
                <Feather name="layers" size={16} color={GREEN} />
                <Text style={s.summaryVal}>{backups.length}개</Text>
                <Text style={s.summaryKey}>총 백업 수</Text>
              </View>
              <View style={s.summaryCard}>
                <Feather name="hard-drive" size={16} color={WARN} />
                <Text style={s.summaryVal}>{fmtSize(totalSize)}</Text>
                <Text style={s.summaryKey}>총 용량</Text>
              </View>
            </View>

            {/* 액션 버튼들 */}
            <View style={s.btnRow}>
              <Pressable style={[s.actionBtn, { flex: 1 }]}
                onPress={() => setCreateVisible(true)} disabled={createBusy}>
                <Feather name="save" size={14} color="#fff" />
                <Text style={s.actionBtnTxt}>지금 백업</Text>
              </Pressable>
              <Pressable style={[s.outlineBtn]}
                onPress={() => setShowSettings(v => !v)}>
                <Feather name="settings" size={14} color={P} />
                <Text style={s.outlineBtnTxt}>{showSettings ? "설정 닫기" : "자동 백업 설정"}</Text>
              </Pressable>
            </View>

            {/* 자동 백업 설정 패널 */}
            {showSettings && <AutoBackupPanel token={token} />}

            {/* 탭 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 0 }}>
              {TABS.map(t => (
                <Pressable key={t.key} style={[s.tab, activeTab === t.key && s.tabActive]}
                  onPress={() => setActiveTab(t.key)}>
                  <Text style={[s.tabTxt, activeTab === t.key && s.tabActiveTxt]}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color={P} style={{ paddingTop: 60 }} />
            : (
              <View style={s.empty}>
                <Feather name="save" size={36} color="#D1D5DB" />
                <Text style={s.emptyTxt}>백업 기록이 없습니다</Text>
                <Text style={s.emptySubTxt}>지금 백업 버튼을 눌러 첫 백업을 생성하세요</Text>
              </View>
            )
        }
      />

      <CreateModal
        visible={createVisible}
        busy={createBusy}
        onClose={() => { if (!createBusy) setCreateVisible(false); }}
        onCreate={handleCreate}
      />

      <RestoreModal
        target={restoreTarget}
        busy={restoreBusy}
        onClose={() => { if (!restoreBusy) setRestoreTarget(null); }}
        onConfirm={handleRestore}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#FBF8F6" },
  summaryRow:    { flexDirection: "row", gap: 8 },
  summaryCard:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "#E9E2DD" },
  summaryVal:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  summaryKey:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F" },
  btnRow:        { flexDirection: "row", gap: 8 },
  actionBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: P, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  actionBtnTxt:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  outlineBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EEDDF5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  outlineBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P },
  tab:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#F6F3F1" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  tabActiveTxt:  { color: "#fff" },
  empty:         { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#9A948F" },
  emptySubTxt:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9A948F" },
});
