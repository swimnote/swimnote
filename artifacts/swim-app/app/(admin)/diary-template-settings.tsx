/**
 * (admin)/diary-template-settings.tsx — 일지 템플릿 관리
 *
 * ACTIVE Curriculum 있음 → [교육과정] / [내 템플릿] 탭 UI
 *   - 교육과정: curriculum_items 기반 (read-only browse)
 *   - 내 템플릿: teacher scope diary_templates (기존 CRUD)
 *
 * ACTIVE Curriculum 없음 → 기존 legacy diary_template_levels / diary_templates UI
 */
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import React, { useCallback, useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { apiRequest, useAuth } from "@/context/AuthContext";
import {
  DiaryTemplateLevel, DiaryTemplate,
  CurriculumLevel, CurriculumNode,
  CurriculumLevelsResponse, CurriculumNodesResponse,
} from "@/components/teacher/diary/types";

const C = Colors.light;
const MAX_LEVELS = 10;

// ── 한글 레이블 ──────────────────────────────────────────────────────────────
const STROKE_LABELS: Record<string, string> = {
  general: "공통/물적응", freestyle: "자유형", backstroke: "배영",
  breaststroke: "평영", butterfly: "접영", im: "IM",
};
const DOMAIN_LABELS: Record<string, string> = {
  water_adaptation: "물적응", breathing: "호흡", technique: "기술",
  coordination: "협응", endurance: "지구력",
};

export default function DiaryTemplateSettingsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  // ── 모드 감지 ──────────────────────────────────────────────────────────────
  const [hasCurriculum, setHasCurriculum] = useState<boolean | null>(null); // null=loading

  // ── Curriculum 탭 state ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"curriculum" | "teacher">("curriculum");
  const [curriculumLevels, setCurriculumLevels] = useState<CurriculumLevel[]>([]);
  const [selectedLevelOrder, setSelectedLevelOrder] = useState<number | null>(null);
  const [curriculumNodes, setCurriculumNodes] = useState<CurriculumNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [strokeFilter, setStrokeFilter] = useState<string>("");
  const [availableStrokes, setAvailableStrokes] = useState<{ value: string; label: string }[]>([]);
  const [teacherTemplates, setTeacherTemplates] = useState<DiaryTemplate[]>([]);
  const [teacherTemplatesLoading, setTeacherTemplatesLoading] = useState(false);

  // ── Legacy state ───────────────────────────────────────────────────────────
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

  // ── 초기 로드: curriculum 모드 감지 ─────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const r = await apiRequest(token, "/curriculum/diary/levels");
        if (r.ok) {
          const data: CurriculumLevelsResponse = await r.json();
          if (data.has_curriculum && data.levels.length > 0) {
            setHasCurriculum(true);
            setCurriculumLevels(data.levels);
            setSelectedLevelOrder(data.levels[0]!.level_order);
          } else {
            setHasCurriculum(false);
            await loadLegacyLevels();
          }
        } else {
          setHasCurriculum(false);
          await loadLegacyLevels();
        }
      } catch {
        setHasCurriculum(false);
        await loadLegacyLevels();
      }
    }
    init();
  }, [token]);

  // ── Curriculum nodes 로드 ───────────────────────────────────────────────
  useEffect(() => {
    if (!hasCurriculum || selectedLevelOrder == null) return;
    loadCurriculumNodes(selectedLevelOrder, strokeFilter);
  }, [hasCurriculum, selectedLevelOrder]);

  useEffect(() => {
    if (!hasCurriculum || selectedLevelOrder == null) return;
    loadCurriculumNodes(selectedLevelOrder, strokeFilter);
  }, [strokeFilter]);

  // stroke 목록 로드
  useEffect(() => {
    if (!hasCurriculum || selectedLevelOrder == null) return;
    apiRequest(token, `/curriculum/diary/facets?level_order=${selectedLevelOrder}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAvailableStrokes(data.strokes ?? []); })
      .catch(() => {});
  }, [hasCurriculum, selectedLevelOrder]);

  // teacher templates 로드 (curriculum 탭)
  useEffect(() => {
    if (!hasCurriculum || activeTab !== "teacher") return;
    loadTeacherTemplates();
  }, [hasCurriculum, activeTab]);

  const loadCurriculumNodes = useCallback(async (lo: number, stroke: string) => {
    setNodesLoading(true);
    try {
      const params = new URLSearchParams({ level_order: String(lo), is_test_item: "false", limit: "200" });
      if (stroke) params.set("stroke", stroke);
      const r = await apiRequest(token, `/curriculum/diary/nodes?${params}`);
      if (r.ok) {
        const data: CurriculumNodesResponse = await r.json();
        setCurriculumNodes(data.nodes);
      }
    } catch {}
    finally { setNodesLoading(false); }
  }, [token]);

  const loadTeacherTemplates = useCallback(async () => {
    setTeacherTemplatesLoading(true);
    try {
      const r = await apiRequest(token, "/curriculum/diary/teacher-templates");
      if (r.ok) {
        const data = await r.json();
        setTeacherTemplates(data.templates ?? []);
      }
    } catch {}
    finally { setTeacherTemplatesLoading(false); }
  }, [token]);

  // ── Legacy functions ────────────────────────────────────────────────────
  const loadLegacyLevels = useCallback(async (keepSelected?: string) => {
    setLevelsLoading(true);
    try {
      const r = await apiRequest(token, "/diary-template-levels");
      if (r.ok) {
        const data: DiaryTemplateLevel[] = await r.json();
        setLevels(data);
        const target = keepSelected ?? selectedLevelId;
        if (target && data.find(l => l.id === target)) setSelectedLevelId(target);
        else if (data.length > 0) setSelectedLevelId(data[0]!.id);
        else setSelectedLevelId(null);
      }
    } catch {}
    finally { setLevelsLoading(false); }
  }, [token, selectedLevelId]);

  const loadLegacyTemplates = useCallback(async (levelId: string) => {
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

  useEffect(() => {
    if (hasCurriculum === false) loadLegacyLevels();
  }, [hasCurriculum]);

  useEffect(() => {
    if (hasCurriculum === false && selectedLevelId) loadLegacyTemplates(selectedLevelId);
    else if (hasCurriculum === false) setTemplates([]);
  }, [hasCurriculum, selectedLevelId]);

  // ── Legacy CRUD ─────────────────────────────────────────────────────────
  async function handleAddLevel() {
    if (!addLevelText.trim()) { setAddLevelError("레벨 이름을 입력해주세요."); return; }
    if (addLevelText.trim().length > 50) { setAddLevelError("레벨 이름은 50자 이내로 입력해주세요."); return; }
    setAddLevelSaving(true);
    try {
      const r = await apiRequest(token, "/diary-template-levels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_name: addLevelText.trim() }),
      });
      if (r.ok) {
        const data = await r.json();
        setAddLevelText(""); setAddLevelError(""); setAddLevelVisible(false);
        await loadLegacyLevels(data.id);
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
    setRenameLevelSaving(true);
    try {
      const r = await apiRequest(token, `/diary-template-levels/${renameTarget.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_name: renameLevelText.trim() }),
      });
      if (r.ok) {
        setRenameLevelVisible(false); setRenameTarget(null); setRenameLevelText("");
        await loadLegacyLevels(selectedLevelId ?? undefined);
      } else {
        const err = await r.json(); setRenameLevelError(err.error || "이름 변경에 실패했습니다.");
      }
    } catch { setRenameLevelError("서버 오류가 발생했습니다."); }
    finally { setRenameLevelSaving(false); }
  }

  async function handleDeleteLevel(lv: DiaryTemplateLevel) {
    const r = await apiRequest(token, `/diary-template-levels/${lv.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      const remaining = levels.filter(l => l.id !== lv.id);
      const nextId = selectedLevelId === lv.id ? (remaining[0]?.id ?? null) : selectedLevelId;
      setLevels(remaining); setSelectedLevelId(nextId);
      if (nextId) await loadLegacyTemplates(nextId); else setTemplates([]);
      await loadLegacyLevels(nextId ?? undefined);
    }
  }

  async function handleClearLevel(lv: DiaryTemplateLevel) {
    const r = await apiRequest(token, `/diary-template-levels/${lv.id}/clear`, { method: "POST" }).catch(() => null);
    if (r?.ok) {
      if (selectedLevelId === lv.id) setTemplates([]);
      await loadLegacyLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleMoveLevel(lv: DiaryTemplateLevel, dir: "up" | "down") {
    const idx = levels.findIndex(l => l.id === lv.id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === levels.length - 1) return;
    const newLevels = [...levels];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    [newLevels[idx], newLevels[swapIdx]] = [newLevels[swapIdx]!, newLevels[idx]!];
    setLevels(newLevels);
    await apiRequest(token, "/diary-template-levels/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: newLevels.map(l => l.id) }),
    }).catch(async () => { await loadLegacyLevels(selectedLevelId ?? undefined); });
  }

  async function handleRestoreDefault() {
    const r = await apiRequest(token, "/diary-templates/restore-default", { method: "POST" }).catch(() => null);
    if (r?.ok) {
      setSelectedLevelId(null); setTemplates([]); setLevelsLoading(true);
      try {
        const lr = await apiRequest(token, "/diary-template-levels");
        if (lr.ok) {
          const data: DiaryTemplateLevel[] = await lr.json();
          setLevels(data);
          if (data.length > 0) setSelectedLevelId(data[0]!.id);
        }
      } catch {} finally { setLevelsLoading(false); }
    }
  }

  async function handleClearAll() {
    const r = await apiRequest(token, "/diary-templates/clear-all", { method: "POST" }).catch(() => null);
    if (r?.ok) {
      if (selectedLevelId) await loadLegacyTemplates(selectedLevelId);
      await loadLegacyLevels(selectedLevelId ?? undefined);
    }
  }

  async function handleAddTemplate() {
    if (!addTemplateText.trim()) { setAddTemplateError("템플릿 내용을 입력해주세요."); return; }
    if (!selectedLevelId) return;
    setAddTemplateSaving(true);
    try {
      const r = await apiRequest(token, "/diary-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_id: selectedLevelId, title: addTemplateTitle.trim() || null, template_text: addTemplateText.trim(), sort_order: templates.length }),
      });
      if (r.ok) {
        setAddTemplateVisible(false); setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError("");
        await loadLegacyTemplates(selectedLevelId); await loadLegacyLevels(selectedLevelId);
      } else {
        const err = await r.json(); setAddTemplateError(err.error || "템플릿 추가에 실패했습니다.");
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
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTemplateTitle.trim() || null, template_text: editTemplateText.trim() }),
      });
      if (r.ok) {
        setEditTemplateTarget(null); setEditTemplateTitle(""); setEditTemplateText(""); setEditTemplateError("");
        if (hasCurriculum) await loadTeacherTemplates();
        else if (selectedLevelId) await loadLegacyTemplates(selectedLevelId);
      } else {
        const err = await r.json(); setEditTemplateError(err.error || "수정에 실패했습니다.");
      }
    } catch { setEditTemplateError("서버 오류가 발생했습니다."); }
    finally { setEditTemplateSaving(false); }
  }

  async function handleDeleteTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      if (hasCurriculum) setTeacherTemplates(prev => prev.filter(x => x.id !== t.id));
      else { setTemplates(prev => prev.filter(x => x.id !== t.id)); await loadLegacyLevels(selectedLevelId ?? undefined); }
    }
  }

  async function handleToggleTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    }).catch(() => null);
    if (r?.ok) {
      if (hasCurriculum) setTeacherTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
      else { setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x)); await loadLegacyLevels(selectedLevelId ?? undefined); }
    }
  }

  async function handleMoveTemplate(t: DiaryTemplate, dir: "up" | "down") {
    const list = hasCurriculum ? teacherTemplates : templates;
    const idx = list.findIndex(x => x.id === t.id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === list.length - 1) return;
    const newT = [...list];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    [newT[idx], newT[swapIdx]] = [newT[swapIdx]!, newT[idx]!];
    if (hasCurriculum) setTeacherTemplates(newT);
    else setTemplates(newT);
    await apiRequest(token, "/diary-templates/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level_id: selectedLevelId, ordered_ids: newT.map(x => x.id) }),
    }).catch(async () => {
      if (hasCurriculum) await loadTeacherTemplates();
      else if (selectedLevelId) await loadLegacyTemplates(selectedLevelId);
    });
  }

  // ── 로딩 중 ──────────────────────────────────────────────────────────────
  if (hasCurriculum === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="일지 템플릿" />
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      </View>
    );
  }

  // ── CURRICULUM 모드 ──────────────────────────────────────────────────────
  if (hasCurriculum) {
    const selectedLevel = curriculumLevels.find(l => l.level_order === selectedLevelOrder);

    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="일지 템플릿" />

        {/* 탭 */}
        <View style={cs.tabRow}>
          <Pressable
            style={[cs.tab, activeTab === "curriculum" && cs.tabActive]}
            onPress={() => setActiveTab("curriculum")}
          >
            <Text style={[cs.tabText, activeTab === "curriculum" && cs.tabTextActive]}>교육과정</Text>
          </Pressable>
          <Pressable
            style={[cs.tab, activeTab === "teacher" && cs.tabActive]}
            onPress={() => setActiveTab("teacher")}
          >
            <Text style={[cs.tabText, activeTab === "teacher" && cs.tabTextActive]}>
              내 템플릿 ({teacherTemplates.length})
            </Text>
          </Pressable>
        </View>

        {activeTab === "curriculum" ? (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
            {/* Level chips */}
            <View style={{ padding: 16, paddingBottom: 8 }}>
              <Text style={cs.sectionLabel}>레벨 선택</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {curriculumLevels.map(lv => (
                    <Pressable
                      key={lv.level_order}
                      style={[cs.levelChip, selectedLevelOrder === lv.level_order && cs.levelChipActive]}
                      onPress={() => { setSelectedLevelOrder(lv.level_order); setStrokeFilter(""); }}
                    >
                      <Text style={[cs.levelChipText, selectedLevelOrder === lv.level_order && cs.levelChipTextActive]} numberOfLines={1}>
                        {lv.level_name}
                      </Text>
                      <Text style={[cs.levelChipCount, selectedLevelOrder === lv.level_order && { color: C.brandStrong + "CC" }]}>
                        ({lv.node_count})
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Stroke filter */}
            {availableStrokes.length > 1 && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable
                      style={[cs.filterChip, !strokeFilter && cs.filterChipActive]}
                      onPress={() => setStrokeFilter("")}
                    >
                      <Text style={[cs.filterChipText, !strokeFilter && cs.filterChipTextActive]}>전체</Text>
                    </Pressable>
                    {availableStrokes.map(s => (
                      <Pressable
                        key={s.value}
                        style={[cs.filterChip, strokeFilter === s.value && cs.filterChipActive]}
                        onPress={() => setStrokeFilter(s.value)}
                      >
                        <Text style={[cs.filterChipText, strokeFilter === s.value && cs.filterChipTextActive]}>
                          {s.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Node list */}
            <View style={{ paddingHorizontal: 16 }}>
              <View style={cs.nodeListHeader}>
                <Text style={cs.sectionLabel}>
                  {selectedLevel?.level_name} — {curriculumNodes.length}개 노드
                </Text>
                <Text style={cs.subLabel}>read-only · AI 일지 검색에 사용됨</Text>
              </View>

              {nodesLoading ? (
                <ActivityIndicator color={C.brandStrong} style={{ marginTop: 24 }} />
              ) : curriculumNodes.length === 0 ? (
                <View style={cs.empty}>
                  <Text style={cs.emptyText}>해당 조건의 노드가 없습니다.</Text>
                </View>
              ) : (
                <View style={cs.nodeList}>
                  {curriculumNodes.map(node => (
                    <CurriculumNodeCard key={node.id} node={node} />
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          /* 내 템플릿 탭 */
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
            <View style={{ padding: 16 }}>
              <View style={cs.nodeListHeader}>
                <Text style={cs.sectionLabel}>내 템플릿</Text>
                <Pressable
                  style={cs.addBtn}
                  onPress={() => { setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError(""); setAddTemplateVisible(true); }}
                >
                  <LucideIcon name="plus" size={13} color={C.brandStrong} />
                  <Text style={cs.addBtnText}>추가</Text>
                </Pressable>
              </View>
              <Text style={cs.subLabel}>Curriculum 노드와 별개로 내가 만든 문장 템플릿</Text>

              {teacherTemplatesLoading ? (
                <ActivityIndicator color={C.brandStrong} style={{ marginTop: 24 }} />
              ) : teacherTemplates.length === 0 ? (
                <View style={cs.empty}>
                  <Text style={cs.emptyText}>등록된 내 템플릿이 없습니다.</Text>
                  <Text style={cs.emptySubText}>"추가" 버튼으로 자주 쓰는 문장을 저장해보세요.</Text>
                </View>
              ) : (
                <View style={s.templateList}>
                  {teacherTemplates.map((t, idx) => (
                    <TemplateItem
                      key={t.id}
                      template={t}
                      isFirst={idx === 0}
                      isLast={idx === teacherTemplates.length - 1}
                      onToggle={() => handleToggleTemplate(t)}
                      onCopy={() => {}}
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
          </ScrollView>
        )}

        {/* Modals */}
        <TemplateInputModal
          visible={addTemplateVisible}
          title="내 템플릿 추가"
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
        <ConfirmModal
          visible={!!confirmDeleteTemplate}
          title="템플릿 삭제"
          message={"이 템플릿을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."}
          confirmText="삭제"
          cancelText="취소"
          onConfirm={async () => { if (confirmDeleteTemplate) { await handleDeleteTemplate(confirmDeleteTemplate); setConfirmDeleteTemplate(null); } }}
          onCancel={() => setConfirmDeleteTemplate(null)}
        />
      </View>
    );
  }

  // ── LEGACY 모드 ──────────────────────────────────────────────────────────
  const selectedLevel = levels.find(l => l.id === selectedLevelId);
  const levelIdx = levels.findIndex(l => l.id === levelActionTarget?.id);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader
        title="일지 템플릿"
        rightSlot={
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable style={s.resetBtn} onPress={() => setConfirmRestoreDefault(true)}>
              <LucideIcon name="refresh-ccw" size={12} color="#7C3AED" />
              <Text style={[s.resetBtnText, { color: "#7C3AED" }]}>기본 복원</Text>
            </Pressable>
            <Pressable style={[s.resetBtn, { borderColor: "#FECACA" }]} onPress={() => setConfirmClearAll(true)}>
              <Text style={[s.resetBtnText, { color: "#DC2626" }]}>전체 초기화</Text>
            </Pressable>
          </View>
        }
      />

      {levelsLoading ? (
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.levelSection}>
            <View style={s.levelSectionHeader}>
              <Text style={s.sectionTitle}>레벨 <Text style={s.sectionCount}>({levels.length}/10)</Text></Text>
              {selectedLevel && (
                <Pressable style={s.levelManageBtn} onPress={() => { setLevelActionTarget(selectedLevel); setLevelActionVisible(true); }}>
                  <Text style={s.levelManageBtnText}>레벨 관리</Text>
                </Pressable>
              )}
            </View>

            {levels.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>레벨이 없습니다.</Text>
                <Text style={s.emptySubText}>"기본 복원" 버튼으로 SwimNote 기본 템플릿을 불러오세요.</Text>
                <Pressable
                  style={[s.addLevelBtn, { borderColor: C.brandStrong, marginTop: 12 }]}
                  onPress={() => { setAddLevelText("레벨 1"); setAddLevelError(""); setAddLevelVisible(true); }}
                >
                  <LucideIcon name="plus" size={14} color={C.brandStrong} />
                  <Text style={[s.addLevelBtnText, { color: C.brandStrong }]}>레벨 추가</Text>
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
                    <LucideIcon name="plus" size={13} color={C.textMuted} />
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
                  <Pressable style={s.addTemplateBtn} onPress={() => { setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError(""); setAddTemplateVisible(true); }}>
                    <LucideIcon name="plus" size={13} color={C.brandStrong} />
                    <Text style={s.addTemplateBtnText}>추가</Text>
                  </Pressable>
                </View>

                {templatesLoading ? (
                  <ActivityIndicator color={C.brandStrong} style={{ marginTop: 24 }} />
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
                        onCopy={async () => {
                          const r = await apiRequest(token, `/diary-templates/${t.id}/copy`, { method: "POST" }).catch(() => null);
                          if (r?.ok) { await loadLegacyTemplates(selectedLevelId!); await loadLegacyLevels(selectedLevelId!); }
                        }}
                        onEdit={() => { setEditTemplateTarget(t); setEditTemplateTitle(t.title ?? ""); setEditTemplateText(t.template_text); setEditTemplateError(""); }}
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
        visible={addLevelVisible} title="레벨 추가" label="레벨 이름" value={addLevelText}
        onChange={setAddLevelText} error={addLevelError} saving={addLevelSaving}
        onClose={() => setAddLevelVisible(false)} onConfirm={handleAddLevel} maxLength={50}
      />
      <InputModal
        visible={renameLevelVisible} title="이름 변경" label="새 레벨 이름" value={renameLevelText}
        onChange={setRenameLevelText} error={renameLevelError} saving={renameLevelSaving}
        onClose={() => setRenameLevelVisible(false)} onConfirm={handleRenameLevel} maxLength={50}
      />
      <LevelActionModal
        visible={levelActionVisible} level={levelActionTarget}
        isFirst={levelIdx === 0} isLast={levelIdx === levels.length - 1} canDelete={levels.length > 1}
        onClose={() => setLevelActionVisible(false)}
        onRename={() => { if (!levelActionTarget) return; setRenameLevelText(levelActionTarget.level_name); setRenameLevelError(""); setRenameTarget(levelActionTarget); setLevelActionVisible(false); setRenameLevelVisible(true); }}
        onClear={() => { setConfirmClearLevel(levelActionTarget); setLevelActionVisible(false); }}
        onDelete={() => { setConfirmDeleteLevel(levelActionTarget); setLevelActionVisible(false); }}
        onMoveUp={() => { if (levelActionTarget) handleMoveLevel(levelActionTarget, "up"); setLevelActionVisible(false); }}
        onMoveDown={() => { if (levelActionTarget) handleMoveLevel(levelActionTarget, "down"); setLevelActionVisible(false); }}
      />
      <ConfirmModal
        visible={!!confirmDeleteLevel} title="레벨 삭제"
        message={`"${confirmDeleteLevel?.level_name}" 레벨과 하위 템플릿 ${confirmDeleteLevel?.template_count}개가 모두 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제" cancelText="취소"
        onConfirm={async () => { if (confirmDeleteLevel) { await handleDeleteLevel(confirmDeleteLevel); setConfirmDeleteLevel(null); } }}
        onCancel={() => setConfirmDeleteLevel(null)}
      />
      <ConfirmModal
        visible={!!confirmClearLevel} title="레벨 비우기"
        message={`"${confirmClearLevel?.level_name}" 레벨의 템플릿 ${confirmClearLevel?.template_count}개가 모두 삭제됩니다.\n레벨 이름은 유지됩니다.`}
        confirmText="비우기" cancelText="취소"
        onConfirm={async () => { if (confirmClearLevel) { await handleClearLevel(confirmClearLevel); setConfirmClearLevel(null); } }}
        onCancel={() => setConfirmClearLevel(null)}
      />
      <ConfirmModal
        visible={confirmRestoreDefault} title="SwimNote 기본 템플릿 복원"
        message={"기본 템플릿으로 복원합니다.\n복원 완료까지 10~20초 정도 소요될 수 있습니다.\n\n이 작업은 되돌릴 수 없습니다."}
        confirmText="복원" cancelText="취소"
        onConfirm={async () => { await handleRestoreDefault(); setConfirmRestoreDefault(false); }}
        onCancel={() => setConfirmRestoreDefault(false)}
      />
      <ConfirmModal
        visible={confirmClearAll} title="전체 초기화"
        message={"레벨 구조는 유지되고\n모든 템플릿이 삭제됩니다.\n\n이 작업은 되돌릴 수 없습니다."}
        confirmText="초기화" cancelText="취소"
        onConfirm={async () => { await handleClearAll(); setConfirmClearAll(false); }}
        onCancel={() => setConfirmClearAll(false)}
      />
      <ConfirmModal
        visible={!!confirmDeleteTemplate} title="템플릿 삭제"
        message={"이 템플릿을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."}
        confirmText="삭제" cancelText="취소"
        onConfirm={async () => { if (confirmDeleteTemplate) { await handleDeleteTemplate(confirmDeleteTemplate); setConfirmDeleteTemplate(null); } }}
        onCancel={() => setConfirmDeleteTemplate(null)}
      />
      <TemplateInputModal
        visible={addTemplateVisible} title="템플릿 추가"
        titleValue={addTemplateTitle} textValue={addTemplateText}
        onTitleChange={setAddTemplateTitle} onTextChange={setAddTemplateText}
        error={addTemplateError} saving={addTemplateSaving}
        onClose={() => setAddTemplateVisible(false)} onConfirm={handleAddTemplate}
      />
      <TemplateInputModal
        visible={!!editTemplateTarget} title="템플릿 수정"
        titleValue={editTemplateTitle} textValue={editTemplateText}
        onTitleChange={setEditTemplateTitle} onTextChange={setEditTemplateText}
        error={editTemplateError} saving={editTemplateSaving}
        onClose={() => setEditTemplateTarget(null)} onConfirm={handleEditTemplate}
      />
    </View>
  );
}

// ── Curriculum Node Card ──────────────────────────────────────────────────────

function CurriculumNodeCard({ node }: { node: CurriculumNode }) {
  const strokeLabel = STROKE_LABELS[node.stroke] ?? node.stroke;
  const domainLabel = DOMAIN_LABELS[node.domain] ?? node.domain;
  return (
    <View style={cs.nodeCard}>
      <View style={cs.nodeCardHeader}>
        <Text style={cs.nodeDisplayNo}>{node.display_no}</Text>
        <View style={cs.nodeTagRow}>
          <Text style={cs.nodeTag}>{strokeLabel}</Text>
          <Text style={cs.nodeTag}>{domainLabel}</Text>
        </View>
      </View>
      <Text style={cs.nodeTitle} numberOfLines={2}>{node.title || node.atomic_skill}</Text>
      {!!node.source_trace && (
        <Text style={cs.nodeTrace} numberOfLines={3}>{node.source_trace}</Text>
      )}
    </View>
  );
}

// ── Shared subcomponents ──────────────────────────────────────────────────────

function LevelChip({
  lv, selected, onSelect, onLongPress,
}: { lv: DiaryTemplateLevel; selected: boolean; onSelect: () => void; onLongPress: () => void }) {
  return (
    <Pressable
      style={[s.levelChip, selected && s.levelChipSelected]}
      onPress={onSelect} onLongPress={onLongPress} delayLongPress={400}
    >
      <Text style={[s.levelChipName, selected && { color: C.brandStrong }]} numberOfLines={1}>{lv.level_name}</Text>
      <Text style={[s.levelChipCount, selected && { color: C.brandStrong + "CC" }]}>({lv.template_count})</Text>
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
        <Switch value={template.is_active} onValueChange={onToggle} trackColor={{ false: C.border, true: C.brandStrong }} thumbColor="#fff" style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }} />
      </View>
      <View style={s.templateItemCenter}>
        {!!template.title && <Text style={[s.templateTitle, !template.is_active && { color: C.textMuted }]} numberOfLines={1}>{template.title}</Text>}
        <Text style={[s.templateContent, !template.is_active && { color: C.textMuted }]} numberOfLines={2}>{template.template_text}</Text>
      </View>
      <View style={s.templateItemRight}>
        <View style={s.orderBtns}>
          <Pressable style={[s.orderBtn, isFirst && { opacity: 0.25 }]} onPress={onMoveUp} disabled={isFirst} hitSlop={6}><LucideIcon name="chevron-up" size={13} color={C.textSecondary} /></Pressable>
          <Pressable style={[s.orderBtn, isLast && { opacity: 0.25 }]} onPress={onMoveDown} disabled={isLast} hitSlop={6}><LucideIcon name="chevron-down" size={13} color={C.textSecondary} /></Pressable>
        </View>
        <View style={s.actionBtns}>
          <Pressable style={s.actionBtn} onPress={onCopy} hitSlop={6}><LucideIcon name="copy" size={13} color={C.textSecondary} /></Pressable>
          <Pressable style={s.actionBtn} onPress={onEdit} hitSlop={6}><LucideIcon name="edit-2" size={13} color={C.brandStrong} /></Pressable>
          <Pressable style={s.actionBtn} onPress={onDelete} hitSlop={6}><LucideIcon name="trash-2" size={13} color="#D96C6C" /></Pressable>
        </View>
      </View>
    </View>
  );
}

function InputModal({ visible, title, label, value, onChange, error, saving, onClose, onConfirm, maxLength }: {
  visible: boolean; title: string; label: string; value: string;
  onChange: (v: string) => void; error: string; saving: boolean;
  onClose: () => void; onConfirm: () => void; maxLength: number;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <Text style={m.title}>{title}</Text>
            <Text style={m.label}>{label}</Text>
            <TextInput style={m.input} value={value} onChangeText={onChange} placeholder="이름 입력" placeholderTextColor={C.textMuted} maxLength={maxLength} autoFocus />
            {!!error && <Text style={m.error}>{error}</Text>}
            <View style={m.btnRow}>
              <Pressable style={[m.btn, { borderColor: C.border }]} onPress={onClose}><Text style={m.btnCancelText}>취소</Text></Pressable>
              <Pressable style={[m.btn, { backgroundColor: C.primaryAction }]} onPress={onConfirm} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnConfirmText}>확인</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function LevelActionModal({ visible, level, isFirst, isLast, canDelete, onClose, onRename, onClear, onDelete, onMoveUp, onMoveDown }: {
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
            <Pressable key={action.label} style={[m.actionRow, i > 0 && m.actionRowBorder, action.disabled && { opacity: 0.35 }]} onPress={action.disabled ? undefined : action.onPress} disabled={action.disabled}>
              <LucideIcon name={action.icon} size={15} color={action.color} />
              <Text style={[m.actionLabel, { color: action.color }]}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[m.actionRow, m.actionRowBorder, { justifyContent: "center" }]} onPress={onClose}><Text style={[m.actionLabel, { color: C.textMuted }]}>닫기</Text></Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function TemplateInputModal({ visible, title, titleValue, textValue, onTitleChange, onTextChange, error, saving, onClose, onConfirm }: {
  visible: boolean; title: string; titleValue: string; textValue: string;
  onTitleChange: (v: string) => void; onTextChange: (v: string) => void;
  error: string; saving: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <Text style={m.title}>{title}</Text>
            <Text style={m.label}>제목 (선택)</Text>
            <TextInput style={m.input} value={titleValue} onChangeText={onTitleChange} placeholder="예: 자유형 연습" placeholderTextColor={C.textMuted} maxLength={100} />
            <Text style={[m.label, { marginTop: 12 }]}>내용 *</Text>
            <TextInput style={[m.input, { minHeight: 90, textAlignVertical: "top" }]} value={textValue} onChangeText={onTextChange} placeholder="일지에 삽입될 내용을 입력하세요" placeholderTextColor={C.textMuted} multiline numberOfLines={4} />
            {!!error && <Text style={m.error}>{error}</Text>}
            <View style={m.btnRow}>
              <Pressable style={[m.btn, { borderColor: C.border }]} onPress={onClose}><Text style={m.btnCancelText}>취소</Text></Pressable>
              <Pressable style={[m.btn, { backgroundColor: C.primaryAction }]} onPress={onConfirm} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnConfirmText}>저장</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Curriculum styles ─────────────────────────────────────────────────────────
const cs = StyleSheet.create({
  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.brandStrong },
  tabText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  tabTextActive: { color: C.brandStrong, fontFamily: "Pretendard-Regular" },
  sectionLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  subLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  levelChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card,
  },
  levelChipActive: { borderColor: C.brandStrong, backgroundColor: C.brandSoft },
  levelChipText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  levelChipTextActive: { color: C.brandStrong },
  levelChipCount: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  filterChipActive: { borderColor: C.brandStrong, backgroundColor: C.brandSoft },
  filterChipText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  filterChipTextActive: { color: C.brandStrong },
  nodeListHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4, marginTop: 8 },
  nodeList: { gap: 8, marginTop: 8 },
  nodeCard: { backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  nodeCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  nodeDisplayNo: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  nodeTagRow: { flexDirection: "row", gap: 4 },
  nodeTag: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.brandStrong, backgroundColor: C.brandSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  nodeTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 18 },
  nodeTrace: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 16, marginTop: 4 },
  empty: { paddingVertical: 32, alignItems: "center" },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptySubText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, borderWidth: 1.5, borderColor: C.brandStrong },
  addBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.brandStrong },
});

// ── Legacy styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  levelSection: { padding: 16, paddingBottom: 12 },
  levelSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 0 },
  levelManageBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: C.brandStrong },
  levelManageBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.brandStrong },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  sectionCount: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  levelGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  levelChip: { width: "18%", alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, minHeight: 54 },
  levelChipSelected: { borderColor: C.brandStrong, backgroundColor: C.brandSoft },
  levelChipName: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  levelChipCount: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 3 },
  addChip: { width: "18%", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, borderStyle: "dashed", backgroundColor: C.background, gap: 3, minHeight: 54 },
  addChipText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyBox: { paddingVertical: 32, paddingHorizontal: 16, alignItems: "center", gap: 6 },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  emptySubText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  addLevelBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  addLevelBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  divider: { height: 1, backgroundColor: C.border },
  templateSection: { padding: 16 },
  templateSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  addTemplateBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, borderWidth: 1.5, borderColor: C.brandStrong },
  addTemplateBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.brandStrong },
  templateList: { gap: 8 },
  templateItem: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.border },
  templateItemInactive: { opacity: 0.55 },
  templateItemLeft: { width: 52, alignItems: "center", justifyContent: "center" },
  templateItemCenter: { flex: 1, gap: 3 },
  templateTitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text },
  templateContent: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  templateItemRight: { alignItems: "flex-end", gap: 5 },
  orderBtns: { flexDirection: "row", gap: 2 },
  orderBtn: { width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: C.background, borderWidth: 1, borderColor: C.border },
  actionBtns: { flexDirection: "row", gap: 3 },
  actionBtn: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: C.background },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  resetBtnText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: "#fff", borderRadius: 20, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  title: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 16 },
  label: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, backgroundColor: C.background },
  error: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 6 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  btnCancelText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  btnConfirmText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  actionRowBorder: { borderTopWidth: 1, borderTopColor: C.border },
  actionLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
