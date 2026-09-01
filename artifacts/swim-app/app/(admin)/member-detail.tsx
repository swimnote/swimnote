/**
 * WP-M3: Admin Member Detail — Long-scroll 통합 레이아웃
 *
 * 탭 구조 제거 → 단일 ScrollView + Section A~H
 * Section G (student_links): WP-M5 전까지 미노출
 *
 * 기존 endpoint/semantics 변경 없음.
 * mode gate 추가 없음 (Shared Core).
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { MemberStatusChangeModal } from "@/components/common/MemberStatusChangeModal";
import { WeeklyCount } from "@/utils/studentUtils";

import { ClassPickerModal } from "@/components/admin/member/ClassPickerModal";
import { SectionA_BasicInfo } from "@/components/admin/member/SectionA_BasicInfo";
import { SectionB_ClassInfo } from "@/components/admin/member/SectionB_ClassInfo";
import { SectionC_Level } from "@/components/admin/member/SectionC_Level";
import { SectionD_Summary } from "@/components/admin/member/SectionD_Summary";
import { SectionE_Guardian } from "@/components/admin/member/SectionE_Guardian";
import { SectionF_Feed } from "@/components/admin/member/SectionF_Feed";
import { SectionH_StatusMgmt } from "@/components/admin/member/SectionH_StatusMgmt";
import {
  DetailData, ActivityLog, ClassGroup, LevelInfo, STATUS_META,
} from "@/components/admin/member/memberDetailTypes";

const C = Colors.light;

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, pool, adminUser } = useAuth();
  const { themeColor } = useBrand();

  const isPoolAdmin =
    adminUser?.role === "pool_admin" ||
    (adminUser?.roles ?? []).includes("pool_admin");

  // ── 데이터 ─────────────────────────────────────────────────────
  const [data, setData]     = useState<DetailData | null>(null);
  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // ── Section A 편집 상태 ─────────────────────────────────────────
  const [editName, setEditName]   = useState("");
  const [editBirth, setEditBirth] = useState("");
  const [editMemo, setEditMemo]   = useState("");
  const [editNotes, setEditNotes] = useState("");

  // ── Section B 편집 상태 ─────────────────────────────────────────
  const [weeklyCount, setWeeklyCount]   = useState<WeeklyCount>(1);
  const [assignedIds, setAssignedIds]   = useState<string[]>([]);
  const [classChanged, setClassChanged] = useState(false);

  // ── Section C 레벨 상태 ─────────────────────────────────────────
  const [showLevelPicker, setShowLevelPicker]   = useState(false);
  const [levelChanging, setLevelChanging]       = useState(false);

  // ── Section E 편집 상태 ─────────────────────────────────────────
  const [editParentName, setEditParentName]       = useState("");
  const [editParentPhone, setEditParentPhone]     = useState("");
  const [editParentPhone2, setEditParentPhone2]   = useState("");
  const [editParentPhone3, setEditParentPhone3]   = useState("");
  const [editParentPhone4, setEditParentPhone4]   = useState("");

  // ── 모달 ──────────────────────────────────────────────────────
  const [showPicker, setShowPicker]                   = useState(false);
  const [showStatusModal, setShowStatusModal]         = useState(false);
  const [alertInfo, setAlertInfo]                     = useState<{ title: string; msg: string } | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm]   = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm]       = useState(false);
  const [showForceDeleteConfirm, setShowForceDeleteConfirm] = useState(false);

  // ── 초기 로드 ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [detailRes, cgRes, lvRes] = await Promise.all([
        apiRequest(token, `/admin/students/${id}/detail`),
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/admin/students/${id}/level`),
      ]);

      if (detailRes.ok) {
        const d: DetailData = await detailRes.json();
        setData(d);
        // Section A
        setEditName(d.name || "");
        setEditBirth(d.birth_year || "");
        setEditMemo(d.memo || "");
        setEditNotes(d.notes || "");
        // Section B
        setWeeklyCount((d.weekly_count || 1) as WeeklyCount);
        setAssignedIds(d.assigned_class_ids || []);
        // Section E
        setEditParentName(d.parent_name || "");
        setEditParentPhone(d.parent_phone || "");
        setEditParentPhone2((d as any).parent_phone2 || "");
        setEditParentPhone3((d as any).parent_phone3 || "");
        setEditParentPhone4((d as any).parent_phone4 || "");
      }
      if (cgRes.ok) setGroups(await cgRes.json());
      if (lvRes.ok) setLevelInfo(await lvRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  // ── API: info 저장 (Section A + E 공통) ─────────────────────────
  async function saveInfo() {
    if (!data || !id) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          birth_year: editBirth,
          parent_name: editParentName,
          parent_phone: editParentPhone,
          parent_phone2: editParentPhone2 || null,
          parent_phone3: editParentPhone3 || null,
          parent_phone4: editParentPhone4 || null,
          memo: editMemo,
          notes: editNotes,
        }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        setData(d => d ? {
          ...d,
          name: editName, birth_year: editBirth,
          parent_name: editParentName, parent_phone: editParentPhone,
          parent_phone2: editParentPhone2 || null,
          parent_phone3: editParentPhone3 || null,
          parent_phone4: editParentPhone4 || null,
          memo: editMemo, notes: editNotes,
          parent_user_id: body.parent_user_id ?? d.parent_user_id,
          parent_account_name: body.parent_account_name ?? (d as any).parent_account_name,
        } as any : d);
        setAlertInfo({ title: "저장 완료", msg: "정보가 업데이트되었습니다." });
      } else {
        const e = await res.json().catch(() => ({}));
        setAlertInfo({ title: "오류", msg: e.error || "저장에 실패했습니다." });
      }
    } catch {
      setAlertInfo({ title: "오류", msg: "네트워크 오류가 발생했습니다." });
    } finally { setSaving(false); }
  }

  // ── API: 반 배정 저장 ────────────────────────────────────────────
  async function saveAssignment() {
    if (!data || !id) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_class_ids: assignedIds, weekly_count: weeklyCount }),
      });
      const d = await res.json();
      if (!res.ok) {
        setAlertInfo({ title: "오류", msg: d.message || "저장에 실패했습니다." });
        return;
      }
      setData(prev => prev ? { ...prev, ...d } : prev);
      setAssignedIds(d.assigned_class_ids || []);
      setClassChanged(false);
      setAlertInfo({ title: "저장 완료", msg: "반 배정이 업데이트되었습니다." });
    } catch {
      setAlertInfo({ title: "오류", msg: "네트워크 오류" });
    } finally { setSaving(false); }
  }

  // ── API: 레벨 변경 ────────────────────────────────────────────────
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
      if (res.ok) {
        const lvRes = await apiRequest(token, `/admin/students/${id}/level`);
        if (lvRes.ok) setLevelInfo(await lvRes.json());
        // WP-M2 expanded fields 동기화
        const newLevel = levelInfo?.all_levels?.find((l: any) => l.level_order === levelOrder);
        if (newLevel) {
          setData(d => d ? {
            ...d,
            current_level_order: levelOrder,
            current_level_name: newLevel.level_name,
            current_level_color: newLevel.badge_color,
          } as any : d);
        }
      }
    } catch {}
    finally { setLevelChanging(false); }
  }

  // ── API: 복구 ────────────────────────────────────────────────────
  async function doRestoreMember() {
    if (!id) return;
    setShowRestoreConfirm(false);
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/restore`, { method: "POST" });
      if (res.ok) {
        setData(d => d ? { ...d, status: "active" } : d);
        setAlertInfo({ title: "복구 완료", msg: "회원이 재원 상태로 복구되었습니다." });
      } else {
        const e = await res.json().catch(() => ({}));
        setAlertInfo({ title: "오류", msg: e.error || "복구에 실패했습니다." });
      }
    } catch {
      setAlertInfo({ title: "오류", msg: "네트워크 오류" });
    } finally { setSaving(false); }
  }

  // ── API: 개인정보 소각 ───────────────────────────────────────────
  async function purgeMember() {
    if (!id) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/students/${id}/purge`, { method: "POST" });
      if (res.ok) {
        setAlertInfo({ title: "소각 완료", msg: "개인정보가 익명화되었습니다. 수업 기록은 유지됩니다." });
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setAlertInfo({ title: "오류", msg: e.error || "소각에 실패했습니다." });
      }
    } catch {
      setAlertInfo({ title: "오류", msg: "네트워크 오류" });
    } finally { setSaving(false); setShowPurgeConfirm(false); }
  }

  // ── API: 즉시 전체 삭제 (force-delete) ──────────────────────────
  async function doForceDelete() {
    if (!id) return;
    setShowForceDeleteConfirm(false);
    setSaving(true);
    try {
      const res = await apiRequest(token, `/admin/students/${id}/force-delete`, { method: "DELETE" });
      if (res.ok) {
        router.back();
      } else {
        const e = await res.json().catch(() => ({}));
        setAlertInfo({ title: "오류", msg: e.error || "삭제에 실패했습니다." });
      }
    } catch {
      setAlertInfo({ title: "오류", msg: "네트워크 오류" });
    } finally { setSaving(false); }
  }

  // ── 파생값 ───────────────────────────────────────────────────────
  const assignedClasses = groups.filter(g => assignedIds.includes(g.id));
  const statusMeta      = STATUS_META[data?.status ?? "active"] || STATUS_META.active;

  // ── 로딩/오류 화면 ────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="회원 정보" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={themeColor} size="large" />
        </View>
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── 헤더 ── */}
      <SubScreenHeader
        title={data.name}
        subtitle={statusMeta.label}
        rightSlot={saving ? <ActivityIndicator color={themeColor} size="small" /> : undefined}
      />

      {/* ── Long-scroll 본문 ── */}
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* HEADER CARD: 이름·반·레벨 한눈에 */}
        <View style={{
          backgroundColor: themeColor + "10", borderRadius: 18,
          padding: 16, gap: 8,
          borderWidth: 1, borderColor: themeColor + "25",
        }}>
          <Text style={{ fontSize: 22, fontFamily: "Pretendard-Regular", color: C.text }}>{data.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {/* 상태 배지 */}
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: statusMeta.bg }}>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: statusMeta.color }}>{statusMeta.label}</Text>
            </View>
            {/* 반 이름 */}
            {assignedClasses.length > 0 && assignedClasses.map(g => (
              <View key={g.id} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: themeColor + "20" }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor }}>{g.name}</Text>
              </View>
            ))}
            {/* 레벨 배지 */}
            {(data as any).current_level_name && (
              <View style={{
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                backgroundColor: ((data as any).current_level_color || themeColor) + "20",
              }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: (data as any).current_level_color || themeColor }}>
                  {(data as any).current_level_name}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Section A: 기본 정보 */}
        <SectionA_BasicInfo
          data={data}
          themeColor={themeColor}
          saving={saving}
          editName={editName} setEditName={setEditName}
          editBirth={editBirth} setEditBirth={setEditBirth}
          editMemo={editMemo} setEditMemo={setEditMemo}
          editNotes={editNotes} setEditNotes={setEditNotes}
          onSave={saveInfo}
        />

        {/* Section B: 수강 정보 */}
        <SectionB_ClassInfo
          data={data}
          themeColor={themeColor}
          saving={saving}
          groups={groups}
          weeklyCount={weeklyCount} setWeeklyCount={setWeeklyCount}
          assignedIds={assignedIds} setAssignedIds={setAssignedIds}
          assignedClasses={assignedClasses}
          classChanged={classChanged} setClassChanged={setClassChanged}
          onSaveAssignment={saveAssignment}
          onOpenPicker={() => setShowPicker(true)}
        />

        {/* Section C: 수영 교육 정보 (레벨) */}
        <SectionC_Level
          data={data}
          themeColor={themeColor}
          levelInfo={levelInfo}
          levelChanging={levelChanging}
          showLevelPicker={showLevelPicker}
          onOpenLevelPicker={() => setShowLevelPicker(true)}
          onCloseLevelPicker={() => setShowLevelPicker(false)}
          onLevelChange={handleLevelChange}
        />

        {/* Section D: 출결 / 보강 요약 */}
        <SectionD_Summary
          data={data}
          themeColor={themeColor}
          onGoAttendance={() => router.push("/(admin)/attendance")}
          onGoMakeups={() => router.push("/(admin)/makeups")}
        />

        {/* Section E: 보호자 / 연락처 */}
        <SectionE_Guardian
          data={data}
          themeColor={themeColor}
          saving={saving}
          editParentName={editParentName} setEditParentName={setEditParentName}
          editParentPhone={editParentPhone} setEditParentPhone={setEditParentPhone}
          editParentPhone2={editParentPhone2} setEditParentPhone2={setEditParentPhone2}
          editParentPhone3={editParentPhone3} setEditParentPhone3={setEditParentPhone3}
          editParentPhone4={editParentPhone4} setEditParentPhone4={setEditParentPhone4}
          onSave={saveInfo}
        />

        {/* Section F: 일지 / 출결 기록 shortcut */}
        <SectionF_Feed
          data={data}
          themeColor={themeColor}
          onGoDiary={() => router.push("/(admin)/diary-hub")}
          onGoAttendance={() => router.push("/(admin)/attendance")}
        />

        {/* Section G: WP-M5 전까지 미노출 (링크 공개 추가정보) */}

        {/* Section H: 회원 상태 / 관리 + Danger Zone */}
        <SectionH_StatusMgmt
          data={data}
          themeColor={themeColor}
          isPoolAdmin={isPoolAdmin}
          saving={saving}
          onShowStatusModal={() => setShowStatusModal(true)}
          onRestoreMember={() => setShowRestoreConfirm(true)}
          onPurgeMember={() => setShowPurgeConfirm(true)}
          onForceDelete={() => setShowForceDeleteConfirm(true)}
        />
      </ScrollView>

      {/* ── 레벨 선택 오버레이 (SectionC 내부 렌더링) ── */}
      {showLevelPicker && levelInfo && (
        <SectionC_Level
          data={data}
          themeColor={themeColor}
          levelInfo={levelInfo}
          levelChanging={levelChanging}
          showLevelPicker={showLevelPicker}
          onOpenLevelPicker={() => setShowLevelPicker(true)}
          onCloseLevelPicker={() => setShowLevelPicker(false)}
          onLevelChange={handleLevelChange}
        />
      )}

      {/* ── 공통 모달 ── */}
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

      <ClassPickerModal
        groups={groups}
        selectedIds={assignedIds}
        maxSelect={weeklyCount}
        onSelect={ids => { setAssignedIds(ids); setClassChanged(true); }}
        onClose={() => setShowPicker(false)}
      />

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
        message={`${data.name}님을 재원 상태로 복구하시겠습니까?`}
        confirmText="복구"
        cancelText="취소"
        onConfirm={doRestoreMember}
        onCancel={() => setShowRestoreConfirm(false)}
      />
      <ConfirmModal
        visible={showPurgeConfirm}
        title="⚠️ 개인정보 소각"
        message={`${data.name}님의 개인정보(이름·연락처·보호자 정보)를 완전히 익명화합니다.\n\n수업 기록은 유지되지만, 이 작업은 되돌릴 수 없습니다.\n\n정말 소각하시겠습니까?`}
        confirmText="소각하기"
        cancelText="취소"
        onConfirm={purgeMember}
        onCancel={() => setShowPurgeConfirm(false)}
      />
      <ConfirmModal
        visible={showForceDeleteConfirm}
        title="⚠️ 즉시 전체 삭제"
        message={`${data.name}님의 모든 데이터(출결·수영일지·학부모 가입정보)를 즉시 완전 삭제합니다.\n\n이 작업은 절대 되돌릴 수 없습니다.\n\n정말 삭제하시겠습니까?`}
        confirmText="즉시 삭제"
        cancelText="취소"
        onConfirm={doForceDelete}
        onCancel={() => setShowForceDeleteConfirm(false)}
      />
    </KeyboardAvoidingView>
  );
}
