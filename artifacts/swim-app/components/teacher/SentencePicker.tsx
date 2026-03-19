/**
 * SentencePicker.tsx — 문장 불러오기 바텀시트
 *
 * 기능:
 * - 초급/중급/상급/커스텀 카테고리 탭
 * - 전체 통합 검색 (카테고리 경계 무시)
 * - 미리보기 영역 (쌓기 방식)
 * - 바로 전 삽입 취소 / 전체 삭제
 * - 완료 시 onInsert(text) 콜백
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

const SCREEN_H = Dimensions.get("window").height;

const C = Colors.light;
const PRIMARY = C.tint;

export type SentenceLevel = "beginner" | "intermediate" | "advanced" | "custom";

export interface SentenceTemplate {
  id: string;
  level: SentenceLevel;
  template_text: string;
}

/* ─── 기본 내장 문장 세트 ─────────────────────────────────────────── */
const BUILT_IN: SentenceTemplate[] = [
  // 초급 (beginner)
  { id: "b01", level: "beginner", template_text: "물에 대한 적응력이 빠르게 늘고 있습니다." },
  { id: "b02", level: "beginner", template_text: "킥 동작을 차분하게 연습했습니다." },
  { id: "b03", level: "beginner", template_text: "호흡 연습이 잘 이루어졌습니다." },
  { id: "b04", level: "beginner", template_text: "발차기 자세가 점점 안정되고 있습니다." },
  { id: "b05", level: "beginner", template_text: "물 속에서 눈을 뜨는 연습을 했습니다." },
  { id: "b06", level: "beginner", template_text: "벽 잡고 킥 연습을 반복했습니다." },
  { id: "b07", level: "beginner", template_text: "물 위에서 몸의 균형을 잡는 연습을 했습니다." },
  { id: "b08", level: "beginner", template_text: "배영 자세의 기초를 연습했습니다." },
  { id: "b09", level: "beginner", template_text: "자유형 팔 동작 기초를 배웠습니다." },
  { id: "b10", level: "beginner", template_text: "수업 중 적극적으로 참여해 주었습니다." },
  { id: "b11", level: "beginner", template_text: "물을 무서워하지 않고 잘 따라와 주었습니다." },
  { id: "b12", level: "beginner", template_text: "오늘은 물 익히기와 호흡에 집중했습니다." },
  { id: "b13", level: "beginner", template_text: "누워 뜨기 자세가 점점 안정적으로 변하고 있습니다." },
  { id: "b14", level: "beginner", template_text: "입수 자세를 익히는 연습을 했습니다." },
  { id: "b15", level: "beginner", template_text: "다음 수업에서는 자유형 기초를 이어갈 예정입니다." },

  // 중급 (intermediate)
  { id: "i01", level: "intermediate", template_text: "자유형 25m를 안정적으로 수영했습니다." },
  { id: "i02", level: "intermediate", template_text: "호흡 타이밍을 맞추는 연습에 집중했습니다." },
  { id: "i03", level: "intermediate", template_text: "배영 50m 구간 연습을 진행했습니다." },
  { id: "i04", level: "intermediate", template_text: "평영 킥 동작의 정확도를 높였습니다." },
  { id: "i05", level: "intermediate", template_text: "턴 동작 연습을 시작했습니다." },
  { id: "i06", level: "intermediate", template_text: "팔과 발 동작의 타이밍을 맞추는 훈련을 했습니다." },
  { id: "i07", level: "intermediate", template_text: "지구력 향상을 위해 100m 인터벌 훈련을 했습니다." },
  { id: "i08", level: "intermediate", template_text: "자유형 풀링 동작을 집중 교정했습니다." },
  { id: "i09", level: "intermediate", template_text: "배영 팔 동작의 궤적을 교정했습니다." },
  { id: "i10", level: "intermediate", template_text: "평영 글라이드 동작이 많이 향상되었습니다." },
  { id: "i11", level: "intermediate", template_text: "오늘은 접영 기초 동작을 처음 연습했습니다." },
  { id: "i12", level: "intermediate", template_text: "수업 집중도가 매우 높았습니다." },
  { id: "i13", level: "intermediate", template_text: "체력이 꾸준히 향상되고 있습니다." },
  { id: "i14", level: "intermediate", template_text: "다음 수업에서는 평영 완성도를 높일 예정입니다." },
  { id: "i15", level: "intermediate", template_text: "앞으로도 꾸준한 연습을 부탁드립니다." },

  // 상급 (advanced)
  { id: "a01", level: "advanced", template_text: "접영 200m 인터벌 훈련을 완료했습니다." },
  { id: "a02", level: "advanced", template_text: "개인혼영 순서로 400m 완주를 목표로 했습니다." },
  { id: "a03", level: "advanced", template_text: "출발 반응 속도와 다이빙 각도를 교정했습니다." },
  { id: "a04", level: "advanced", template_text: "턴 후 유선형 자세를 집중 훈련했습니다." },
  { id: "a05", level: "advanced", template_text: "페이스 조절 능력이 크게 향상되었습니다." },
  { id: "a06", level: "advanced", template_text: "자유형 스트로크 효율을 높이는 드릴을 진행했습니다." },
  { id: "a07", level: "advanced", template_text: "평영 킥 타이밍을 정밀하게 교정했습니다." },
  { id: "a08", level: "advanced", template_text: "접영 리듬과 호흡 타이밍이 안정되었습니다." },
  { id: "a09", level: "advanced", template_text: "목표 기록에 근접한 훌륭한 수영을 보여줬습니다." },
  { id: "a10", level: "advanced", template_text: "대회를 대비한 페이스 분배 연습을 했습니다." },
  { id: "a11", level: "advanced", template_text: "탄력 훈련으로 전반적 스피드를 향상시켰습니다." },
  { id: "a12", level: "advanced", template_text: "고강도 훈련에도 집중력을 잃지 않았습니다." },
  { id: "a13", level: "advanced", template_text: "체계적인 훈련 계획에 잘 따라오고 있습니다." },
  { id: "a14", level: "advanced", template_text: "유연성 강화 운동을 병행했습니다." },
  { id: "a15", level: "advanced", template_text: "다음 목표를 설정하고 전략적으로 준비 중입니다." },
];

/* ─── 탭 정의 ─────────────────────────────────────────────────────── */
const TABS: { key: SentenceLevel; label: string }[] = [
  { key: "beginner",     label: "초급" },
  { key: "intermediate", label: "중급" },
  { key: "advanced",     label: "상급" },
  { key: "custom",       label: "커스텀" },
];

/* ─── Props ──────────────────────────────────────────────────────── */
interface Props {
  visible: boolean;
  customTemplates?: SentenceTemplate[];
  onClose: () => void;
  onInsert: (text: string) => void;
}

/* ════════════════════════════════════════════════════════════════
   메인 컴포넌트
   ════════════════════════════════════════════════════════════════ */
export default function SentencePicker({ visible, customTemplates = [], onClose, onInsert }: Props) {
  const [activeTab, setActiveTab] = useState<SentenceLevel>("beginner");
  const [searchQuery, setSearchQuery] = useState("");
  const [preview, setPreview] = useState<string[]>([]);

  const allSentences = useMemo<SentenceTemplate[]>(() => {
    return [...BUILT_IN, ...customTemplates];
  }, [customTemplates]);

  /* 표시할 문장 목록 */
  const displayList = useMemo<SentenceTemplate[]>(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return allSentences.filter(s => s.template_text.toLowerCase().includes(q));
    }
    return allSentences.filter(s => s.level === activeTab);
  }, [allSentences, searchQuery, activeTab]);

  const isSearching = searchQuery.trim().length > 0;

  function levelLabel(level: SentenceLevel): string {
    return { beginner: "초급", intermediate: "중급", advanced: "상급", custom: "커스텀" }[level] || level;
  }

  function levelColor(level: SentenceLevel): string {
    return { beginner: "#10B981", intermediate: "#3B82F6", advanced: "#8B5CF6", custom: "#F59E0B" }[level] || C.textSecondary;
  }

  const addToPreview = useCallback((text: string) => {
    setPreview(prev => [...prev, text]);
  }, []);

  const undoLast = useCallback(() => {
    setPreview(prev => prev.slice(0, -1));
  }, []);

  const clearAll = useCallback(() => {
    setPreview([]);
  }, []);

  const handleInsert = useCallback(() => {
    if (preview.length === 0) return;
    onInsert(preview.join("\n"));
    setPreview([]);
    setSearchQuery("");
    setActiveTab("beginner");
    onClose();
  }, [preview, onInsert, onClose]);

  const handleClose = useCallback(() => {
    setPreview([]);
    setSearchQuery("");
    setActiveTab("beginner");
    onClose();
  }, [onClose]);

  const renderSentenceItem = useCallback(({ item }: { item: SentenceTemplate }) => (
    <TouchableOpacity
      style={s.sentenceItem}
      onPress={() => addToPreview(item.template_text)}
      activeOpacity={0.7}
    >
      <Text style={s.sentenceText}>{item.template_text}</Text>
      {isSearching && (
        <View style={[s.levelBadge, { backgroundColor: levelColor(item.level) + "20" }]}>
          <Text style={[s.levelBadgeText, { color: levelColor(item.level) }]}>{levelLabel(item.level)}</Text>
        </View>
      )}
      <Feather name="plus" size={16} color={PRIMARY} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  ), [isSearching, addToPreview]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={s.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={s.kvWrapper}
      >
        <View style={s.sheet}>
          {/* 핸들 */}
          <View style={s.handle} />

          {/* 헤더 */}
          <View style={s.header}>
            <Text style={s.title}>문장 불러오기</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* 검색창 */}
          <View style={s.searchRow}>
            <Feather name="search" size={15} color={C.textSecondary} />
            <TextInput
              style={s.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="전체 문장 통합 검색..."
              placeholderTextColor={C.textMuted}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Feather name="x-circle" size={16} color={C.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* 카테고리 탭 (검색 중에는 숨김) */}
          {!isSearching && (
            <View style={s.tabBar}>
              {TABS.map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  style={[s.tabBtn, activeTab === tab.key && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.tabText, activeTab === tab.key && { color: "#fff" }]}>{tab.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {isSearching && (
            <Text style={s.searchHint}>
              전체 {displayList.length}개 문장 검색됨
            </Text>
          )}

          {/* 문장 목록 */}
          <FlatList
            data={displayList}
            keyExtractor={item => item.id}
            renderItem={renderSentenceItem}
            style={s.sentenceList}
            contentContainerStyle={s.sentenceListContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Feather name="inbox" size={28} color={C.textMuted} />
                <Text style={s.emptyText}>
                  {isSearching ? "검색 결과가 없습니다." : "문장이 없습니다."}
                </Text>
              </View>
            }
          />

          {/* 미리보기 영역 */}
          <View style={s.previewBox}>
            <View style={s.previewHeader}>
              <Text style={s.previewLabel}>
                <Feather name="eye" size={12} color={C.textSecondary} />
                {" "}삽입 예정 미리보기
              </Text>
              <Text style={s.previewCount}>{preview.length}문장</Text>
            </View>
            <ScrollView style={s.previewScroll} showsVerticalScrollIndicator={false}>
              {preview.length === 0 ? (
                <Text style={s.previewEmpty}>문장을 선택하면 여기에 쌓입니다.</Text>
              ) : (
                preview.map((line, idx) => (
                  <Text key={idx} style={s.previewLine}>{idx + 1}. {line}</Text>
                ))
              )}
            </ScrollView>

            {/* 미리보기 조작 버튼 */}
            <View style={s.previewActions}>
              <TouchableOpacity
                style={[s.previewBtn, preview.length === 0 && s.previewBtnDisabled]}
                onPress={undoLast}
                disabled={preview.length === 0}
                activeOpacity={0.7}
              >
                <Feather name="corner-left-up" size={13} color={preview.length === 0 ? C.textMuted : C.textSecondary} />
                <Text style={[s.previewBtnText, preview.length === 0 && { color: C.textMuted }]}>바로 전 삭제</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.previewBtn, preview.length === 0 && s.previewBtnDisabled]}
                onPress={clearAll}
                disabled={preview.length === 0}
                activeOpacity={0.7}
              >
                <Feather name="trash-2" size={13} color={preview.length === 0 ? C.textMuted : "#EF4444"} />
                <Text style={[s.previewBtnText, preview.length === 0 ? { color: C.textMuted } : { color: "#EF4444" }]}>전체 삭제</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 하단 버튼 */}
          <View style={s.footer}>
            <TouchableOpacity style={s.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={s.cancelBtnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.insertBtn, preview.length === 0 && s.insertBtnDisabled]}
              onPress={handleInsert}
              disabled={preview.length === 0}
              activeOpacity={0.7}
            >
              <Feather name="check" size={15} color={preview.length === 0 ? C.textMuted : "#fff"} />
              <Text style={[s.insertBtnText, preview.length === 0 && { color: C.textMuted }]}>완료 · 삽입</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  kvWrapper:  { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: SCREEN_H * 0.72,
    maxHeight: SCREEN_H * 0.92,
    paddingBottom: Platform.OS === "ios" ? 20 : 10,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: "center", marginTop: 10, marginBottom: 10,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 10,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },

  /* 검색 */
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.background, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text,
    padding: 0,
  },
  searchHint: {
    fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular",
    marginHorizontal: 16, marginBottom: 8,
  },

  /* 카테고리 탭 — 4개 균등 배치 */
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 10,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff",
  },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary },

  /* 문장 목록 — 6개 동시 표시 (각 행 ≈ 44px → 6×44 = 264 + gap) */
  sentenceList: { maxHeight: 274 },
  sentenceListContent: { paddingHorizontal: 16, paddingBottom: 4, gap: 4 },
  sentenceItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: C.background, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    minHeight: 44,
  },
  sentenceText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 19 },
  levelBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  levelBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },

  /* 미리보기 */
  previewBox: {
    marginHorizontal: 16, marginTop: 10,
    borderWidth: 1.5, borderColor: C.tintLight, borderRadius: 12,
    backgroundColor: "#F8FAFF", overflow: "hidden",
  },
  previewHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4,
    borderBottomWidth: 1, borderBottomColor: C.tintLight,
  },
  previewLabel: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_500Medium" },
  previewCount: { fontSize: 11, color: PRIMARY, fontFamily: "Inter_600SemiBold" },
  previewScroll: { maxHeight: 88, paddingHorizontal: 12, paddingVertical: 8 },
  previewEmpty: { fontSize: 12, color: C.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 8 },
  previewLine: { fontSize: 12, color: C.text, fontFamily: "Inter_400Regular", lineHeight: 20 },
  previewActions: {
    flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: C.tintLight,
  },
  previewBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: C.border,
  },
  previewBtnDisabled: { opacity: 0.4 },
  previewBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },

  /* 하단 버튼 */
  footer: {
    flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  cancelBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  insertBtn: {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 13, borderRadius: 12, backgroundColor: PRIMARY,
  },
  insertBtnDisabled: { backgroundColor: C.border },
  insertBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
