/**
 * 회원 상세 8탭 허브 — 쉘 (탭 라우팅 + 공유 상태)
 * 탭 컴포넌트: components/admin/member/ 하위
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal }             from "@/components/common/ConfirmModal";
import { MemberStatusChangeModal }  from "@/components/common/MemberStatusChangeModal";
import {
  WeeklyCount, getStudentConnectionStatus,
} from "@/utils/studentUtils";

import { ClassPickerModal }           from "@/components/admin/member/ClassPickerModal";
import { MemberInfoTab }              from "@/components/admin/member/MemberInfoTab";
import { MemberClassTab }             from "@/components/admin/member/MemberClassTab";
import { MemberLevelTab }             from "@/components/admin/member/MemberLevelTab";
import { MemberParentTab }            from "@/components/admin/member/MemberParentTab";
import { MemberPaymentTab }           from "@/components/admin/member/MemberPaymentTab";
import { MemberLogTab }               from "@/components/admin/member/MemberLogTab";
import { MemberMakeupTab }            from "@/components/admin/member/MemberMakeupTab";
import { MemberParentRequestsTab }    from "@/components/admin/member/MemberParentRequestsTab";
import {
  DetailData, ActivityLog, ClassGroup, LevelInfo, STATUS_META,
} from "@/components/admin/member/memberDetailTypes";

const C = Colors.light;

const TABS = ["기본정보", "수업정보", "보강", "레벨/평가", "학부모공유", "학부모 요청", "결제/이용", "활동로그"] as const;
type Tab = typeof TABS[number];

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();

  const [data, setData]                   = useState<DetailData | null>(null);
  const [groups, setGroups]               = useState<ClassGroup[]>([]);
  const [logs, setLogs]                   = useState<ActivityLog[]>([]);
  const [makeups, setMakeups]             = useState<any[]>([]);
  const [parentRequests, setParentRequests] = useState<any[]>([]);
  const [activeTab, setActiveTab]         = useState<Tab>("기본정보");
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [showPicker, setShowPicker]       = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [alertInfo, setAlertInfo]         = useState<{ title: string; msg: string } | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // 편집 상태
  const [editName, setEditName]               = useState("");
  const [editBirth, setEditBirth]             = useState("");
  const [editParentName, setEditParentName]   = useState("");
  const [editParentPhone, setEditParentPhone] = useState("");
  const [editParentPhone2, setEditParentPhone2] = useState("");
  const [editPhone, setEditPhone]             = useState("");
  const [editMemo, setEditMemo]               = useState("");
  const [editNotes, setEditNotes]             = useState("");
  const [infoChanged, setInfoChanged]         = useState(false);

  // 수업 편집
  const [weeklyCount, setWeeklyCount]   = useState<WeeklyCount>(1);
  const [assignedIds, setAssignedIds]   = useState<string[]>([]);
  const [classChanged, setClassChanged] = useState(false);

  // 레벨
  const [levelInfo, setLevelInfo]           = useState<LevelInfo | null>(null);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [levelChanging, setLevelChanging]   = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detailRes, cgRes] = await Promise.all([
        apiRequest(token, `/admin/students/${id}/detail`),
        apiRequest(token, "/class-groups"),
      ]);
      if (detailRes.ok) {
        const d: DetailData = await detailRes.json();
        setData(d);
        setEditName(d.name || "");
        setEditBirth(d.birth_year || "");
        setEditParentName(d.parent_name || "");
        setEditParentPhone(d.parent_phone || "");
        setEditParentPhone2((d as any).parent_phone2 || "");
        setEditPhone(d.phone || "");
        setEditMemo(d.memo || "");
        setEditNotes(d.notes || "");
        setWeeklyCount((d.weekly_count || 1) as WeeklyCount);
        setAssignedIds(d.assigned_class_ids || []);
      }
      if (cgRes.ok) setGroups(await cgRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id, token]);

  const loadLogs = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest(token, `/admin/member-logs/${id}`);
      if (res.ok) setLogs(await res.json());
    } catch (e) { console.error(e); }
  }, [id, token]);

  const loadLevel = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest(token, `/admin/students/${id}/level`);
      if (res.ok) setLevelInfo(await res.json());
    } catch {}
  }, [id, token]);

  async function handleLevelChange(levelOrder: number) {
    if (!id) return;
    setLevelChanging(true);
    setShowLevelPicker(false);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/level`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_order: levelOrder }),
      });
      if (res.ok) await loadLevel();
    } catch {}
    finally { setLevelChanging(false); }
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (activeTab === "활동로그") loadLogs(); }, [activeTab, loadLogs]);
  useEffect(() => { if (activeTab === "레벨/평가") loadLevel(); }, [activeTab, loadLevel]);
  useEffect(() => {
    if (activeTab === "보강" && id) {
      apiRequest(token, `/admin/makeups/student/${id}`).then(r => r.ok ? r.json() : []).then(setMakeups);
    }
    if (activeTab === "학부모 요청" && id) {
      apiRequest(token, `/parent-requests?student_id=${id}`)
        .then(r => r.ok ? r.json() : [])
        .then(d => setParentRequests(Array.isArray(d) ? d : d.items || []));
    }
  }, [activeTab, id, token]);

  async function saveInfo() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/info`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName, birth_year: editBirth, parent_name: editParentName,
          parent_phone: editParentPhone, parent_phone2: editParentPhone2, phone: editPhone,
          memo: editMemo, notes: editNotes,
        }),
      });
      if (res.ok) {
        setData(d => d ? { ...d, name: editName, birth_year: editBirth, parent_name: editParentName, parent_phone: editParentPhone, phone: editPhone, memo: editMemo, notes: editNotes } as any : d);
        setInfoChanged(false);
        setAlertInfo({ title: "저장 완료", msg: "기본 정보가 업데이트되었습니다." });
      } else {
        const e = await res.json();
        setAlertInfo({ title: "오류", msg: e.error || "저장에 실패했습니다." });
      }
    } catch { setAlertInfo({ title: "오류", msg: "네트워크 오류가 발생했습니다." }); }
    finally { setSaving(false); }
  }

  function restoreMember() { setShowRestoreConfirm(true); }

  async function doRestoreMember() {
    setShowRestoreConfirm(false);
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/restore`, { method: "POST" });
      if (res.ok) {
        setData(d => d ? { ...d, status: "active" } : d);
        setAlertInfo({ title: "복구 완료", msg: "회원이 복구되었습니다." });
      } else {
        const e = await res.json();
        setAlertInfo({ title: "오류", msg: e.error || "복구에 실패했습니다." });
      }
    } catch { setAlertInfo({ title: "오류", msg: "네트워크 오류" }); }
    finally { setSaving(false); }
  }

  async function saveAssignment() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: assignedIds, weekly_count: weeklyCount }),
      });
      const d = await res.json();
      if (!res.ok) { setAlertInfo({ title: "오류", msg: d.message || "저장에 실패했습니다." }); return; }
      setData(prev => prev ? { ...prev, ...d } : prev);
      setAssignedIds(d.assigned_class_ids || []);
      setClassChanged(false);
      setAlertInfo({ title: "저장 완료", msg: "반 배정이 업데이트되었습니다." });
    } catch { setAlertInfo({ title: "오류", msg: "네트워크 오류" }); }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <ActivityIndicator color={themeColor} size="large" style={{ flex: 1 }} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="회원 정보" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: C.textMuted }}>회원을 찾을 수 없습니다</Text>
        </View>
      </View>
    );
  }

  const connStatus    = getStudentConnectionStatus(data);
  const statusMeta    = STATUS_META[data.status] || STATUS_META.active;
  const assignedClasses = groups.filter(g => assignedIds.includes(g.id));
  const poolName      = (pool as any)?.name || "수영장";
  const isArchived    = ["withdrawn", "deleted"].includes(data.status);

  return (
    <View style={s.safe}>
      <SubScreenHeader
        title={data.name}
        subtitle={statusMeta.label}
        rightSlot={saving ? <ActivityIndicator color={themeColor} size="small" /> : undefined}
      />

      {/* 탭 스크롤 바 */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.tabScroll}
        contentContainerStyle={{ paddingHorizontal: 12 }}
      >
        {TABS.map(t => (
          <Pressable
            key={t}
            style={[s.tabBtn, activeTab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(t)}
          >
            <Text style={[s.tabText, { color: activeTab === t ? themeColor : C.textSecondary }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── 탭 콘텐츠 ── */}
      {activeTab === "기본정보" && (
        <MemberInfoTab
          data={data} themeColor={themeColor} saving={saving}
          editName={editName} setEditName={setEditName}
          editBirth={editBirth} setEditBirth={setEditBirth}
          editPhone={editPhone} setEditPhone={setEditPhone}
          editParentName={editParentName} setEditParentName={setEditParentName}
          editParentPhone={editParentPhone} setEditParentPhone={setEditParentPhone}
          editParentPhone2={editParentPhone2} setEditParentPhone2={setEditParentPhone2}
          infoChanged={infoChanged} setInfoChanged={setInfoChanged}
          onSave={saveInfo}
          onRestoreMember={restoreMember}
          onShowStatusModal={() => setShowStatusModal(true)}
          isArchived={isArchived}
          statusMeta={statusMeta}
        />
      )}

      {activeTab === "수업정보" && (
        <MemberClassTab
          data={data} themeColor={themeColor} saving={saving} groups={groups}
          weeklyCount={weeklyCount} setWeeklyCount={setWeeklyCount}
          assignedIds={assignedIds} setAssignedIds={setAssignedIds}
          assignedClasses={assignedClasses}
          classChanged={classChanged} setClassChanged={setClassChanged}
          onSaveAssignment={saveAssignment}
          onOpenPicker={() => setShowPicker(true)}
        />
      )}

      {activeTab === "보강" && (
        <MemberMakeupTab makeups={makeups} themeColor={themeColor} />
      )}

      {activeTab === "레벨/평가" && (
        <MemberLevelTab
          themeColor={themeColor} saving={saving}
          levelInfo={levelInfo} levelChanging={levelChanging}
          showLevelPicker={showLevelPicker}
          onLevelChange={handleLevelChange}
          onOpenLevelPicker={() => setShowLevelPicker(true)}
          onCloseLevelPicker={() => setShowLevelPicker(false)}
          editNotes={editNotes} setEditNotes={setEditNotes}
          infoChanged={infoChanged} setInfoChanged={setInfoChanged}
          onSave={saveInfo}
        />
      )}

      {activeTab === "학부모공유" && (
        <MemberParentTab
          data={data} themeColor={themeColor}
          connStatus={connStatus} poolName={poolName}
          onAlert={setAlertInfo}
        />
      )}

      {activeTab === "학부모 요청" && (
        <MemberParentRequestsTab parentRequests={parentRequests} />
      )}

      {activeTab === "결제/이용" && (
        <MemberPaymentTab
          data={data} themeColor={themeColor}
          weeklyCount={weeklyCount}
          assignedClasses={assignedClasses}
        />
      )}

      {activeTab === "활동로그" && (
        <MemberLogTab logs={logs} />
      )}

      {/* ── 공통 모달 ── */}
      {data && (
        <MemberStatusChangeModal
          visible={showStatusModal}
          studentId={id!}
          studentName={data.name}
          currentStatus={data.status}
          pendingStatusChange={(data as any).pending_status_change}
          pendingEffectiveMode={(data as any).pending_effective_mode}
          onClose={() => setShowStatusModal(false)}
          onChanged={load}
        />
      )}

      {showPicker && (
        <ClassPickerModal
          groups={groups}
          selectedIds={assignedIds}
          maxSelect={weeklyCount}
          onSelect={ids => { setAssignedIds(ids); setClassChanged(true); }}
          onClose={() => setShowPicker(false)}
        />
      )}

      <ConfirmModal
        visible={!!alertInfo}
        title={alertInfo?.title ?? ""}
        message={alertInfo?.msg ?? ""}
        confirmText="확인"
        onConfirm={() => setAlertInfo(null)}
      />
      <ConfirmModal
        visible={showRestoreConfirm}
        title="회원 복구"
        message={`${data?.name}님을 재원 상태로 복구하시겠습니까?`}
        confirmText="복구"
        cancelText="취소"
        onConfirm={doRestoreMember}
        onCancel={() => setShowRestoreConfirm(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  tabScroll: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border, flexGrow: 0 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 13 },
  tabText: { fontSize: 13, fontFamily: "Pretendard-Medium" },
});
