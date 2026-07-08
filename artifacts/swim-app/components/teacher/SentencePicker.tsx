/**
 * SentencePicker.tsx — 문장 불러오기 바텀시트
 *
 * - /api/diary-template-levels 에서 레벨 탭 동적 로드
 * - /api/diary-templates 에서 선생님 문장 로드 (override 병합)
 * - 전체 통합 검색, 미리보기, 삽입
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { API_BASE } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";

const SCREEN_H = Dimensions.get("window").height;
const C = Colors.light;
const PRIMARY = C.tint;

interface DiaryLevel {
  id: string;
  level_name: string;
  sort_order: number;
  template_count: number;
}

interface DiaryTemplate {
  id: string;
  template_text: string;
  title: string | null;
  level_id: string;
  sort_order: number;
  is_active: boolean;
  is_overridden: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export default function SentencePicker({ visible, onClose, onInsert }: Props) {
  const { token } = useAuth();

  const [levels, setLevels] = useState<DiaryLevel[]>([]);
  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [preview, setPreview] = useState<string[]>([]);

  /* ── 데이터 로드 ── */
  useEffect(() => {
    if (!visible || !token) return;

    setLoading(true);
    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(`${API_BASE}/diary-template-levels`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/diary-templates`, { headers }).then(r => r.json()),
    ])
      .then(([lvls, tmps]) => {
        const levelList: DiaryLevel[] = Array.isArray(lvls) ? lvls : [];
        const templateList: DiaryTemplate[] = Array.isArray(tmps) ? tmps : [];
        setLevels(levelList);
        setTemplates(templateList);
        if (levelList.length > 0) {
          setActiveLevelId(levelList[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, token]);

  /* ── 표시할 문장 목록 ── */
  const displayList = useMemo<DiaryTemplate[]>(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return templates.filter(t => t.template_text.toLowerCase().includes(q));
    }
    if (!activeLevelId) return [];
    return templates.filter(t => t.level_id === activeLevelId);
  }, [templates, searchQuery, activeLevelId]);

  const isSearching = searchQuery.trim().length > 0;

  /* ── 미리보기 조작 ── */
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
    onInsert(preview.join(" "));
    setPreview([]);
    setSearchQuery("");
    onClose();
  }, [preview, onInsert, onClose]);

  const handleClose = useCallback(() => {
    setPreview([]);
    setSearchQuery("");
    onClose();
  }, [onClose]);

  const renderSentenceItem = useCallback(({ item }: { item: DiaryTemplate }) => {
    const levelName = isSearching
      ? levels.find(l => l.id === item.level_id)?.level_name
      : null;

    return (
      <TouchableOpacity
        style={s.sentenceItem}
        onPress={() => addToPreview(item.template_text)}
        activeOpacity={0.7}
      >
        <Text style={s.sentenceText}>{item.template_text}</Text>
        {levelName && (
          <View style={s.levelBadge}>
            <Text style={s.levelBadgeText}>{levelName}</Text>
          </View>
        )}
        {item.is_overridden && (
          <View style={s.editedDot} />
        )}
        <Plus size={16} color={PRIMARY} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  }, [isSearching, levels, addToPreview]);

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

          {/* 레벨 탭 (검색 중 숨김) */}
          {!isSearching && (
            <View style={s.tabBar}>
              {levels.map(lv => (
                <TouchableOpacity
                  key={lv.id}
                  style={[s.tabBtn, activeLevelId === lv.id && { backgroundColor: PRIMARY, borderColor: PRIMARY }]}
                  onPress={() => setActiveLevelId(lv.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.tabText, activeLevelId === lv.id && { color: "#fff" }]}>{lv.level_name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {isSearching && (
            <Text style={s.searchHint}>전체 {displayList.length}개 문장 검색됨</Text>
          )}

          {/* 문장 목록 */}
          {loading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={PRIMARY} />
              <Text style={s.loadingText}>불러오는 중...</Text>
            </View>
          ) : (
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
                    {isSearching
                      ? "검색 결과가 없습니다."
                      : levels.length === 0
                      ? "카테고리가 없습니다.\n관리자에게 문의해주세요."
                      : "문장이 없습니다."}
                  </Text>
                </View>
              }
            />
          )}

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
    flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, padding: 0,
  },
  searchHint: {
    fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular",
    marginHorizontal: 16, marginBottom: 8,
  },

  tabBar: {
    flexDirection: "row", flexWrap: "wrap",
    paddingHorizontal: 16, paddingBottom: 10, gap: 6,
  },
  tabBtn: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: Platform.OS === "android" ? 7 : 6, paddingHorizontal: 12,
    borderRadius: 11, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff",
  },
  tabText: { fontSize: 11, lineHeight: 20, color: C.textSecondary, includeFontPadding: false } as any,

  loadingBox: { alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 8 },
  loadingText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  sentenceList: { maxHeight: 274 },
  sentenceListContent: { paddingHorizontal: 16, paddingBottom: 4, gap: 4 },
  sentenceItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: C.background, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    minHeight: 44,
  },
  sentenceText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 19 },
  levelBadge: {
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: PRIMARY + "20",
  },
  levelBadgeText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: PRIMARY },
  editedDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#E4A93A",
  },
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
