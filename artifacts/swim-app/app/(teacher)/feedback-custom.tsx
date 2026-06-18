/**
 * (teacher)/feedback-custom.tsx — 일지 템플릿 (선생님)
 *
 * 공통(global scope) 템플릿: 읽기 전용, 복사 가능
 * 내 템플릿(teacher scope): 생성·수정·삭제 가능
 * 레벨 구조는 관리자가 관리 — 선생님은 탭만 사용
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Copy, Edit2, Lock, Plus, Trash2 } from "lucide-react-native";
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

  const [addVisible, setAddVisible] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addText, setAddText] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<DiaryTemplate | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<DiaryTemplate | null>(null);

  const loadLevels = useCallback(async () => {
    setLevelsLoading(true);
    try {
      const r = await apiRequest(token, "/diary-template-levels");
      if (r.ok) {
        const data: DiaryTemplateLevel[] = await r.json();
        setLevels(data);
        setSelectedLevelId(prev => {
          if (prev && data.find(l => l.id === prev)) return prev;
          return data[0]?.id ?? null;
        });
      }
    } catch {}
    finally { setLevelsLoading(false); }
  }, [token]);

  const loadTemplates = useCallback(async (levelId: string) => {
    setTemplatesLoading(true);
    try {
      const r = await apiRequest(token, `/diary-templates?level_id=${levelId}&include_inactive=true`);
      if (r.ok) {
        const data: DiaryTemplate[] = await r.json();
        setTemplates([...data].sort((a, b) => a.sort_order - b.sort_order));
      }
    } catch {}
    finally { setTemplatesLoading(false); }
  }, [token]);

  useEffect(() => { loadLevels(); }, []);
  useEffect(() => {
    if (selectedLevelId) loadTemplates(selectedLevelId);
    else setTemplates([]);
  }, [selectedLevelId]);

  const globalTemplates = templates.filter(t => t.scope !== "teacher");
  const teacherTemplates = templates.filter(t => t.scope === "teacher");

  async function handleAdd() {
    if (!addText.trim()) { setAddError("내용을 입력해주세요."); return; }
    if (!selectedLevelId) return;
    setAddSaving(true);
    try {
      const r = await apiRequest(token, "/diary-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level_id: selectedLevelId,
          title: addTitle.trim() || null,
          template_text: addText.trim(),
          sort_order: teacherTemplates.length,
        }),
      });
      if (r.ok) {
        setAddVisible(false); setAddTitle(""); setAddText(""); setAddError("");
        await loadTemplates(selectedLevelId);
      } else {
        const err = await r.json();
        setAddError(err.error || "추가에 실패했습니다.");
      }
    } catch { setAddError("서버 오류가 발생했습니다."); }
    finally { setAddSaving(false); }
  }

  async function handleCopy(t: DiaryTemplate) {
    if (!selectedLevelId) return;
    const r = await apiRequest(token, `/diary-templates/${t.id}/copy`, { method: "POST" }).catch(() => null);
    if (r?.ok) await loadTemplates(selectedLevelId);
  }

  async function handleEditSave() {
    if (!editTarget) return;
    if (!editText.trim()) { setEditError("내용을 입력해주세요."); return; }
    setEditSaving(true);
    try {
      const r = await apiRequest(token, `/diary-templates/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim() || null,
          template_text: editText.trim(),
        }),
      });
      if (r.ok) {
        setEditTarget(null); setEditTitle(""); setEditText(""); setEditError("");
        if (selectedLevelId) await loadTemplates(selectedLevelId);
      } else {
        const err = await r.json();
        setEditError(err.error || "수정에 실패했습니다.");
      }
    } catch { setEditError("서버 오류가 발생했습니다."); }
    finally { setEditSaving(false); }
  }

  async function handleDelete(t: DiaryTemplate) {
    if (!selectedLevelId) return;
    await apiRequest(token, `/diary-templates/${t.id}`, { method: "DELETE" }).catch(() => null);
    await loadTemplates(selectedLevelId);
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="일지 템플릿" />

      {levelsLoading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : levels.length === 0 ? (
        <View style={s.emptyRoot}>
          <Text style={s.emptyTitle}>레벨이 없습니다</Text>
          <Text style={s.emptySubText}>관리자가 레벨을 등록하면 여기에 표시됩니다.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={s.tabScrollOuter} contentContainerStyle={s.tabRow}
          >
            {levels.map(lv => (
              <Pressable
                key={lv.id}
                style={[s.tab, selectedLevelId === lv.id && s.tabActive]}
                onPress={() => setSelectedLevelId(lv.id)}
              >
                <Text style={[s.tabText, selectedLevelId === lv.id && s.tabTextActive]}>
                  {lv.level_name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {templatesLoading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 32 }} />
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
              showsVerticalScrollIndicator={false}
            >
              {globalTemplates.length > 0 && (
                <View style={s.section}>
                  <View style={s.sectionHeader}>
                    <Lock size={11} color="#94A3B8" />
                    <Text style={s.sectionLabel}>공통 (읽기 전용)</Text>
                  </View>
                  {globalTemplates.map(t => (
                    <View key={t.id} style={s.templateItem}>
                      <View style={s.templateBody}>
                        {!!t.title && <Text style={s.templateTitleGlobal}>{t.title}</Text>}
                        <Text style={s.templateText}>{t.template_text}</Text>
                      </View>
                      <Pressable
                        style={s.iconBtn} hitSlop={8}
                        onPress={() => handleCopy(t)}
                      >
                        <Copy size={15} color="#64748B" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.section}>
                <View style={[s.sectionHeader, { justifyContent: "space-between" }]}>
                  <Text style={s.sectionLabel}>내 템플릿</Text>
                  <Pressable
                    style={s.addBtn}
                    onPress={() => { setAddTitle(""); setAddText(""); setAddError(""); setAddVisible(true); }}
                  >
                    <Plus size={12} color={C.tint} />
                    <Text style={s.addBtnText}>추가</Text>
                  </Pressable>
                </View>

                {teacherTemplates.length === 0 ? (
                  <View style={s.emptySection}>
                    <Text style={s.emptySectionText}>아직 내 템플릿이 없습니다.</Text>
                    <Text style={s.emptySectionSub}>공통 템플릿 복사 또는 직접 추가할 수 있습니다.</Text>
                  </View>
                ) : (
                  teacherTemplates.map(t => (
                    <View key={t.id} style={[s.templateItem, s.templateItemTeacher]}>
                      <View style={s.templateBody}>
                        {!!t.title && <Text style={s.templateTitleTeacher}>{t.title}</Text>}
                        <Text style={s.templateText}>{t.template_text}</Text>
                      </View>
                      <View style={s.iconRow}>
                        <Pressable
                          style={s.iconBtn} hitSlop={8}
                          onPress={() => {
                            setEditTarget(t);
                            setEditTitle(t.title || "");
                            setEditText(t.template_text);
                            setEditError("");
                          }}
                        >
                          <Edit2 size={15} color="#64748B" />
                        </Pressable>
                        <Pressable style={s.iconBtn} hitSlop={8} onPress={() => setConfirmDelete(t)}>
                          <Trash2 size={15} color="#DC2626" />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}
        </>
      )}

      <TemplateModal
        visible={addVisible}
        title="내 템플릿 추가"
        titleValue={addTitle}
        textValue={addText}
        onTitleChange={setAddTitle}
        onTextChange={setAddText}
        error={addError}
        saving={addSaving}
        onClose={() => setAddVisible(false)}
        onConfirm={handleAdd}
      />

      <TemplateModal
        visible={!!editTarget}
        title="템플릿 수정"
        titleValue={editTitle}
        textValue={editText}
        onTitleChange={setEditTitle}
        onTextChange={setEditText}
        error={editError}
        saving={editSaving}
        onClose={() => setEditTarget(null)}
        onConfirm={handleEditSave}
      />

      <ConfirmModal
        visible={!!confirmDelete}
        title="템플릿 삭제"
        message={"이 템플릿을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."}
        confirmText="삭제"
        cancelText="취소"
        onConfirm={async () => { if (confirmDelete) { await handleDelete(confirmDelete); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />
    </View>
  );
}

function TemplateModal({
  visible, title, titleValue, textValue,
  onTitleChange, onTextChange, error, saving, onClose, onConfirm,
}: {
  visible: boolean; title: string;
  titleValue: string; textValue: string;
  onTitleChange: (v: string) => void; onTextChange: (v: string) => void;
  error: string; saving: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={m.overlay} onPress={onClose}>
          <Pressable style={m.card} onPress={() => {}}>
            <Text style={m.title}>{title}</Text>
            <TextInput
              style={m.input}
              placeholder="제목 (선택)"
              placeholderTextColor="#94A3B8"
              value={titleValue}
              onChangeText={onTitleChange}
              maxLength={50}
            />
            <TextInput
              style={[m.input, m.textarea]}
              placeholder="템플릿 내용 *"
              placeholderTextColor="#94A3B8"
              value={textValue}
              onChangeText={onTextChange}
              multiline
              maxLength={500}
            />
            {!!error && <Text style={m.error}>{error}</Text>}
            <View style={m.btnRow}>
              <Pressable style={m.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={m.cancelBtnText}>취소</Text>
              </Pressable>
              <Pressable style={m.confirmBtn} onPress={onConfirm} disabled={saving}>
                <Text style={m.confirmBtnText}>{saving ? "저장 중..." : "저장"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  emptyRoot:           { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle:          { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#0F172A", marginBottom: 8 },
  emptySubText:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8", textAlign: "center" },
  tabScrollOuter:      { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  tabRow:              { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: "center" as const },
  tab:                 { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: "#E2E8F0" },
  tabActive:           { borderColor: Colors.light.tint, backgroundColor: Colors.light.tint + "15" },
  tabText:             { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTextActive:       { color: Colors.light.tint, fontFamily: "Pretendard-SemiBold" },
  section:             { marginBottom: 20 },
  sectionHeader:       { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, marginBottom: 10 },
  sectionLabel:        { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#94A3B8", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  addBtn:              { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.tint },
  addBtnText:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.tint },
  emptySection:        { paddingVertical: 20, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center" as const, gap: 4 },
  emptySectionText:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  emptySectionSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#CBD5E1" },
  templateItem:        { flexDirection: "row" as const, alignItems: "flex-start" as const, padding: 12, borderRadius: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8, gap: 8 },
  templateItemTeacher: { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  templateBody:        { flex: 1, gap: 4 },
  templateTitleGlobal: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: Colors.light.tint },
  templateTitleTeacher:{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#7C3AED" },
  templateText:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 20 },
  iconBtn:             { padding: 4 },
  iconRow:             { flexDirection: "row" as const, gap: 4 },
});

const m = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 24 },
  card:           { backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 12 },
  title:          { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  input:          { borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  textarea:       { minHeight: 100, textAlignVertical: "top" },
  error:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  btnRow:         { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn:      { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: "#E2E8F0", alignItems: "center" },
  cancelBtnText:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  confirmBtn:     { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.light.tint, alignItems: "center" },
  confirmBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
