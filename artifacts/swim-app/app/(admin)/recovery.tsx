/**
 * (admin)/recovery.tsx — 백업·복구
 * 스냅샷 목록 보기 → 시점 선택 → 영향 범위 확인 → 복구 실행
 */
import { Activity, Archive, CircleAlert, CircleCheck, Clock, GitBranch, Info, RotateCcw, Save, Trash2, TriangleAlert, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
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

const TYPE_CFG: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  auto:           { color: "#2EC4B6", bg: "#E6FFFA", label: "자동",    icon: "clock"      },
  manual:         { color: "#2EC4B6", bg: "#E6FFFA", label: "수동",    icon: "save"       },
  before_restore: { color: "#D97706", bg: "#FFF1BF", label: "복구 전", icon: "rotate-ccw" },
  before_delete:  { color: "#D96C6C", bg: "#F9DEDA", label: "삭제 전", icon: "alert-triangle" },
};

function snapTypeChip(snap: BackupSnapshot) {
  return TYPE_CFG[snap.snapshotType ?? "manual"] ?? { color: "#64748B", bg: "#FFFFFF", label: "기타", icon: "archive" };
}

// ── 스냅샷 삭제 확인 모달 (2단계) ────────────────────────────────
function SnapshotDeleteModal({
  snap, actorName, onClose, onDone,
}: {
  snap: BackupSnapshot;
  actorName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep]       = useState<1 | 2>(1);
  const [confirmed, setConfirmed] = useState(false);
  const deleteSnapshot = useBackupStore(s => s.deleteSnapshot);
  const addEventLog    = useOperatorEventLogStore(s => s.addLog);

  function execDelete() {
    deleteSnapshot(snap.id);
    addEventLog({
      operatorId: snap.operatorId || "system",
      actorRole: "operator",
      actorId: "self",
      actorName,
      eventType: "snapshot_delete",
      targetType: "snapshot",
      targetId: snap.id,
      summary: `스냅샷 삭제: ${fmtDateTime(snap.createdAt)} — ${snap.note ?? ""}`,
    });
    onDone();
  }

  return (
    <View style={rm.overlay}>
      <Pressable style={rm.backdrop} onPress={onClose} />
      <View style={rm.sheet}>
        <View style={rm.header}>
          <Trash2 size={20} color="#D96C6C" />
          <Text style={rm.title}>스냅샷 삭제</Text>
          <Pressable onPress={onClose}><X size={20} color={C.textSecondary} /></Pressable>
        </View>

        <View style={[rm.targetBox, { backgroundColor: "#F9DEDA" }]}>
          <Text style={rm.targetLabel}>삭제할 스냅샷</Text>
          {snap.snapshotName && (
            <Text style={[rm.targetTime, { fontFamily: "Pretendard-SemiBold", marginBottom: 2 }]}>{snap.snapshotName}</Text>
          )}
          <Text style={rm.targetTime}>{fmtDateTime(snap.createdAt)}</Text>
          <Text style={rm.targetNote}>{snap.note ?? ""} · {fmtSize(snap.sizeMb)}</Text>
        </View>

        {step === 1 ? (
          <>
            <View style={[rm.checkRow, { backgroundColor: "#FEF2F2" }]}>
              <TriangleAlert size={14} color="#D96C6C" />
              <Text style={[rm.checkTxt, { color: "#991B1B" }]}>
                데이터 유지를 위하여 백업 데이터를 삭제할 경우 이전 데이터는 영원히 복구할 수 없습니다.
              </Text>
            </View>
            <View style={rm.btnRow}>
              <Pressable style={[rm.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={onClose}>
                <Text style={[rm.btnTxt, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[rm.btn, { backgroundColor: "#F9DEDA", flex: 1.5 }]} onPress={() => setStep(2)}>
                <Trash2 size={14} color="#D96C6C" />
                <Text style={[rm.btnTxt, { color: "#D96C6C" }]}>계속 (2/2)</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={[rm.checkRow, { backgroundColor: "#F1F5F9" }]}>
              <Switch value={confirmed} onValueChange={setConfirmed} />
              <Text style={rm.checkTxt}>
                이 스냅샷이 영구 삭제됨을 이해했으며, 삭제 이후 이전 데이터 복구가 불가능함을 확인합니다.
              </Text>
            </View>
            <View style={rm.btnRow}>
              <Pressable style={[rm.btn, { backgroundColor: C.background, borderWidth: 1, borderColor: C.border }]} onPress={() => setStep(1)}>
                <Text style={[rm.btnTxt, { color: C.textSecondary }]}>뒤로</Text>
              </Pressable>
              <Pressable
                style={[rm.btn, { backgroundColor: confirmed ? "#D96C6C" : "#64748B", flex: 1.5 }]}
                onPress={execDelete}
                disabled={!confirmed}
              >
                <Trash2 size={14} color="#fff" />
                <Text style={[rm.btnTxt, { color: "#fff" }]}>영구 삭제</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

// ── 스냅샷 카드 ───────────────────────────────────────────────────
function SnapshotCard({
  snap, onRestore, onDelete,
}: {
  snap: BackupSnapshot;
  onRestore: (snap: BackupSnapshot) => void;
  onDelete: (snap: BackupSnapshot) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const chip = snapTypeChip(snap);

  function handleCompare() {
    Alert.alert("비교 복구", "선택한 스냅샷 시점과 현재 상태를 비교하는 기능입니다.\n\n현재 버전에서는 미리보기 모드로만 제공됩니다. 실제 복구 전 차이를 확인해 주세요.");
  }

  return (
    <View style={s.snapCard}>
      <Pressable style={s.snapTop} onPress={() => setExpanded(v => !v)}>
        <View style={[s.snapIcon, { backgroundColor: chip.bg }]}>
          <LucideIcon name={chip.icon as any} size={16} color={chip.color} />
        </View>
        <View style={s.snapInfo}>
          {snap.snapshotName && (
            <Text style={s.snapName} numberOfLines={1}>{snap.snapshotName}</Text>
          )}
          <View style={s.snapRow}>
            <Text style={s.snapTime}>{fmtDateTime(snap.createdAt)}</Text>
            <View style={[s.chip, { backgroundColor: chip.bg }]}>
              <Text style={[s.chipTxt, { color: chip.color }]}>{chip.label}</Text>
            </View>
          </View>
          <Text style={s.snapNote} numberOfLines={1}>{snap.note}</Text>
          <Text style={s.snapMeta}>{fmtSize(snap.sizeMb)} · {snap.createdBy}</Text>
        </View>
        <LucideIcon name={expanded ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
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
            <CircleAlert size={12} color="#D97706" />
            <Text style={s.excludeTxt}>사진·영상 원본 복구 미보장</Text>
          </View>
          {/* 액션 버튼: 복구 / 비교 / 삭제 */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={[s.restoreBtn, { backgroundColor: C.button, flex: 1 }]}
              onPress={() => onRestore(snap)}
            >
              <RotateCcw size={14} color="#fff" />
              <Text style={s.restoreBtnTxt}>이 시점으로 복구</Text>
            </Pressable>
            <Pressable
              style={[s.restoreBtn, { backgroundColor: "#E6FFFA", flex: 0.65 }]}
              onPress={handleCompare}
            >
              <GitBranch size={14} color="#2EC4B6" />
              <Text style={[s.restoreBtnTxt, { color: "#2EC4B6" }]}>비교</Text>
            </Pressable>
            <Pressable
              style={[s.restoreBtn, { backgroundColor: "#F9DEDA", flex: 0.55 }]}
              onPress={() => onDelete(snap)}
            >
              <Trash2 size={14} color="#D96C6C" />
              <Text style={[s.restoreBtnTxt, { color: "#D96C6C" }]}>삭제</Text>
            </Pressable>
          </View>
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
          <TriangleAlert size={20} color="#D96C6C" />
          <Text style={rm.title}>복구 실행 확인</Text>
          <Pressable onPress={onClose}><X size={20} color={C.textSecondary} /></Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {/* 복구 미리보기 정보 */}
          <View style={rm.previewBox}>
            <View style={rm.previewRow}>
              <Text style={rm.previewKey}>스냅샷 이름</Text>
              <Text style={rm.previewVal} numberOfLines={2}>{snap.snapshotName ?? "—"}</Text>
            </View>
            <View style={rm.previewRow}>
              <Text style={rm.previewKey}>생성 시각</Text>
              <Text style={rm.previewVal}>{fmtDateTime(snap.createdAt)}</Text>
            </View>
            <View style={rm.previewRow}>
              <Text style={rm.previewKey}>수영장</Text>
              <Text style={rm.previewVal}>{operatorName}</Text>
            </View>
            {snap.note ? (
              <View style={rm.previewRow}>
                <Text style={rm.previewKey}>메모</Text>
                <Text style={rm.previewVal}>{snap.note}</Text>
              </View>
            ) : null}
          </View>

          {/* 전체 복구 안내 */}
          <View style={[rm.policyBox, { marginTop: 10 }]}>
            <CircleAlert size={13} color="#D97706" />
            <Text style={rm.policyTxt}>
              전체 시점 복구만 허용됩니다. 부분 복구(항목별 선택 복구)는 지원하지 않습니다.
            </Text>
          </View>

          {/* 덮어쓰기 경고 */}
          <View style={[rm.overwriteBox, { marginTop: 8 }]}>
            <TriangleAlert size={13} color="#D96C6C" />
            <Text style={rm.overwriteTxt}>
              복구 실행 시 현재 데이터가 모두 이 시점으로 덮어쓰여집니다. 이 시점 이후 입력·수정된 데이터는 복구되지 않습니다.
            </Text>
          </View>

          {/* 복구 대상 */}
          <Text style={[rm.sectionTitle, { marginTop: 12 }]}>복구 대상 데이터 종류</Text>
          {AFFECTED_ITEMS.map(item => (
            <View key={item.label} style={rm.affectedRow}>
              <LucideIcon name={item.icon} size={13} color="#2EC4B6" />
              <View style={{ flex: 1 }}>
                <Text style={rm.affectedLabel}>{item.label}</Text>
                <Text style={rm.affectedDetail}>{item.detail}</Text>
              </View>
            </View>
          ))}

          {/* 복구 제외 */}
          <Text style={[rm.sectionTitle, { color: "#D97706", marginTop: 10 }]}>복구 제외 / 미보장</Text>
          {EXCLUDED_ITEMS.map(item => (
            <View key={item.label} style={[rm.affectedRow, { borderLeftColor: "#FFF1BF" }]}>
              <LucideIcon name={item.icon} size={13} color="#D97706" />
              <View style={{ flex: 1 }}>
                <Text style={[rm.affectedLabel, { color: "#D97706" }]}>{item.label}</Text>
                <Text style={rm.affectedDetail}>{item.detail}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

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
            style={[rm.btn, { backgroundColor: check1 && check2 ? "#D96C6C" : "#64748B", flex: 1.5 }]}
            onPress={execRestore}
            disabled={running || !check1 || !check2}
          >
            {running
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <RotateCcw size={14} color="#fff" />
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
  const getEventLogs   = useOperatorEventLogStore(s => s.getOperatorLogs);
  const eventLogs      = useMemo(() => getEventLogs(operatorId, 5), [getEventLogs, operatorId]);

  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshot | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<BackupSnapshot | null>(null);
  const [doneSnap, setDoneSnap]           = useState(false);
  const [doneDelete, setDoneDelete]       = useState(false);
  const [creating, setCreating]           = useState(false);

  const mySnaps = useMemo(
    () => snapshots.filter(s => s.operatorId === operatorId || (s.scope === "operator" && s.operatorId === operatorId)),
    [snapshots, operatorId],
  );

  const myJobs = useMemo(
    () => restoreJobs.filter(j => j.operatorId === operatorId),
    [restoreJobs, operatorId],
  );

  const latestSnap     = mySnaps[0];
  const latestAutoSnap = useMemo(
    () => mySnaps.find(s => s.snapshotType === "auto"),
    [mySnaps],
  );

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

  function handleDeleteDone() {
    setDeleteTarget(null);
    setDoneDelete(true);
  }

  return (
    <ScreenLayout>
      <SubScreenHeader title="백업·복구" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 상태 요약 */}
        <View style={[s.statusCard, { backgroundColor: latestSnap ? "#E6FFFA" : "#F9DEDA" }]}>
          <LucideIcon name={latestSnap ? "shield" : "alert-circle"} size={18}
            color={latestSnap ? "#2EC4B6" : "#D96C6C"} />
          <View style={{ flex: 1 }}>
            <Text style={[s.statusTitle, { color: latestSnap ? "#2EC4B6" : "#D96C6C" }]}>
              {latestSnap ? "최근 백업 있음" : "백업 없음"}
            </Text>
            {latestSnap && (
              <Text style={s.statusSub}>{fmtDateTime(latestSnap.createdAt)} · {fmtSize(latestSnap.sizeMb)}</Text>
            )}
          </View>
          <Pressable
            style={[s.manualBtn, { backgroundColor: creating ? "#E6FFFA" : C.tint }]}
            onPress={handleManualSnapshot}
            disabled={creating}
          >
            {creating
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Save size={13} color="#fff" />
                  <Text style={s.manualBtnTxt}>지금 백업</Text>
                </>
            }
          </Pressable>
        </View>

        {/* 자동 백업 정책 안내 */}
        <View style={[s.autoBackupBox, { backgroundColor: "#DFF3EC" }]}>
          <View style={s.autoBackupRow}>
            <Clock size={14} color="#2EC4B6" />
            <Text style={s.autoBackupTitle}>자동 백업 정책</Text>
          </View>
          <Text style={s.autoBackupLine}>• 자동 백업 주기: <Text style={{ fontFamily: "Pretendard-SemiBold" }}>1시간</Text></Text>
          <Text style={s.autoBackupLine}>
            • 마지막 자동 백업:{" "}
            <Text style={{ fontFamily: "Pretendard-SemiBold" }}>
              {latestAutoSnap ? fmtDateTime(latestAutoSnap.createdAt) : "기록 없음"}
            </Text>
          </Text>
          {latestAutoSnap?.snapshotName && (
            <Text style={s.autoBackupLine}>
              • 스냅샷 이름: <Text style={{ fontFamily: "Pretendard-Medium" }}>{latestAutoSnap.snapshotName}</Text>
            </Text>
          )}
          <Text style={s.autoBackupLine}>• 보존 기간: 최근 30일 자동 스냅샷 유지</Text>
        </View>

        {/* 복구 완료 배너 */}
        {doneSnap && (
          <View style={s.doneBanner}>
            <CircleCheck size={14} color="#2EC4B6" />
            <Text style={s.doneTxt}>복구가 실행 중입니다. 완료 후 화면을 새로고침하세요.</Text>
          </View>
        )}

        {/* 삭제 완료 배너 */}
        {doneDelete && (
          <View style={[s.doneBanner, { backgroundColor: "#F9DEDA" }]}>
            <Trash2 size={14} color="#D96C6C" />
            <Text style={[s.doneTxt, { color: "#991B1B" }]}>스냅샷이 영구 삭제되었습니다.</Text>
          </View>
        )}

        {/* 복구 원칙 안내 */}
        <View style={[s.infoBox, { backgroundColor: "#E6FFFA" }]}>
          <Text style={s.infoTitle}>복구 데이터 정책</Text>
          <Text style={s.infoLine}>• 회원 정보·승인 상태·반/수업 설정·출결·일지 텍스트·설정값 복구 가능</Text>
          <Text style={s.infoLine}>• 사진·영상 원본 복구는 보장되지 않습니다</Text>
          <Text style={s.infoLine}>• 복구 전 현재 상태가 자동 백업됩니다</Text>
          <Text style={s.infoLine}>• 모든 복구는 로그에 기록됩니다</Text>
        </View>

        {/* 역할 안내 */}
        <View style={[s.infoBox, { backgroundColor: "#FFF1BF" }]}>
          <Info size={13} color="#D97706" />
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
                  backgroundColor: job.status === "done" ? "#E6FFFA" : job.status === "running" ? "#E6FFFA" : "#FFF1BF",
                }]}>
                  <Text style={[s.jobStatusTxt, {
                    color: job.status === "done" ? "#2EC4B6" : job.status === "running" ? "#2EC4B6" : "#D97706",
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
              <Archive size={32} color={C.textMuted} />
              <Text style={s.emptyTxt}>아직 스냅샷이 없습니다.{"\n"}"지금 백업" 버튼으로 첫 백업을 만드세요.</Text>
            </View>
          ) : (
            mySnaps.map(snap => (
              <SnapshotCard key={snap.id} snap={snap} onRestore={setRestoreTarget} onDelete={setDeleteTarget} />
            ))
          )}
        </View>

        {/* 최근 이벤트 로그 */}
        {eventLogs.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>최근 이벤트 로그</Text>
            {eventLogs.map(log => (
              <View key={log.id} style={[s.logRow, { backgroundColor: C.card }]}>
                <Activity size={13} color={C.tint} />
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

      {/* 스냅샷 삭제 확인 모달 */}
      {deleteTarget && (
        <View style={StyleSheet.absoluteFill}>
          <SnapshotDeleteModal
            snap={deleteTarget}
            actorName={actorName}
            onClose={() => setDeleteTarget(null)}
            onDone={handleDeleteDone}
          />
        </View>
      )}
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  scroll:       { padding: 16, gap: 12 },

  statusCard:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  statusTitle:  { fontSize: 14, fontFamily: "Pretendard-Bold" },
  statusSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", marginTop: 2 },
  manualBtn:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12,
                  paddingVertical: 8, borderRadius: 10 },
  manualBtnTxt: { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#fff" },

  doneBanner:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 12,
                  backgroundColor: "#E6FFFA", borderRadius: 12 },
  doneTxt:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: "#065F46", flex: 1 },

  infoBox:      { borderRadius: 12, padding: 14, gap: 4, flexDirection: "row" },
  infoTitle:    { fontSize: 13, fontFamily: "Pretendard-Bold", color: "#0F172A", marginBottom: 4 },
  infoLine:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 18 },

  section:      { gap: 8 },
  sectionTitle: { fontSize: 13, fontFamily: "Pretendard-Bold", color: C.textSecondary },

  autoBackupBox:  { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, gap: 4 },
  autoBackupRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  autoBackupTitle:{ fontSize: 13, fontFamily: "Pretendard-Bold", color: "#2EC4B6" },
  autoBackupLine: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#166534", lineHeight: 18 },

  snapCard:     { backgroundColor: C.card, borderRadius: 14, overflow: "hidden" },
  snapTop:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  snapIcon:     { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  snapInfo:     { flex: 1, gap: 3 },
  snapRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  snapName:     { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  snapTime:     { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text },
  snapNote:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  snapMeta:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  chip:         { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  chipTxt:      { fontSize: 10, fontFamily: "Pretendard-Bold" },

  snapBody:     { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  includesTitle:{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  tagsRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag:          { backgroundColor: "#E6FFFA", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tagTxt:       { fontSize: 10, fontFamily: "Pretendard-Medium", color: "#2EC4B6" },
  excludeBox:   { flexDirection: "row", alignItems: "center", gap: 6,
                  backgroundColor: "#FFF1BF", padding: 8, borderRadius: 8 },
  excludeTxt:   { fontSize: 11, fontFamily: "Pretendard-Medium", color: "#92400E" },
  restoreBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, paddingVertical: 12, borderRadius: 12 },
  restoreBtnTxt:{ fontSize: 14, fontFamily: "Pretendard-Bold", color: "#fff" },

  jobRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  jobStatus:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  jobStatusTxt: { fontSize: 11, fontFamily: "Pretendard-Bold" },
  jobNote:      { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.text },
  jobMeta:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },

  logRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  logSummary:   { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.text },
  logMeta:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },

  emptyBox:     { alignItems: "center", gap: 8, paddingVertical: 32 },
  emptyTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", lineHeight: 20 },
});

const rm = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: "flex-end" },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:        { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  padding: 20, gap: 10, maxHeight: "90%" },
  header:       { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  title:        { flex: 1, fontSize: 17, fontFamily: "Pretendard-Bold", color: "#D96C6C" },

  targetBox:    { backgroundColor: "#F9DEDA", borderRadius: 12, padding: 14, gap: 4 },
  targetLabel:  { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#D96C6C" },
  targetTime:   { fontSize: 16, fontFamily: "Pretendard-Bold", color: "#D96C6C" },
  targetNote:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#991B1B" },

  previewBox:   { backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0", padding: 14, gap: 8 },
  previewRow:   { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  previewKey:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, flexShrink: 0 },
  previewVal:   { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.text, textAlign: "right", flex: 1 },

  policyBox:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFBEB", borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A", padding: 10 },
  policyTxt:    { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 17 },

  overwriteBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 10, borderWidth: 1, borderColor: "#FECACA", padding: 10 },
  overwriteTxt: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#991B1B", lineHeight: 17 },

  sectionTitle: { fontSize: 12, fontFamily: "Pretendard-Bold", color: C.textSecondary, marginTop: 4 },
  affectedRow:  { flexDirection: "row", gap: 10, paddingVertical: 6,
                  borderLeftWidth: 2, borderLeftColor: "#E6FFFA", paddingLeft: 10 },
  affectedLabel:{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text },
  affectedDetail:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 16 },

  checkRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4,
                  backgroundColor: "#F1F5F9", borderRadius: 10, padding: 10 },
  checkTxt:     { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 18 },

  btnRow:       { flexDirection: "row", gap: 10, marginTop: 6 },
  btn:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, paddingVertical: 13, borderRadius: 12 },
  btnTxt:       { fontSize: 14, fontFamily: "Pretendard-Bold" },
});
