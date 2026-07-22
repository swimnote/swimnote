/**
 * SentencePicker.tsx — 문장 불러오기 바텀시트
 *
 * - /api/diary-template-levels 에서 레벨 탭 동적 로드
 * - /api/diary-templates 에서 선생님 문장 로드 (override 병합)
 * - 전체 통합 검색, 미리보기, 삽입
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LucideIcon } from "@/components/common/LucideIcon";
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
  global_id: string | null;
}

const MY_TAB_ID = "__my_templates__";

interface Props {
  visible: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export default function SentencePicker({ visible, onClose, onInsert }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [levels, setLevels] = useState<DiaryLevel[]>([]);
  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [preview, setPreview] = useState<string[]>([]);

  // 레벨 피커 인라인 패널
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // 미리보기 전체 확대 모달
  const [previewModalVisible, setPreviewModalVisible] = useState(false);

  // 미리보기 ScrollView ref (자동 스크롤)
  const previewScrollRef = useRef<ScrollView>(null);

  // 키보드 높이 추적 (Modal 내 KeyboardAvoidingView 대체)
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // 시트 높이 계산 (B-2 지시 기준)
  const topGap = insets.top + 6;
  const sheetHeight = Math.max(200, kbHeight > 0
    ? SCREEN_H - kbHeight - topGap
    : SCREEN_H - topGap,
  );

  // 아래로 스와이프 닫기
  const swipeY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) swipeY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          Keyboard.dismiss();
          swipeY.setValue(0);
          onClose();
        } else {
          Animated.spring(swipeY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    }),
  ).current;

  // visible 변경 시 swipeY 초기화
  useEffect(() => { if (!visible) swipeY.setValue(0); }, [visible]);

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
        const hasMyTemplates = templateList.some(t => t.global_id === null);
        if (hasMyTemplates) {
          setActiveLevelId(MY_TAB_ID);
        } else if (levelList.length > 0) {
          setActiveLevelId(levelList[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, token]);

  /* ── 표시할 문장 목록 ── */
  const myTemplates = useMemo(
    () => templates.filter(t => t.global_id === null),
    [templates],
  );

  const filteredLevels = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return levels;
    return levels.filter(lv => lv.level_name.toLowerCase().includes(q));
  }, [levels, pickerSearch]);

  const selectedLevelName = activeLevelId === MY_TAB_ID
    ? null
    : levels.find(lv => lv.id === activeLevelId)?.level_name ?? null;

  const displayList = useMemo<DiaryTemplate[]>(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return templates.filter(t => t.template_text.toLowerCase().includes(q));
    }
    if (!activeLevelId) return [];
    if (activeLevelId === MY_TAB_ID) return myTemplates;
    return templates.filter(t => t.level_id === activeLevelId);
  }, [templates, myTemplates, searchQuery, activeLevelId]);

  const isSearching = searchQuery.trim().length > 0;

  /* ── 미리보기 자동 스크롤 (추가 시 맨 아래로) ── */
  useEffect(() => {
    if (preview.length > 0) {
      setTimeout(() => previewScrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [preview.length]);

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
    Keyboard.dismiss();
    onInsert(preview.join("\n\n"));
    setPreview([]);
    setSearchQuery("");
    onClose();
  }, [preview, onInsert, onClose]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
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
        <LucideIcon name="plus" size={16} color={PRIMARY} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );
  }, [isSearching, levels, addToPreview]);

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={s.kvWrapper}>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.45)" }]} onPress={handleClose} />
        <Animated.View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === "ios" ? 20 : 16), height: sheetHeight, transform: [{ translateY: swipeY }] }]}>
          {/* ── 고정 상단 (스와이프 핸들) ── */}
          <View style={s.handle} {...panResponder.panHandlers} hitSlop={{ top: 10, bottom: 16, left: 60, right: 60 }} />

          <View style={s.header}>
            <Text style={s.title}>문장 불러오기</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <LucideIcon name="x" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* 검색창 */}
          <View style={s.searchRow}>
            <LucideIcon name="search" size={15} color={C.textSecondary} />
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
                <LucideIcon name="x-circle" size={16} color={C.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* 탭 바 (검색 중 숨김) */}
          {!isSearching && (
            <View style={s.tabBarRow}>
              <TouchableOpacity
                style={[s.tabBtn, s.myTabBtn, activeLevelId === MY_TAB_ID && s.myTabBtnActive]}
                onPress={() => { setActiveLevelId(MY_TAB_ID); setPickerOpen(false); }}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, s.myTabText, activeLevelId === MY_TAB_ID && s.myTabTextActive]}>
                  ✦ 나의 템플릿
                </Text>
              </TouchableOpacity>
              <View style={s.tabDivider} />
              <TouchableOpacity
                style={[s.pickerBtn, activeLevelId !== MY_TAB_ID && !!selectedLevelName && s.pickerBtnActive]}
                onPress={() => { setPickerSearch(""); setPickerOpen(v => !v); }}
                activeOpacity={0.7}
              >
                <Text
                  style={[s.pickerBtnText, activeLevelId !== MY_TAB_ID && !!selectedLevelName && s.pickerBtnTextActive]}
                  numberOfLines={1}
                >
                  {activeLevelId === MY_TAB_ID || !selectedLevelName ? "레벨 선택" : selectedLevelName}
                </Text>
                <LucideIcon name="chevron-down" size={14} color={activeLevelId !== MY_TAB_ID && selectedLevelName ? PRIMARY : C.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          {/* ── 중간 스크롤 영역 (flex:1 — 남은 공간 전부 차지) ── */}
          <View style={s.middleArea}>

            {/* 레벨 피커 인라인 패널 */}
            {!isSearching && pickerOpen && (
              <View style={s.inlinePicker}>
                <View style={s.inlinePickerSearch}>
                  <LucideIcon name="search" size={14} color={C.textMuted} />
                  <TextInput
                    style={s.inlinePickerInput}
                    value={pickerSearch}
                    onChangeText={setPickerSearch}
                    placeholder="레벨 검색..."
                    placeholderTextColor={C.textMuted}
                    autoFocus
                    clearButtonMode="while-editing"
                  />
                </View>
                <ScrollView style={s.inlinePickerList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {filteredLevels.map(lv => {
                    const isSel = activeLevelId === lv.id;
                    return (
                      <TouchableOpacity
                        key={lv.id}
                        style={[s.inlinePickerRow, isSel && s.inlinePickerRowSel]}
                        onPress={() => { setActiveLevelId(lv.id); setPickerOpen(false); setPickerSearch(""); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.inlinePickerRowText, isSel && s.inlinePickerRowTextSel]} numberOfLines={1}>
                          {lv.level_name}
                        </Text>
                        {isSel && <LucideIcon name="check" size={14} color={PRIMARY} />}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredLevels.length === 0 && (
                    <Text style={s.inlinePickerEmpty}>검색 결과 없음</Text>
                  )}
                </ScrollView>
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
                keyboardDismissMode="interactive"
                ListEmptyComponent={
                  <View style={s.emptyBox}>
                    <LucideIcon name="inbox" size={28} color={C.textMuted} />
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
          </View>

          {/* 미리보기 영역 */}
          <View style={s.previewBox}>
            <View style={s.previewHeader}>
              <Text style={s.previewLabel}>
                <LucideIcon name="eye" size={12} color={C.textSecondary} />
                {" "}삽입 예정 미리보기
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={s.previewCount}>{preview.length}문장</Text>
                {preview.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setPreviewModalVisible(true)}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <LucideIcon name="zoom-in" size={15} color={PRIMARY} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <ScrollView ref={previewScrollRef} style={[s.previewScroll, kbHeight > 0 && { maxHeight: 0 }]} showsVerticalScrollIndicator={false}>
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
                <LucideIcon name="corner-left-up" size={13} color={preview.length === 0 ? C.textMuted : C.textSecondary} />
                <Text style={[s.previewBtnText, preview.length === 0 && { color: C.textMuted }]}>바로 전 삭제</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.previewBtn, preview.length === 0 && s.previewBtnDisabled]}
                onPress={clearAll}
                disabled={preview.length === 0}
                activeOpacity={0.7}
              >
                <LucideIcon name="trash-2" size={13} color={preview.length === 0 ? C.textMuted : "#D96C6C"} />
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
              <LucideIcon name="check" size={15} color={preview.length === 0 ? C.textMuted : "#fff"} />
              <Text style={[s.insertBtnText, preview.length === 0 && { color: C.textMuted }]}>완료 · 삽입</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>

    {/* ── 미리보기 전체 확대 모달 ── */}
    <Modal
      visible={previewModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setPreviewModalVisible(false)}
    >
      <View style={s.fullPreviewBackdrop}>
        <View style={s.fullPreviewBox}>
          <View style={s.fullPreviewHeader}>
            <Text style={s.fullPreviewTitle}>삽입 예정 미리보기 ({preview.length}문장)</Text>
            <TouchableOpacity onPress={() => setPreviewModalVisible(false)} hitSlop={12} activeOpacity={0.7}>
              <LucideIcon name="x" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.fullPreviewScroll} showsVerticalScrollIndicator={false}>
            {preview.map((line, idx) => (
              <View key={idx} style={s.fullPreviewItem}>
                <Text style={s.fullPreviewNum}>{idx + 1}.</Text>
                <Text style={s.fullPreviewText}>{line}</Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={s.fullPreviewCloseBtn}
            onPress={() => setPreviewModalVisible(false)}
            activeOpacity={0.8}
          >
            <Text style={s.fullPreviewCloseBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  kvWrapper:  { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  middleArea: {
    flex: 1,
    minHeight: Math.max(72, SCREEN_H * 0.17),
    overflow: "hidden",
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

  // ── 탭 바 ──
  tabBarRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 10, gap: 8,
  },
  tabBtn: {
    paddingVertical: Platform.OS === "android" ? 7 : 5, paddingHorizontal: 11,
    borderRadius: 14, borderWidth: 1.5, borderColor: "#E2E8F0", backgroundColor: "#fff",
  },
  tabText: { fontSize: 11, lineHeight: 16, color: C.textSecondary, includeFontPadding: false } as any,
  myTabBtn:        { borderColor: "#6B5BCD", backgroundColor: "#F5F3FF" },
  myTabBtnActive:  { backgroundColor: "#6B5BCD", borderColor: "#6B5BCD" },
  myTabText:       { color: "#6B5BCD", fontFamily: "Pretendard-SemiBold" } as any,
  myTabTextActive: { color: "#fff" } as any,
  tabDivider:      { width: 1, height: 22, backgroundColor: C.border },

  // ── 레벨 피커 버튼 ──
  pickerBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff",
  },
  pickerBtnActive:     { borderColor: PRIMARY, backgroundColor: PRIMARY + "10" },
  pickerBtnText:       { flex: 1, fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" } as any,
  pickerBtnTextActive: { color: PRIMARY, fontFamily: "Pretendard-SemiBold" } as any,

  // ── 인라인 피커 패널 ──
  inlinePicker: {
    marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: "#F8FAFC", overflow: "hidden",
  },
  inlinePickerSearch: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  inlinePickerInput:   { flex: 1, fontSize: 13, color: C.text, padding: 0, fontFamily: "Pretendard-Regular" },
  inlinePickerList:    { maxHeight: 210 },
  inlinePickerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 11, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  inlinePickerRowSel:     { backgroundColor: PRIMARY + "10" },
  inlinePickerRowText:    { flex: 1, fontSize: 13, color: C.text, fontFamily: "Pretendard-Regular" },
  inlinePickerRowTextSel: { color: PRIMARY, fontFamily: "Pretendard-SemiBold" } as any,
  inlinePickerEmpty:      { fontSize: 12, color: C.textMuted, textAlign: "center", padding: 16, fontFamily: "Pretendard-Regular" },

  loadingBox: { alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 8 },
  loadingText: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  sentenceList: { flex: 1 },
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
  previewScroll: { maxHeight: Math.max(80, SCREEN_H * 0.13), paddingHorizontal: 12, paddingVertical: 8 },
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

  // ── 전체 미리보기 확대 모달 ──
  fullPreviewBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  fullPreviewBox: {
    width: "100%", backgroundColor: "#fff", borderRadius: 18,
    maxHeight: SCREEN_H * 0.78, overflow: "hidden",
  },
  fullPreviewHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  fullPreviewTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.text } as any,
  fullPreviewScroll: { paddingHorizontal: 20, paddingVertical: 12, maxHeight: SCREEN_H * 0.55 },
  fullPreviewItem: { flexDirection: "row", gap: 8, marginBottom: 14 },
  fullPreviewNum: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: PRIMARY, minWidth: 20 } as any,
  fullPreviewText: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 22 } as any,
  fullPreviewCloseBtn: {
    marginHorizontal: 20, marginVertical: 14, paddingVertical: 13, borderRadius: 12,
    backgroundColor: PRIMARY, alignItems: "center",
  },
  fullPreviewCloseBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" } as any,
});
