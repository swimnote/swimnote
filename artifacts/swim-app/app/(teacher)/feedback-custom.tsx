/**
 * (teacher)/feedback-custom.tsx — 피드백커스텀
 *
 * 선생님 개인의 일지 자동완성 문장 세트를 관리하는 화면
 * - 카테고리 탭 (초급/중급/상급/커스텀)
 * - 문장 추가/수정/삭제
 * - 카테고리 이름 수정
 * - 카테고리 초기화 / 전체 초기화
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import {
  useFeedbackTemplates,
  SentenceLevel,
  FeedbackTemplate,
  DEFAULT_LABELS,
} from "@/context/FeedbackTemplateContext";

const C = Colors.light;

const MAX_PER_CATEGORY = 100;

const LEVEL_COLORS: Record<SentenceLevel, string> = {
  beginner:     "#2E9B6F",
  intermediate: "#4EA7D8",
  advanced:     "#8B5CF6",
  custom:       "#E4A93A",
};

const LEVEL_KEYS: SentenceLevel[] = ["beginner", "intermediate", "advanced", "custom"];

export default function FeedbackCustomScreen() {
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const {
    templates, labels,
    addTemplate, updateTemplate, deleteTemplate,
    updateLabel, resetCategory, resetAll,
  } = useFeedbackTemplates();

  const [activeTab, setActiveTab] = useState<SentenceLevel>("beginner");

  /* ── 문장 추가 모달 ── */
  const [addVisible, setAddVisible]   = useState(false);
  const [addText,    setAddText]      = useState("");
  const [addError,   setAddError]     = useState("");

  /* ── 문장 수정 모달 ── */
  const [editItem,    setEditItem]    = useState<FeedbackTemplate | null>(null);
  const [editText,    setEditText]    = useState("");
  const [editError,   setEditError]   = useState("");

  /* ── 문장 삭제 확인 ── */
  const [deleteTarget, setDeleteTarget] = useState<FeedbackTemplate | null>(null);

  /* ── 카테고리 이름 수정 모달 ── */
  const [labelVisible, setLabelVisible] = useState(false);
  const [labelText,    setLabelText]    = useState("");
  const [labelError,   setLabelError]   = useState("");

  /* ── 카테고리 초기화 확인 ── */
  const [resetCatVisible, setResetCatVisible] = useState(false);

  /* ── 전체 초기화 확인 ── */
  const [resetAllVisible, setResetAllVisible] = useState(false);

  const currentList = templates.filter(t => t.level === activeTab);
  const currentCount = currentList.length;
  const isFull = currentCount >= MAX_PER_CATEGORY;

  /* ──────── 문장 추가 ──────── */
  function openAdd() {
    setAddText(""); setAddError(""); setAddVisible(true);
  }
  function handleAdd() {
    const t = addText.trim();
    if (!t) { setAddError("문장을 입력해주세요."); return; }
    if (t.length > 100) { setAddError("최대 100자까지 입력 가능합니다."); return; }
    if (isFull) { setAddError(`카테고리당 최대 ${MAX_PER_CATEGORY}개까지 추가할 수 있습니다.`); return; }
    addTemplate(activeTab, t);
    setAddVisible(false);
  }

  /* ──────── 문장 수정 ──────── */
  function openEdit(item: FeedbackTemplate) {
    setEditItem(item); setEditText(item.template_text); setEditError(""); 
  }
  function handleEdit() {
    if (!editItem) return;
    const t = editText.trim();
    if (!t) { setEditError("문장을 입력해주세요."); return; }
    if (t.length > 100) { setEditError("최대 100자까지 입력 가능합니다."); return; }
    updateTemplate(editItem.id, t);
    setEditItem(null);
  }

  /* ──────── 문장 삭제 ──────── */
  function handleDelete() {
    if (!deleteTarget) return;
    deleteTemplate(deleteTarget.id);
    setDeleteTarget(null);
  }

  /* ──────── 카테고리 이름 수정 ──────── */
  function openLabel() {
    setLabelText(labels[activeTab]); setLabelError(""); setLabelVisible(true);
  }
  function handleLabelSave() {
    const t = labelText.trim();
    if (!t) { setLabelError("카테고리 이름을 입력해주세요."); return; }
    if (t.length > 20) { setLabelError("최대 20자까지 입력 가능합니다."); return; }
    updateLabel(activeTab, t);
    setLabelVisible(false);
  }

  /* ──────── 렌더 ──────── */
  function renderItem({ item, index }: { item: FeedbackTemplate; index: number }) {
    return (
      <View style={[s.row, { backgroundColor: C.card }]}>
        <View style={[s.rowIndex, { backgroundColor: LEVEL_COLORS[activeTab] + "18" }]}>
          <Text style={[s.rowIndexText, { color: LEVEL_COLORS[activeTab] }]}>{index + 1}</Text>
        </View>
        <Text style={[s.rowText, { color: C.text }]} numberOfLines={3}>{item.template_text}</Text>
        <View style={s.rowActions}>
          <Pressable style={s.rowBtn} onPress={() => openEdit(item)} hitSlop={6}>
            <Feather name="edit-2" size={15} color="#4EA7D8" />
          </Pressable>
          <Pressable style={[s.rowBtn, { backgroundColor: "#FEF2F2" }]} onPress={() => setDeleteTarget(item)} hitSlop={6}>
            <Feather name="trash-2" size={15} color="#D96C6C" />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title="피드백 커스텀"
        onBack={() => router.navigate("/(teacher)/settings" as any)}
        homePath="/(teacher)/today-schedule"
        rightSlot={
          <Pressable style={s.resetAllBtn} onPress={() => setResetAllVisible(true)}>
            <Feather name="refresh-ccw" size={13} color="#D96C6C" />
            <Text style={s.resetAllBtnText}>전체 초기화</Text>
          </Pressable>
        }
      />

      {/* 안내 문구 */}
      <View style={[s.descBox, { backgroundColor: themeColor + "0C" }]}>
        <Feather name="info" size={13} color={themeColor} />
        <Text style={[s.descText, { color: themeColor }]}>
          일지 작성 시 불러올 문장을 직접 수정하고 관리할 수 있습니다. 변경 내용은 즉시 반영됩니다.
        </Text>
      </View>

      {/* 카테고리 탭 */}
      <View style={s.tabBar}>
        {LEVEL_KEYS.map(key => {
          const active = activeTab === key;
          const cnt = templates.filter(t => t.level === key).length;
          return (
            <Pressable
              key={key}
              style={[s.tabBtn, active && { backgroundColor: themeColor, borderColor: themeColor }]}
              onPress={() => setActiveTab(key)}
            >
              <Text style={[s.tabText, { color: active ? "#fff" : C.textSecondary }]}>{labels[key]}</Text>
              {cnt > 0 && (
                <View style={[s.tabBadge, { backgroundColor: active ? "rgba(255,255,255,0.3)" : themeColor + "20" }]}>
                  <Text style={[s.tabBadgeText, { color: active ? "#fff" : themeColor }]}>{cnt}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* 카테고리 컨트롤 */}
      <View style={s.catControl}>
        <Text style={[s.countText, { color: isFull ? "#D96C6C" : C.textSecondary }]}>
          현재 {currentCount} / {MAX_PER_CATEGORY}
        </Text>
        <View style={s.catBtns}>
          <Pressable style={s.catBtn} onPress={openLabel}>
            <Feather name="tag" size={13} color="#6F6B68" />
            <Text style={s.catBtnText}>이름 변경</Text>
          </Pressable>
          <Pressable style={[s.catBtn, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]} onPress={() => setResetCatVisible(true)}>
            <Feather name="rotate-ccw" size={13} color="#D96C6C" />
            <Text style={[s.catBtnText, { color: "#D96C6C" }]}>초기화</Text>
          </Pressable>
        </View>
      </View>

      {/* 문장 리스트 */}
      <FlatList
        data={currentList}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={s.emptyBox}>
            <Feather name="inbox" size={36} color={C.textMuted} />
            <Text style={s.emptyText}>
              {activeTab === "custom"
                ? "문장을 추가해 보세요."
                : "초기화하면 기본 문장이 복구됩니다."}
            </Text>
          </View>
        }
      />

      {/* 문장 추가 버튼 */}
      <View style={[s.addBtnWrap, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[s.addBtn, { backgroundColor: isFull ? "#9A948F" : themeColor }]}
          onPress={openAdd}
          disabled={isFull}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={s.addBtnText}>문장 추가</Text>
          {isFull && <Text style={[s.addBtnText, { fontSize: 11, opacity: 0.8 }]}>(최대 도달)</Text>}
        </Pressable>
      </View>

      {/* ════ 문장 추가 모달 ════ */}
      <Modal visible={addVisible} transparent animationType="slide" onRequestClose={() => setAddVisible(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setAddVisible(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.modalKV}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.modalTitle}>문장 추가</Text>
            <Text style={s.modalSub}>{labels[activeTab]} 카테고리에 추가됩니다.</Text>
            <TextInput
              style={[s.textInput, { borderColor: addError ? "#D96C6C" : C.border }]}
              value={addText}
              onChangeText={t => { setAddText(t); setAddError(""); }}
              placeholder="문장을 입력하세요 (최대 100자)"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={100}
              autoFocus
            />
            <Text style={s.charCount}>{addText.length} / 100</Text>
            {addError ? <Text style={s.errorText}>{addError}</Text> : null}
            <View style={s.modalBtns}>
              <Pressable style={[s.modalBtn, s.modalBtnCancel]} onPress={() => setAddVisible(false)}>
                <Text style={s.modalBtnCancelText}>취소</Text>
              </Pressable>
              <Pressable style={[s.modalBtn, { backgroundColor: themeColor }]} onPress={handleAdd}>
                <Text style={s.modalBtnText}>추가</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════ 문장 수정 모달 ════ */}
      <Modal visible={editItem !== null} transparent animationType="slide" onRequestClose={() => setEditItem(null)}>
        <Pressable style={s.modalOverlay} onPress={() => setEditItem(null)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.modalKV}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.modalTitle}>문장 수정</Text>
            <TextInput
              style={[s.textInput, { borderColor: editError ? "#D96C6C" : C.border }]}
              value={editText}
              onChangeText={t => { setEditText(t); setEditError(""); }}
              placeholder="문장을 입력하세요 (최대 100자)"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={100}
              autoFocus
            />
            <Text style={s.charCount}>{editText.length} / 100</Text>
            {editError ? <Text style={s.errorText}>{editError}</Text> : null}
            <View style={s.modalBtns}>
              <Pressable style={[s.modalBtn, s.modalBtnCancel]} onPress={() => setEditItem(null)}>
                <Text style={s.modalBtnCancelText}>취소</Text>
              </Pressable>
              <Pressable style={[s.modalBtn, { backgroundColor: themeColor }]} onPress={handleEdit}>
                <Text style={s.modalBtnText}>저장</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════ 카테고리 이름 수정 모달 ════ */}
      <Modal visible={labelVisible} transparent animationType="slide" onRequestClose={() => setLabelVisible(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setLabelVisible(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.modalKV}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.modalTitle}>카테고리 이름 변경</Text>
            <Text style={s.modalSub}>내부 분류 키는 변경되지 않으며, 표시 이름만 바뀝니다.</Text>
            <TextInput
              style={[s.textInput, { borderColor: labelError ? "#D96C6C" : C.border }]}
              value={labelText}
              onChangeText={t => { setLabelText(t); setLabelError(""); }}
              placeholder="카테고리 이름 (최대 20자)"
              placeholderTextColor={C.textMuted}
              maxLength={20}
              autoFocus
            />
            {labelError ? <Text style={s.errorText}>{labelError}</Text> : null}
            <View style={s.modalBtns}>
              <Pressable style={[s.modalBtn, s.modalBtnCancel]} onPress={() => setLabelVisible(false)}>
                <Text style={s.modalBtnCancelText}>취소</Text>
              </Pressable>
              <Pressable style={[s.modalBtn, { backgroundColor: themeColor }]} onPress={handleLabelSave}>
                <Text style={s.modalBtnText}>저장</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════ 문장 삭제 확인 ════ */}
      <ConfirmModal
        visible={deleteTarget !== null}
        title="문장 삭제"
        message={`이 문장을 삭제하시겠습니까?\n\n"${deleteTarget?.template_text ?? ""}"`}
        confirmText="삭제"
        cancelText="취소"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ════ 카테고리 초기화 확인 ════ */}
      <ConfirmModal
        visible={resetCatVisible}
        title={`${labels[activeTab]} 초기화`}
        message={
          activeTab === "custom"
            ? `커스텀 카테고리의 모든 문장이 삭제됩니다.\n계속하시겠습니까?`
            : `${labels[activeTab]} 카테고리를 기본 문장으로 되돌립니다.\n현재 수정 내용은 사라집니다.`
        }
        confirmText="초기화"
        cancelText="취소"
        destructive
        onConfirm={() => { resetCategory(activeTab); setResetCatVisible(false); }}
        onCancel={() => setResetCatVisible(false)}
      />

      {/* ════ 전체 초기화 확인 ════ */}
      <ConfirmModal
        visible={resetAllVisible}
        title="전체 초기화"
        message="현재 수정한 모든 피드백 문장이 삭제되고 기본값으로 복구됩니다.\n이 작업은 되돌릴 수 없습니다."
        confirmText="전체 초기화"
        cancelText="취소"
        destructive
        onConfirm={() => { resetAll(); setResetAllVisible(false); }}
        onCancel={() => setResetAllVisible(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  subHeader: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border, gap: 10,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center", justifyContent: "center" },
  subTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },

  resetAllBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2",
  },
  resetAllBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#D96C6C" },

  descBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginHorizontal: 14, marginTop: 10, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
  },
  descText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  tabBar: {
    flexDirection: "row", paddingHorizontal: 14, gap: 8, marginTop: 10, marginBottom: 4,
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff",
  },
  tabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tabBadge: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },

  catControl: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  countText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  catBtns: { flexDirection: "row", gap: 8 },
  catBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  catBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6F6B68" },

  listContent: { paddingHorizontal: 14, paddingTop: 8, gap: 8 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12,
  },
  rowIndex: {
    width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  rowIndexText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  rowText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  rowActions: { flexDirection: "row", gap: 6, flexShrink: 0 },
  rowBtn: {
    width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "#DDF2EF",
  },

  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },

  addBtnWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 14, paddingTop: 10,
    backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.border,
  },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 50, borderRadius: 14,
  },
  addBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },

  /* 모달 공통 */
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  modalKV:  { flex: 1, justifyContent: "flex-end" },
  modalBox: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 20, gap: 12,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  modalSub:   { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: -4 },
  textInput: {
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", color: C.text,
    minHeight: 80, textAlignVertical: "top",
    backgroundColor: C.background,
  },
  charCount: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "right", marginTop: -6 },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#D96C6C" },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: {
    flex: 1, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center",
  },
  modalBtnCancel: { borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  modalBtnCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  modalBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
