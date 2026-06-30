/**
 * (admin)/diary-write.tsx — 관리자 수업일지 전체 목록
 *
 * - 전체 선생님 일지를 저장 순으로 한 목록에 표시
 * - 각 항목에 작성 선생님 표시
 * - 통합 검색: 선생님 이름·날짜·반 이름으로 필터
 * - 클릭 → 일지 내용 펼쳐 읽기
 * - 길게 눌러 선택 모드 → 일괄 삭제
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BookOpen, Check, Clock, Image, Info,
  Layers, Search, SquareCheck, Trash2, X,
} from "lucide-react-native";
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

type DeleteMode = "photo_only" | "full" | null;

function formatLessonDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function formatCreatedAt(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 선생님 이름에서 아바타 이니셜 추출
function avatarChar(name: string) {
  return (name || "?").charAt(0);
}

// 선생님 이름 기반 고정 색상 (간단한 해시)
const TEACHER_COLORS = [
  "#6366F1", "#0EA5E9", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6",
];
function teacherColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % TEACHER_COLORS.length;
  return TEACHER_COLORS[h];
}

export default function AdminDiaryAllScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState("");

  // 선택 모드
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 펼쳐진 일지
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 삭제 흐름
  const [showModeModal, setShowModeModal] = useState(false);
  const [pendingMode, setPendingMode] = useState<DeleteMode>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (!isRefresh) setLoading(true);
    try {
      const res = await apiRequest(token, "/diaries/admin/all-entries?limit=200");
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error("[admin-diary-all] load error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // 검색 필터링 (클라이언트 사이드)
  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.trim().toLowerCase();
    return entries.filter(e =>
      (e.teacher_name || "").toLowerCase().includes(q) ||
      (e.class_name || "").toLowerCase().includes(q) ||
      (e.lesson_date || "").includes(q) ||
      (e.common_content || "").toLowerCase().includes(q)
    );
  }, [entries, query]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(e => e.id)));
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
    const color = teacherColor(item.teacher_name || "");
    const nCount = Number(item.note_count) || 0;

    return (
      <Pressable
        style={[
          s.card,
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
        <View style={s.cardRow}>
          {/* 선택 체크박스 */}
          {selectMode && (
            <Pressable onPress={() => toggleSelect(item.id)} style={{ marginRight: 10 }}>
              <View style={[s.checkbox, isSelected && { backgroundColor: themeColor, borderColor: themeColor }]}>
                {isSelected && <Check size={12} color="#fff" />}
              </View>
            </Pressable>
          )}

          {/* 선생님 아바타 */}
          {!selectMode && (
            <View style={[s.avatar, { backgroundColor: color + "20" }]}>
              <Text style={[s.avatarTxt, { color }]}>{avatarChar(item.teacher_name)}</Text>
            </View>
          )}

          {/* 본문 */}
          <View style={{ flex: 1 }}>
            {/* 선생님 이름 + 시간 */}
            <View style={s.topRow}>
              <Text style={[s.teacherName, { color }]}>
                {item.teacher_name || "선생님"} 선생님
              </Text>
              <Text style={s.timeAgo}>{formatCreatedAt(item.created_at)}</Text>
            </View>

            {/* 수업일 + 반 */}
            <View style={s.metaRow}>
              <Clock size={11} color={C.textMuted} />
              <Text style={s.metaTxt}>{formatLessonDate(item.lesson_date)}</Text>
              {item.class_name ? (
                <>
                  <Layers size={11} color={C.textMuted} style={{ marginLeft: 8 }} />
                  <Text style={s.metaTxt}>{item.class_name}</Text>
                </>
              ) : null}
            </View>

            {/* 내용 미리보기 */}
            {!isExpanded && item.common_content ? (
              <Text style={s.preview} numberOfLines={2}>{item.common_content}</Text>
            ) : null}

            {/* 배지 */}
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

          {/* 펼침 아이콘 */}
          {!selectMode && (
            <Text style={s.chevron}>{isExpanded ? "▲" : "▼"}</Text>
          )}
        </View>

        {/* 펼쳐진 일지 내용 */}
        {isExpanded && (
          <View style={s.contentBox}>
            <Text style={s.contentTxt}>
              {item.common_content || "(내용 없음)"}
            </Text>
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
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title="수업일지 관리"
        subtitle={
          selectMode
            ? `${selected.size}개 선택됨`
            : `전체 ${total}건 · 표시 ${filtered.length}건`
        }
        onBack={selectMode ? exitSelectMode : undefined}
        homePath="/(admin)/dashboard"
      />

      {/* 검색바 */}
      <View style={s.searchWrap}>
        <Search size={16} color={C.textMuted} style={{ marginLeft: 12 }} />
        <TextInput
          style={s.searchInput}
          placeholder="선생님·반 이름·날짜·내용 검색"
          placeholderTextColor={C.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} style={{ paddingHorizontal: 10 }}>
            <X size={15} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {/* 선택 모드 툴바 */}
      {selectMode ? (
        <View style={[s.toolbar, { borderBottomColor: C.border }]}>
          <Pressable style={s.toolbarBtn} onPress={toggleSelectAll}>
            <SquareCheck size={15} color={themeColor} />
            <Text style={[s.toolbarBtnTxt, { color: themeColor }]}>
              {selected.size === filtered.length ? "전체 해제" : "전체 선택"}
            </Text>
          </Pressable>
          <Pressable
            style={[s.toolbarBtn, { opacity: selected.size === 0 ? 0.4 : 1 }]}
            onPress={handleDeleteRequest}
            disabled={selected.size === 0 || deleting}
          >
            {deleting
              ? <ActivityIndicator color={C.error} size="small" />
              : (
                <>
                  <Trash2 size={14} color={C.error} />
                  <Text style={[s.toolbarBtnTxt, { color: C.error }]}>
                    선택 삭제 ({selected.size})
                  </Text>
                </>
              )
            }
          </Pressable>
        </View>
      ) : (
        <View style={s.infoBar}>
          <Info size={12} color={C.textMuted} />
          <Text style={s.infoTxt}>항목을 눌러 읽기 · 길게 눌러 선택 삭제</Text>
        </View>
      )}

      {/* 삭제 결과 메시지 */}
      {deleteMsg && (
        <View style={[s.msgBar, { backgroundColor: deleteMsg.includes("실패") ? "#F9DEDA" : "#E6FFFA" }]}>
          <Text style={[s.msgTxt, { color: deleteMsg.includes("실패") ? C.error : "#2EC4B6" }]}>
            {deleteMsg}
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { setRefreshing(true); load(true); }}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={s.empty}>
              <BookOpen size={44} color={C.textMuted} />
              <Text style={s.emptyTitle}>
                {query ? "검색 결과가 없습니다" : "작성된 일지가 없습니다"}
              </Text>
              {query ? (
                <Text style={s.emptySub}>다른 검색어를 입력해 보세요</Text>
              ) : null}
            </View>
          }
        />
      )}

      {/* 삭제 방식 선택 모달 */}
      <Modal visible={showModeModal} transparent animationType="fade">
        <Pressable style={s.overlay} onPress={() => setShowModeModal(false)}>
          <Pressable onPress={() => {}} style={[s.modeSheet, { backgroundColor: C.card }]}>
            <Text style={[s.modeTitle, { color: C.text }]}>삭제 방식 선택</Text>
            <Text style={[s.modeDesc, { color: C.textSecondary }]}>
              선택한 {selected.size}건에 대해 삭제 방식을 선택하세요
            </Text>
            <Pressable
              style={[s.modeBtn, { backgroundColor: "#FFF1BF", borderColor: "#FDE68A" }]}
              onPress={() => handleModeSelect("photo_only")}
            >
              <Image size={18} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={[s.modeBtnTitle, { color: "#B45309" }]}>사진만 삭제</Text>
                <Text style={[s.modeBtnDesc, { color: "#78350F" }]}>글 내용은 유지, 첨부 사진만 제거</Text>
              </View>
            </Pressable>
            <Pressable
              style={[s.modeBtn, { backgroundColor: "#F9DEDA", borderColor: "#FCA5A5" }]}
              onPress={() => handleModeSelect("full")}
            >
              <Trash2 size={18} color={C.error} />
              <View style={{ flex: 1 }}>
                <Text style={[s.modeBtnTitle, { color: C.error }]}>글 전체 삭제</Text>
                <Text style={[s.modeBtnDesc, { color: "#7F1D1D" }]}>일지 전체를 삭제 (복구 불가)</Text>
              </View>
            </Pressable>
            <Pressable style={s.modeCancelBtn} onPress={() => setShowModeModal(false)}>
              <Text style={[s.modeCancelTxt, { color: C.textSecondary }]}>취소</Text>
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

  searchWrap: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginTop: 10, marginBottom: 6,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    height: 44,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular",
    color: C.text, paddingHorizontal: 8,
  },

  toolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  toolbarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolbarBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  infoBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  infoTxt: { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  msgBar: {
    marginHorizontal: 16, marginBottom: 6,
    padding: 10, borderRadius: 8,
  },
  msgTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  listContent: { paddingHorizontal: 16, paddingBottom: 100, gap: 8, paddingTop: 4 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: "transparent",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },

  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 2, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },

  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  avatarTxt: { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "700" },

  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  teacherName: { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  timeAgo: { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 5 },
  metaTxt: { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  preview: { fontSize: 13, color: C.textSecondary, fontFamily: "Pretendard-Regular", lineHeight: 18, marginBottom: 6 },

  badgeRow: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular" },

  chevron: { fontSize: 10, color: C.textMuted, marginTop: 2, marginLeft: 4 },

  contentBox: {
    marginTop: 10, padding: 12,
    backgroundColor: C.background, borderRadius: 10,
  },
  contentTxt: {
    fontSize: 14, color: C.text,
    fontFamily: "Pretendard-Regular", lineHeight: 22,
  },

  empty: { alignItems: "center", paddingTop: 100, gap: 10 },
  emptyTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modeSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, gap: 12,
  },
  modeTitle: { fontSize: 17, fontFamily: "Pretendard-Regular", textAlign: "center" },
  modeDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", marginBottom: 4 },
  modeBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  modeBtnTitle: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  modeBtnDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  modeCancelBtn: { paddingVertical: 14, alignItems: "center" },
  modeCancelTxt: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
