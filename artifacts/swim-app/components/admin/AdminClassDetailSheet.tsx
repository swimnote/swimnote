/**
 * AdminClassDetailSheet.tsx
 * 관리자 반 상세 바텀시트
 * - 반 정보 표시 (이름, 요일, 시간, 담당선생님, 정원)
 * - 학생 목록
 * - 버튼: 반배정, 미등록, 반이동
 * - 담당선생님 지정/변경
 * - 서브뷰: 미등록시트, 반이동시트, 선생님선택시트
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal,
  Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import PastelColorPicker from "@/components/common/PastelColorPicker";

const C = Colors.light;

/* ── 타입 ────────────────────────────────────────── */
export interface ClassGroupDetail {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  teacher_user_id: string | null;
  capacity: number | null;
  level: string | null;
  color?: string | null;
}

interface StudentItem {
  id: string;
  name: string;
  parent_phone?: string | null;
  parent_name?: string | null;
  class_group_id?: string | null;
  assigned_class_ids?: string[];
  weekly_count?: number | null;
  status?: string;
  schedule_labels?: string | null;
  updated_at?: string | null;
}

interface TeacherItem {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
}

type SubView = "unregistered" | "transfer" | "teacher" | null;

interface Props {
  group: { id: string; name: string; schedule_days: string; schedule_time: string; instructor?: string | null; color?: string | null };
  token: string | null;
  themeColor: string;
  onClose: () => void;
  onReload: () => void;
  onColorChange?: (id: string, color: string) => void;
}

/* ══════════════════════════════════════════════════ */
export default function AdminClassDetailSheet({ group, token, themeColor, onClose, onReload, onColorChange }: Props) {
  const [detail, setDetail]       = useState<ClassGroupDetail | null>(null);
  const [students, setStudents]   = useState<StudentItem[]>([]);  // 이 반 학생
  const [allStudents, setAll]     = useState<StudentItem[]>([]);   // 풀 전체 학생
  const [teachers, setTeachers]   = useState<TeacherItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [subView, setSubView]     = useState<SubView>(null);
  const [saving, setSaving]       = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [teacherSaving, setTeacherSaving] = useState(false);
  const [conflictVisible, setConflictVisible] = useState(false);
  const [colorSaving, setColorSaving] = useState(false);

  const originalColorRef = useRef<string>(group.color || "#FFFFFF");
  const [draftColor, setDraftColor] = useState<string>(group.color || "#FFFFFF");

  function handleColorSelect(color: string) {
    setDraftColor(color);
  }

  async function handleClose() {
    if (draftColor !== originalColorRef.current) {
      setColorSaving(true);
      try {
        await apiRequest(token, `/class-groups/${group.id}`, {
          method: "PATCH",
          body: JSON.stringify({ color: draftColor }),
        });
        onColorChange?.(group.id, draftColor);
        originalColorRef.current = draftColor;
      } catch (e) {
        console.error(e);
        setDraftColor(originalColorRef.current);
      }
      setColorSaving(false);
    }
    onClose();
  }

  /* ── 데이터 로드 ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cgRes, stuAllRes] = await Promise.all([
        apiRequest(token, `/class-groups/${group.id}`),
        apiRequest(token, "/students?pool_all=true"),
      ]);
      if (cgRes.ok) {
        const d = await cgRes.json();
        setDetail(d);
        const loaded = d.color || "#FFFFFF";
        originalColorRef.current = loaded;
        setDraftColor(loaded);
      }
      if (stuAllRes.ok) {
        const all: StudentItem[] = await stuAllRes.json();
        const active = all.filter(s => s.status === "active" || !s.status);
        setAll(active);
        setStudents(active.filter(s => {
          const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
          return s.class_group_id === group.id || ids.includes(group.id);
        }));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token, group.id]);

  useEffect(() => { load(); }, [load]);

  /* ── 선생님 목록 로드 (서브뷰 teacher 진입 시) ── */
  async function loadTeachers() {
    if (teachers.length > 0) return;
    try {
      const res = await apiRequest(token, "/teachers");
      if (res.ok) setTeachers(await res.json());
    } catch (e) { console.error(e); }
  }

  /* ── 담당선생님 지정 ── */
  async function handleAssignTeacher(teacher: TeacherItem) {
    setTeacherSaving(true);
    const instrName = teacher.name || null;
    const instrId   = teacher.id   || null;
    try {
      const res = await apiRequest(token, `/class-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ instructor: instrName, teacher_user_id: instrId }),
      });
      if (res.ok) {
        setDetail(prev => prev ? { ...prev, instructor: instrName, teacher_user_id: instrId } : prev);
        setSubView(null);
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setTeacherSaving(false); }
  }

  /* ── 미등록 배정: assign 엔드포인트 ── */
  async function handleAddUnregistered(student: StudentItem) {
    if (!detail) return;
    setSaving(student.id);
    try {
      const currentIds: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
      const weeklyCount = student.weekly_count || 1;
      const newIds = [...currentIds, group.id];
      const res = await apiRequest(token, `/students/${student.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds, weekly_count: weeklyCount }),
      });
      if (res.ok) {
        const updated: StudentItem = await res.json();
        setAll(prev => prev.map(s => s.id === student.id ? { ...s, ...updated } : s));
        setStudents(prev => [...prev, { ...student, ...updated }]);
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  /* ── 반이동: move-class 엔드포인트 ── */
  async function handleTransfer(student: StudentItem) {
    const ids: string[] = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
    const fromClassId = ids.find(id => id !== group.id) || student.class_group_id;
    if (!fromClassId) return;
    setSaving(student.id);
    try {
      const res = await apiRequest(token, `/students/${student.id}/move-class`, {
        method: "POST",
        body: JSON.stringify({
          from_class_id: fromClassId,
          to_class_id: group.id,
          expected_updated_at: student.updated_at ?? undefined,
        }),
      });
      if (res.status === 409) {
        setConflictVisible(true);
        return;
      }
      if (res.ok) {
        await load();
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  /* ── 필터 ── */
  const capacityLabel = detail?.capacity != null
    ? `${students.length} / ${detail.capacity}명`
    : `${students.length}명`;
  const capacityFull = detail?.capacity != null && students.length >= detail.capacity;

  // 미등록: assigned_class_ids 비어있고 class_group_id도 없는 학생
  const unregistered = allStudents.filter(s => {
    const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
    if (ids.includes(group.id) || s.class_group_id === group.id) return false;
    if (ids.length > 0 || s.class_group_id) return false;
    return true;
  }).filter(s => !search.trim() || s.name.includes(search.trim()) || (s.parent_phone || "").includes(search.trim()));

  // 반이동: 다른 반에 속한 학생
  const transferable = allStudents.filter(s => {
    const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
    if (ids.includes(group.id) || s.class_group_id === group.id) return false;
    if (ids.length === 0 && !s.class_group_id) return false;
    return true;
  }).filter(s => !search.trim() || s.name.includes(search.trim()) || (s.parent_phone || "").includes(search.trim()));

  const days = (detail?.schedule_days || group.schedule_days).split(",").map(d => d.trim()).join("·");
  const instructorLabel = detail?.instructor || "미지정";

  /* ── 서브뷰 진입 ── */
  function enterTeacher() { loadTeachers(); setSearch(""); setSubView("teacher"); }
  function enterUnregistered() { setSearch(""); setSubView("unregistered"); }
  function enterTransfer() { setSearch(""); setSubView("transfer"); }

  /* ── 반배정 → class-assign 화면으로 이동 ── */
  function handleAssign() {
    onClose();
    setTimeout(() => {
      router.push({ pathname: "/class-assign", params: { classId: group.id, returnTo: "admin-classes" } } as any);
    }, 150);
  }

  /* ──────────────────────────────────────────────── */
  return (
    <Modal visible animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable style={sh.backdrop} onPress={handleClose} />
      <View style={sh.sheet}>
        <View style={sh.handle} />

        {/* ── 공통 헤더 ── */}
        <View style={sh.header}>
          {subView ? (
            <Pressable onPress={() => { setSubView(null); setSearch(""); }} style={sh.backBtn}>
              <Feather name="chevron-left" size={22} color={themeColor} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={sh.headerTitle} numberOfLines={1}>
              {subView === "unregistered" ? "미등록 회원"
                : subView === "transfer" ? "반이동"
                : subView === "teacher" ? "담당선생님 지정"
                : group.name}
            </Text>
            {!subView && (
              <Text style={sh.headerSub}>{days} · {detail?.schedule_time || group.schedule_time}</Text>
            )}
          </View>
          <Pressable onPress={handleClose} style={sh.closeBtn}>
            {colorSaving
              ? <ActivityIndicator size="small" color={C.textSecondary} />
              : <Feather name="x" size={20} color={C.textSecondary} />}
          </Pressable>
        </View>

        {/* ── 메인 뷰 ── */}
        {!subView && (
          loading ? (
            <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
              {/* 반 요약 카드 */}
              <View style={sh.summaryCard}>
                <View style={sh.summaryRow}>
                  <Feather name="user" size={14} color={C.textMuted} />
                  <Pressable onPress={enterTeacher} style={sh.instructorBtn}>
                    <Text style={[sh.instructorText, !detail?.instructor && { color: C.textMuted, fontStyle: "italic" }]}>
                      {instructorLabel}
                    </Text>
                    <Feather name="edit-2" size={12} color={themeColor} style={{ marginLeft: 4 }} />
                  </Pressable>
                </View>
                <View style={sh.summaryRow}>
                  <Feather name="users" size={14} color={C.textMuted} />
                  <Text style={sh.summaryVal}>{capacityLabel}</Text>
                  {capacityFull && <View style={sh.fullBadge}><Text style={sh.fullBadgeText}>정원 마감</Text></View>}
                </View>
                {/* 반 색상 */}
                <PastelColorPicker selected={draftColor} onSelect={handleColorSelect} />
              </View>

              {/* 액션 버튼 */}
              <View style={sh.actionRow}>
                <Pressable style={[sh.actionBtn, { backgroundColor: themeColor }]} onPress={handleAssign}>
                  <Feather name="user-plus" size={14} color="#fff" />
                  <Text style={sh.actionBtnText}>반배정</Text>
                </Pressable>
                <Pressable style={[sh.actionBtn, { backgroundColor: "#2E9B6F" }]} onPress={enterUnregistered}>
                  <Feather name="user-x" size={14} color="#fff" />
                  <Text style={sh.actionBtnText}>미등록</Text>
                </Pressable>
                <Pressable style={[sh.actionBtn, { backgroundColor: "#E4A93A" }]} onPress={enterTransfer}>
                  <Feather name="repeat" size={14} color="#fff" />
                  <Text style={sh.actionBtnText}>반이동</Text>
                </Pressable>
              </View>

              {/* 학생 목록 */}
              <View style={sh.sectionHeader}>
                <Text style={sh.sectionTitle}>학생 목록</Text>
                <Text style={sh.sectionCount}>{students.length}명</Text>
              </View>
              {students.length === 0 ? (
                <View style={sh.emptyBox}>
                  <Feather name="users" size={32} color={C.textMuted} />
                  <Text style={sh.emptyText}>아직 배정된 학생이 없습니다</Text>
                </View>
              ) : students.map(s => (
                <View key={s.id} style={sh.studentRow}>
                  <View style={sh.studentAvatar}>
                    <Text style={sh.studentAvatarText}>{s.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sh.studentName}>{s.name}</Text>
                    <Text style={sh.studentSub}>
                      {s.parent_phone ? s.parent_phone.slice(-4) : ""}{s.weekly_count ? ` · 주${s.weekly_count}회` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )
        )}

        {/* ── 미등록 서브뷰 ── */}
        {subView === "unregistered" && (
          <View style={{ flex: 1 }}>
            <View style={sh.searchBox}>
              <Feather name="search" size={14} color={C.textMuted} />
              <TextInput
                style={sh.searchInput}
                placeholder="이름 또는 연락처 검색"
                placeholderTextColor={C.textMuted}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            {unregistered.length === 0 ? (
              <View style={sh.emptyBox}>
                <Feather name="check-circle" size={32} color={C.textMuted} />
                <Text style={sh.emptyText}>미등록 회원이 없습니다</Text>
              </View>
            ) : (
              <FlatList
                data={unregistered}
                keyExtractor={i => i.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <View style={sh.listRow}>
                    <View style={sh.studentAvatar}>
                      <Text style={sh.studentAvatarText}>{item.name[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={sh.studentName}>{item.name}</Text>
                      <Text style={sh.studentSub}>
                        {item.parent_phone?.slice(-4) || "연락처 없음"} · 주{item.weekly_count || 1}회
                      </Text>
                    </View>
                    <View style={sh.listRowRight}>
                      <View style={sh.unregBadge}><Text style={sh.unregBadgeText}>미배정</Text></View>
                      <Pressable
                        style={[sh.addBtn, saving === item.id && { opacity: 0.5 }, capacityFull && { backgroundColor: "#D1D5DB" }]}
                        disabled={saving === item.id || capacityFull}
                        onPress={() => handleAddUnregistered(item)}
                      >
                        {saving === item.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={sh.addBtnText}>{capacityFull ? "정원 마감" : "추가"}</Text>}
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        )}

        {/* ── 반이동 서브뷰 ── */}
        {subView === "transfer" && (
          <View style={{ flex: 1 }}>
            <View style={sh.searchBox}>
              <Feather name="search" size={14} color={C.textMuted} />
              <TextInput
                style={sh.searchInput}
                placeholder="이름 또는 연락처 검색"
                placeholderTextColor={C.textMuted}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            {transferable.length === 0 ? (
              <View style={sh.emptyBox}>
                <Feather name="repeat" size={32} color={C.textMuted} />
                <Text style={sh.emptyText}>이동 가능한 학생이 없습니다</Text>
              </View>
            ) : (
              <FlatList
                data={transferable}
                keyExtractor={i => i.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const ids: string[] = Array.isArray(item.assigned_class_ids) ? item.assigned_class_ids : [];
                  const currentClassCount = ids.length || (item.class_group_id ? 1 : 0);
                  return (
                    <View style={sh.listRow}>
                      <View style={sh.studentAvatar}>
                        <Text style={sh.studentAvatarText}>{item.name[0]}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={sh.studentName}>{item.name}</Text>
                        <Text style={sh.studentSub}>
                          {item.schedule_labels || `${currentClassCount}개 반 소속`}
                        </Text>
                      </View>
                      <Pressable
                        style={[sh.transferBtn, saving === item.id && { opacity: 0.5 }]}
                        disabled={saving === item.id}
                        onPress={() => handleTransfer(item)}
                      >
                        {saving === item.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={sh.addBtnText}>이동</Text>}
                      </Pressable>
                    </View>
                  );
                }}
              />
            )}
          </View>
        )}

        {/* ── 담당선생님 서브뷰 ── */}
        {subView === "teacher" && (
          <View style={{ flex: 1 }}>
            {teacherSaving && (
              <ActivityIndicator color={themeColor} style={{ marginTop: 20 }} />
            )}
            {/* 선생님 미지정 옵션 */}
            <Pressable
              style={[sh.teacherRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}
              onPress={() => handleAssignTeacher({ id: "", name: "" } as any)}
            >
              <View style={[sh.teacherAvatar, { backgroundColor: "#F8FAFC" }]}>
                <Feather name="user-x" size={16} color={C.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sh.teacherName, { color: C.textMuted, fontStyle: "italic" }]}>미지정</Text>
                <Text style={sh.teacherSub}>담당 선생님 없음</Text>
              </View>
              {!detail?.instructor && (
                <Feather name="check" size={18} color={themeColor} />
              )}
            </Pressable>
            <FlatList
              data={teachers}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={sh.emptyBox}>
                  <ActivityIndicator color={themeColor} />
                  <Text style={sh.emptyText}>선생님 목록 로딩 중...</Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable style={sh.teacherRow} onPress={() => handleAssignTeacher(item)}>
                  <View style={[sh.teacherAvatar, { backgroundColor: themeColor + "20" }]}>
                    <Text style={[sh.teacherAvatarText, { color: themeColor }]}>{item.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sh.teacherName}>{item.name}</Text>
                    <Text style={sh.teacherSub}>{item.position || item.email || ""}</Text>
                  </View>
                  {detail?.instructor === item.name && (
                    <Feather name="check" size={18} color={themeColor} />
                  )}
                </Pressable>
              )}
            />
          </View>
        )}
      </View>

      {/* ── 동시성 충돌 팝업 ── */}
      {conflictVisible && (
        <Modal visible animationType="fade" transparent onRequestClose={() => { setConflictVisible(false); load(); }}>
          <Pressable style={sh.backdrop} onPress={() => { setConflictVisible(false); load(); }} />
          <View style={{ position: "absolute", left: 24, right: 24, top: "35%", backgroundColor: "#fff", borderRadius: 14, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, elevation: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#222", marginBottom: 8 }}>배정 상태가 변경되었습니다</Text>
            <Text style={{ fontSize: 14, color: "#555", textAlign: "center", marginBottom: 20 }}>다른 작업자가 먼저 처리했습니다.{"\n"}최신 목록을 다시 불러옵니다.</Text>
            <Pressable
              onPress={() => { setConflictVisible(false); load(); }}
              style={{ backgroundColor: themeColor, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8 }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>확인</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

/* ── 스타일 ─────────────────────────────────────── */
const sh = StyleSheet.create({
  backdrop:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%", minHeight: "55%" },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                alignSelf: "center", marginTop: 10, marginBottom: 2 },

  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle:{ fontSize: 16, fontFamily: "Pretendard-Bold", color: C.text },
  headerSub:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
  backBtn:    { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  closeBtn:   { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  summaryCard:{ margin: 14, backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 10 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryVal: { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.text },
  instructorBtn:{ flexDirection: "row", alignItems: "center", flex: 1 },
  instructorText:{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text },
  fullBadge:  { backgroundColor: "#F9DEDA", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  fullBadgeText:{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#D96C6C" },

  actionRow:  { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginBottom: 4 },
  actionBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                gap: 6, paddingVertical: 11, borderRadius: 12 },
  actionBtnText:{ fontSize: 13, fontFamily: "Pretendard-Bold", color: "#fff" },

  sectionHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  sectionCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },

  studentRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: "#F8FAFC", gap: 10 },
  studentAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.tint + "20",
                  alignItems: "center", justifyContent: "center" },
  studentAvatarText:{ fontSize: 14, fontFamily: "Pretendard-Bold", color: C.tint },
  studentName:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },

  emptyBox:   { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },

  searchBox:  { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC",
                borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, margin: 12, gap: 8 },
  searchInput:{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

  listRow:    { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10,
                borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  listRowRight:{ flexDirection: "row", alignItems: "center", gap: 6 },
  unregBadge: { backgroundColor: "#FFF1BF", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  unregBadgeText:{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#D97706" },
  addBtn:     { backgroundColor: C.tint, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                minWidth: 48, alignItems: "center" },
  addBtnText: { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#fff" },
  transferBtn:{ backgroundColor: "#E4A93A", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                minWidth: 48, alignItems: "center" },

  teacherRow:     { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  teacherAvatar:  { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  teacherAvatarText:{ fontSize: 16, fontFamily: "Pretendard-Bold" },
  teacherName:    { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  teacherSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
});
