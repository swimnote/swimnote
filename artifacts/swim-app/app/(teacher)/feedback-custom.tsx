/**
 * (teacher)/feedback-custom.tsx — 일지 템플릿 (선생님)
 *
 * Override 패턴:
 *   - 관리자 원본을 기본 목록으로 표시
 *   - 선생님이 수정 → 해당 항목만 개인 override 저장
 *   - 초기화 → override 삭제, 관리자 원본으로 복귀
 *   - 선생님 신규 추가 → source_template_id=NULL 별도 항목
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Edit2, Plus, RotateCcw, Trash2 } from "lucide-react-native";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { DiaryTemplateLevel, DiaryTemplate } from "@/components/teacher/diary/types";

const C = Colors.light;

export default function FeedbackCustomScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [levels, setLevels] = useState<DiaryTemplateLevel[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [levelsLoading, setLevelsLoading] = useState(true);

  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // 수정 모달 (global override + teacher 신규 모두)
  const [editTarget, setEditTarget] = useState<DiaryTemplate | null>(null);
  const [editText, setEditText] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // 신규 추가 모달 (teacher-only, source=null)
  const [addVisible, setAddVisible] = useState(false);
  const [addText, setAddText] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // 초기화 확인
  const [resetTarget, setResetTarget] = useState<DiaryTemplate | null>(null);
  // 삭제 확인 (teacher 신규 항목)
  const [deleteTarget, setDeleteTarget] = useState<DiaryTemplate | null>(null);

  // ── 레벨 로드 ──────────────────────────────────────
  const loadLevels = useCallback(async () => {
    setLevelsLoading(true);
    try {
      const r = await apiRequest(token, "/diary-template-levels");
      if (r.ok) {
        const lvs: DiaryTemplateLevel[] = await r.json();
        setLevels(lvs);
        if (lvs.length > 0 && !selectedLevelId) setSelectedLevelId(lvs[0].id);
      }
    } catch { /* ignore */ }
    setLevelsLoading(false);
  }, [token, selectedLevelId]);

  // ── 템플릿 로드 (merged view) ───────────────────────
  const loadTemplates = useCallback(async (levelId: string) => {
    setTemplatesLoading(true);
    try {
      const r = await apiRequest(token, `/diary-templates?level_id=${levelId}`);
      if (r.ok) setTemplates(await r.json());
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  }, [token]);

  useEffect(() => { loadLevels(); }, []);
  useEffect(() => { if (selectedLevelId) loadTemplates(selectedLevelId); }, [selectedLevelId]);

  // ── override 저장 (global 항목 수정) ───────────────
  const saveOverride = async () => {
    if (!editTarget || !editText.trim()) { setEditError("내용을 입력해주세요."); return; }
    setEditSaving(true);
    setEditError("");
    try {
      let r: Response;
      if (editTarget.global_id) {
        r = await apiRequest(token, `/diary-templates/${editTarget.global_id}/override`, {
          method: "POST",
          body: JSON.stringify({ template_text: editText.trim(), title: editTitle.trim() || null }),
        });
      } else {
        r = await apiRequest(token, `/diary-templates/${editTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ template_text: editText.trim(), title: editTitle.trim() || null }),
        });
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setEditError(j.error ?? "저장 실패");
        setEditSaving(false);
        return;
      }
      setEditTarget(null);
      if (selectedLevelId) loadTemplates(selectedLevelId);
    } catch (e: any) {
      setEditError(e?.message ?? "저장 실패");
    }
    setEditSaving(false);
  };

  // ── override 초기화 ─────────────────────────────────
  const confirmReset = async () => {
    if (!resetTarget?.global_id) return;
    try {
      await apiRequest(token, `/diary-templates/${resetTarget.global_id}/override`, { method: "DELETE" });
    } catch { /* ignore */ }
    setResetTarget(null);
    if (selectedLevelId) loadTemplates(selectedLevelId);
  };

  // ── 신규 추가 ──────────────────────────────────────
  const saveAdd = async () => {
    if (!addText.trim()) { setAddError("내용을 입력해주세요."); return; }
    if (!selectedLevelId) return;
    setAddSaving(true);
    setAddError("");
    try {
      const r = await apiRequest(token, "/diary-templates", {
        method: "POST",
        body: JSON.stringify({ level_id: selectedLevelId, template_text: addText.trim(), title: addTitle.trim() || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setAddError(j.error ?? "저장 실패");
        setAddSaving(false);
        return;
      }
      setAddVisible(false);
      setAddText(""); setAddTitle("");
      loadTemplates(selectedLevelId);
    } catch (e: any) {
      setAddError(e?.message ?? "저장 실패");
    }
    setAddSaving(false);
  };

  // ── 삭제 (teacher 신규 항목만) ──────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(token, `/diary-templates/${deleteTarget.id}`, { method: "DELETE" });
    } catch { /* ignore */ }
    setDeleteTarget(null);
    if (selectedLevelId) loadTemplates(selectedLevelId);
  };

  // ── 항목 분류 ──────────────────────────────────────
  const baseItems  = templates.filter(t => t.global_id !== null && t.global_id !== undefined);
  const myNewItems = templates.filter(t => !t.global_id);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SubScreenHeader title="일지 템플릿" />

      {/* ── 레벨 탭 ── */}
      {levelsLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={C.primary} />
      ) : levels.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyText}>관리자가 설정한 레벨이 없습니다.</Text>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={s.tabRow}>
            {levels.map(lv => (
              <Pressable
                key={lv.id}
                style={[s.tab, selectedLevelId === lv.id && s.tabActive]}
                onPress={() => setSelectedLevelId(lv.id)}
              >
                <Text style={[s.tabText, selectedLevelId === lv.id && s.tabTextActive]}>{lv.level_name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 80 }]}>
            {templatesLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={C.primary} />
            ) : (
              <>
                {/* ── 관리자 원본 (merged) ── */}
                {baseItems.length === 0 ? (
                  <View style={s.emptyBox}>
                    <Text style={s.emptyText}>이 레벨에 등록된 공통 템플릿이 없습니다.</Text>
                  </View>
                ) : (
                  baseItems.map((t, i) => (
                    <View key={t.global_id} style={[s.card, t.is_overridden && s.cardOverridden]}>
                      <View style={s.cardTop}>
                        <Text style={s.cardNum}>{i + 1}</Text>
                        <Text style={s.cardText} numberOfLines={3}>{t.template_text}</Text>
                        <Pressable style={s.editBtn} onPress={() => {
                          setEditTarget(t);
                          setEditText(t.template_text);
                          setEditTitle(t.title ?? "");
                          setEditError("");
                        }}>
                          <Edit2 size={14} color="#64748B" />
                          <Text style={s.editBtnText}>수정</Text>
                        </Pressable>
                      </View>
                      {t.is_overridden && (
                        <View style={s.overriddenRow}>
                          <View style={s.myBadge}><Text style={s.myBadgeText}>내 수정</Text></View>
                          <Pressable style={s.resetBtn} onPress={() => setResetTarget(t)}>
                            <RotateCcw size={11} color="#64748B" />
                            <Text style={s.resetBtnText}>초기화</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ))
                )}

                {/* ── 내가 추가한 항목 ── */}
                {myNewItems.length > 0 && (
                  <>
                    <View style={s.sectionDivider}>
                      <View style={s.sectionLine} />
                      <Text style={s.sectionLabel}>내가 추가한 항목</Text>
                      <View style={s.sectionLine} />
                    </View>
                    {myNewItems.map((t) => (
                      <View key={t.id} style={[s.card, s.cardMine]}>
                        <View style={s.cardTop}>
                          {!!t.title && <Text style={s.cardTitle}>{t.title}</Text>}
                          <Text style={[s.cardText, { flex: 1 }]} numberOfLines={3}>{t.template_text}</Text>
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            <Pressable style={s.editBtn} onPress={() => {
                              setEditTarget(t);
                              setEditText(t.template_text);
                              setEditTitle(t.title ?? "");
                              setEditError("");
                            }}>
                              <Edit2 size={14} color="#64748B" />
                              <Text style={s.editBtnText}>수정</Text>
                            </Pressable>
                            <Pressable style={[s.editBtn, { borderColor: "#FCA5A5" }]} onPress={() => setDeleteTarget(t)}>
                              <Trash2 size={14} color="#EF4444" />
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* ── 신규 추가 FAB ── */}
      {selectedLevelId && (
        <Pressable
          style={[s.fab, { bottom: insets.bottom + 16 }]}
          onPress={() => { setAddVisible(true); setAddText(""); setAddTitle(""); setAddError(""); }}
        >
          <Plus size={20} color="#fff" />
          <Text style={s.fabText}>내 항목 추가</Text>
        </Pressable>
      )}

      {/* ── 수정 모달 ── */}
      <Modal visible={!!editTarget} transparent animationType="fade" onRequestClose={() => setEditTarget(null)}>
        <Pressable style={s.modalOverlay} onPress={() => setEditTarget(null)}>
          <Pressable style={s.modalBox} onPress={e => e.stopPropagation()}>
            <Text style={s.modalTitle}>템플릿 수정</Text>
            {editTarget?.global_id && !editTarget.is_overridden && (
              <Text style={s.modalHint}>수정하면 이 항목만 내 버전으로 저장됩니다.</Text>
            )}
            <TextInput
              style={s.input}
              placeholder="제목 (선택)"
              value={editTitle}
              onChangeText={setEditTitle}
              placeholderTextColor="#94A3B8"
            />
            <TextInput
              style={[s.input, s.textArea]}
              placeholder="내용을 입력하세요"
              value={editText}
              onChangeText={setEditText}
              multiline
              placeholderTextColor="#94A3B8"
            />
            {!!editError && <Text style={s.errorText}>{editError}</Text>}
            <View style={s.modalBtns}>
              <Pressable style={s.cancelBtn} onPress={() => setEditTarget(null)}>
                <Text style={s.cancelBtnText}>취소</Text>
              </Pressable>
              <Pressable style={[s.saveBtn, editSaving && { opacity: 0.6 }]} onPress={saveOverride} disabled={editSaving}>
                {editSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>저장</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 신규 추가 모달 ── */}
      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setAddVisible(false)}>
          <Pressable style={s.modalBox} onPress={e => e.stopPropagation()}>
            <Text style={s.modalTitle}>내 항목 추가</Text>
            <Text style={s.modalHint}>나에게만 표시되는 항목입니다.</Text>
            <TextInput
              style={s.input}
              placeholder="제목 (선택)"
              value={addTitle}
              onChangeText={setAddTitle}
              placeholderTextColor="#94A3B8"
            />
            <TextInput
              style={[s.input, s.textArea]}
              placeholder="내용을 입력하세요"
              value={addText}
              onChangeText={setAddText}
              multiline
              placeholderTextColor="#94A3B8"
            />
            {!!addError && <Text style={s.errorText}>{addError}</Text>}
            <View style={s.modalBtns}>
              <Pressable style={s.cancelBtn} onPress={() => setAddVisible(false)}>
                <Text style={s.cancelBtnText}>취소</Text>
              </Pressable>
              <Pressable style={[s.saveBtn, addSaving && { opacity: 0.6 }]} onPress={saveAdd} disabled={addSaving}>
                {addSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>추가</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── 초기화 확인 ── */}
      <ConfirmModal
        visible={!!resetTarget}
        title="내 수정 초기화"
        message={`이 항목을 관리자 원본으로 되돌립니다.\n내가 수정한 내용은 삭제됩니다.`}
        confirmText="초기화"
        confirmColor="#EF4444"
        onConfirm={confirmReset}
        onCancel={() => setResetTarget(null)}
      />

      {/* ── 삭제 확인 ── */}
      <ConfirmModal
        visible={!!deleteTarget}
        title="항목 삭제"
        message="내가 추가한 이 항목을 삭제합니다."
        confirmText="삭제"
        confirmColor="#EF4444"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  tabScroll:    { flexGrow: 0, flexShrink: 0 },
  tabRow:       { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: "center" },
  tab:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: "#E2E8F0" },
  tabActive:    { backgroundColor: "#2EC4B620", borderColor: "#2EC4B6" },
  tabText:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTextActive:{ color: "#2EC4B6", fontFamily: "Pretendard-SemiBold" },

  listContent:  { paddingHorizontal: 16, paddingTop: 4, gap: 8 },

  card:         { backgroundColor: "#F8FAFC", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  cardOverridden:{ backgroundColor: "#FFF8EC", borderColor: "#FCD34D" },
  cardMine:     { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  cardTop:      { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardNum:      { width: 22, height: 22, borderRadius: 11, backgroundColor: "#E2E8F0", textAlign: "center", lineHeight: 22, fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#64748B" },
  cardTitle:    { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#7C3AED", marginBottom: 2 },
  cardText:     { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 20 },
  editBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff" },
  editBtnText:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  overriddenRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#FDE68A" },
  myBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: "#FCD34D" },
  myBadgeText:  { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#92400E" },
  resetBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#fff" },
  resetBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },

  sectionDivider:{ flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 10 },
  sectionLine:   { flex: 1, height: 1, backgroundColor: "#E2E8F0" },
  sectionLabel:  { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#94A3B8" },

  emptyBox:   { paddingTop: 48, alignItems: "center" },
  emptyText:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8" },

  fab:        { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2EC4B6", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  fabText:    { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalBox:     { width: "100%", backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 12 },
  modalTitle:   { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  modalHint:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  input:        { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  textArea:     { minHeight: 90, textAlignVertical: "top" },
  errorText:    { fontSize: 12, color: "#EF4444", fontFamily: "Pretendard-Regular" },
  modalBtns:    { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn:    { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center" },
  cancelBtnText:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  saveBtn:      { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: "#2EC4B6", alignItems: "center" },
  saveBtnText:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
