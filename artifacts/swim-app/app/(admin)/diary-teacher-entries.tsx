/**
 * (admin)/diary-teacher-entries.tsx — 관리자 교사별 일지 목록
 *
 * - 특정 선생님의 수업일지 목록 (최신순)
 * - 조회 전용: 수정 버튼 없음
 * - 체크박스 다중 선택 후 일괄 삭제 (사진삭제/글전체삭제)
 * - 삭제 방식 선택 팝업 + 최종 확인 팝업
 * - 삭제 후 목록 갱신
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
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
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  class_name: string;
  schedule_days: string;
  schedule_time: string;
  note_count: number;
}

type DeleteMode = "photo_only" | "full" | null;

function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

export default function DiaryTeacherEntriesScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ teacherId: string; teacherName: string }>();

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 선택 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 삭제 흐름
  const [showModeModal, setShowModeModal] = useState(false);
  const [pendingMode, setPendingMode] = useState<DeleteMode>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  // 단일 일지 상세 보기
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !params.teacherId) return;
    try {
      const res = await apiRequest(token, `/diaries/admin/teacher/${params.teacherId}/entries`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      }
    } catch (e) {
      console.error("[diary-teacher-entries] load error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, params.teacherId]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map(e => e.id)));
    }
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
        const err = await res.json();
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

    return (
      <Pressable
        style={[
          de.card,
          { backgroundColor: C.card },
          isSelected && { borderColor: themeColor, borderWidth: 2 },
        ]}
        onPress={() => {
          if (selectMode) {
            toggleSelect(item.id);
          } else {
            setExpandedId(prev => prev === item.id ? null : item.id);
          }
        }}
        onLongPress={() => {
          if (!selectMode) {
            setSelectMode(true);
            setSelected(new Set([item.id]));
          }
        }}
      >
        <View style={de.cardHeader}>
          {selectMode && (
            <Pressable onPress={() => toggleSelect(item.id)} style={{ marginRight: 10 }}>
              <View style={[de.checkbox, isSelected && { backgroundColor: themeColor, borderColor: themeColor }]}>
                {isSelected && <Feather name="check" size={12} color="#fff" />}
              </View>
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            <View style={de.cardTop}>
              <Text style={de.cardDate}>{formatDate(item.lesson_date)}</Text>
              <View style={de.badgeRow}>
                {item.is_edited && (
                  <View style={[de.badge, { backgroundColor: "#FEF3C7" }]}>
                    <Text style={[de.badgeText, { color: "#92400E" }]}>수정됨</Text>
                  </View>
                )}
                {Number(item.note_count) > 0 && (
                  <View style={[de.badge, { backgroundColor: "#EDE9FE" }]}>
                    <Text style={[de.badgeText, { color: "#7C3AED" }]}>개별 {item.note_count}명</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={de.cardMeta}>
              <Feather name="layers" size={11} color={C.textSecondary} />
              <Text style={de.cardMetaText}>{item.class_name}</Text>
              <Feather name="clock" size={11} color={C.textSecondary} style={{ marginLeft: 6 }} />
              <Text style={de.cardMetaText}>{(item.schedule_time || "").slice(0, 5)}</Text>
            </View>
          </View>
          {!selectMode && (
            <Feather
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={15} color={C.textMuted}
            />
          )}
        </View>

        {/* 일지 내용 (펼침) */}
        {isExpanded && (
          <View style={[de.contentBox, { backgroundColor: C.background }]}>
            <Text style={de.contentText}>{item.common_content}</Text>
          </View>
        )}
      </Pressable>
    );
  }, [selected, selectMode, expandedId, themeColor]);

  const keyExtractor = useCallback((item: DiaryEntry) => item.id, []);

  const confirmTitle = pendingMode === "photo_only"
    ? "사진만 삭제하시겠습니까?"
    : "일지를 완전히 삭제하시겠습니까?";
  const confirmMessage = pendingMode === "photo_only"
    ? `선택한 ${selected.size}건의 사진을 삭제합니다. 글 내용은 유지됩니다.`
    : `선택한 ${selected.size}건의 일지를 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.`;

  return (
    <SafeAreaView style={de.safe} edges={[]}>
      <SubScreenHeader
        title={`${params.teacherName || "선생님"} 일지`}
        subtitle={selectMode ? `${selected.size}개 선택됨` : `총 ${entries.length}건 (최신순)`}
        onBack={selectMode ? exitSelectMode : undefined}
        homePath="/(admin)/diary-write"
      />

      {/* 선택 모드 툴바 */}
      {selectMode ? (
        <View style={[de.toolbar, { borderBottomColor: C.border }]}>
          <Pressable style={de.toolbarBtn} onPress={toggleSelectAll}>
            <Feather name="check-square" size={15} color={themeColor} />
            <Text style={[de.toolbarBtnText, { color: themeColor }]}>
              {selected.size === entries.length ? "전체 해제" : "전체 선택"}
            </Text>
          </Pressable>
          <Pressable
            style={[de.toolbarBtn, de.toolbarDeleteBtn, { opacity: selected.size === 0 ? 0.4 : 1 }]}
            onPress={handleDeleteRequest}
            disabled={selected.size === 0 || deleting}
          >
            {deleting
              ? <ActivityIndicator color={C.error} size="small" />
              : <><Feather name="trash-2" size={14} color={C.error} /><Text style={de.toolbarDeleteText}>선택 삭제 ({selected.size})</Text></>
            }
          </Pressable>
        </View>
      ) : (
        /* 일반 모드 안내 */
        <View style={de.infoBar}>
          <Feather name="info" size={12} color={C.textMuted} />
          <Text style={de.infoText}>항목을 길게 눌러 선택 모드로 전환합니다</Text>
        </View>
      )}

      {/* 삭제 완료 메시지 */}
      {deleteMsg && (
        <View style={[de.msg, { backgroundColor: deleteMsg.includes("실패") ? "#FEE2E2" : "#D1FAE5" }]}>
          <Feather name={deleteMsg.includes("실패") ? "alert-circle" : "check-circle"} size={13}
            color={deleteMsg.includes("실패") ? C.error : "#059669"} />
          <Text style={[de.msgText, { color: deleteMsg.includes("실패") ? C.error : "#059669" }]}>{deleteMsg}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={de.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { setRefreshing(true); load(); }}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={de.empty}>
              <Feather name="book-open" size={40} color={C.textMuted} />
              <Text style={de.emptyTitle}>작성된 일지가 없습니다</Text>
            </View>
          }
        />
      )}

      {/* 삭제 방식 선택 모달 */}
      <Modal visible={showModeModal} transparent animationType="fade">
        <Pressable
          style={de.overlay}
          onPress={() => setShowModeModal(false)}
        >
          <Pressable onPress={() => {}} style={[de.modeSheet, { backgroundColor: C.card }]}>
            <Text style={[de.modeTitle, { color: C.text }]}>삭제 방식 선택</Text>
            <Text style={[de.modeDesc, { color: C.textSecondary }]}>
              선택한 {selected.size}건에 대해 삭제 방식을 선택하세요
            </Text>

            <Pressable
              style={[de.modeBtn, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}
              onPress={() => handleModeSelect("photo_only")}
            >
              <Feather name="image" size={18} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={[de.modeBtnTitle, { color: "#B45309" }]}>사진만 삭제</Text>
                <Text style={[de.modeBtnDesc, { color: "#78350F" }]}>글 내용은 유지, 첨부 사진만 제거</Text>
              </View>
            </Pressable>

            <Pressable
              style={[de.modeBtn, { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" }]}
              onPress={() => handleModeSelect("full")}
            >
              <Feather name="trash-2" size={18} color={C.error} />
              <View style={{ flex: 1 }}>
                <Text style={[de.modeBtnTitle, { color: C.error }]}>글 전체 삭제</Text>
                <Text style={[de.modeBtnDesc, { color: "#7F1D1D" }]}>일지 전체를 삭제 (복구 불가)</Text>
              </View>
            </Pressable>

            <Pressable style={de.modeCancelBtn} onPress={() => setShowModeModal(false)}>
              <Text style={[de.modeCancelText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 최종 확인 */}
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

const de = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  toolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  toolbarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolbarBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  toolbarDeleteBtn: { gap: 4 },
  toolbarDeleteText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#DC2626" },

  infoBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  infoText: { fontSize: 11, color: C.textMuted, fontFamily: "Inter_400Regular" },

  msg: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    padding: 10, borderRadius: 8,
  },
  msgText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },

  card: {
    borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: "transparent",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start" },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 2, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  cardDate: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  badgeRow: { flexDirection: "row", gap: 4 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  cardMeta: { flexDirection: "row", alignItems: "center" },
  cardMetaText: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular", marginLeft: 3 },
  contentBox: { marginTop: 10, padding: 10, borderRadius: 8 },
  contentText: { fontSize: 13, color: C.text, fontFamily: "Inter_400Regular", lineHeight: 20 },

  empty: { alignItems: "center", paddingTop: 100, gap: 10 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },

  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modeSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, gap: 12,
  },
  modeTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  modeDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 4 },
  modeBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  modeBtnTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modeBtnDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  modeCancelBtn: { paddingVertical: 14, alignItems: "center" },
  modeCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
