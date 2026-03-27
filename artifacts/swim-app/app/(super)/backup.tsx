/**
 * (super)/backup.tsx — 백업/복구 관리 (실제 API 연동)
 *
 * GET  /super/backup-status       — DB 백업 상태 4개 카드
 * POST /super/backup/run          — 수동 백업 실행 (full | pool_only)
 * GET  /super/backups             — 백업 목록
 * POST /super/backups             — 수동 백업 생성 (Object Storage)
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
const GREEN = "#2EC4B6";
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

interface SwimmingPool {
  id: string;
  name: string;
  owner_name: string | null;
  approval_status: string;
  subscription_status: string;
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
function fmtSize(bytes: number | string | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!n || isNaN(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  const mb = n / 1024 / 1024;
  if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "대기 중", color: WARN,    bg: "#FFF1BF" },
  running: { label: "진행 중", color: GREEN,   bg: "#ECFEFF" },
  done:    { label: "완료",    color: GREEN,   bg: "#E6FFFA" },
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

// ── DB 백업 상태 타입 ──────────────────────────────────────────────────────────
type CardStatus = "normal" | "warning" | "error" | "not_configured";

interface BackupStatusData {
  checked_at: string;
  cards: {
    operational_db: {
      label: string;
      connected: boolean;
      latency_ms: number;
      error: string | null;
      status: CardStatus;
      status_label: string;
    };
    pool_backup: {
      label: string;
      configured: boolean;
      status: CardStatus;
      status_label: string;
      last_backup_at: string | null;
      last_success_at: string | null;
      last_status: string | null;
      error_message: string | null;
      size_bytes: number | null;
    };
    protect_backup: {
      label: string;
      configured: boolean;
      status: CardStatus;
      status_label: string;
      last_backup_at: string | null;
      last_success_at: string | null;
      last_status: string | null;
      error_message: string | null;
      size_bytes: number | null;
    };
    summary: {
      label: string;
      status: CardStatus;
      status_label: string;
      recent_success: boolean;
      failure_count_24h: number;
      pool_configured: boolean;
      protect_configured: boolean;
    };
  };
}

const DB_STATUS_CFG: Record<CardStatus, { color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  normal:         { color: "#2EC4B6", bg: "#E6FFFA", icon: "check-circle" },
  warning:        { color: "#D97706", bg: "#FFF1BF", icon: "alert-circle" },
  error:          { color: "#D96C6C", bg: "#F9DEDA", icon: "alert-triangle" },
  not_configured: { color: "#9CA3AF", bg: "#F8FAFC", icon: "minus-circle" },
};

// ── 4개 DB 상태 카드 ──────────────────────────────────────────────────────────
function DbStatusCards({ token, onManualBackup, backingUp }: {
  token: string | null;
  onManualBackup: (type: "full" | "pool_only") => void;
  backingUp: boolean;
}) {
  const [status, setStatus]     = useState<BackupStatusData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const res = await apiRequest(token, "/super/backup-status");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "상태 조회 실패");
      }
      setStatus(await res.json());
    } catch (e: any) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchStatus();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={dc.loadingBox}>
        <ActivityIndicator color={P} size="small" />
        <Text style={dc.loadingTxt}>DB 상태 조회 중...</Text>
      </View>
    );
  }

  if (error || !status) {
    return (
      <View style={dc.errorBox}>
        <Feather name="alert-circle" size={16} color={DANGER} />
        <Text style={dc.errorTxt}>{error ?? "상태 조회 실패"}</Text>
        <Pressable onPress={handleRefresh}>
          <Text style={dc.retryTxt}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const { operational_db, pool_backup, protect_backup, summary } = status.cards;

  function DbCard({ label, status: st, statusLabel, sub1, sub2, errorMsg, icon }: {
    label: string;
    status: CardStatus;
    statusLabel: string;
    sub1?: string;
    sub2?: string;
    errorMsg?: string | null;
    icon: React.ComponentProps<typeof Feather>["name"];
  }) {
    const cfg = DB_STATUS_CFG[st];
    return (
      <View style={[dc.card, { borderLeftColor: cfg.color, borderLeftWidth: 3 }]}>
        <View style={dc.cardTop}>
          <View style={[dc.iconWrap, { backgroundColor: cfg.bg }]}>
            <Feather name={icon} size={16} color={cfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dc.cardLabel}>{label}</Text>
            {sub1 ? <Text style={dc.cardSub}>{sub1}</Text> : null}
          </View>
          <View style={[dc.statusBadge, { backgroundColor: cfg.bg }]}>
            <Feather name={cfg.icon} size={10} color={cfg.color} />
            <Text style={[dc.statusTxt, { color: cfg.color }]}>{statusLabel}</Text>
          </View>
        </View>
        {sub2 ? <Text style={dc.cardSub2}>{sub2}</Text> : null}
        {errorMsg ? (
          <Text style={dc.errorLine} numberOfLines={2}>{errorMsg}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={dc.wrap}>
      {/* 헤더 + 갱신 버튼 */}
      <View style={dc.header}>
        <Feather name="shield" size={14} color={P} />
        <Text style={dc.headerTxt}>DB 백업 상태</Text>
        <Pressable onPress={handleRefresh} disabled={refreshing} style={dc.refreshBtn}>
          <Feather name="refresh-cw" size={13} color={refreshing ? "#D1D5DB" : P} />
        </Pressable>
      </View>

      {/* 카드 1: 운영 DB */}
      <DbCard
        label={operational_db.label}
        status={operational_db.status}
        statusLabel={operational_db.status_label}
        icon="database"
        sub1={`응답 ${operational_db.latency_ms}ms`}
        errorMsg={operational_db.error}
      />

      {/* 카드 2: pool 백업 */}
      <DbCard
        label={pool_backup.label}
        status={pool_backup.status}
        statusLabel={pool_backup.status_label}
        icon="server"
        sub1={pool_backup.configured
          ? (pool_backup.last_success_at
              ? `마지막 성공: ${fmtRelative(pool_backup.last_success_at)}`
              : "백업 기록 없음")
          : "POOL_DATABASE_URL 미설정"}
        errorMsg={pool_backup.error_message}
      />

      {/* 카드 3: 보호백업 */}
      <DbCard
        label={protect_backup.label}
        status={protect_backup.status}
        statusLabel={protect_backup.status_label}
        icon="lock"
        sub1={protect_backup.configured
          ? (protect_backup.last_success_at
              ? `마지막 성공: ${fmtRelative(protect_backup.last_success_at)}`
              : "백업 기록 없음")
          : "SUPER_PROTECT_DATABASE_URL 미설정"}
        errorMsg={protect_backup.error_message}
      />

      {/* 카드 4: 전체 요약 */}
      <DbCard
        label={summary.label}
        status={summary.status}
        statusLabel={summary.status_label}
        icon="activity"
        sub1={`24시간 내 실패: ${summary.failure_count_24h}건`}
        sub2={`pool ${summary.pool_configured ? "✓" : "✗"}  보호백업 ${summary.protect_configured ? "✓" : "✗"}`}
      />

      {/* 수동 백업 버튼 */}
      <View style={dc.btnRow}>
        <Pressable
          style={[dc.manualBtn, backingUp && { opacity: 0.5 }]}
          onPress={() => onManualBackup("full")}
          disabled={backingUp}
        >
          {backingUp
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="save" size={13} color="#fff" />}
          <Text style={dc.manualBtnTxt}>{backingUp ? "백업 중..." : "전체 백업 실행"}</Text>
        </Pressable>
        <Pressable
          style={[dc.poolBtn, backingUp && { opacity: 0.5 }]}
          onPress={() => onManualBackup("pool_only")}
          disabled={backingUp}
        >
          <Feather name="server" size={13} color={P} />
          <Text style={dc.poolBtnTxt}>pool만</Text>
        </Pressable>
      </View>

      <Text style={dc.checkedAt}>상태 기준: {fmtRelative(status.checked_at)}</Text>
    </View>
  );
}

const dc = StyleSheet.create({
  wrap:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 4 },
  header:     { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  headerTxt:  { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  refreshBtn: { padding: 4 },
  loadingBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  loadingTxt: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  errorBox:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, backgroundColor: "#FDE8E8", borderRadius: 12 },
  errorTxt:   { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: DANGER },
  retryTxt:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: DANGER },
  card:       { backgroundColor: "#FAFAF9", borderRadius: 10, padding: 10, gap: 2 },
  cardTop:    { flexDirection: "row", alignItems: "center", gap: 8 },
  iconWrap:   { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardLabel:  { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827" },
  cardSub:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 1 },
  cardSub2:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: 40 },
  statusBadge:{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusTxt:  { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  errorLine:  { fontSize: 10, fontFamily: "Inter_400Regular", color: DANGER, marginLeft: 40, marginTop: 2 },
  btnRow:     { flexDirection: "row", gap: 8, marginTop: 4 },
  manualBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                backgroundColor: P, borderRadius: 10, paddingVertical: 10 },
  manualBtnTxt:{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  poolBtn:    { flexDirection: "row", alignItems: "center", gap: 5,
                backgroundColor: "#EEDDF5", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  poolBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P },
  checkedAt:  { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "right" },
});

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
            <Feather name="layers" size={11} color="#6B7280" />
            <Text style={bc.metaVal}>{item.total_tables}개 테이블</Text>
          </View>
        )}
        <View style={bc.metaItem}>
          <Feather name="hard-drive" size={11} color="#6B7280" />
          <Text style={bc.metaVal}>{fmtSize(item.size_bytes)}</Text>
        </View>
        <View style={bc.metaItem}>
          <Feather name="clock" size={11} color="#6B7280" />
          <Text style={bc.metaVal}>{fmtDateTime(item.created_at)}</Text>
        </View>
        {item.created_by && (
          <View style={bc.metaItem}>
            <Feather name="user" size={11} color="#6B7280" />
            <Text style={bc.metaVal}>{item.created_by}</Text>
          </View>
        )}
        {item.note && (
          <View style={bc.metaItem}>
            <Feather name="file-text" size={11} color="#6B7280" />
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
  card:     { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  top:      { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  badge:    { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },
  time:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
  name:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 8 },
  meta:     { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaVal:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
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
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F1F5F9" }} edges={["top"]}>
        <View style={cr.header}>
          <Pressable onPress={onClose} disabled={busy}><Feather name="x" size={20} color="#6B7280" /></Pressable>
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
              placeholder="이 백업에 대한 메모를 입력하세요" placeholderTextColor="#9CA3AF"
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
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  label:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827", marginBottom: 8 },
  input:      { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
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
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F1F5F9" }} edges={["top"]}>
        <View style={rm.header}>
          <Pressable onPress={onClose} disabled={busy}><Feather name="x" size={20} color="#6B7280" /></Pressable>
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
              placeholder="복구 사유를 입력하세요" placeholderTextColor="#9CA3AF"
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
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#FFF1BF", borderRadius: 10, padding: 14 },
  warningTxt: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#92400E", lineHeight: 20 },
  infoBox:    { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 14, gap: 4 },
  infoLabel:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  infoVal:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 6 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827", marginBottom: 6 },
  input:      { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", height: 90 },
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
          trackColor={{ true: P, false: "#E5E7EB" }} thumbColor="#fff" />
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
                <Feather name="chevron-left" size={16} color="#111827" />
              </Pressable>
              <Text style={ap.hourVal}>{p2(draft.run_hour)}:00</Text>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, run_hour: (draft.run_hour + 1) % 24 })}>
                <Feather name="chevron-right" size={16} color="#111827" />
              </Pressable>
            </View>
          </View>

          <View style={ap.divider} />
          <View style={ap.row}>
            <Text style={ap.label}>보관 기간</Text>
            <View style={ap.hourPicker}>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, retention_days: Math.max(1, draft.retention_days - 1) })}>
                <Feather name="chevron-left" size={16} color="#111827" />
              </Pressable>
              <Text style={ap.hourVal}>{draft.retention_days}일</Text>
              <Pressable style={ap.hourBtn} onPress={() => setDraft({ ...draft, retention_days: Math.min(90, draft.retention_days + 1) })}>
                <Feather name="chevron-right" size={16} color="#111827" />
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
  wrap:        { backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 10 },
  row:         { flexDirection: "row", alignItems: "center", gap: 10 },
  label:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827", flex: 1 },
  sub:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  divider:     { height: 1, backgroundColor: "#F8FAFC" },
  segRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  seg:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#F8FAFC" },
  segActive:   { backgroundColor: P },
  segTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  segActiveTxt:{ color: "#fff" },
  hourPicker:  { flexDirection: "row", alignItems: "center", gap: 8 },
  hourBtn:     { width: 30, height: 30, borderRadius: 8, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" },
  hourVal:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", minWidth: 50, textAlign: "center" },
  saveBtn:     { backgroundColor: P, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, marginTop: 4 },
  saveTxt:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ── 전체 복구 모달 ────────────────────────────────────────────────────────────
function FullRestoreModal({
  visible, onClose, backups, token,
}: {
  visible: boolean;
  onClose: () => void;
  backups: BackupRecord[];
  token: string | null;
}) {
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);
  const [confirmText,    setConfirmText]    = useState("");
  const [step,           setStep]           = useState<1 | 2>(1);
  const [busy,           setBusy]           = useState(false);
  const [result,         setResult]         = useState<{ ok: boolean; empty?: boolean; msg: string } | null>(null);

  function resetModal() {
    setSelectedBackup(null);
    setConfirmText("");
    setStep(1);
    setBusy(false);
    setResult(null);
  }

  function handleClose() {
    if (busy) return;
    resetModal();
    onClose();
  }

  async function handleExecute() {
    if (!token || !selectedBackup || confirmText !== "전체 복구" || busy) return;
    setBusy(true);
    try {
      const res = await apiRequest(token, "/super/restore/full", {
        method: "POST",
        body: JSON.stringify({ backup_id: selectedBackup.id, confirmed_text: "전체 복구" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.detail ?? "복구 실패");
      const isEmpty = data.rows_restored === 0 && data.warning_count === 0;
      setResult({
        ok: true,
        empty: isEmpty,
        msg: isEmpty
          ? (data.reason_message ?? "해당 백업 시점에 변경된 데이터가 없습니다.")
          : `테이블 ${data.tables_restored}개, ${data.rows_restored}행 복구\n선백업 ID: ${data.pre_backup_id}`,
      });
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setBusy(false);
    }
  }

  const canExecute = selectedBackup !== null && confirmText === "전체 복구" && !busy;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F1F5F9" }} edges={["top"]}>
        <View style={fr.header}>
          <Pressable onPress={handleClose} disabled={busy}>
            <Feather name="x" size={20} color="#6B7280" />
          </Pressable>
          <Text style={fr.title}>전체 복구</Text>
          <View style={{ width: 24 }} />
        </View>

        {result ? (
          /* 결과 화면 */
          <View style={fr.resultWrap}>
            <View style={[fr.resultIcon, {
              backgroundColor: result.empty ? "#FEF3C7" : result.ok ? "#E6FFFA" : "#F9DEDA",
            }]}>
              <Feather
                name={result.empty ? "info" : result.ok ? "check-circle" : "x-circle"}
                size={40}
                color={result.empty ? "#D97706" : result.ok ? GREEN : DANGER}
              />
            </View>
            <Text style={[fr.resultTitle, {
              color: result.empty ? "#D97706" : result.ok ? GREEN : DANGER,
            }]}>
              {result.empty ? "복구 대상 없음" : result.ok ? "복구 완료" : "복구 실패"}
            </Text>
            <Text style={fr.resultMsg}>{result.msg}</Text>
            <Pressable style={[fr.execBtn, {
              backgroundColor: result.empty ? "#D97706" : result.ok ? GREEN : DANGER,
            }]} onPress={handleClose}>
              <Text style={fr.execTxt}>닫기</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
            {/* 1단계: 백업 시점 선택 */}
            <Text style={fr.stepTitle}>1단계 — 복구할 백업 시점 선택</Text>
            {backups.length === 0 ? (
              <View style={fr.emptyBox}>
                <Text style={fr.emptyTxt}>백업 기록이 없습니다. 먼저 백업을 생성하세요.</Text>
              </View>
            ) : (
              <ScrollView style={fr.backupList} nestedScrollEnabled showsVerticalScrollIndicator>
                {backups.map(bk => (
                  <Pressable key={bk.id} style={[fr.backupItem, selectedBackup?.id === bk.id && fr.backupItemSel]}
                    onPress={() => setSelectedBackup(bk)}>
                    <View style={{ flex: 1 }}>
                      <Text style={fr.backupItemDate}>
                        {fmtDateTime(bk.created_at)} {bk.backup_type_v2 === "auto" ? "자동" : "수동"}백업
                      </Text>
                      <Text style={fr.backupItemMeta}>
                        {bk.total_tables ?? "?"}테이블 · {fmtSize(bk.size_bytes)}
                      </Text>
                      {bk.note ? <Text style={fr.backupItemNote} numberOfLines={1}>{bk.note}</Text> : null}
                    </View>
                    {selectedBackup?.id === bk.id && (
                      <Feather name="check-circle" size={18} color={P} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* 선택된 백업 요약 */}
            {selectedBackup && (
              <View style={fr.selectedBox}>
                <Feather name="calendar" size={14} color={P} />
                <Text style={fr.selectedTxt}>
                  선택: {fmtDateTime(selectedBackup.created_at)} · {fmtSize(selectedBackup.size_bytes)}
                </Text>
              </View>
            )}

            {/* 경고 문구 */}
            <View style={fr.warnBox}>
              <Feather name="alert-triangle" size={18} color={DANGER} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={fr.warnTitle}>⚠️ 전체 플랫폼 데이터 복구</Text>
                <Text style={fr.warnTxt}>선택한 시점으로 전체 DB가 되돌아갑니다.</Text>
                <Text style={fr.warnTxt}>복구 전 현재 상태를 자동으로 선백업합니다.</Text>
                <Text style={fr.warnTxt}>사진/영상 원본은 복구되지 않습니다.</Text>
              </View>
            </View>

            {/* 확인 문구 입력 */}
            <View>
              <Text style={fr.inputLabel}>
                확인 입력 — 아래에 <Text style={{ fontFamily: "Inter_700Bold", color: DANGER }}>'전체 복구'</Text>를 입력하세요
              </Text>
              <TextInput style={[fr.input, confirmText === "전체 복구" && { borderColor: DANGER }]}
                value={confirmText} onChangeText={setConfirmText}
                placeholder="전체 복구" placeholderTextColor="#9CA3AF"
                editable={!busy} autoCapitalize="none" />
            </View>

            {/* 실행 버튼 */}
            <Pressable style={[fr.execBtn, (!canExecute) && { opacity: 0.4 }]}
              onPress={handleExecute} disabled={!canExecute}>
              {busy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="rotate-ccw" size={16} color="#fff" />
              }
              <Text style={fr.execTxt}>{busy ? "복구 실행 중..." : "전체 복구 실행"}</Text>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const fr = StyleSheet.create({
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:          { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  stepTitle:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  backupList:     { maxHeight: 220, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10 },
  backupItem:     { padding: 12, borderBottomWidth: 1, borderBottomColor: "#F8FAFC", flexDirection: "row", alignItems: "center", gap: 10 },
  backupItemSel:  { backgroundColor: "#F3EEFF" },
  backupItemDate: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  backupItemMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  backupItemNote: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  selectedBox:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F3EEFF", borderRadius: 8, padding: 10 },
  selectedTxt:    { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P, flex: 1 },
  warnBox:        { flexDirection: "row", gap: 10, backgroundColor: "#FFF1BF", borderRadius: 10, padding: 14, alignItems: "flex-start" },
  warnTitle:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#92400E", marginBottom: 2 },
  warnTxt:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },
  emptyBox:       { backgroundColor: "#F8FAFC", borderRadius: 8, padding: 16, alignItems: "center" },
  emptyTxt:       { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  inputLabel:     { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827", marginBottom: 8 },
  input:          { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  execBtn:        { backgroundColor: DANGER, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 15 },
  execTxt:        { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  resultWrap:     { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  resultIcon:     { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  resultTitle:    { fontSize: 20, fontFamily: "Inter_700Bold" },
  resultMsg:      { fontSize: 14, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 22 },
});

// ── 수영장별 복구 모달 ─────────────────────────────────────────────────────────
function PoolRestoreModal({
  visible, onClose, backups, token,
}: {
  visible: boolean;
  onClose: () => void;
  backups: BackupRecord[];
  token: string | null;
}) {
  const [searchQ,        setSearchQ]        = useState("");
  const [searchResults,  setSearchResults]  = useState<SwimmingPool[]>([]);
  const [searching,      setSearching]      = useState(false);
  const [selectedPool,   setSelectedPool]   = useState<SwimmingPool | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);
  const [confirmName,    setConfirmName]    = useState("");
  const [busy,           setBusy]           = useState(false);
  const [result,         setResult]         = useState<{ ok: boolean; empty?: boolean; msg: string } | null>(null);

  function resetModal() {
    setSearchQ("");
    setSearchResults([]);
    setSelectedPool(null);
    setSelectedBackup(null);
    setConfirmName("");
    setBusy(false);
    setResult(null);
  }

  function handleClose() {
    if (busy) return;
    resetModal();
    onClose();
  }

  async function doSearch(q: string) {
    if (!token || q.length < 1) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await apiRequest(token, `/super/pools/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.pools ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQ), 350);
    return () => clearTimeout(t);
  }, [searchQ, token]);

  async function handleExecute() {
    if (!token || !selectedPool || !selectedBackup || confirmName !== selectedPool.name || busy) return;
    setBusy(true);
    try {
      const res = await apiRequest(token, "/super/restore/pool", {
        method: "POST",
        body: JSON.stringify({
          pool_id: selectedPool.id,
          backup_id: selectedBackup.id,
          confirmed_pool_name: confirmName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.detail ?? "복구 실패");
      const isEmpty = data.rows_restored === 0 && data.warning_count === 0;
      setResult({
        ok: true,
        empty: isEmpty,
        msg: isEmpty
          ? (data.reason_message ?? "해당 백업 시점에 변경된 데이터가 없습니다.")
          : `'${selectedPool.name}' ${data.rows_restored}행 복구\n선백업 ID: ${data.pre_backup_id}`,
      });
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setBusy(false);
    }
  }

  const canExecute =
    selectedPool !== null &&
    selectedBackup !== null &&
    confirmName === selectedPool?.name &&
    !busy;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F1F5F9" }} edges={["top"]}>
        <View style={pr.header}>
          <Pressable onPress={handleClose} disabled={busy}>
            <Feather name="x" size={20} color="#6B7280" />
          </Pressable>
          <Text style={pr.title}>수영장별 복구</Text>
          <View style={{ width: 24 }} />
        </View>

        {result ? (
          <View style={fr.resultWrap}>
            <View style={[fr.resultIcon, {
              backgroundColor: result.empty ? "#FEF3C7" : result.ok ? "#E6FFFA" : "#F9DEDA",
            }]}>
              <Feather
                name={result.empty ? "info" : result.ok ? "check-circle" : "x-circle"}
                size={40}
                color={result.empty ? "#D97706" : result.ok ? GREEN : DANGER}
              />
            </View>
            <Text style={[fr.resultTitle, {
              color: result.empty ? "#D97706" : result.ok ? GREEN : DANGER,
            }]}>
              {result.empty ? "복구 대상 없음" : result.ok ? "복구 완료" : "복구 실패"}
            </Text>
            <Text style={fr.resultMsg}>{result.msg}</Text>
            <Pressable style={[fr.execBtn, {
              backgroundColor: result.empty ? "#D97706" : result.ok ? GREEN : DANGER,
            }]} onPress={handleClose}>
              <Text style={fr.execTxt}>닫기</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled">

            {/* Step 1: 수영장 검색 */}
            <Text style={pr.stepTitle}>1단계 — 수영장 검색 및 선택</Text>
            <View style={pr.searchBox}>
              <Feather name="search" size={16} color="#9CA3AF" />
              <TextInput style={pr.searchInput} value={searchQ}
                onChangeText={setSearchQ}
                placeholder="수영장명 검색 (예: 토이키즈)"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none" editable={!busy} />
              {searching && <ActivityIndicator size="small" color={P} />}
            </View>

            {/* 검색 결과 */}
            {searchQ.length > 0 && (
              <View style={pr.resultList}>
                {searchResults.length === 0 && !searching ? (
                  <View style={pr.noResult}>
                    <Text style={pr.noResultTxt}>검색 결과 없음</Text>
                  </View>
                ) : (
                  searchResults.map(pool => (
                    <Pressable key={pool.id}
                      style={[pr.poolItem, selectedPool?.id === pool.id && pr.poolItemSel]}
                      onPress={() => { setSelectedPool(pool); setConfirmName(""); }}>
                      <View style={{ flex: 1 }}>
                        <Text style={pr.poolName}>{pool.name}</Text>
                        {pool.owner_name ? (
                          <Text style={pr.poolSub}>{pool.owner_name}</Text>
                        ) : null}
                      </View>
                      {selectedPool?.id === pool.id && (
                        <Feather name="check-circle" size={18} color={P} />
                      )}
                    </Pressable>
                  ))
                )}
              </View>
            )}

            {/* 선택된 수영장 */}
            {selectedPool && (
              <View style={pr.selectedPoolBox}>
                <Feather name="anchor" size={14} color={P} />
                <Text style={pr.selectedPoolTxt}>선택된 수영장: <Text style={{ fontFamily: "Inter_700Bold" }}>{selectedPool.name}</Text></Text>
              </View>
            )}

            {/* Step 2: 복구 시점 선택 */}
            <Text style={pr.stepTitle}>2단계 — 복구 기준 백업 시점 선택</Text>
            {backups.length === 0 ? (
              <View style={fr.emptyBox}>
                <Text style={fr.emptyTxt}>백업 기록이 없습니다.</Text>
              </View>
            ) : (
              <ScrollView style={pr.backupList} nestedScrollEnabled showsVerticalScrollIndicator>
                {backups.map(bk => (
                  <Pressable key={bk.id}
                    style={[pr.backupItem, selectedBackup?.id === bk.id && pr.backupItemSel]}
                    onPress={() => setSelectedBackup(bk)}>
                    <View style={{ flex: 1 }}>
                      <Text style={fr.backupItemDate}>
                        {fmtDateTime(bk.created_at)} {bk.backup_type_v2 === "auto" ? "자동" : "수동"}백업
                      </Text>
                      <Text style={fr.backupItemMeta}>
                        {bk.total_tables ?? "?"}테이블 · {fmtSize(bk.size_bytes)}
                      </Text>
                    </View>
                    {selectedBackup?.id === bk.id && (
                      <Feather name="check-circle" size={18} color={P} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {selectedBackup && (
              <View style={fr.selectedBox}>
                <Feather name="calendar" size={14} color={P} />
                <Text style={fr.selectedTxt}>
                  시점: {fmtDateTime(selectedBackup.created_at)} · {fmtSize(selectedBackup.size_bytes)}
                </Text>
              </View>
            )}

            {/* 경고 */}
            <View style={fr.warnBox}>
              <Feather name="alert-triangle" size={18} color={WARN} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={fr.warnTitle}>⚠️ 수영장별 부분 복구</Text>
                <Text style={fr.warnTxt}>선택한 수영장 데이터만 복구됩니다.</Text>
                <Text style={fr.warnTxt}>다른 수영장 데이터는 변경되지 않습니다.</Text>
                <Text style={fr.warnTxt}>복구 전 현재 상태를 자동으로 선백업합니다.</Text>
              </View>
            </View>

            {/* Step 3: 수영장명 확인 입력 */}
            {selectedPool && (
              <View>
                <Text style={pr.inputLabel}>
                  확인 입력 — 수영장명{" "}
                  <Text style={{ fontFamily: "Inter_700Bold", color: DANGER }}>'{selectedPool.name}'</Text>을 입력하세요
                </Text>
                <TextInput style={[fr.input, confirmName === selectedPool.name && { borderColor: DANGER }]}
                  value={confirmName} onChangeText={setConfirmName}
                  placeholder={selectedPool.name}
                  placeholderTextColor="#9CA3AF"
                  editable={!busy} autoCapitalize="none" />
              </View>
            )}

            {/* 실행 버튼 */}
            <Pressable style={[fr.execBtn, { backgroundColor: WARN }, !canExecute && { opacity: 0.4 }]}
              onPress={handleExecute} disabled={!canExecute}>
              {busy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="refresh-cw" size={16} color="#fff" />
              }
              <Text style={fr.execTxt}>{busy ? "복구 중..." : "수영장별 복구 실행"}</Text>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const pr = StyleSheet.create({
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title:          { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  stepTitle:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  searchBox:      { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput:    { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  resultList:     { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, overflow: "hidden", maxHeight: 200 },
  noResult:       { padding: 16, alignItems: "center" },
  noResultTxt:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  poolItem:       { padding: 12, borderBottomWidth: 1, borderBottomColor: "#F8FAFC", flexDirection: "row", alignItems: "center", gap: 8 },
  poolItemSel:    { backgroundColor: "#F3EEFF" },
  poolName:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  poolSub:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  selectedPoolBox:{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F3EEFF", borderRadius: 8, padding: 10 },
  selectedPoolTxt:{ fontSize: 13, fontFamily: "Inter_400Regular", color: P, flex: 1 },
  backupList:     { maxHeight: 200, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10 },
  backupItem:     { padding: 12, borderBottomWidth: 1, borderBottomColor: "#F8FAFC", flexDirection: "row", alignItems: "center", gap: 10 },
  backupItemSel:  { backgroundColor: "#F3EEFF" },
  inputLabel:     { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827", marginBottom: 8 },
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
  const [showSettings,      setShowSettings]      = useState(false);
  const [dbBackingUp,       setDbBackingUp]       = useState(false);
  const [fullRestoreVisible, setFullRestoreVisible] = useState(false);
  const [poolRestoreVisible, setPoolRestoreVisible] = useState(false);

  async function handleManualBackupToDb(type: "full" | "pool_only") {
    if (!token || dbBackingUp) return;
    setDbBackingUp(true);
    try {
      const res = await apiRequest(token, "/super/backup/run", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "백업 실패");
      const poolResult    = data.results?.pool;
      const protectResult = data.results?.protect;
      const lines = [];
      if (poolResult?.skipped)  lines.push(`pool: ${poolResult.reason}`);
      else if (poolResult?.status === "success") lines.push(`pool: 성공`);
      else if (poolResult?.status === "failed") lines.push(`pool: 실패 — ${poolResult.error}`);
      if (protectResult?.skipped)  lines.push(`보호백업: ${protectResult.reason}`);
      else if (protectResult?.status === "success") lines.push(`보호백업: 성공`);
      else if (protectResult?.status === "failed") lines.push(`보호백업: 실패 — ${protectResult.error}`);
      Alert.alert("백업 DB 실행 완료", lines.join("\n") || "완료");
    } catch (e: any) {
      Alert.alert("백업 실패", e.message);
    } finally {
      setDbBackingUp(false);
    }
  }

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
  const totalSize = backups.reduce((s, b) => {
    const n = Number(b.size_bytes ?? 0);
    console.log("[backup] size_bytes raw:", b.size_bytes, "→ Number:", n);
    return s + (isNaN(n) ? 0 : n);
  }, 0);
  console.log("[backup] totalSize (bytes):", totalSize);

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
            {/* DB 백업 상태 4개 카드 */}
            <DbStatusCards
              token={token}
              onManualBackup={handleManualBackupToDb}
              backingUp={dbBackingUp}
            />

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

            {/* 액션 버튼들 (2×2 그리드) */}
            <View style={{ gap: 8 }}>
              <View style={s.btnRow}>
                {/* 전체 백업 */}
                <Pressable style={[s.actionBtn, { flex: 1 }]}
                  onPress={() => setCreateVisible(true)} disabled={createBusy}>
                  <Feather name="save" size={14} color="#fff" />
                  <Text style={s.actionBtnTxt}>전체 백업</Text>
                </Pressable>
                {/* 자동 백업 설정 */}
                <Pressable style={[s.outlineBtn, { flex: 1 }]}
                  onPress={() => setShowSettings(v => !v)}>
                  <Feather name="settings" size={14} color={P} />
                  <Text style={s.outlineBtnTxt}>{showSettings ? "설정 닫기" : "자동백업 설정"}</Text>
                </Pressable>
              </View>
              <View style={s.btnRow}>
                {/* 전체 복구 */}
                <Pressable style={[s.actionBtn, { flex: 1, backgroundColor: DANGER }]}
                  onPress={() => setFullRestoreVisible(true)} disabled={backups.length === 0}>
                  <Feather name="rotate-ccw" size={14} color="#fff" />
                  <Text style={s.actionBtnTxt}>전체 복구</Text>
                </Pressable>
                {/* 수영장별 복구 */}
                <Pressable style={[s.outlineBtn, { flex: 1, borderColor: WARN }]}
                  onPress={() => setPoolRestoreVisible(true)} disabled={backups.length === 0}>
                  <Feather name="refresh-cw" size={14} color={WARN} />
                  <Text style={[s.outlineBtnTxt, { color: WARN }]}>수영장별 복구</Text>
                </Pressable>
              </View>
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

      <FullRestoreModal
        visible={fullRestoreVisible}
        onClose={() => setFullRestoreVisible(false)}
        backups={backups}
        token={token}
      />

      <PoolRestoreModal
        visible={poolRestoreVisible}
        onClose={() => setPoolRestoreVisible(false)}
        backups={backups}
        token={token}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F1F5F9" },
  summaryRow:    { flexDirection: "row", gap: 8 },
  summaryCard:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "#E5E7EB" },
  summaryVal:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryKey:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  btnRow:        { flexDirection: "row", gap: 8 },
  actionBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: P, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  actionBtnTxt:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  outlineBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EEDDF5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  outlineBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P },
  tab:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#F8FAFC" },
  tabActive:     { backgroundColor: P },
  tabTxt:        { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  tabActiveTxt:  { color: "#fff" },
  empty:         { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  emptySubTxt:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
