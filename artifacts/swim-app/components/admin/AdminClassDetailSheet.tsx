/**
 * AdminClassDetailSheet.tsx
 * 관리자 반 상세 바텀시트
 */
import { Check, ChevronLeft, Minus, PenLine, Plus, Repeat, Search, Trash2, User, UserPlus, Users, UserX, X } from "lucide-react-native";
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
  co_teacher_ids?: string[] | null;
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

type SubView = "transfer" | "teacher" | "add_co_teacher" | null;

interface Props {
  group: { id: string; name: string; schedule_days: string; schedule_time: string; instructor?: string | null; color?: string | null };
  token: string | null;
  themeColor: string;
  onClose: () => void;
  onReload: () => void;
  onColorChange?: (id: string, color: string) => void;
  initialStudents?: StudentItem[];
}

export default function AdminClassDetailSheet({ group, token, themeColor, onClose, onReload, onColorChange, initialStudents }: Props) {
  // initialStudents가 있으면 즉시 필터링해서 보여줌 (로딩 없음)
  function filterForGroup(all: StudentItem[]) {
    return all.filter(s => {
      const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
      return s.class_group_id === group.id || ids.includes(group.id);
    });
  }
  const prefiltered = initialStudents
    ? initialStudents.filter(s => s.status === "active" || !s.status)
    : [];

  const [detail, setDetail]       = useState<ClassGroupDetail | null>(null);
  const [students, setStudents]   = useState<StudentItem[]>(() => filterForGroup(prefiltered));
  const [allStudents, setAll]     = useState<StudentItem[]>(prefiltered);
  const [teachers, setTeachers]   = useState<TeacherItem[]>([]);
  // initialStudents가 있으면 학생 목록 즉시 표시 — detail만 백그라운드 로드
  const [loading, setLoading]     = useState(!initialStudents || initialStudents.length === 0);
  const [subView, setSubView]     = useState<SubView>(null);
  const [saving, setSaving]       = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [teacherSaving, setTeacherSaving] = useState(false);
  const [colorSaving, setColorSaving] = useState(false);

  // 정원 인라인 편집
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [draftCapacity, setDraftCapacity]     = useState<number>(5);
  const [capacitySaving, setCapacitySaving]   = useState(false);

  // 추가 선생님 (co-teacher)
  const [coTeacherIds, setCoTeacherIds]     = useState<string[]>([]);
  const [coTeacherSaving, setCoTeacherSaving] = useState(false);

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

  const load = useCallback(async () => {
    try {
      if (initialStudents && initialStudents.length > 0) {
        // 학생 목록은 이미 즉시 표시됨 — detail만 백그라운드 조용히 로드 (스피너 없음)
        const cgRes = await apiRequest(token, `/class-groups/${group.id}`);
        if (cgRes.ok) {
          const d = await cgRes.json();
          setDetail(d);
          const loaded = d.color || "#FFFFFF";
          originalColorRef.current = loaded;
          setDraftColor(loaded);
          setCoTeacherIds(Array.isArray(d.co_teacher_ids) ? d.co_teacher_ids : []);
          setDraftCapacity(d.capacity ?? 5);
        }
      } else {
        // fallback: 학생 미전달 — 해당 반 학생만 빠르게 조회 (pool_all 대신 class_group_id 필터)
        setLoading(true);
        const [cgRes, stuRes] = await Promise.all([
          apiRequest(token, `/class-groups/${group.id}`),
          apiRequest(token, `/students?class_group_id=${group.id}`),
        ]);
        if (cgRes.ok) {
          const d = await cgRes.json();
          setDetail(d);
          const loaded = d.color || "#FFFFFF";
          originalColorRef.current = loaded;
          setDraftColor(loaded);
          setCoTeacherIds(Array.isArray(d.co_teacher_ids) ? d.co_teacher_ids : []);
          setDraftCapacity(d.capacity ?? 5);
        }
        if (stuRes.ok) {
          const all: StudentItem[] = await stuRes.json();
          const active = all.filter(s => s.status === "active" || !s.status);
          setAll(active);
          setStudents(active);
        }
        setLoading(false);
      }
    } catch (e) { console.error(e); setLoading(false); }
  }, [token, group.id, initialStudents]);

  useEffect(() => { load(); }, [load]);

  // 선생님 목록 로드 (컴포넌트 마운트 시 항상 백그라운드 로드)
  useEffect(() => {
    apiRequest(token, "/teachers").then(r => { if (r.ok) r.json().then(setTeachers); }).catch(() => {});
  }, [token]);

  async function loadTeachers() {
    if (teachers.length > 0) return;
    try {
      const res = await apiRequest(token, "/teachers");
      if (res.ok) setTeachers(await res.json());
    } catch (e) { console.error(e); }
  }

  async function handleAssignTeacher(teacher: TeacherItem) {
    setTeacherSaving(true);
    const instrName = teacher.name || null;
    const instrId   = teacher.id   || null;
    // 새 주담당이 co_teacher_ids에 있으면 자동 제거
    const currentCoIds = detail?.co_teacher_ids || [];
    const newCoIds = instrId ? currentCoIds.filter(id => id !== instrId) : currentCoIds;
    try {
      const res = await apiRequest(token, `/class-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ instructor: instrName, teacher_user_id: instrId, co_teacher_ids: newCoIds }),
      });
      if (res.ok) {
        setDetail(prev => prev ? { ...prev, instructor: instrName, teacher_user_id: instrId, co_teacher_ids: newCoIds } : prev);
        setSubView(null);
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setTeacherSaving(false); }
  }

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
        }),
      });
      if (res.ok) {
        await load();
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  const capacityLabel = detail?.capacity != null
    ? `${students.length} / ${detail.capacity}명`
    : `${students.length}명`;
  const capacityFull = detail?.capacity != null && students.length >= detail.capacity;

  const transferable = allStudents.filter(s => {
    const ids: string[] = Array.isArray(s.assigned_class_ids) ? s.assigned_class_ids : [];
    if (ids.includes(group.id) || s.class_group_id === group.id) return false;
    if (ids.length === 0 && !s.class_group_id) return false;
    return true;
  }).filter(s => !search.trim() || s.name.includes(search.trim()) || (s.parent_phone || "").includes(search.trim()));

  const days = (detail?.schedule_days || group.schedule_days).split(",").map(d => d.trim()).join("·");
  const instructorLabel = detail?.instructor || "미지정";

  // ── 정원 저장 ──
  async function handleSaveCapacity() {
    setCapacitySaving(true);
    try {
      const res = await apiRequest(token, `/class-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ capacity: draftCapacity }),
      });
      if (res.ok) {
        setDetail(prev => prev ? { ...prev, capacity: draftCapacity } : prev);
        setEditingCapacity(false);
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setCapacitySaving(false); }
  }

  // ── 추가 선생님(co-teacher) 추가 ──
  async function handleAddCoTeacher(teacher: TeacherItem) {
    const newIds = [...coTeacherIds.filter(id => id !== teacher.id), teacher.id];
    setCoTeacherSaving(true);
    try {
      const res = await apiRequest(token, `/class-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ co_teacher_ids: newIds }),
      });
      if (res.ok) {
        setCoTeacherIds(newIds);
        setSubView(null);
        setSearch("");
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setCoTeacherSaving(false); }
  }

  // ── 추가 선생님 제거 ──
  async function handleRemoveCoTeacher(removeId: string) {
    const newIds = coTeacherIds.filter(id => id !== removeId);
    setCoTeacherSaving(true);
    try {
      const res = await apiRequest(token, `/class-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ co_teacher_ids: newIds }),
      });
      if (res.ok) {
        setCoTeacherIds(newIds);
        onReload();
      }
    } catch (e) { console.error(e); }
    finally { setCoTeacherSaving(false); }
  }

  function enterTeacher() { loadTeachers(); setSearch(""); setSubView("teacher"); }
  function enterTransfer() { setSearch(""); setSubView("transfer"); }
  function enterAddCoTeacher() { setSearch(""); setSubView("add_co_teacher"); }

  function handleAssign() {
    onClose();
    setTimeout(() => {
      router.push({ pathname: "/class-assign", params: { classId: group.id, returnTo: "admin-classes" } } as any);
    }, 150);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable style={sh.backdrop} onPress={handleClose} />
      <View style={[sh.sheet, subView && { height: "88%" }]}>
        <View style={sh.handle} />

        <View style={sh.header}>
          {subView ? (
            <Pressable onPress={() => { setSubView(null); setSearch(""); }} style={sh.backBtn}>
              <ChevronLeft size={22} color={themeColor} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={sh.headerTitle} numberOfLines={1}>
              {subView === "transfer" ? "반이동"
                : subView === "teacher" ? "주담당 선생님 변경"
                : subView === "add_co_teacher" ? "선생님 추가"
                : group.name}
            </Text>
            {!subView && (
              <Text style={sh.headerSub}>{days} · {detail?.schedule_time || group.schedule_time}</Text>
            )}
          </View>
          <Pressable onPress={handleClose} style={sh.closeBtn}>
            {colorSaving
              ? <ActivityIndicator size="small" color={C.textSecondary} />
              : <X size={20} color={C.textSecondary} />}
          </Pressable>
        </View>

        {!subView && (
          loading ? (
            <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
              <View style={sh.summaryCard}>
                {/* 주담당 선생님 */}
                <View style={sh.summaryRow}>
                  <User size={14} color={C.textMuted} />
                  <Text style={sh.summaryLabel}>주담당</Text>
                  <Pressable onPress={enterTeacher} style={sh.instructorBtn}>
                    <Text style={[sh.instructorText, !detail?.instructor && { color: C.textMuted, fontStyle: "italic" }]}>
                      {instructorLabel}
                    </Text>
                    <PenLine size={12} color={themeColor} style={{ marginLeft: 4 }} />
                  </Pressable>
                </View>

                {/* 추가 선생님 목록 */}
                {coTeacherIds.length > 0 && coTeacherIds.map(cid => {
                  const ct = teachers.find(t => t.id === cid);
                  return (
                    <View key={cid} style={sh.coTeacherRow}>
                      <User size={14} color={C.textMuted} />
                      <Text style={sh.summaryLabel}>추가</Text>
                      <Text style={[sh.instructorText, { flex: 1 }]}>{ct?.name || cid}</Text>
                      {coTeacherSaving ? (
                        <ActivityIndicator size="small" color={C.textMuted} />
                      ) : (
                        <Pressable onPress={() => handleRemoveCoTeacher(cid)} hitSlop={8}>
                          <Trash2 size={14} color="#EF4444" />
                        </Pressable>
                      )}
                    </View>
                  );
                })}

                {/* 선생님 추가 버튼 */}
                <Pressable style={sh.addCoTeacherBtn} onPress={enterAddCoTeacher}>
                  <UserPlus size={13} color={themeColor} />
                  <Text style={[sh.addCoTeacherTxt, { color: themeColor }]}>선생님 추가</Text>
                </Pressable>

                {/* 정원 (편집 가능) */}
                <View style={sh.summaryRow}>
                  <Users size={14} color={C.textMuted} />
                  {editingCapacity ? (
                    <View style={sh.capacityEditor}>
                      <Pressable
                        style={sh.capBtn}
                        onPress={() => setDraftCapacity(v => Math.max(1, v - 1))}
                        hitSlop={6}
                      >
                        <Minus size={14} color={C.text} />
                      </Pressable>
                      <Text style={sh.capValue}>{draftCapacity}명</Text>
                      <Pressable
                        style={sh.capBtn}
                        onPress={() => setDraftCapacity(v => Math.min(50, v + 1))}
                        hitSlop={6}
                      >
                        <Plus size={14} color={C.text} />
                      </Pressable>
                      <Pressable
                        style={[sh.capSaveBtn, { backgroundColor: themeColor }]}
                        onPress={handleSaveCapacity}
                        disabled={capacitySaving}
                      >
                        {capacitySaving
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={sh.capSaveTxt}>저장</Text>}
                      </Pressable>
                      <Pressable onPress={() => { setEditingCapacity(false); setDraftCapacity(detail?.capacity ?? 5); }} hitSlop={6}>
                        <X size={16} color={C.textMuted} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={sh.instructorBtn} onPress={() => { setDraftCapacity(detail?.capacity ?? 5); setEditingCapacity(true); }}>
                      <Text style={sh.summaryVal}>{capacityLabel}</Text>
                      <PenLine size={12} color={themeColor} style={{ marginLeft: 4 }} />
                    </Pressable>
                  )}
                  {!editingCapacity && capacityFull && <View style={sh.fullBadge}><Text style={sh.fullBadgeText}>정원 마감</Text></View>}
                </View>

                <PastelColorPicker selected={draftColor} onSelect={handleColorSelect} />
              </View>

              <View style={sh.actionRow}>
                <Pressable style={[sh.actionBtn, { backgroundColor: themeColor, flex: 1 }]} onPress={handleAssign}>
                  <UserPlus size={14} color="#fff" />
                  <Text style={sh.actionBtnText}>반배정</Text>
                </Pressable>
                <Pressable style={[sh.actionBtn, { backgroundColor: "#E4A93A", flex: 1 }]} onPress={enterTransfer}>
                  <Repeat size={14} color="#fff" />
                  <Text style={sh.actionBtnText}>반이동</Text>
                </Pressable>
              </View>

              <View style={sh.sectionHeader}>
                <Text style={sh.sectionTitle}>학생 목록</Text>
                <Text style={sh.sectionCount}>{students.length}명</Text>
              </View>
              {students.length === 0 ? (
                <View style={sh.emptyBox}>
                  <Users size={32} color={C.textMuted} />
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

        {subView === "transfer" && (
          <View style={{ flex: 1 }}>
            <View style={sh.searchBox}>
              <Search size={14} color={C.textMuted} />
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
                <Repeat size={32} color={C.textMuted} />
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

        {/* ── 선생님 추가 (co-teacher) ── */}
        {subView === "add_co_teacher" && (
          <View style={{ flex: 1 }}>
            {coTeacherSaving && <ActivityIndicator color={themeColor} style={{ marginTop: 20 }} />}
            <FlatList
              data={teachers.filter(t =>
                t.id !== detail?.teacher_user_id &&
                !coTeacherIds.includes(t.id) &&
                (!search.trim() || t.name.includes(search.trim()))
              )}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View style={sh.searchBox}>
                  <Search size={14} color={C.textMuted} />
                  <TextInput
                    style={sh.searchInput}
                    placeholder="선생님 이름 검색"
                    placeholderTextColor={C.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                </View>
              }
              ListEmptyComponent={
                <View style={sh.emptyBox}>
                  <User size={32} color={C.textMuted} />
                  <Text style={sh.emptyText}>추가할 수 있는 선생님이 없습니다</Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable style={sh.teacherRow} onPress={() => handleAddCoTeacher(item)} disabled={coTeacherSaving}>
                  <View style={[sh.teacherAvatar, { backgroundColor: themeColor + "20" }]}>
                    <Text style={[sh.teacherAvatarText, { color: themeColor }]}>{item.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={sh.teacherName}>{item.name}</Text>
                    <Text style={sh.teacherSub}>{item.position || item.email || ""}</Text>
                  </View>
                  <UserPlus size={16} color={themeColor} />
                </Pressable>
              )}
            />
          </View>
        )}

        {subView === "teacher" && (
          <View style={{ flex: 1 }}>
            {teacherSaving && (
              <ActivityIndicator color={themeColor} style={{ marginTop: 20 }} />
            )}
            <Pressable
              style={[sh.teacherRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}
              onPress={() => handleAssignTeacher({ id: "", name: "" } as any)}
            >
              <View style={[sh.teacherAvatar, { backgroundColor: "#F8FAFC" }]}>
                <UserX size={16} color={C.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sh.teacherName, { color: C.textMuted, fontStyle: "italic" }]}>미지정</Text>
                <Text style={sh.teacherSub}>담당 선생님 없음</Text>
              </View>
              {!detail?.instructor && (
                <Check size={18} color={themeColor} />
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
                    <Check size={18} color={themeColor} />
                  )}
                </Pressable>
              )}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

const sh = StyleSheet.create({
  backdrop:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%", minHeight: "55%" },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                alignSelf: "center", marginTop: 10, marginBottom: 2 },

  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle:{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text },
  headerSub:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
  backBtn:    { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  closeBtn:   { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  summaryCard:{ margin: 14, backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 10 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryLabel:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, minWidth: 32 },
  summaryVal: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  instructorBtn:{ flexDirection: "row", alignItems: "center", flex: 1 },
  instructorText:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  fullBadge:  { backgroundColor: "#F9DEDA", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  fullBadgeText:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },

  coTeacherRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addCoTeacherBtn:{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                    borderWidth: 1, borderColor: C.border, backgroundColor: C.background },
  addCoTeacherTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular" },

  capacityEditor: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  capBtn:   { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, borderColor: C.border,
              alignItems: "center", justifyContent: "center", backgroundColor: C.background },
  capValue: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, minWidth: 36, textAlign: "center" },
  capSaveBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  capSaveTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },

  actionRow:  { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginBottom: 4 },
  actionBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                gap: 6, paddingVertical: 11, borderRadius: 12 },
  actionBtnText:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },

  sectionHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  sectionCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },

  studentRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: "#F8FAFC", gap: 10 },
  studentAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.tint + "20",
                  alignItems: "center", justifyContent: "center" },
  studentAvatarText:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.tint },
  studentName:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },

  emptyBox:   { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },

  searchBox:  { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC",
                borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, margin: 12, gap: 8 },
  searchInput:{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

  listRow:    { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10,
                borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  listRowRight:{ flexDirection: "row", alignItems: "center", gap: 6 },
  addBtn:     { backgroundColor: C.tint, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                minWidth: 48, alignItems: "center" },
  addBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  transferBtn:{ backgroundColor: "#E4A93A", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                minWidth: 48, alignItems: "center" },

  teacherRow:     { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  teacherAvatar:  { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  teacherAvatarText:{ fontSize: 16, fontFamily: "Pretendard-Regular" },
  teacherName:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  teacherSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
});
