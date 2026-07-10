/**
 * (admin)/diary-template-settings.tsx — 일지 템플릿 관리 (관리자)
 *
 * scope=global 템플릿 관리: 레벨 슬롯 (최대 10개) + 레벨별 CRUD
 * SwimNote 기본 템플릿 복원 / 전체 초기화
 */
import {ActivityIndicator, Modal, Platform,
  Pressable, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import React, { useCallback, useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, ChevronUp, Copy, Edit2, Plus, RefreshCcw, Trash2 } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { DiaryTemplateLevel, DiaryTemplate } from "@/components/teacher/diary/types";

const C = Colors.light;
const MAX_LEVELS = 10;

export default function DiaryTemplateSettingsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [levels, setLevels] = useState<DiaryTemplateLevel[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [levelsLoading, setLevelsLoading] = useState(true);

  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [addLevelVisible, setAddLevelVisible] = useState(false);
  const [addLevelText, setAddLevelText] = useState("");
  const [addLevelError, setAddLevelError] = useState("");
  const [addLevelSaving, setAddLevelSaving] = useState(false);

  const [renameLevelVisible, setRenameLevelVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DiaryTemplateLevel | null>(null);
  const [renameLevelText, setRenameLevelText] = useState("");
  const [renameLevelError, setRenameLevelError] = useState("");
  const [renameLevelSaving, setRenameLevelSaving] = useState(false);

  const [levelActionTarget, setLevelActionTarget] = useState<DiaryTemplateLevel | null>(null);
  const [levelActionVisible, setLevelActionVisible] = useState(false);

  const [confirmDeleteLevel, setConfirmDeleteLevel] = useState<DiaryTemplateLevel | null>(null);
  const [confirmClearLevel, setConfirmClearLevel] = useState<DiaryTemplateLevel | null>(null);
  const [confirmRestoreDefault, setConfirmRestoreDefault] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<DiaryTemplate | null>(null);

  const [addTemplateVisible, setAddTemplateVisible] = useState(false);
  const [addTemplateTitle, setAddTemplateTitle] = useState("");
  const [addTemplateText, setAddTemplateText] = useState("");
  const [addTemplateError, setAddTemplateError] = useState("");
  const [addTemplateSaving, setAddTemplateSaving] = useState(false);

  const [editTemplateTarget, setEditTemplateTarget] = useState<DiaryTemplate | null>(null);
  const [editTemplateTitle, setEditTemplateTitle] = useState("");
  const [editTemplateText, setEditTemplateText] = useState("");
  const [editTemplateError, setEditTemplateError] = useState("");
  const [editTemplateSaving, setEditTemplateSaving] = useState(false);

  const loadLevels = useCallback(async (keepSelected?: string) => {
    setLevelsLoading(true);
    try {
      const r = await apiRequest(token, "/diary-template-levels");
      if (r.ok) {
        const data: DiaryTemplateLevel[] = await r.json();
        setLevels(data);
        const target = keepSelected ?? selectedLevelId;
        if (target && data.find(l => l.id === target)) {
          setSelectedLevelId(target);
        } else if (data.length > 0) {
          setSelectedLevelId(data[0].id);
        } else {
          setSelectedLevelId(null);
        }
      }
    } catch {}
    finally { setLevelsLoading(false); }
  }, [token, selectedLevelId]);

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

  async function handleAddLevel() {
    if (!addLevelText.trim()) { setAddLevelError("레벨 이름을 입력해주세요."); return; }
    if (addLevelText.trim().length > 50) { setAddLevelError("레벨 이름은 50자 이내로 입력해주세요."); return; }
    setAddLevelSaving(true);
    try {
      const r = await apiRequest(token, "/diary-template-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_name: addLevelText.trim() }),
      });
      if (r.ok) {
        const data = await r.json();
        setAddLevelText(""); setAddLevelError(""); setAddLevelVisible(false);
        await loadLevels(data.id);
      } else {
        const err = await r.json();
        setAddLevelError(err.error || "레벨 추가에 실패했습니다.");
      }
    } catch { setAddLevelError("서버 오류가 발생했습니다."); }
    finally { setAddLevelSaving(false); }
  }

  async function handleRenameLevel() {
    if (!renameTarget) return;
    if (!renameLevelText.trim()) { setRenameLevelError("레벨 이름을 입력해주세요."); return; }
    if (renameLevelText.trim().length > 50) { setRenameLevelError("레벨 이름은 50자 이내로 입력해주세요."); return; }
    setRenameLevelSaving(true);
    try {
      const r = await apiRequest(token, `/diary-template-levels/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_name: renameLevelText.trim() }),
      });
      if (r.ok) {
        setRenameLevelVisible(false); setRenameTarget(null); setRenameLevelText("");
        await loadLevels(selectedLevelId ?? undefined);
      } else {
        const err = await r.json();
        setRenameLevelError(err.error || "이름 변경에 실패했습니다.");
      }
    } catch { setRenameLevelError("서버 오류가 발생했습니다."); }
    finally { setRenameLevelSaving(false); }
  }

  async function handleDeleteLevel(lv: DiaryTemplateLevel) {
    const r = await apiRequest(token, `/diary-template-levels/${lv.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      const remaining = levels.filter(l => l.id !== lv.id);
      const nextId = selectedLevelId === lv.id ? (remaining[0]?.id ?? null) : selectedLevelId;
      setLevels(remaining);
      setSelectedLevelId(nextId);
      if (nextId) await loadTemplates(nextId);
      else setTemplates([]);
      await loadLevels(nextId ?? undefined);
    }
  }

  async function handleClearLevel(lv: DiaryTemplateLevel) {
    const r = await apiRequest(token, `/diary-template-levels/${lv.id}/clear`, { method: "POST" }).catch(() => null);
    if (r?.ok) {
      if (selectedLevelId === lv.id) setTemplates([]);
      await loadLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleMoveLevel(lv: DiaryTemplateLevel, dir: "up" | "down") {
    const idx = levels.findIndex(l => l.id === lv.id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === levels.length - 1) return;
    const newLevels = [...levels];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    [newLevels[idx], newLevels[swapIdx]] = [newLevels[swapIdx], newLevels[idx]];
    setLevels(newLevels);
    await apiRequest(token, "/diary-template-levels/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: newLevels.map(l => l.id) }),
    }).catch(async () => { await loadLevels(selectedLevelId ?? undefined); });
  }

  async function handleRestoreDefault() {
    const r = await apiRequest(token, "/diary-templates/restore-default", { method: "POST" }).catch(() => null);
    if (r?.ok) {
      setSelectedLevelId(null);
      setTemplates([]);
      setLevelsLoading(true);
      try {
        const lr = await apiRequest(token, "/diary-template-levels");
        if (lr.ok) {
          const data: DiaryTemplateLevel[] = await lr.json();
          setLevels(data);
          if (data.length > 0) {
            setSelectedLevelId(data[0].id);
          }
        }
      } catch {}
      finally { setLevelsLoading(false); }
    }
  }

  async function handleClearAll() {
    const r = await apiRequest(token, "/diary-templates/clear-all", { method: "POST" }).catch(() => null);
    if (r?.ok) {
      if (selectedLevelId) await loadTemplates(selectedLevelId);
      await loadLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleAddTemplate() {
    if (!addTemplateText.trim()) { setAddTemplateError("템플릿 내용을 입력해주세요."); return; }
    if (!selectedLevelId) return;
    setAddTemplateSaving(true);
    try {
      const r = await apiRequest(token, "/diary-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level_id: selectedLevelId,
          title: addTemplateTitle.trim() || null,
          template_text: addTemplateText.trim(),
          sort_order: templates.length,
        }),
      });
      if (r.ok) {
        setAddTemplateVisible(false); setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError("");
        await loadTemplates(selectedLevelId);
        await loadLevels(selectedLevelId);
      } else {
        const err = await r.json();
        setAddTemplateError(err.error || "템플릿 추가에 실패했습니다.");
      }
    } catch { setAddTemplateError("서버 오류가 발생했습니다."); }
    finally { setAddTemplateSaving(false); }
  }

  async function handleEditTemplate() {
    if (!editTemplateTarget) return;
    if (!editTemplateText.trim()) { setEditTemplateError("템플릿 내용을 입력해주세요."); return; }
    setEditTemplateSaving(true);
    try {
      const r = await apiRequest(token, `/diary-templates/${editTemplateTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTemplateTitle.trim() || null, template_text: editTemplateText.trim() }),
      });
      if (r.ok) {
        setEditTemplateTarget(null); setEditTemplateTitle(""); setEditTemplateText(""); setEditTemplateError("");
        if (selectedLevelId) await loadTemplates(selectedLevelId);
      } else {
        const err = await r.json();
        setEditTemplateError(err.error || "수정에 실패했습니다.");
      }
    } catch { setEditTemplateError("서버 오류가 발생했습니다."); }
    finally { setEditTemplateSaving(false); }
  }

  async function handleDeleteTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      setTemplates(prev => prev.filter(x => x.id !== t.id));
      await loadLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleCopyTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}/copy`, { method: "POST" }).catch(() => null);
    if (r?.ok) {
      if (selectedLevelId) await loadTemplates(selectedLevelId);
      await loadLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleToggleTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    }).catch(() => null);
    if (r?.ok) {
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
      await loadLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleMoveTemplate(t: DiaryTemplate, dir: "up" | "down") {
    const idx = templates.findIndex(x => x.id === t.id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === templates.length - 1) return;
    const newT = [...templates];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    [newT[idx], newT[swapIdx]] = [newT[swapIdx], newT[idx]];
    setTemplates(newT);
    if (selectedLevelId) {
      await apiRequest(token, "/diary-templates/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_id: selectedLevelId, ordered_ids: newT.map(x => x.id) }),
      }).catch(async () => { if (selectedLevelId) await loadTemplates(selectedLevelId); });
    }
  }

  const selectedLevel = levels.find(l => l.id === selectedLevelId);
  const levelIdx = levels.findIndex(l => l.id === levelActionTarget?.id);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader
        title="일지 템플릿"
        rightSlot={
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable style={s.resetBtn} onPress={() => setConfirmRestoreDefault(true)}>
              <RefreshCcw size={12} color="#7C3AED" />
              <Text style={[s.resetBtnText, { color: "#7C3AED" }]}>기본 복원</Text>
            </Pressable>
            <Pressable style={[s.resetBtn, { borderColor: "#FECACA" }]} onPress={() => setConfirmClearAll(true)}>
              <Text style={[s.resetBtnText, { color: "#DC2626" }]}>전체 초기화</Text>
            </Pressable>
          </View>
        }
      />

      {levelsLoading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.levelSection}>
            <View style={s.levelSectionHeader}>
              <Text style={s.sectionTitle}>레벨 <Text style={s.sectionCount}>({levels.length}/10)</Text></Text>
              {selectedLevel && (
                <Pressable
                  style={s.levelManageBtn}
                  onPress={() => { setLevelActionTarget(selectedLevel); setLevelActionVisible(true); }}
                >
                  <Text style={s.levelManageBtnText}>레벨 관리</Text>
                </Pressable>
              )}
            </View>

            {levels.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>레벨이 없습니다.</Text>
                <Text style={s.emptySubText}>"기본 복원" 버튼으로 SwimNote 기본 템플릿을 불러오세요.</Text>
                <Pressable
                  style={[s.addLevelBtn, { borderColor: C.tint, marginTop: 12 }]}
                  onPress={() => { setAddLevelText("레벨 1"); setAddLevelError(""); setAddLevelVisible(true); }}
                >
                  <Plus size={14} color={C.tint} />
                  <Text style={[s.addLevelBtnText, { color: C.tint }]}>레벨 추가</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.levelGrid}>
                {levels.map((lv) => (
                  <LevelChip
                    key={lv.id}
                    lv={lv}
                    selected={lv.id === selectedLevelId}
                    onSelect={() => setSelectedLevelId(lv.id)}
                    onLongPress={() => { setLevelActionTarget(lv); setLevelActionVisible(true); }}
                  />
                ))}
                {levels.length < MAX_LEVELS && (
                  <Pressable
                    style={s.addChip}
                    onPress={() => { setAddLevelText(`레벨 ${levels.length + 1}`); setAddLevelError(""); setAddLevelVisible(true); }}
                  >
                    <Plus size={13} color={C.textMuted} />
                    <Text style={s.addChipText}>추가</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {selectedLevel && (
            <>
              <View style={s.divider} />
              <View style={s.templateSection}>
                <View style={s.templateSectionHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.sectionTitle}>{selectedLevel.level_name}</Text>
                    <Text style={s.sectionCount}>({templates.length}개)</Text>
                  </View>
                  <Pressable
                    style={s.addTemplateBtn}
                    onPress={() => { setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError(""); setAddTemplateVisible(true); }}
                  >
                    <Plus size={13} color={C.tint} />
                    <Text style={s.addTemplateBtnText}>추가</Text>
                  </Pressable>
                </View>

                {templatesLoading ? (
                  <ActivityIndicator color={C.tint} style={{ marginTop: 24 }} />
                ) : templates.length === 0 ? (
                  <View style={s.emptyBox}>
                    <Text style={s.emptyText}>템플릿이 없습니다.</Text>
                    <Text style={s.emptySubText}>"추가" 버튼으로 템플릿을 만들어보세요.</Text>
                  </View>
                ) : (
                  <View style={s.templateList}>
                    {templates.map((t, idx) => (
                      <TemplateItem
                        key={t.id}
                        template={t}
                        isFirst={idx === 0}
                        isLast={idx === templates.length - 1}
                        onToggle={() => handleToggleTemplate(t)}
                        onCopy={() => handleCopyTemplate(t)}
                        onEdit={() => {
                          setEditTemplateTarget(t);
                          setEditTemplateTitle(t.title ?? "");
                          setEditTemplateText(t.template_text);
                          setEditTemplateError("");
                        }}
                        onDelete={() => setConfirmDeleteTemplate(t)}
                        onMoveUp={() => handleMoveTemplate(t, "up")}
                        onMoveDown={() => handleMoveTemplate(t, "down")}
                      />
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </KeyboardAwareScrollView>
      )}

      <InputModal
        visible={addLevelVisible}
        title="레벨 추가"
        label="레벨 이름"
        value={addLevelText}
        onChange={setAddLevelText}
        error={addLevelError}
        saving={addLevelSaving}
        onClose={() => setAddLevelVisible(false)}
        onConfirm={handleAddLevel}
        maxLength={50}
      />

      <InputModal
        visible={renameLevelVisible}
        title="이름 변경"
        label="새 레벨 이름"
        value={renameLevelText}
        onChange={setRenameLevelText}
        error={renameLevelError}
        saving={renameLevelSaving}
        onClose={() => setRenameLevelVisible(false)}
        onConfirm={handleRenameLevel}
        maxLength={50}
      />

      <LevelActionModal
        visible={levelActionVisible}
        level={levelActionTarget}
        isFirst={levelIdx === 0}
        isLast={levelIdx === levels.length - 1}
        canDelete={levels.length > 1}
        onClose={() => setLevelActionVisible(false)}
        onRename={() => {
          if (!levelActionTarget) return;
          setRenameLevelText(levelActionTarget.level_name);
          setRenameLevelError("");
          setRenameTarget(levelActionTarget);
          setLevelActionVisible(false);
          setRenameLevelVisible(true);
        }}
        onClear={() => { setConfirmClearLevel(levelActionTarget); setLevelActionVisible(false); }}
        onDelete={() => { setConfirmDeleteLevel(levelActionTarget); setLevelActionVisible(false); }}
        onMoveUp={() => { if (levelActionTarget) handleMoveLevel(levelActionTarget, "up"); setLevelActionVisible(false); }}
        onMoveDown={() => { if (levelActionTarget) handleMoveLevel(levelActionTarget, "down"); setLevelActionVisible(false); }}
      />

      <ConfirmModal
        visible={!!confirmDeleteLevel}
        title="레벨 삭제"
        message={`"${confirmDeleteLevel?.level_name}" 레벨과 하위 템플릿 ${confirmDeleteLevel?.template_count}개가 모두 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제"
        cancelText="취소"
        onConfirm={async () => { if (confirmDeleteLevel) { await handleDeleteLevel(confirmDeleteLevel); setConfirmDeleteLevel(null); } }}
        onCancel={() => setConfirmDeleteLevel(null)}
      />

      <ConfirmModal
        visible={!!confirmClearLevel}
        title="레벨 비우기"
        message={`"${confirmClearLevel?.level_name}" 레벨의 템플릿 ${confirmClearLevel?.template_count}개가 모두 삭제됩니다.\n레벨 이름은 유지됩니다.`}
        confirmText="비우기"
        cancelText="취소"
        onConfirm={async () => { if (confirmClearLevel) { await handleClearLevel(confirmClearLevel); setConfirmClearLevel(null); } }}
        onCancel={() => setConfirmClearLevel(null)}
      />

      <ConfirmModal
        visible={confirmRestoreDefault}
        title="SwimNote 기본 템플릿 복원"
        message={"기본 템플릿으로 복원합니다.\n복원 완료까지 10~20초 정도 소요될 수 있습니다.\n\n이 작업은 되돌릴 수 없습니다."}
        confirmText="복원"
        cancelText="취소"
        onConfirm={async () => { await handleRestoreDefault(); setConfirmRestoreDefault(false); }}
        onCancel={() => setConfirmRestoreDefault(false)}
      />

      <ConfirmModal
        visible={confirmClearAll}
        title="전체 초기화"
        message={"레벨 구조는 유지되고\n모든 템플릿이 삭제됩니다.\n\n이 작업은 되돌릴 수 없습니다."}
        confirmText="초기화"
        cancelText="취소"
        onConfirm={async () => { await handleClearAll(); setConfirmClearAll(false); }}
        onCancel={() => setConfirmClearAll(false)}
      />

      <ConfirmModal
        visible={!!confirmDeleteTemplate}
        title="템플릿 삭제"
        message={"이 템플릿을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."}
        confirmText="삭제"
        cancelText="취소"
        onConfirm={async () => { if (confirmDeleteTemplate) { await handleDeleteTemplate(confirmDeleteTemplate); setConfirmDeleteTemplate(null); } }}
        onCancel={() => setConfirmDeleteTemplate(null)}
      />

      <TemplateInputModal
        visible={addTemplateVisible}
        title="템플릿 추가"
        titleValue={addTemplateTitle}
        textValue={addTemplateText}
        onTitleChange={setAddTemplateTitle}
        onTextChange={setAddTemplateText}
        error={addTemplateError}
        saving={addTemplateSaving}
        onClose={() => setAddTemplateVisible(false)}
        onConfirm={handleAddTemplate}
      />

      <TemplateInputModal
        visible={!!editTemplateTarget}
        title="템플릿 수정"
        titleValue={editTemplateTitle}
        textValue={editTemplateText}
        onTitleChange={setEditTemplateTitle}
        onTextChange={setEditTemplateText}
        error={editTemplateError}
        saving={editTemplateSaving}
        onClose={() => setEditTemplateTarget(null)}
        onConfirm={handleEditTemplate}
      />
    </View>
  );
}

function LevelChip({
  lv, selected, onSelect, onLongPress,
}: { lv: DiaryTemplateLevel; selected: boolean; onSelect: () => void; onLongPress: () => void }) {
  return (
    <Pressable
      style={[s.levelChip, selected && s.levelChipSelected]}
      onPress={onSelect}
      onLongPress={onLongPress}
      delayLongPress={400}
    >
      <Text style={[s.levelChipName, selected && { color: C.tint }]} numberOfLines={1}>{lv.level_name}</Text>
      <Text style={[s.levelChipCount, selected && { color: C.tint + "CC" }]}>({lv.template_count})</Text>
    </Pressable>
  );
}

function TemplateItem({
  template, isFirst, isLast, onToggle, onCopy, onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  template: DiaryTemplate; isFirst: boolean; isLast: boolean;
  onToggle: () => void; onCopy: () => void; onEdit: () => void;
  onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  return (
    <View style={[s.templateItem, !template.is_active && s.templateItemInactive]}>
      <View style={s.templateItemLeft}>
        <Switch
          value={template.is_active}
          onValueChange={onToggle}
          trackColor={{ false: C.border, true: C.tint }}
          thumbColor="#fff"
          style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
        />
      </View>
      <View style={s.templateItemCenter}>
        {!!template.title && (
          <Text style={[s.templateTitle, !template.is_active && { color: C.textMuted }]} numberOfLines={1}>
            {template.title}
          </Text>
        )}
        <Text
          style={[s.templateContent, !template.is_active && { color: C.textMuted }]}
          numberOfLines={2}
        >
          {template.template_text}
        </Text>
      </View>
      <View style={s.templateItemRight}>
        <View style={s.orderBtns}>
          <Pressable
            style={[s.orderBtn, isFirst && { opacity: 0.25 }]}
            onPress={onMoveUp}
            disabled={isFirst}
            hitSlop={6}
          >
            <ChevronUp size={13} color={C.textSecondary} />
          </Pressable>
          <Pressable
            style={[s.orderBtn, isLast && { opacity: 0.25 }]}
            onPress={onMoveDown}
            disabled={isLast}
            hitSlop={6}
          >
            <ChevronDown size={13} color={C.textSecondary} />
          </Pressable>
        </View>
        <View style={s.actionBtns}>
          <Pressable style={s.actionBtn} onPress={onCopy} hitSlop={6}>
            <Copy size={13} color={C.textSecondary} />
          </Pressable>
          <Pressable style={s.actionBtn} onPress={onEdit} hitSlop={6}>
            <Edit2 size={13} color={C.tint} />
          </Pressable>
          <Pressable style={s.actionBtn} onPress={onDelete} hitSlop={6}>
            <Trash2 size={13} color="#D96C6C" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function InputModal({
  visible, title, label, value, onChange, error, saving, onClose, onConfirm, maxLength,
}: {
  visible: boolean; title: string; label: string; value: string;
  onChange: (v: string) => void; error: string; saving: boolean;
  onClose: () => void; onConfirm: () => void; maxLength: number;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={m.overlay}>
        <View style={m.sheet}>
          <Text style={m.title}>{title}</Text>
          <Text style={m.label}>{label}</Text>
          <TextInput
            style={m.input}
            value={value}
            onChangeText={onChange}
            placeholder="이름 입력"
            placeholderTextColor={C.textMuted}
            maxLength={maxLength}
            autoFocus
          />
          {!!error && <Text style={m.error}>{error}</Text>}
          <View style={m.btnRow}>
            <Pressable style={[m.btn, { borderColor: C.border }]} onPress={onClose}>
              <Text style={m.btnCancelText}>취소</Text>
            </Pressable>
            <Pressable style={[m.btn, { backgroundColor: C.tint }]} onPress={onConfirm} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={m.btnConfirmText}>확인</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LevelActionModal({
  visible, level, isFirst, isLast, canDelete,
  onClose, onRename, onClear, onDelete, onMoveUp, onMoveDown,
}: {
  visible: boolean; level: DiaryTemplateLevel | null;
  isFirst: boolean; isLast: boolean; canDelete: boolean;
  onClose: () => void; onRename: () => void; onClear: () => void;
  onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  if (!level) return null;

  const actions = [
    { label: "이름 변경", icon: "edit-2" as const, color: C.text, onPress: onRename, disabled: false },
    { label: "위로 이동", icon: "chevron-up" as const, color: isFirst ? C.border : C.text, onPress: onMoveUp, disabled: isFirst },
    { label: "아래로 이동", icon: "chevron-down" as const, color: isLast ? C.border : C.text, onPress: onMoveDown, disabled: isLast },
    { label: "레벨 비우기", icon: "trash-2" as const, color: "#D97706", onPress: onClear, disabled: false },
    { label: canDelete ? "레벨 삭제" : "레벨 삭제 (최소 1개)", icon: "trash-2" as const, color: canDelete ? "#D96C6C" : C.border, onPress: onDelete, disabled: !canDelete },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={m.overlay} onPress={onClose}>
        <View style={[m.sheet, { paddingHorizontal: 0, paddingBottom: 0 }]}>
          <Text style={[m.title, { paddingHorizontal: 20, marginBottom: 8 }]}>{level.level_name}</Text>
          {actions.map((action, i) => (
            <Pressable
              key={action.label}
              style={[m.actionRow, i > 0 && m.actionRowBorder, action.disabled && { opacity: 0.35 }]}
              onPress={action.disabled ? undefined : action.onPress}
              disabled={action.disabled}
            >
              <LucideIcon name={action.icon} size={15} color={action.color} />
              <Text style={[m.actionLabel, { color: action.color }]}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[m.actionRow, m.actionRowBorder, { justifyContent: "center" }]} onPress={onClose}>
            <Text style={[m.actionLabel, { color: C.textMuted }]}>닫기</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function TemplateInputModal({
  visible, title, titleValue, textValue, onTitleChange, onTextChange,
  error, saving, onClose, onConfirm,
}: {
  visible: boolean; title: string; titleValue: string; textValue: string;
  onTitleChange: (v: string) => void; onTextChange: (v: string) => void;
  error: string; saving: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <Text style={m.title}>{title}</Text>
            <Text style={m.label}>제목 (선택)</Text>
            <TextInput
              style={m.input}
              value={titleValue}
              onChangeText={onTitleChange}
              placeholder="예: 자유형 연습"
              placeholderTextColor={C.textMuted}
              maxLength={100}
            />
            <Text style={[m.label, { marginTop: 12 }]}>내용 *</Text>
            <TextInput
              style={[m.input, { minHeight: 90, textAlignVertical: "top" }]}
              value={textValue}
              onChangeText={onTextChange}
              placeholder="일지에 삽입될 내용을 입력하세요"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={4}
            />
            {!!error && <Text style={m.error}>{error}</Text>}
            <View style={m.btnRow}>
              <Pressable style={[m.btn, { borderColor: C.border }]} onPress={onClose}>
                <Text style={m.btnCancelText}>취소</Text>
              </Pressable>
              <Pressable style={[m.btn, { backgroundColor: C.tint }]} onPress={onConfirm} disabled={saving}>
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={m.btnConfirmText}>저장</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  levelSection: { padding: 16, paddingBottom: 12 },
  levelSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 0 },
  levelManageBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: C.tint },
  levelManageBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.tint },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  sectionCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  levelGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  levelChip: {
    width: "18%", alignItems: "center", justifyContent: "center",
    paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, minHeight: 54,
  },
  levelChipSelected: { borderColor: C.tint, backgroundColor: "#E6FFFA" },
  levelChipName: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  levelChipCount: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 3 },
  addChip: {
    width: "18%", alignItems: "center", justifyContent: "center",
    paddingVertical: 10, borderRadius: 12, borderWidth: 1.5,
    borderColor: C.border, borderStyle: "dashed", backgroundColor: C.background, gap: 3, minHeight: 54,
  },
  addChipText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyBox: { paddingVertical: 32, paddingHorizontal: 16, alignItems: "center", gap: 6 },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  emptySubText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  addLevelBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  addLevelBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  divider: { height: 1, backgroundColor: C.border },
  templateSection: { padding: 16 },
  templateSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  addTemplateBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, borderWidth: 1.5, borderColor: C.tint },
  addTemplateBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.tint },
  templateList: { gap: 8 },
  templateItem: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.card, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  templateItemInactive: { opacity: 0.55 },
  templateItemLeft: { width: 52, alignItems: "center", justifyContent: "center" },
  templateItemCenter: { flex: 1, gap: 3 },
  templateTitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text },
  templateContent: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  templateItemRight: { alignItems: "flex-end", gap: 5 },
  orderBtns: { flexDirection: "row", gap: 2 },
  orderBtn: {
    width: 22, height: 22, alignItems: "center", justifyContent: "center",
    borderRadius: 6, backgroundColor: C.background, borderWidth: 1, borderColor: C.border,
  },
  actionBtns: { flexDirection: "row", gap: 3 },
  actionBtn: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: C.background },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  resetBtnText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  sheet: {
    backgroundColor: "#fff", borderRadius: 20, padding: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  title: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 16 },
  label: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, backgroundColor: C.background,
  },
  error: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 6 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  btnCancelText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  btnConfirmText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  actionRowBorder: { borderTopWidth: 1, borderTopColor: C.border },
  actionLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
