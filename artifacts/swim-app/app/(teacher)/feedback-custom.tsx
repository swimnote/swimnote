/**
 * (teacher)/feedback-custom.tsx — 일지 템플릿 (선생님)
 *
 * Override 패턴:
 *   - 관리자 원본을 기본 목록으로 표시
 *   - 선생님이 수정 → 해당 항목만 개인 override 저장
 *   - 초기화 → override 삭제, 관리자 원본으로 복귀
 *   - 선생님 신규 추가 → source_template_id=NULL 별도 항목
 *   - 활성/비활성 토글 → toggle-active API (문장 불러오기에서 표시 여부 조절)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { Check, Plus, Search } from "lucide-react-native";
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

const MY_TAB_ID = "__my__";

// ── 한글 레이블 ──────────────────────────────────────────────────────────────
const STROKE_LABELS: Record<string, string> = {
  general: "공통/물적응", freestyle: "자유형", backstroke: "배영",
  breaststroke: "평영", butterfly: "접영", im: "IM",
};
const DOMAIN_LABELS: Record<string, string> = {
  water_adaptation: "물적응", breathing: "호흡", technique: "기술",
  coordination: "협응", endurance: "지구력",
};

export default function FeedbackCustomScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  // ── Curriculum 모드 감지 ────────────────────────────────────────────────
  const [hasCurriculum, setHasCurriculum] = useState<boolean | null>(null);

  // ── Curriculum 탭 state ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"curriculum" | "teacher">("curriculum");
  const [curriculumLevels, setCurriculumLevels] = useState<CurriculumLevel[]>([]);
  const [selectedLevelOrder, setSelectedLevelOrder] = useState<number | null>(null);
  const [curriculumNodes, setCurriculumNodes] = useState<CurriculumNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [strokeFilter, setStrokeFilter] = useState<string>("");
  const [availableStrokes, setAvailableStrokes] = useState<{ value: string; label: string }[]>([]);
  const [teacherTemplates, setTeacherTemplates] = useState<DiaryTemplate[]>([]);
  const [teacherTemplatesLoading, setTeacherTemplatesLoading] = useState(false);
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
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<DiaryTemplate | null>(null);

  // ── Legacy state ────────────────────────────────────────────────────────
  const [levels, setLevels] = useState<DiaryTemplateLevel[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [levelsLoading, setLevelsLoading] = useState(true);

  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // "내 항목" 탭 전용: 전체 커스텀 템플릿
  const [allMyTemplates, setAllMyTemplates] = useState<DiaryTemplate[]>([]);

  // 추가 모달에서 "내 항목" 탭일 때 레벨 선택
  const [addLevelId, setAddLevelId] = useState<string | null>(null);

  // 레벨 피커 바텀시트
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // 피커 내 새 카테고리 인라인 입력
  const [newCatMode, setNewCatMode] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatError, setNewCatError] = useState("");
  const [newCatSaving, setNewCatSaving] = useState(false);

  // 토글 로딩 (templateId → boolean)
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

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

  // 키보드 높이 추적 (Modal 내 완료 버튼용)
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // 초기화 확인
  const [resetTarget, setResetTarget] = useState<DiaryTemplate | null>(null);
  // 삭제 확인 (teacher 신규 항목)
  const [deleteTarget, setDeleteTarget] = useState<DiaryTemplate | null>(null);

  // ── Curriculum 초기 감지 ────────────────────────────────────────────────
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
            return;
          }
        }
      } catch { /* fallback */ }
      setHasCurriculum(false);
    }
    init();
  }, [token]);

  // ── Curriculum 노드 로드 ────────────────────────────────────────────────
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

  useEffect(() => {
    if (!hasCurriculum || selectedLevelOrder == null) return;
    loadCurriculumNodes(selectedLevelOrder, strokeFilter);
  }, [hasCurriculum, selectedLevelOrder]);

  useEffect(() => {
    if (!hasCurriculum || selectedLevelOrder == null) return;
    loadCurriculumNodes(selectedLevelOrder, strokeFilter);
  }, [strokeFilter]);

  // ── Stroke facets 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!hasCurriculum || selectedLevelOrder == null) return;
    apiRequest(token, `/curriculum/diary/facets?level_order=${selectedLevelOrder}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAvailableStrokes(data.strokes ?? []); })
      .catch(() => {});
  }, [hasCurriculum, selectedLevelOrder]);

  // ── Teacher templates 로드 (curriculum 모드) ────────────────────────────
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

  useEffect(() => {
    if (!hasCurriculum || activeTab !== "teacher") return;
    loadTeacherTemplates();
  }, [hasCurriculum, activeTab]);

  // ── Curriculum 모드 template CRUD ───────────────────────────────────────
  async function handleAddCurriculumTemplate() {
    if (!addTemplateText.trim()) { setAddTemplateError("템플릿 내용을 입력해주세요."); return; }
    setAddTemplateSaving(true);
    try {
      const r = await apiRequest(token, "/diary-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: addTemplateTitle.trim() || null, template_text: addTemplateText.trim(), sort_order: teacherTemplates.length }),
      });
      if (r.ok) {
        setAddTemplateVisible(false); setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError("");
        await loadTeacherTemplates();
      } else {
        const err = await r.json().catch(() => ({}));
        setAddTemplateError(err.error ?? "저장 실패");
      }
    } catch { setAddTemplateError("서버 오류가 발생했습니다."); }
    finally { setAddTemplateSaving(false); }
  }

  async function handleEditCurriculumTemplate() {
    if (!editTemplateTarget || !editTemplateText.trim()) { setEditTemplateError("내용을 입력해주세요."); return; }
    setEditTemplateSaving(true);
    try {
      const r = await apiRequest(token, `/diary-templates/${editTemplateTarget.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTemplateTitle.trim() || null, template_text: editTemplateText.trim() }),
      });
      if (r.ok) {
        setEditTemplateTarget(null); setEditTemplateTitle(""); setEditTemplateText(""); setEditTemplateError("");
        await loadTeacherTemplates();
      } else {
        const err = await r.json().catch(() => ({}));
        setEditTemplateError(err.error ?? "수정 실패");
      }
    } catch { setEditTemplateError("서버 오류가 발생했습니다."); }
    finally { setEditTemplateSaving(false); }
  }

  async function handleToggleCurriculumTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    }).catch(() => null);
    if (r?.ok) setTeacherTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
  }

  async function handleDeleteCurriculumTemplate(t: DiaryTemplate) {
    const r = await apiRequest(token, `/diary-templates/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setTeacherTemplates(prev => prev.filter(x => x.id !== t.id)); setConfirmDeleteTemplate(null); }
  }

  // ── 레벨 로드 (legacy) ──────────────────────────────────────
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

  // ── 카테고리(레벨) 신규 생성 ────────────────────────
  const createLevel = useCallback(async () => {
    const name = newCatName.trim();
    if (!name) { setNewCatError("이름을 입력해주세요."); return; }
    if (name.length > 50) { setNewCatError("50자 이내로 입력해주세요."); return; }
    setNewCatSaving(true);
    setNewCatError("");
    try {
      const r = await apiRequest(token, "/diary-template-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level_name: name }),
      });
      const data = await r.json();
      if (!r.ok) { setNewCatError(data.message ?? "오류가 발생했습니다."); setNewCatSaving(false); return; }
      // 레벨 목록 다시 로드 후 새 레벨 선택
      const r2 = await apiRequest(token, "/diary-template-levels");
      if (r2.ok) {
        const lvs: DiaryTemplateLevel[] = await r2.json();
        setLevels(lvs);
        setSelectedLevelId(data.id);
      }
      setNewCatMode(false);
      setNewCatName("");
      setPickerVisible(false);
      setPickerSearch("");
    } catch { setNewCatError("네트워크 오류가 발생했습니다."); }
    setNewCatSaving(false);
  }, [token, newCatName]);

  // ── 템플릿 로드 (include_inactive=true → 비활성 항목도 관리 화면에 표시)
  const loadTemplates = useCallback(async (levelId: string) => {
    setTemplatesLoading(true);
    try {
      const r = await apiRequest(token, `/diary-templates?level_id=${levelId}&include_inactive=true`);
      if (r.ok) setTemplates(await r.json());
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  }, [token]);

  // ── "내 항목" 탭: 전체 커스텀 템플릿 로드
  const loadMyTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const r = await apiRequest(token, "/diary-templates?include_inactive=true");
      if (r.ok) {
        const all: DiaryTemplate[] = await r.json();
        setAllMyTemplates(all.filter(t => !t.global_id));
      }
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  }, [token]);

  useEffect(() => { loadLevels(); }, []);
  useEffect(() => {
    if (!selectedLevelId) return;
    if (selectedLevelId === MY_TAB_ID) loadMyTemplates();
    else loadTemplates(selectedLevelId);
  }, [selectedLevelId]);

  // ── 활성/비활성 토글 ────────────────────────────────
  const handleToggleActive = async (t: DiaryTemplate, newValue: boolean) => {
    const id = t.global_id ?? t.id;
    setToggling(prev => ({ ...prev, [t.id]: true }));
    // 낙관적 업데이트
    setTemplates(prev => prev.map(item => item.id === t.id ? { ...item, is_active: newValue } : item));
    try {
      const r = await apiRequest(token, `/diary-templates/${id}/toggle-active`, {
        method: "POST",
        body: JSON.stringify({ is_active: newValue }),
      });
      if (!r.ok) {
        // 롤백
        setTemplates(prev => prev.map(item => item.id === t.id ? { ...item, is_active: !newValue } : item));
      }
    } catch {
      setTemplates(prev => prev.map(item => item.id === t.id ? { ...item, is_active: !newValue } : item));
    }
    setToggling(prev => { const next = { ...prev }; delete next[t.id]; return next; });
  };

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
    if (selectedLevelId && selectedLevelId !== MY_TAB_ID) loadTemplates(selectedLevelId);
  };

  // ── 신규 추가 ──────────────────────────────────────
  const saveAdd = async () => {
    if (!addText.trim()) { setAddError("내용을 입력해주세요."); return; }
    const targetLevelId = selectedLevelId === MY_TAB_ID ? addLevelId : selectedLevelId;
    if (!targetLevelId) { setAddError("레벨을 선택해주세요."); return; }
    setAddSaving(true);
    setAddError("");
    try {
      const r = await apiRequest(token, "/diary-templates", {
        method: "POST",
        body: JSON.stringify({ level_id: targetLevelId, template_text: addText.trim(), title: addTitle.trim() || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setAddError(j.error ?? "저장 실패");
        setAddSaving(false);
        return;
      }
      setAddVisible(false);
      setAddText(""); setAddTitle(""); setAddLevelId(null);
      if (selectedLevelId === MY_TAB_ID) loadMyTemplates();
      else loadTemplates(selectedLevelId!);
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
    if (selectedLevelId === MY_TAB_ID) loadMyTemplates();
    else if (selectedLevelId) loadTemplates(selectedLevelId);
  };

  // ── 항목 분류 (일반 레벨 탭용) ──────────────────────
  const baseItems = templates.filter(t => t.global_id !== null && t.global_id !== undefined);
  const isMyTab   = selectedLevelId === MY_TAB_ID;

  // ── 피커 검색 필터 ──────────────────────────────────
  const filteredLevels = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return levels;
    return levels.filter(lv => lv.level_name.toLowerCase().includes(q));
  }, [levels, pickerSearch]);

  // ── 현재 선택된 레벨 이름 ──────────────────────────
  const selectedLevelName = isMyTab ? null : levels.find(lv => lv.id === selectedLevelId)?.level_name ?? null;

  // ── Curriculum 모드 로딩 ────────────────────────────────────────────────
  if (hasCurriculum === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="일지 템플릿" />
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      </View>
    );
  }

  // ── Curriculum 모드 ─────────────────────────────────────────────────────
  if (hasCurriculum) {
    const selectedLevel = curriculumLevels.find(l => l.level_order === selectedLevelOrder);
    return (
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <SubScreenHeader title="일지 템플릿" />

        {/* 탭 */}
        <View style={cs.tabRow}>
          <Pressable style={[cs.tab, activeTab === "curriculum" && cs.tabActive]} onPress={() => setActiveTab("curriculum")}>
            <Text style={[cs.tabText, activeTab === "curriculum" && cs.tabTextActive]}>교육과정</Text>
          </Pressable>
          <Pressable style={[cs.tab, activeTab === "teacher" && cs.tabActive]} onPress={() => setActiveTab("teacher")}>
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
                    <Pressable style={[cs.filterChip, !strokeFilter && cs.filterChipActive]} onPress={() => setStrokeFilter("")}>
                      <Text style={[cs.filterChipText, !strokeFilter && cs.filterChipTextActive]}>전체</Text>
                    </Pressable>
                    {availableStrokes.map(fs => (
                      <Pressable
                        key={fs.value}
                        style={[cs.filterChip, strokeFilter === fs.value && cs.filterChipActive]}
                        onPress={() => setStrokeFilter(fs.value)}
                      >
                        <Text style={[cs.filterChipText, strokeFilter === fs.value && cs.filterChipTextActive]}>{fs.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Node list */}
            <View style={{ paddingHorizontal: 16 }}>
              <View style={cs.nodeListHeader}>
                <Text style={cs.sectionLabel}>{selectedLevel?.level_name} — {curriculumNodes.length}개 노드</Text>
                <Text style={cs.subLabel}>read-only · AI 일지 검색에 사용됨</Text>
              </View>
              {nodesLoading ? (
                <ActivityIndicator color={C.brandStrong} style={{ marginTop: 24 }} />
              ) : curriculumNodes.length === 0 ? (
                <View style={cs.empty}><Text style={cs.emptyText}>해당 조건의 노드가 없습니다.</Text></View>
              ) : (
                <View style={cs.nodeList}>
                  {curriculumNodes.map(node => {
                    const strokeLabel = STROKE_LABELS[node.stroke] ?? node.stroke;
                    const domainLabel = DOMAIN_LABELS[node.domain] ?? node.domain;
                    return (
                      <View key={node.id} style={cs.nodeCard}>
                        <View style={cs.nodeCardHeader}>
                          <Text style={cs.nodeDisplayNo}>{node.display_no}</Text>
                          <View style={cs.nodeTagRow}>
                            <Text style={cs.nodeTag}>{strokeLabel}</Text>
                            <Text style={cs.nodeTag}>{domainLabel}</Text>
                          </View>
                        </View>
                        <Text style={cs.nodeTitle} numberOfLines={2}>{node.title || node.atomic_skill}</Text>
                        {!!node.goal && <Text style={cs.nodeGoal} numberOfLines={2}>{node.goal}</Text>}
                      </View>
                    );
                  })}
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
                <View style={{ gap: 8, marginTop: 8 }}>
                  {teacherTemplates.map(t => (
                    <View key={t.id} style={[cs.nodeCard, !t.is_active && { opacity: 0.65 }]}>
                      {!!t.title && <Text style={{ fontSize: 11, color: "#7C3AED", fontFamily: "Pretendard-Regular", marginBottom: 2 } as any}>{t.title}</Text>}
                      <Text style={{ fontSize: 13, color: C.textPrimary, fontFamily: "Pretendard-Regular", lineHeight: 19 } as any} numberOfLines={3}>{t.template_text}</Text>
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                        <Switch
                          value={!!t.is_active}
                          onValueChange={() => handleToggleCurriculumTemplate(t)}
                          trackColor={{ false: C.border, true: C.brandSoft }}
                          thumbColor={t.is_active ? C.brandStrong : C.textMuted}
                          style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                        />
                        <Pressable
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border }}
                          onPress={() => { setEditTemplateTarget(t); setEditTemplateTitle(t.title ?? ""); setEditTemplateText(t.template_text); setEditTemplateError(""); }}
                        >
                          <LucideIcon name="edit-2" size={13} color={C.textSecondary} />
                          <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular" } as any}>수정</Text>
                        </Pressable>
                        <Pressable
                          style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "#FECACA" }}
                          onPress={() => setConfirmDeleteTemplate(t)}
                        >
                          <LucideIcon name="trash-2" size={13} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        )}

        {/* 템플릿 추가 모달 */}
        <Modal visible={addTemplateVisible} transparent animationType="fade" onRequestClose={() => setAddTemplateVisible(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}>
              <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20 }}>
                <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 16 } as any}>내 템플릿 추가</Text>
                <TextInput style={s.input} placeholder="제목 (선택)" value={addTemplateTitle} onChangeText={setAddTemplateTitle} placeholderTextColor={C.textMuted} />
                <TextInput style={[s.input, s.textArea, { marginTop: 10 }]} placeholder="내용을 입력하세요" value={addTemplateText} onChangeText={setAddTemplateText} multiline placeholderTextColor={C.textMuted} />
                {!!addTemplateError && <Text style={{ fontSize: 12, color: "#EF4444", marginTop: 6 }}>{addTemplateError}</Text>}
                <View style={[s.modalBtns, { marginTop: 14 }]}>
                  <Pressable style={s.cancelBtn} onPress={() => setAddTemplateVisible(false)}><Text style={s.cancelBtnText}>취소</Text></Pressable>
                  <Pressable style={[s.saveBtn, addTemplateSaving && { opacity: 0.6 }]} onPress={handleAddCurriculumTemplate} disabled={addTemplateSaving}>
                    {addTemplateSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>추가</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 템플릿 수정 모달 */}
        <Modal visible={!!editTemplateTarget} transparent animationType="fade" onRequestClose={() => setEditTemplateTarget(null)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}>
              <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20 }}>
                <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 16 } as any}>템플릿 수정</Text>
                <TextInput style={s.input} placeholder="제목 (선택)" value={editTemplateTitle} onChangeText={setEditTemplateTitle} placeholderTextColor={C.textMuted} />
                <TextInput style={[s.input, s.textArea, { marginTop: 10 }]} placeholder="내용을 입력하세요" value={editTemplateText} onChangeText={setEditTemplateText} multiline placeholderTextColor={C.textMuted} />
                {!!editTemplateError && <Text style={{ fontSize: 12, color: "#EF4444", marginTop: 6 }}>{editTemplateError}</Text>}
                <View style={[s.modalBtns, { marginTop: 14 }]}>
                  <Pressable style={s.cancelBtn} onPress={() => setEditTemplateTarget(null)}><Text style={s.cancelBtnText}>취소</Text></Pressable>
                  <Pressable style={[s.saveBtn, editTemplateSaving && { opacity: 0.6 }]} onPress={handleEditCurriculumTemplate} disabled={editTemplateSaving}>
                    {editTemplateSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>저장</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* 삭제 확인 */}
        <ConfirmModal
          visible={!!confirmDeleteTemplate}
          title="템플릿 삭제"
          message="이 템플릿을 삭제하시겠습니까?"
          confirmText="삭제"
          confirmColor="#EF4444"
          onConfirm={() => { if (confirmDeleteTemplate) handleDeleteCurriculumTemplate(confirmDeleteTemplate); }}
          onCancel={() => setConfirmDeleteTemplate(null)}
        />
      </View>
    );
  }

  // ── Legacy 모드 ─────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="일지 템플릿" />

      {/* ── 레벨 탭 ── */}
      {levelsLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={C.brandStrong} />
      ) : levels.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyText}>관리자가 설정한 레벨이 없습니다.</Text>
        </View>
      ) : (
        <>
          <View style={s.tabBarWrapper}>
            {/* "내 항목" 탭 — 항상 고정 */}
            <Pressable
              style={[s.tab, s.tabMine, isMyTab && s.tabMineActive]}
              onPress={() => setSelectedLevelId(MY_TAB_ID)}
            >
              <Text style={[s.tabText, s.tabMineText, isMyTab && s.tabMineTextActive]}>✦ 내 항목</Text>
            </Pressable>
            {/* 세로 구분선 */}
            <View style={s.tabDivider} />
            {/* 레벨 피커 버튼 */}
            <Pressable
              style={[s.pickerBtn, !isMyTab && !!selectedLevelId && s.pickerBtnActive]}
              onPress={() => { setPickerSearch(""); setPickerVisible(true); }}
            >
              <Text
                style={[s.pickerBtnText, !isMyTab && !!selectedLevelId && s.pickerBtnTextActive]}
                numberOfLines={1}
              >
                {isMyTab || !selectedLevelName ? "레벨 선택" : selectedLevelName}
              </Text>
              <LucideIcon name="chevron-down" size={14} color={!isMyTab && selectedLevelName ? C.brandStrong : C.textMuted} />
            </Pressable>
          </View>

          {/* 안내 문구 */}
          <View style={s.hintRow}>
            <LucideIcon name="eye" size={12} color={C.textMuted} />
            <Text style={s.hintText}>스위치를 끄면 "문장 불러오기"에서 숨겨집니다</Text>
          </View>

          <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 80 }]}>
            {templatesLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={C.brandStrong} />
            ) : isMyTab ? (
              /* ── "내 항목" 탭 ── */
              allMyTemplates.length === 0 ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyText}>{"내가 추가한 항목이 없습니다.\n하단 버튼으로 추가해보세요."}</Text>
                </View>
              ) : (
                allMyTemplates.map((t) => {
                  const levelName = levels.find(lv => lv.id === t.level_id)?.level_name;
                  return (
                    <View key={t.id} style={[s.card, s.cardMine, !t.is_active && s.cardInactive]}>
                      <View style={s.cardTop}>
                        {!!t.title && <Text style={s.cardTitle}>{t.title}</Text>}
                        <Text style={[s.cardText, { flex: 1 }, !t.is_active && s.cardTextInactive]} numberOfLines={3}>
                          {t.template_text}
                        </Text>
                        <View style={s.cardActions}>
                          {toggling[t.id] ? (
                            <ActivityIndicator size="small" color={C.brandStrong} style={{ width: 44 }} />
                          ) : (
                            <Switch
                              value={!!t.is_active}
                              onValueChange={v => handleToggleActive(t, v)}
                              trackColor={{ false: C.border, true: C.brandSoft }}
                              thumbColor={t.is_active ? C.brandStrong : C.textMuted}
                              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                            />
                          )}
                          <Pressable style={s.editBtn} onPress={() => {
                            setEditTarget(t);
                            setEditText(t.template_text);
                            setEditTitle(t.title ?? "");
                            setEditError("");
                          }}>
                            <LucideIcon name="edit-2" size={14} color={C.textSecondary} />
                            <Text style={s.editBtnText}>수정</Text>
                          </Pressable>
                          <Pressable style={[s.editBtn, { borderColor: "#FCA5A5" }]} onPress={() => setDeleteTarget(t)}>
                            <LucideIcon name="trash-2" size={14} color="#EF4444" />
                          </Pressable>
                        </View>
                      </View>
                      {levelName && (
                        <View style={s.levelTagRow}>
                          <View style={s.levelTag}><Text style={s.levelTagText}>{levelName}</Text></View>
                        </View>
                      )}
                      {!t.is_active && (
                        <View style={s.hiddenBadgeRow}>
                          <LucideIcon name="eye-off" size={11} color={C.textMuted} />
                          <Text style={s.hiddenBadgeText}>문장 불러오기에서 숨겨짐</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )
            ) : (
              /* ── 일반 레벨 탭: 관리자 원본만 표시 ── */
              <>
                {baseItems.length === 0 ? (
                  <View style={s.emptyBox}>
                    <Text style={s.emptyText}>이 레벨에 등록된 공통 템플릿이 없습니다.</Text>
                  </View>
                ) : (
                  baseItems.map((t, i) => (
                    <View key={t.global_id} style={[
                      s.card,
                      t.is_overridden && s.cardOverridden,
                      !t.is_active && s.cardInactive,
                    ]}>
                      <View style={s.cardTop}>
                        <Text style={[s.cardNum, !t.is_active && s.cardNumInactive]}>{i + 1}</Text>
                        <Text style={[s.cardText, !t.is_active && s.cardTextInactive]} numberOfLines={3}>
                          {t.template_text}
                        </Text>
                        <View style={s.cardActions}>
                          {toggling[t.id] ? (
                            <ActivityIndicator size="small" color={C.brandStrong} style={{ width: 44 }} />
                          ) : (
                            <Switch
                              value={!!t.is_active}
                              onValueChange={v => handleToggleActive(t, v)}
                              trackColor={{ false: C.border, true: C.brandSoft }}
                              thumbColor={t.is_active ? C.brandStrong : C.textMuted}
                              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                            />
                          )}
                          <Pressable style={s.editBtn} onPress={() => {
                            setEditTarget(t);
                            setEditText(t.template_text);
                            setEditTitle(t.title ?? "");
                            setEditError("");
                          }}>
                            <LucideIcon name="edit-2" size={14} color={C.textSecondary} />
                            <Text style={s.editBtnText}>수정</Text>
                          </Pressable>
                        </View>
                      </View>
                      {!t.is_active && (
                        <View style={s.hiddenBadgeRow}>
                          <LucideIcon name="eye-off" size={11} color={C.textMuted} />
                          <Text style={s.hiddenBadgeText}>문장 불러오기에서 숨겨짐</Text>
                        </View>
                      )}
                      {t.is_overridden && t.is_active && (
                        <View style={s.overriddenRow}>
                          <View style={s.myBadge}><Text style={s.myBadgeText}>내 수정</Text></View>
                          <Pressable style={s.resetBtn} onPress={() => setResetTarget(t)}>
                            <LucideIcon name="refresh-ccw" size={11} color={C.textSecondary} />
                            <Text style={s.resetBtnText}>초기화</Text>
                          </Pressable>
                        </View>
                      )}
                      {t.is_overridden && !t.is_active && (
                        <Pressable style={[s.resetBtn, { alignSelf: "flex-start", marginTop: 4 }]} onPress={() => setResetTarget(t)}>
                          <LucideIcon name="refresh-ccw" size={11} color={C.textSecondary} />
                          <Text style={s.resetBtnText}>수정 초기화</Text>
                        </Pressable>
                      )}
                    </View>
                  ))
                )}
              </>
            )}
          </KeyboardAwareScrollView>
        </>
      )}

      {/* ── 신규 추가 FAB ── */}
      {selectedLevelId && (
        <Pressable
          style={[s.fab, { bottom: insets.bottom + 16 }]}
          onPress={() => { setAddVisible(true); setAddText(""); setAddTitle(""); setAddError(""); }}
        >
          <LucideIcon name="plus" size={20} color="#fff" />
          <Text style={s.fabText}>내 항목 추가</Text>
        </Pressable>
      )}

      {/* ── 수정 모달 ── */}
      <Modal visible={!!editTarget} transparent animationType="fade" onRequestClose={() => setEditTarget(null)}>
        <View style={s.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} />
          {kbHeight > 0 && (
            <View style={{ position: "absolute", bottom: kbHeight, left: 0, right: 0, zIndex: 100, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.backgroundSoft, borderTopWidth: 1, borderTopColor: C.border }}>
              <Pressable onPress={Keyboard.dismiss} hitSlop={12}>
                <Text style={{ color: "#2A9D8F", fontWeight: "600", fontSize: 16 }}>완료</Text>
              </Pressable>
            </View>
          )}
          <View style={s.modalBox}>
            <KeyboardAwareScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 140 }}
            >
              <Text style={s.modalTitle}>템플릿 수정</Text>
              {editTarget?.global_id && !editTarget.is_overridden && (
                <Text style={[s.modalHint, { marginBottom: 12 }]}>수정하면 이 항목만 내 버전으로 저장됩니다.</Text>
              )}
              <TextInput
                style={[s.input, { marginBottom: 10 }]}
                placeholder="제목 (선택)"
                value={editTitle}
                onChangeText={setEditTitle}
                placeholderTextColor={C.textMuted}
                returnKeyType="next"
              />
              <TextInput
                style={[s.input, s.textArea]}
                placeholder="내용을 입력하세요"
                value={editText}
                onChangeText={setEditText}
                multiline
                scrollEnabled
                placeholderTextColor={C.textMuted}
              />
              {!!editError && <Text style={s.errorText}>{editError}</Text>}
              <View style={[s.modalBtns, { marginTop: 12 }]}>
                <Pressable style={s.cancelBtn} onPress={() => setEditTarget(null)}>
                  <Text style={s.cancelBtnText}>취소</Text>
                </Pressable>
                <Pressable style={[s.saveBtn, editSaving && { opacity: 0.6 }]} onPress={saveOverride} disabled={editSaving}>
                  {editSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>저장</Text>}
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 신규 추가 모달 ── */}
      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <View style={s.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} />
          {kbHeight > 0 && (
            <View style={{ position: "absolute", bottom: kbHeight, left: 0, right: 0, zIndex: 100, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.backgroundSoft, borderTopWidth: 1, borderTopColor: C.border }}>
              <Pressable onPress={Keyboard.dismiss} hitSlop={12}>
                <Text style={{ color: "#2A9D8F", fontWeight: "600", fontSize: 16 }}>완료</Text>
              </Pressable>
            </View>
          )}
          <View style={s.modalBox}>
            <KeyboardAwareScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 140 }}
            >
              <Text style={s.modalTitle}>내 항목 추가</Text>
              <Text style={[s.modalHint, { marginBottom: 12 }]}>나에게만 표시되는 항목입니다.</Text>
              {/* "내 항목" 탭에서 추가 시 레벨 선택 필요 */}
              {isMyTab && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[s.modalHint, { marginBottom: 6, color: "#475569" }]}>레벨 선택 *</Text>
                  <View style={s.levelPickerRow}>
                    {levels.map(lv => (
                      <Pressable
                        key={lv.id}
                        style={[s.levelPickerBtn, addLevelId === lv.id && s.levelPickerBtnActive]}
                        onPress={() => setAddLevelId(lv.id)}
                      >
                        <Text style={[s.levelPickerText, addLevelId === lv.id && s.levelPickerTextActive]} numberOfLines={1}>
                          {lv.level_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              <TextInput
                style={[s.input, { marginBottom: 10 }]}
                placeholder="제목 (선택)"
                value={addTitle}
                onChangeText={setAddTitle}
                placeholderTextColor={C.textMuted}
                returnKeyType="next"
              />
              <TextInput
                style={[s.input, s.textArea]}
                placeholder="내용을 입력하세요"
                value={addText}
                onChangeText={setAddText}
                multiline
                scrollEnabled
                placeholderTextColor={C.textMuted}
              />
              {!!addError && <Text style={s.errorText}>{addError}</Text>}
              <View style={[s.modalBtns, { marginTop: 12 }]}>
                <Pressable style={s.cancelBtn} onPress={() => { setAddVisible(false); setAddLevelId(null); }}>
                  <Text style={s.cancelBtnText}>취소</Text>
                </Pressable>
                <Pressable style={[s.saveBtn, addSaving && { opacity: 0.6 }]} onPress={saveAdd} disabled={addSaving}>
                  {addSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>추가</Text>}
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 레벨 피커 바텀시트 ── */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={s.pickerBackdrop} onPress={() => setPickerVisible(false)} />
        <View style={[s.pickerSheet, { paddingBottom: Math.max(insets.bottom + 12, kbHeight + 12) }]}>
          {/* 핸들 */}
          <View style={s.pickerHandle} />
          {/* 타이틀 + 새 카테고리 버튼 */}
          <View style={s.pickerTitleRow}>
            <Text style={s.pickerTitle}>카테고리 선택</Text>
            <Pressable
              style={s.pickerAddCatBtn}
              onPress={() => {
                setNewCatMode(v => !v);
                setNewCatName("");
                setNewCatError("");
              }}
            >
              <Plus size={14} color={C.brandStrong} />
              <Text style={s.pickerAddCatBtnText}>새 카테고리</Text>
            </Pressable>
          </View>
          {/* 새 카테고리 인라인 입력 */}
          {newCatMode && (
            <View style={s.newCatBox}>
              <TextInput
                style={s.newCatInput}
                value={newCatName}
                onChangeText={t => { setNewCatName(t); setNewCatError(""); }}
                placeholder="카테고리 이름 (50자 이내)"
                placeholderTextColor={C.textMuted}
                autoFocus
                maxLength={50}
                returnKeyType="done"
                onSubmitEditing={createLevel}
              />
              {!!newCatError && <Text style={s.newCatError}>{newCatError}</Text>}
              <View style={s.newCatActions}>
                <Pressable style={s.newCatCancelBtn} onPress={() => { setNewCatMode(false); setNewCatName(""); setNewCatError(""); }}>
                  <Text style={s.newCatCancelText}>취소</Text>
                </Pressable>
                <Pressable style={[s.newCatSaveBtn, newCatSaving && { opacity: 0.6 }]} onPress={createLevel} disabled={newCatSaving}>
                  {newCatSaving
                    ? <ActivityIndicator size={14} color="#fff" />
                    : <Text style={s.newCatSaveText}>추가</Text>
                  }
                </Pressable>
              </View>
            </View>
          )}
          {/* 검색 */}
          {!newCatMode && (
            <View style={s.pickerSearchRow}>
              <Search size={15} color={C.textMuted} />
              <TextInput
                style={s.pickerSearchInput}
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="카테고리 검색..."
                placeholderTextColor={C.textMuted}
                autoFocus
                clearButtonMode="while-editing"
              />
            </View>
          )}
          {/* 레벨 목록 */}
          <ScrollView
            style={s.pickerList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filteredLevels.length === 0 ? (
              <View style={s.pickerEmpty}>
                <Text style={s.pickerEmptyText}>검색 결과가 없습니다.</Text>
              </View>
            ) : (
              filteredLevels.map(lv => {
                const isSelected = selectedLevelId === lv.id;
                return (
                  <Pressable
                    key={lv.id}
                    style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                    onPress={() => {
                      setSelectedLevelId(lv.id);
                      setPickerVisible(false);
                      setPickerSearch("");
                      setNewCatMode(false);
                    }}
                  >
                    <Text style={[s.pickerRowText, isSelected && s.pickerRowTextSelected]} numberOfLines={2}>
                      {lv.level_name}
                    </Text>
                    {isSelected && <Check size={16} color={C.brandStrong} />}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
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
    </View>
  );
}

const s = StyleSheet.create({
  // ── 탭 바 ──
  tabBarWrapper:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tabDivider:        { width: 1, height: 22, backgroundColor: C.border },
  tab:               { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 14, borderWidth: 1.5, borderColor: C.border },
  tabActive:         { backgroundColor: C.brandSoft, borderColor: C.brandStrong },
  tabText:           { fontSize: 11, lineHeight: 16, color: C.textSecondary },
  tabTextActive:     { color: C.brandStrong },
  tabMine:           { borderColor: "#6B5BCD", backgroundColor: "#F5F3FF" },
  tabMineActive:     { backgroundColor: "#6B5BCD", borderColor: "#6B5BCD" },
  tabMineText:       { color: "#6B5BCD" } as any,
  tabMineTextActive: { color: "#fff" } as any,

  // ── 레벨 피커 버튼 ──
  pickerBtn:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface },
  pickerBtnActive:    { borderColor: C.brandStrong, backgroundColor: C.brandMist },
  pickerBtnText:      { flex: 1, fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular" } as any,
  pickerBtnTextActive:{ color: C.brandStrong, fontFamily: "Pretendard-SemiBold" } as any,

  // ── 레벨 피커 바텀시트 ──
  pickerBackdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: "80%",
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  pickerHandle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 14 },
  pickerTitleRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  pickerTitle:       { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  pickerAddCatBtn:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: C.brandStrong, backgroundColor: C.brandMist },
  pickerAddCatBtnText:{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.brandStrong } as any,
  newCatBox:         { backgroundColor: C.backgroundSoft, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 8 },
  newCatInput:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: C.surface, marginBottom: 6 },
  newCatError:       { fontSize: 12, color: "#EF4444", marginBottom: 6, fontFamily: "Pretendard-Regular" },
  newCatActions:     { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  newCatCancelBtn:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  newCatCancelText:  { fontSize: 13, color: C.textSecondary, fontFamily: "Pretendard-Regular" },
  newCatSaveBtn:     { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8, backgroundColor: C.primaryAction, minWidth: 52, alignItems: "center" },
  newCatSaveText:    { fontSize: 13, color: "#fff", fontFamily: "Pretendard-SemiBold" } as any,
  pickerSearchRow:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.backgroundSoft, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 8 },
  pickerSearchInput: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, padding: 0 },
  pickerList:        { flex: 1 },
  pickerRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.backgroundSoft },
  pickerRowSelected: { backgroundColor: C.brandMist },
  pickerRowText:     { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textStrong, lineHeight: 20 },
  pickerRowTextSelected: { color: C.brandStrong, fontFamily: "Pretendard-SemiBold" } as any,
  pickerEmpty:       { alignItems: "center", paddingVertical: 32 },
  pickerEmptyText:   { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  hintRow:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingBottom: 6 },
  hintText:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  listContent:  { paddingHorizontal: 16, paddingTop: 4, gap: 14 },

  card:           { backgroundColor: C.backgroundSoft, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  cardOverridden: { backgroundColor: "#FFF8EC", borderColor: "#FCD34D" },
  cardMine:       { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  cardInactive:   { backgroundColor: C.backgroundSoft, borderColor: C.border, opacity: 0.7 },
  cardTop:        { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardNum:        { width: 22, height: 22, borderRadius: 11, backgroundColor: C.border, textAlign: "center", lineHeight: 22, fontSize: 12, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  cardNumInactive:{ backgroundColor: "#CBD5E1", color: C.textMuted },
  cardTitle:      { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#7C3AED", marginBottom: 2 },
  cardText:       { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 20 },
  cardTextInactive:{ color: C.textMuted },
  cardActions:    { flexDirection: "row", alignItems: "center", gap: 4 },
  editBtn:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  editBtnText:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  hiddenBadgeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  hiddenBadgeText:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  overriddenRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#FDE68A" },
  myBadge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: "#FCD34D" },
  myBadgeText:    { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#92400E" },
  resetBtn:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  resetBtnText:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  sectionDivider: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 10 },
  sectionLine:    { flex: 1, height: 1, backgroundColor: C.border },
  sectionLabel:   { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textMuted },

  levelTagRow:  { flexDirection: "row", marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#EDE9FE" },
  levelTag:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#EDE9FE" },
  levelTagText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#6B5BCD" },

  levelPickerRow:        { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  levelPickerBtn:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.backgroundSoft },
  levelPickerBtnActive:  { borderColor: "#6B5BCD", backgroundColor: "#F5F3FF" },
  levelPickerText:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary } as any,
  levelPickerTextActive: { color: "#6B5BCD", fontFamily: "Pretendard-SemiBold" } as any,

  emptyBox:   { paddingTop: 48, alignItems: "center" },
  emptyText:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },

  fab:        { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primaryAction, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  fabText:    { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalBox:     { width: "100%", backgroundColor: "#fff", borderRadius: 16, padding: 20, maxHeight: "85%" },
  modalTitle:   { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  modalHint:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  input:        { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  textArea:     { minHeight: 90, textAlignVertical: "top" },
  errorText:    { fontSize: 12, color: "#EF4444", fontFamily: "Pretendard-Regular" },
  modalBtns:    { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn:    { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  cancelBtnText:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  saveBtn:      { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: C.primaryAction, alignItems: "center" },
  saveBtnText:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});

// ── Curriculum 스타일 ─────────────────────────────────────────────────────────
const cs = StyleSheet.create({
  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.brandStrong },
  tabText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  tabTextActive: { color: C.brandStrong, fontFamily: "Pretendard-Regular" },
  sectionLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  subLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  levelChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.backgroundSoft },
  levelChipActive: { borderColor: C.brandStrong, backgroundColor: C.brandSoft },
  levelChipText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  levelChipTextActive: { color: C.brandStrong },
  levelChipCount: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.backgroundSoft },
  filterChipActive: { borderColor: C.brandStrong, backgroundColor: C.brandSoft },
  filterChipText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  filterChipTextActive: { color: C.brandStrong },
  nodeListHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4, marginTop: 8 },
  nodeList: { gap: 8, marginTop: 8 },
  nodeCard: { backgroundColor: C.backgroundSoft, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  nodeCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  nodeDisplayNo: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  nodeTagRow: { flexDirection: "row", gap: 4 },
  nodeTag: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.brandStrong, backgroundColor: C.brandSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  nodeTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 18 },
  nodeGoal: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 16, marginTop: 4 },
  empty: { paddingVertical: 32, alignItems: "center" },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptySubText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, borderWidth: 1.5, borderColor: C.brandStrong },
  addBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.brandStrong },
});
