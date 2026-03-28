/**
 * SentencePicker.tsx — 문장 불러오기 바텀시트
 *
 * 기능:
 * - FeedbackTemplateContext에서 templates/labels 읽기 (즉시 반영)
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

import { Check, CircleX, CornerLeftUp, Eye, Inbox, Plus, Search, Trash2, X } from "lucide-react-native";
import Colors from "@/constants/colors";
import { useFeedbackTemplates, SentenceLevel, FeedbackTemplate } from "@/context/FeedbackTemplateContext";

const SCREEN_H = Dimensions.get("window").height;

const C = Colors.light;
const PRIMARY = C.tint;

export type { SentenceLevel };
export type SentenceTemplate = FeedbackTemplate;

/* ─── Props ──────────────────────────────────────────────────────── */
interface Props {
  visible: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

const LEVEL_COLORS: Record<SentenceLevel, string> = {
  beginner:     "#2E9B6F",
  intermediate: "#4EA7D8",
  advanced:     "#8B5CF6",
  custom:       "#E4A93A",
};

/* ════════════════════════════════════════════════════════════════
   메인 컴포넌트
   ════════════════════════════════════════════════════════════════ */
export default function SentencePicker({ visible, onClose, onInsert }: Props) {
  const { templates, labels } = useFeedbackTemplates();

  const [activeTab, setActiveTab] = useState<SentenceLevel>("beginner");
  const [searchQuery, setSearchQuery] = useState("");
  const [preview, setPreview] = useState<string[]>([]);

  const TABS: { key: SentenceLevel; label: string }[] = [
    { key: "beginner",     label: labels.beginner },
    { key: "intermediate", label: labels.intermediate },
    { key: "advanced",     label: labels.advanced },
    { key: "custom",       label: labels.custom },
  ];

  /* 표시할 문장 목록 */
  const displayList = useMemo<FeedbackTemplate[]>(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return templates.filter(s => s.template_text.toLowerCase().includes(q));
    }
    return templates.filter(s => s.level === activeTab);
  }, [templates, searchQuery, activeTab]);

  const isSearching = searchQuery.trim().length > 0;

  function levelLabel(level: SentenceLevel): string {
    return labels[level] || level;
  }

  function levelColor(level: SentenceLevel): string {
    return LEVEL_COLORS[level] || C.textSecondary;
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

  const renderSentenceItem = useCallback(({ item }: { item: FeedbackTemplate }) => (
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
      <Plus size={16} color={PRIMARY} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  ), [isSearching, addToPreview, labels]);

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
              <X size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* 검색창 */}
          <View style={s.searchRow}>
            <Search size={15} color={C.textSecondary} />
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
                <CircleX size={16} color={C.textSecondary} />
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
                <Inbox size={28} color={C.textMuted} />
                <Text style={s.emptyText}>
                  {isSearching ? "검색 결과가 없습니다." : "문장이 없습니다.\n피드백커스텀에서 추가해 보세요."}
                </Text>
              </View>
            }
          />

          {/* 미리보기 영역 */}
          <View style={s.previewBox}>
            <View style={s.previewHeader}>
              <Text style={s.previewLabel}>
                <Eye size={12} color={C.textSecondary} />
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
                <CornerLeftUp size={13} color={preview.length === 0 ? C.textMuted : C.textSecondary} />
                <Text style={[s.previewBtnText, preview.length === 0 && { color: C.textMuted }]}>바로 전 삭제</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.previewBtn, preview.length === 0 && s.previewBtnDisabled]}
                onPress={clearAll}
                disabled={preview.length === 0}
                activeOpacity={0.7}
              >
                <Trash2 size={13} color={preview.length === 0 ? C.textMuted : "#D96C6C"} />
                <Text style={[s.previewBtnText, preview.length === 0 ? { color: C.textMuted } : { color: "#D96C6C" }]}>전체 삭제</Text>
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
              <Check size={15} color={preview.length === 0 ? C.textMuted : "#fff"} />
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
  title: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.background, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text,
    padding: 0,
  },
  searchHint: {
    fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular",
    marginHorizontal: 16, marginBottom: 8,
  },

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
  tabText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  sentenceList: { maxHeight: 274 },
  sentenceListContent: { paddingHorizontal: 16, paddingBottom: 4, gap: 4 },
  sentenceItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: C.background, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    minHeight: 44,
  },
  sentenceText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 19 },
  levelBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  levelBadgeText: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },

  previewBox: {
    marginHorizontal: 16, marginTop: 10,
    borderWidth: 1.5, borderColor: C.tintLight, borderRadius: 12,
    backgroundColor: "#FFFFFF", overflow: "hidden",
  },
  previewHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4,
    borderBottomWidth: 1, borderBottomColor: C.tintLight,
  },
  previewLabel: { fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular" },
  previewCount: { fontSize: 11, color: PRIMARY, fontFamily: "Pretendard-Regular" },
  previewScroll: { maxHeight: 88, paddingHorizontal: 12, paddingVertical: 8 },
  previewEmpty: { fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 8 },
  previewLine: { fontSize: 12, color: C.text, fontFamily: "Pretendard-Regular", lineHeight: 20 },
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
  previewBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  footer: {
    flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  cancelBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  insertBtn: {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 13, borderRadius: 12, backgroundColor: PRIMARY,
  },
  insertBtnDisabled: { backgroundColor: C.border },
  insertBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
