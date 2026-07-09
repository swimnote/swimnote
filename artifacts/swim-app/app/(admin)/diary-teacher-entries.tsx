/**
 * (admin)/diary-teacher-entries.tsx — 관리자 수업일지 (선생님별 섹션)
 * 전체 일지를 선생님별로 묶어서 한 화면에 표시
 */
import { BookOpen, Check, ChevronDown, ChevronUp, Clock, Image, Info, Layers, SquareCheck, Trash2 } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, SectionList,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

interface DiaryEntry {
  id: string;
  lesson_date: string;
  common_content: string;
  teacher_name: string;
  teacher_id: string;
  is_edited: boolean;
  created_at: string;
  class_name: string;
  schedule_days: string;
  schedule_time: string;
  note_count: number;
}

interface Section {
  title: string;
  teacher_id: string;
  data: DiaryEntry[];
}

type DeleteMode = "photo_only" | "full" | null;

function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

const TEACHER_COLORS = [
  "#6366F1", "#0EA5E9", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6",
];
function teacherColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % TEACHER_COLORS.length;
  return TEACHER_COLORS[h];
}

export default function DiaryTeacherEntriesScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [showModeModal, setShowModeModal] = useState(false);
  const [pendingMode, setPendingMode] = useState<DeleteMode>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!token) { setLoading(false); return; }
    if (!isRefresh) setLoading(true);
    setLoadError(null);
    try {
      const res = await apiRequest(token, "/diaries/admin/all-entries?limit=300");
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      } else {
        const err = await res.json().catch(() => ({}));
        setLoadError(err.error || `서버 오류 (${res.status})`);
      }
    } catch (e) {
      setLoadError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // 선생님별 섹션으로 그룹화 (최신 일지 순)
  const sections: Section[] = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    for (const e of entries) {
      const key = e.teacher_name || "미확인";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).map(([name, data]) => ({
      title: name,
      teacher_id: data[0]?.teacher_id ?? "",
      data,
    }));
  }, [entries]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map(e => e.id)));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function handleDeleteRequest() {
    if (selected.size === 0) return;
    setShowModeModal(true);
  }

  function handleModeSelect(mode: DeleteMode) {
    setPendingMode(mode);
    setShowModeModal(false);
    setShowConfirm(true);
  }

  async function executeDelete() {
    if (!pendingMode || selected.size === 0) return;
    setDeleting(true);
    setShowConfirm(false);
    try {
      const ids = Array.from(selected);
      const res = await apiRequest(token, "/diaries/admin/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids, mode: pendingMode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (pendingMode === "full") {
          setEntries(prev => prev.filter(e => !selected.has(e.id)));
        }
        setDeleteMsg(`${data.deleted_count}건 ${pendingMode === "full" ? "삭제" : "사진 삭제"} 완료`);
        exitSelectMode();
        setTimeout(() => setDeleteMsg(null), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setDeleteMsg(`삭제 실패: ${err.error || "서버 오류"}`);
      }
    } catch {
      setDeleteMsg("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
      setPendingMode(null);
    }
  }

  const renderItem = useCallback(({ item }: { item: DiaryEntry }) => {
    const isSelected = selected.has(item.id);
    const isExpanded = expandedId === item.id;
    const nCount = Number(item.note_count) || 0;

    return (
      <Pressable
        style={[s.card, { backgroundColor: C.card }, isSelected && { borderColor: themeColor, borderWidth: 2 }]}
        onPress={() => {
          if (selectMode) toggleSelect(item.id);
          else setExpandedId(prev => prev === item.id ? null : item.id);
        }}
        onLongPress={() => {
          if (!selectMode) { setSelectMode(true); setSelected(new Set([item.id])); }
        }}
      >
        <View style={s.cardRow}>
          {selectMode && (
            <Pressable onPress={() => toggleSelect(item.id)} style={{ marginRight: 10 }}>
              <View style={[s.checkbox, isSelected && { backgroundColor: themeColor, borderColor: themeColor }]}>
                {isSelected && <Check size={12} color="#fff" />}
              </View>
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            <View style={s.topRow}>
              <Text style={s.dateText}>{formatDate(item.lesson_date)}</Text>
              <View style={s.badgeRow}>
                {item.is_edited && (
                  <View style={[s.badge, { backgroundColor: "#FFF1BF" }]}>
                    <Text style={[s.badgeTxt, { color: "#92400E" }]}>수정됨</Text>
                  </View>
                )}
                {nCount > 0 && (
                  <View style={[s.badge, { backgroundColor: "#EEDDF5" }]}>
                    <Text style={[s.badgeTxt, { color: "#7C3AED" }]}>개별 {nCount}명</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={s.metaRow}>
              <Layers size={11} color={C.textMuted} />
              <Text style={s.metaTxt}>{item.class_name || "-"}</Text>
              <Clock size={11} color={C.textMuted} style={{ marginLeft: 8 }} />
              <Text style={s.metaTxt}>{(item.schedule_time || "").slice(0, 5)}</Text>
            </View>
            {!isExpanded && item.common_content ? (
              <Text style={s.preview} numberOfLines={2}>{item.common_content}</Text>
            ) : null}
          </View>
          {!selectMode && (
            isExpanded
              ? <ChevronUp size={15} color={C.textMuted} />
              : <ChevronDown size={15} color={C.textMuted} />
          )}
        </View>
        {isExpanded && (
          <View style={[s.contentBox, { backgroundColor: C.background }]}>
            <Text style={s.contentTxt}>{item.common_content || "(내용 없음)"}</Text>
          </View>
        )}
      </Pressable>
    );
  }, [selected, selectMode, expandedId, themeColor]);

  const renderSectionHeader = useCallback(({ section }: { section: Section }) => {
    const color = teacherColor(section.title);
    return (
      <View style={[s.sectionHeader, { backgroundColor: C.background }]}>
        <View style={[s.sectionDot, { backgroundColor: color }]} />
        <Text style={[s.sectionTitle, { color }]}>{section.title} 선생님</Text>
        <Text style={[s.sectionCount, { color: C.textMuted }]}>{section.data.length}건</Text>
      </View>
    );
  }, []);

  const keyExtractor = useCallback((item: DiaryEntry) => item.id, []);

  const confirmTitle = pendingMode === "photo_only" ? "사진만 삭제하시겠습니까?" : "일지를 완전히 삭제하시겠습니까?";
  const confirmMessage = pendingMode === "photo_only"
    ? `선택한 ${selected.size}건의 사진을 삭제합니다. 글 내용은 유지됩니다.`
    : `선택한 ${selected.size}건의 일지를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.`;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title="수업 일지"
        subtitle={selectMode ? `${selected.size}개 선택됨` : `전체 ${entries.length}건`}
        onBack={selectMode ? exitSelectMode : undefined}
        homePath="/(admin)/class-hub"
      />

      {selectMode ? (
        <View style={[s.toolbar, { borderBottomColor: C.border }]}>
          <Pressable style={s.toolbarBtn} onPress={toggleSelectAll}>
            <SquareCheck size={15} color={themeColor} />
            <Text style={[s.toolbarBtnText, { color: themeColor }]}>
              {selected.size === entries.length ? "전체 해제" : "전체 선택"}
            </Text>
          </Pressable>
          <Pressable
            style={[s.toolbarBtn, { opacity: selected.size === 0 ? 0.4 : 1 }]}
            onPress={handleDeleteRequest}
            disabled={selected.size === 0 || deleting}
          >
            {deleting
              ? <ActivityIndicator color={C.error} size="small" />
              : <><Trash2 size={14} color={C.error} /><Text style={[s.toolbarBtnText, { color: C.error }]}>선택 삭제 ({selected.size})</Text></>
            }
          </Pressable>
        </View>
      ) : (
        <View style={s.infoBar}>
          <Info size={12} color={C.textMuted} />
          <Text style={s.infoText}>항목을 길게 눌러 선택 모드로 전환합니다</Text>
        </View>
      )}

      {deleteMsg && (
        <View style={[s.msg, { backgroundColor: deleteMsg.includes("실패") ? "#F9DEDA" : "#E6FFFA" }]}>
          <LucideIcon name={deleteMsg.includes("실패") ? "alert-circle" : "check-circle"} size={13}
            color={deleteMsg.includes("실패") ? C.error : "#2EC4B6"} />
          <Text style={[s.msgText, { color: deleteMsg.includes("실패") ? C.error : "#2EC4B6" }]}>{deleteMsg}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : loadError ? (
        <View style={s.empty}>
          <Info size={40} color="#EF4444" />
          <Text style={[s.emptyTitle, { color: "#EF4444" }]}>불러오기 실패</Text>
          <Text style={[s.emptyTitle, { fontSize: 13, color: C.textSecondary, marginTop: 4, textAlign: "center", paddingHorizontal: 24 }]}>{loadError}</Text>
          <Pressable onPress={() => load()} style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: themeColor, borderRadius: 8 }}>
            <Text style={{ color: "#fff", fontSize: 14 }}>다시 시도</Text>
          </Pressable>
        </View>
      ) : sections.length === 0 ? (
        <View style={s.empty}>
          <BookOpen size={40} color={C.textMuted} />
          <Text style={s.emptyTitle}>작성된 일지가 없습니다</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 4 }}
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(true)}
          refreshing={refreshing}
          SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        />
      )}

      <Modal visible={showModeModal} transparent animationType="fade">
        <Pressable style={s.overlay} onPress={() => setShowModeModal(false)}>
          <Pressable onPress={() => {}} style={[s.modeSheet, { backgroundColor: C.card }]}>
            <Text style={[s.modeTitle, { color: C.text }]}>삭제 방식 선택</Text>
            <Text style={[s.modeDesc, { color: C.textSecondary }]}>선택한 {selected.size}건에 대해 삭제 방식을 선택하세요</Text>
            <Pressable style={[s.modeBtn, { backgroundColor: "#FFF1BF", borderColor: "#FDE68A" }]}
              onPress={() => handleModeSelect("photo_only")}>
              <Image size={18} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={[s.modeBtnTitle, { color: "#B45309" }]}>사진만 삭제</Text>
                <Text style={[s.modeBtnDesc, { color: "#78350F" }]}>글 내용은 유지, 첨부 사진만 제거</Text>
              </View>
            </Pressable>
            <Pressable style={[s.modeBtn, { backgroundColor: "#F9DEDA", borderColor: "#FCA5A5" }]}
              onPress={() => handleModeSelect("full")}>
              <Trash2 size={18} color={C.error} />
              <View style={{ flex: 1 }}>
                <Text style={[s.modeBtnTitle, { color: C.error }]}>글 전체 삭제</Text>
                <Text style={[s.modeBtnDesc, { color: "#7F1D1D" }]}>일지 전체를 삭제 (복구 불가)</Text>
              </View>
            </Pressable>
            <Pressable style={s.modeCancelBtn} onPress={() => setShowModeModal(false)}>
              <Text style={[s.modeCancelText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmModal
        visible={showConfirm}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={pendingMode === "full" ? "삭제" : "사진 삭제"}
        destructive
        onConfirm={executeDelete}
        onCancel={() => { setShowConfirm(false); setPendingMode(null); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  toolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  toolbarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolbarBtnText: { fontSize: 13 },

  infoBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  infoText: { fontSize: 11, color: C.textMuted },

  msg: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 8,
  },
  msgText: { fontSize: 13 },

  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingTop: 14,
  },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 14, fontWeight: "600", flex: 1 },
  sectionCount: { fontSize: 12 },

  card: {
    borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: "transparent",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start" },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: C.border,
    alignItems: "center", justifyContent: "center", marginRight: 10,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  dateText: { fontSize: 13, color: C.text },
  badgeRow: { flexDirection: "row", gap: 4 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 10 },
  metaRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  metaTxt: { fontSize: 11, color: C.textSecondary, marginLeft: 3 },
  preview: { fontSize: 12, color: C.textSecondary, lineHeight: 18, marginTop: 2 },
  contentBox: { marginTop: 10, padding: 10, borderRadius: 8 },
  contentTxt: { fontSize: 13, color: C.text, lineHeight: 20 },

  empty: { alignItems: "center", paddingTop: 100, gap: 10 },
  emptyTitle: { fontSize: 15, color: C.textSecondary },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modeSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 12 },
  modeTitle: { fontSize: 17, textAlign: "center" },
  modeDesc: { fontSize: 13, textAlign: "center", marginBottom: 4 },
  modeBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  modeBtnTitle: { fontSize: 15 },
  modeBtnDesc: { fontSize: 12, marginTop: 2 },
  modeCancelBtn: { paddingVertical: 14, alignItems: "center" },
  modeCancelText: { fontSize: 15 },
});
