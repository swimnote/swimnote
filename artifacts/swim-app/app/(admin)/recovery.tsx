/**
 * (admin)/recovery.tsx — 백업·복구
 * 스냅샷 목록 보기 → 시점 선택 → 영향 범위 확인 → 복구 실행
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView,
  StyleSheet, Switch, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { ScreenLayout } from "@/components/common/ScreenLayout";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useBackupStore } from "@/store/backupStore";
import { useOperatorEventLogStore } from "@/store/operatorEventLogStore";
import type { BackupSnapshot } from "@/domain/types";

const C = Colors.light;

const AFFECTED_ITEMS = [
  { icon: "users" as const,     label: "회원 정보",         detail: "등록·수정·삭제된 회원 데이터가 해당 시점으로 되돌아갑니다." },
  { icon: "check-circle" as const, label: "학부모 승인 상태", detail: "이 시점 이후 처리된 승인/거절이 취소될 수 있습니다." },
  { icon: "link" as const,      label: "학생 연결 상태",     detail: "이 시점 이후 연결된 학부모·학생 연결이 해제될 수 있습니다." },
  { icon: "layers" as const,    label: "반/수업 설정",       detail: "개설·삭제된 반 정보가 해당 시점 상태로 복구됩니다." },
  { icon: "clipboard" as const, label: "출결 기록",          detail: "이 시점 이후 변경된 출결 데이터가 사라질 수 있습니다." },
  { icon: "book-open" as const, label: "일지 텍스트",        detail: "이 시점 이후 작성된 일지가 사라질 수 있습니다." },
  { icon: "settings" as const,  label: "설정값",             detail: "수영장 설정 변경 사항이 되돌아갑니다." },
];

const EXCLUDED_ITEMS = [
  { icon: "image" as const,   label: "사진 원본",  detail: "사진 파일 원본은 복구가 보장되지 않습니다." },
  { icon: "video" as const,   label: "영상 원본",  detail: "영상 파일 원본은 복구가 보장되지 않습니다." },
];

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function fmtSize(mb: number) {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

const REASON_CFG: Record<string, { color: string; bg: string; label: string }> = {
  "수동 스냅샷":               { color: "#2563EB", bg: "#DBEAFE", label: "수동" },
  "자동 스냅샷":               { color: "#059669", bg: "#D1FAE5", label: "자동" },
  "복구 실행 직전 현재 상태 보존 스냅샷": { color: "#D97706", bg: "#FEF3C7", label: "복구 전" },
  "킬스위치 실행 직전 강제 스냅샷 — 복구 불가 경고 확인됨": { color: "#DC2626", bg: "#FEE2E2", label: "킬스위치 전" },
};

function reasonChip(note: string) {
  const key = Object.keys(REASON_CFG).find(k => note.includes(k.split(" — ")[0])) ?? "";
  const cfg = REASON_CFG[key] ?? { color: "#6B7280", bg: "#F3F4F6", label: "기타" };
  return cfg;
}

// ── 스냅샷 카드 ───────────────────────────────────────────────────
function SnapshotCard({
  snap, onRestore, onManualSnap,
}: {
  snap: BackupSnapshot;
  onRestore: (snap: BackupSnapshot) => void;
  onManualSnap?: never;
}) {
  const [expanded, setExpanded] = useState(false);
  const chip = reasonChip(snap.note ?? "");

  return (
    <View style={s.snapCard}>
      <Pressable style={s.snapTop} onPress={() => setExpanded(v => !v)}>
        <View style={[s.snapIcon, { backgroundColor: chip.bg }]}>
          <Feather name="archive" size={16} color={chip.color} />
        </View>
        <View style={s.snapInfo}>
          <View style={s.snapRow}>
            <Text style={s.snapTime}>{fmtDateTime(snap.createdAt)}</Text>
            <View style={[s.chip, { backgroundColor: chip.bg }]}>
              <Text style={[s.chipTxt, { color: chip.color }]}>{chip.label}</Text>
            </View>
          </View>
          <Text style={s.snapNote} numberOfLines={1}>{snap.note}</Text>
          <Text style={s.snapMeta}>{fmtSize(snap.sizeMb)} · {snap.createdBy}</Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
      </Pressable>

      {expanded && (
        <View style={s.snapBody}>
          <Text style={s.includesTitle}>포함 항목</Text>
          <View style={s.tagsRow}>
            {snap.includes.map(inc => (
              <View key={inc} style={s.tag}>
                <Text style={s.tagTxt}>{inc}</Text>
              </View>
            ))}
          </View>
          <View style={s.excludeBox}>
            <Feather name="alert-circle" size={12} color="#D97706" />
            <Text style={s.excludeTxt}>사진·영상 원본 복구 미보장</Text>
          </View>
          <Pressable
            style={[s.restoreBtn, { backgroundColor: C.tint }]}
            onPress={() => onRestore(snap)}
          >
            <Feather name="rotate-ccw" size={14} color="#fff" />
            <Text style={s.restoreBtnTxt}>이 시점으로 복구</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── 복구 확인 모달 ────────────────────────────────────────────────
function RestoreModal({
  snap, operatorName, actorName,
  onClose, onDone,
}: {
  snap: BackupSnapshot;
  operatorName: string;
  actorName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [running, setRunning] = useState(false);

  const createForcedSnap = useBackupStore(s => s.createForcedSnapshotBeforeRestore);
  const createRestoreJob = useBackupStore(s => s.createRestoreJob);
  const startSimulation  = useBackupStore(s => s.startRestoreSimulation);
  const addEventLog      = useOperatorEventLogStore(s => s.addLog);

  async function execRestore() {
    if (!check1 || !check2) {
      Alert.alert("확인 필요", "복구 진행 전 두 항목 모두 동의해야 합니다.");
      return;
    }
    setRunning(true);
    await new Promise(r => setTimeout(r, 600));

    const preSnap = createForcedSnap(snap.operatorId, operatorName, actorName);
    const job = createRestoreJob({
      snapshotId: snap.id,
      operatorId: snap.operatorId,
      operatorName,
      mode: "single",
      note: `복구 시점: ${fmtDateTime(snap.createdAt)} / 실행자: ${actorName}`,
      actorName,
    });
    startSimulation(job.id);

    addEventLog({
      operatorId: snap.operatorId,
      actorRole: "operator",
      actorId: "self",
      actorName,
      eventType: "restore_execute",
      targetType: "snapshot",
      targetId: snap.id,
      summary: `복구 실행: ${fmtDateTime(snap.createdAt)} 시점 · 사전 백업 ${preSnap.id}`,
    });

    setRunning(false);
    onDone();
  }

  return (
    <View style={rm.overlay}>
      <Pressable style={rm.backdrop} onPress={onClose} />
      <View style={rm.sheet}>
        <View style={rm.header}>
          <Feather name="alert-triangle" size={20} color="#DC2626" />
          <Text style={rm.title}>복구 실행 확인</Text>
          <Pressable onPress={onClose}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
        </View>

        <View style={rm.targetBox}>
          <Text style={rm.targetLabel}>복구 시점</Text>
          <Text style={rm.targetTime}>{fmtDateTime(snap.createdAt)}</Text>
          <Text style={rm.targetNote}>{snap.note}</Text>
        </View>

        {/* 복구 대상 */}
        <Text style={rm.sectionTitle}>복구 대상 항목</Text>
        {AFFECTED_ITEMS.map(item => (
          <View key={item.label} style={rm.affectedRow}>
            <Feather name={item.icon} size={13} color="#2563EB" />
            <View style={{ flex: 1 }}>
              <Text style={rm.affectedLabel}>{item.label}</Text>
              <Text style={rm.affectedDetail}>{item.detail}</Text>
            </View>
          </View>
        ))}

        {/* 복구 제외 */}
        <Text style={[rm.sectionTitle, { color: "#D97706", marginTop: 10 }]}>복구 제외 / 미보장</Text>
        {EXCLUDED_ITEMS.map(item => (
          <View key={item.label} style={[rm.affectedRow, { borderLeftColor: "#FEF3C7" }]}>
            <Feather name={item.icon} size={13} color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={[rm.affectedLabel, { color: "#D97706" }]}>{item.label}</Text>
              <Text style={rm.affectedDetail}>{item.detail}</Text>
            </View>
          </View>
        ))}

        {/* 동의 체크박스 */}
        <View style={rm.checkRow}>
          <Switch value={check1} onValueChange={setCheck1} />
          <Text style={rm.checkTxt}>
            이 시점 이후 입력된 데이터가 사라질 수 있음을 이해했습니다.
          </Text>
        </View>
        <View style={rm.checkRow}>
          <Switch value={check2} onValueChange={setCheck2} />
          <Text style={rm.checkTxt}>
            복구 전 현재 상태 스냅샷이 자동 생성되며, 복구 이벤트가 로그에 기록됩니다.
          </Text>
        </View>

        <View style={rm.btnRow}>
          <Pressable style={[rm.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={onClose}>
            <Text style={[rm.btnTxt, { color: C.textSecondary }]}>취소</Text>
          </Pressable>
          <Pressable
            style={[rm.btn, { backgroundColor: check1 && check2 ? "#DC2626" : "#9CA3AF", flex: 1.5 }]}
            onPress={execRestore}
            disabled={running || !check1 || !check2}
          >
            {running
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Feather name="rotate-ccw" size={14} color="#fff" />
                  <Text style={[rm.btnTxt, { color: "#fff" }]}>복구 실행</Text>
                </>
            }
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── 메인 화면 ────────────────────────────────────────────────────
export default function RecoveryScreen() {
  const insets    = useSafeAreaInsets();
  const { pool, adminUser } = useAuth();
  const actorName = adminUser?.name ?? "관리자";
  const operatorId = pool?.id ?? "op-001";
  const operatorName = pool?.name ?? "수영장";

  const snapshots      = useBackupStore(s => s.snapshots);
  const restoreJobs    = useBackupStore(s => s.restoreJobs);
  const createSnapshot = useBackupStore(s => s.createSnapshot);
  const eventLogs      = useOperatorEventLogStore(s => s.getOperatorLogs(operatorId, 5));

  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshot | null>(null);
  const [doneSnap, setDoneSnap]           = useState(false);
  const [creating, setCreating]           = useState(false);

  const mySnaps = useMemo(
    () => snapshots.filter(s => s.operatorId === operatorId || (s.scope === "operator" && s.operatorId === operatorId)),
    [snapshots, operatorId],
  );

  const myJobs = useMemo(
    () => restoreJobs.filter(j => j.operatorId === operatorId),
    [restoreJobs, operatorId],
  );

  const latestSnap = mySnaps[0];

  async function handleManualSnapshot() {
    setCreating(true);
    await new Promise(r => setTimeout(r, 800));
    createSnapshot({ scope: "operator", operatorId, operatorName, note: "수동 스냅샷", actorName });
    setCreating(false);
    Alert.alert("백업 완료", "현재 상태의 스냅샷이 생성되었습니다.");
  }

  function handleRestoreDone() {
    setRestoreTarget(null);
    setDoneSnap(true);
  }

  return (
    <ScreenLayout>
      <SubScreenHeader title="백업·복구" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 상태 요약 */}
        <View style={[s.statusCard, { backgroundColor: latestSnap ? "#D1FAE5" : "#FEE2E2" }]}>
          <Feather name={latestSnap ? "shield" : "alert-circle"} size={18}
            color={latestSnap ? "#059669" : "#DC2626"} />
          <View style={{ flex: 1 }}>
            <Text style={[s.statusTitle, { color: latestSnap ? "#059669" : "#DC2626" }]}>
              {latestSnap ? "최근 백업 있음" : "백업 없음"}
            </Text>
            {latestSnap && (
              <Text style={s.statusSub}>{fmtDateTime(latestSnap.createdAt)} · {fmtSize(latestSnap.sizeMb)}</Text>
            )}
          </View>
          <Pressable
            style={[s.manualBtn, { backgroundColor: creating ? "#D1FAE5" : C.tint }]}
            onPress={handleManualSnapshot}
            disabled={creating}
          >
            {creating
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Feather name="save" size={13} color="#fff" />
                  <Text style={s.manualBtnTxt}>지금 백업</Text>
                </>
            }
          </Pressable>
        </View>

        {/* 복구 완료 배너 */}
        {doneSnap && (
          <View style={s.doneBanner}>
            <Feather name="check-circle" size={14} color="#059669" />
            <Text style={s.doneTxt}>복구가 실행 중입니다. 완료 후 화면을 새로고침하세요.</Text>
          </View>
        )}

        {/* 복구 원칙 안내 */}
        <View style={[s.infoBox, { backgroundColor: "#EFF6FF" }]}>
          <Text style={s.infoTitle}>복구 데이터 정책</Text>
          <Text style={s.infoLine}>• 회원 정보·승인 상태·반/수업 설정·출결·일지 텍스트·설정값 복구 가능</Text>
          <Text style={s.infoLine}>• 사진·영상 원본 복구는 보장되지 않습니다</Text>
          <Text style={s.infoLine}>• 복구 전 현재 상태가 자동 백업됩니다</Text>
          <Text style={s.infoLine}>• 모든 복구는 로그에 기록됩니다</Text>
        </View>

        {/* 역할 안내 */}
        <View style={[s.infoBox, { backgroundColor: "#FFF7ED" }]}>
          <Feather name="info" size={13} color="#D97706" />
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={[s.infoTitle, { color: "#D97706" }]}>역할 안내</Text>
            <Text style={[s.infoLine, { color: "#92400E" }]}>
              수업 스케줄·출결·일지 조작은 선생님 모드에서 진행하세요. 관리자 모드는 회원 명부·승인·반 개설·정산·복구를 담당합니다.
            </Text>
          </View>
        </View>

        {/* 최근 복구 이력 */}
        {myJobs.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>복구 이력</Text>
            {myJobs.slice(0, 3).map(job => (
              <View key={job.id} style={[s.jobRow, { backgroundColor: C.card }]}>
                <View style={[s.jobStatus, {
                  backgroundColor: job.status === "done" ? "#D1FAE5" : job.status === "running" ? "#DBEAFE" : "#FEF3C7",
                }]}>
                  <Text style={[s.jobStatusTxt, {
                    color: job.status === "done" ? "#059669" : job.status === "running" ? "#2563EB" : "#D97706",
                  }]}>{job.status === "done" ? "완료" : job.status === "running" ? "실행 중" : "대기"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.jobNote} numberOfLines={1}>{job.note}</Text>
                  <Text style={s.jobMeta}>{fmtDateTime(job.createdAt)} · {job.createdBy}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* 스냅샷 목록 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>스냅샷 목록 ({mySnaps.length})</Text>
          {mySnaps.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="archive" size={32} color={C.textMuted} />
              <Text style={s.emptyTxt}>아직 스냅샷이 없습니다.{"\n"}"지금 백업" 버튼으로 첫 백업을 만드세요.</Text>
            </View>
          ) : (
            mySnaps.map(snap => (
              <SnapshotCard key={snap.id} snap={snap} onRestore={setRestoreTarget} />
            ))
          )}
        </View>

        {/* 최근 이벤트 로그 */}
        {eventLogs.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>최근 이벤트 로그</Text>
            {eventLogs.map(log => (
              <View key={log.id} style={[s.logRow, { backgroundColor: C.card }]}>
                <Feather name="activity" size={13} color={C.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={s.logSummary} numberOfLines={1}>{log.summary}</Text>
                  <Text style={s.logMeta}>{fmtDateTime(log.createdAt)} · {log.actorName}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 복구 확인 모달 */}
      {restoreTarget && (
        <View style={StyleSheet.absoluteFill}>
          <RestoreModal
            snap={restoreTarget}
            operatorName={operatorName}
            actorName={actorName}
            onClose={() => setRestoreTarget(null)}
            onDone={handleRestoreDone}
          />
        </View>
      )}
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  scroll:       { padding: 16, gap: 12 },

  statusCard:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  statusTitle:  { fontSize: 14, fontFamily: "Inter_700Bold" },
  statusSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151", marginTop: 2 },
  manualBtn:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12,
                  paddingVertical: 8, borderRadius: 10 },
  manualBtnTxt: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  doneBanner:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 12,
                  backgroundColor: "#D1FAE5", borderRadius: 12 },
  doneTxt:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#065F46", flex: 1 },

  infoBox:      { borderRadius: 12, padding: 14, gap: 4, flexDirection: "row" },
  infoTitle:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1E40AF", marginBottom: 4 },
  infoLine:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#1E40AF", lineHeight: 18 },

  section:      { gap: 8 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: C.textSecondary },

  snapCard:     { backgroundColor: C.card, borderRadius: 14, overflow: "hidden" },
  snapTop:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  snapIcon:     { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  snapInfo:     { flex: 1, gap: 3 },
  snapRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  snapTime:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  snapNote:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  snapMeta:     { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  chip:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  chipTxt:      { fontSize: 10, fontFamily: "Inter_700Bold" },

  snapBody:     { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  includesTitle:{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  tagsRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag:          { backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tagTxt:       { fontSize: 10, fontFamily: "Inter_500Medium", color: "#2563EB" },
  excludeBox:   { flexDirection: "row", alignItems: "center", gap: 6,
                  backgroundColor: "#FEF3C7", padding: 8, borderRadius: 8 },
  excludeTxt:   { fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400E" },
  restoreBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, paddingVertical: 12, borderRadius: 12 },
  restoreBtnTxt:{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },

  jobRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  jobStatus:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  jobStatusTxt: { fontSize: 11, fontFamily: "Inter_700Bold" },
  jobNote:      { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  jobMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },

  logRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  logSummary:   { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  logMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },

  emptyBox:     { alignItems: "center", gap: 8, paddingVertical: 32 },
  emptyTxt:     { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center", lineHeight: 20 },
});

const rm = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: "flex-end" },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:        { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  padding: 20, gap: 10, maxHeight: "90%" },
  header:       { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  title:        { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", color: "#DC2626" },

  targetBox:    { backgroundColor: "#FEE2E2", borderRadius: 12, padding: 14, gap: 4 },
  targetLabel:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  targetTime:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#DC2626" },
  targetNote:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#991B1B" },

  sectionTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.textSecondary, marginTop: 4 },
  affectedRow:  { flexDirection: "row", gap: 10, paddingVertical: 6,
                  borderLeftWidth: 2, borderLeftColor: "#DBEAFE", paddingLeft: 10 },
  affectedLabel:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  affectedDetail:{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 16 },

  checkRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4,
                  backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10 },
  checkTxt:     { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 18 },

  btnRow:       { flexDirection: "row", gap: 10, marginTop: 6 },
  btn:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, paddingVertical: 13, borderRadius: 12 },
  btnTxt:       { fontSize: 14, fontFamily: "Inter_700Bold" },
});
