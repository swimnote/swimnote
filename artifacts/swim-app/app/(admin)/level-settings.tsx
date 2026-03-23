import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LevelBadge, type LevelDef } from "@/components/common/LevelBadge";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

const BADGE_COLORS = [
  { label: "청록",  value: "#1F8F86" },
  { label: "파랑",  value: "#3B82F6" },
  { label: "빨강",  value: "#EF4444" },
  { label: "초록",  value: "#22C55E" },
  { label: "노랑",  value: "#F59E0B" },
  { label: "보라",  value: "#8B5CF6" },
  { label: "주황",  value: "#F97316" },
  { label: "검정",  value: "#1A1A1A" },
  { label: "핑크",  value: "#EC4899" },
  { label: "흰색",  value: "#FFFFFF" },
];

const BADGE_TYPES = [
  { key: "text", label: "문자형" },
  { key: "color", label: "색상형" },
  { key: "icon", label: "아이콘형" },
];

interface LevelSetting extends LevelDef {
  level_description: string;
  learning_content: string;
  promotion_test_rule: string;
  badge_type: string;
  badge_label: string;
  badge_color: string;
  badge_text_color: string;
  is_active: boolean;
}

const DEFAULT: LevelSetting[] = Array.from({ length: 10 }, (_, i) => ({
  level_order: i + 1,
  level_name: String(i + 1),
  level_description: "",
  learning_content: "",
  promotion_test_rule: "",
  badge_type: "text",
  badge_label: String(i + 1),
  badge_color: "#1F8F86",
  badge_text_color: "#FFFFFF",
  is_active: true,
}));

export default function LevelSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [levels, setLevels] = useState<LevelSetting[]>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ visible: boolean; action: (() => void) | null }>({ visible: false, action: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/admin/level-settings");
      if (res.ok) {
        const data: any[] = await res.json();
        if (data.length > 0) {
          setLevels(data.map(d => ({ ...d, is_active: d.is_active !== false })));
        } else {
          setLevels(DEFAULT);
        }
      }
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function update(order: number, field: keyof LevelSetting, value: string) {
    setLevels(prev => prev.map(l =>
      l.level_order === order ? { ...l, [field]: value, badge_label: field === "level_name" && l.badge_type !== "icon" ? value : l.badge_label, ...{} } : l
    ));
    setChanged(true);
  }

  function updateBadgeLabel(order: number, value: string) {
    setLevels(prev => prev.map(l => l.level_order === order ? { ...l, badge_label: value } : l));
    setChanged(true);
  }

  function toggleActive(order: number) {
    setLevels(prev => prev.map(l => l.level_order === order ? { ...l, is_active: !l.is_active } : l));
    setChanged(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await apiRequest(token, "/admin/level-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      if (res.ok) { setChanged(false); }
    } catch {}
    finally { setSaving(false); }
  }

  const lv = (order: number) => levels.find(l => l.level_order === order)!;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="레벨 설정"
        rightSlot={
          <Pressable
            style={[s.saveBtn, { backgroundColor: changed ? C.tint : C.border }]}
            onPress={save}
            disabled={saving || !changed}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={[s.saveBtnTxt, { color: changed ? "#fff" : C.textMuted }]}>저장</Text>
            }
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, paddingTop: 12 }}
        >
          {/* 안내 카드 */}
          <View style={[s.infoCard, { backgroundColor: "#EEF9F8", borderColor: "#C2E8E5" }]}>
            <Feather name="info" size={16} color={C.tint} />
            <Text style={[s.infoTxt, { color: C.tint }]}>
              레벨 1~10의 표시명·설명·뱃지를 자유롭게 설정할 수 있습니다.{"\n"}설정하지 않은 항목은 기본값(숫자)으로 표시됩니다.
            </Text>
          </View>

          {/* 레벨 카드 목록 */}
          {levels.map((lv) => (
            <LevelCard
              key={lv.level_order}
              lv={lv}
              expanded={expanded === lv.level_order}
              onToggle={() => setExpanded(prev => prev === lv.level_order ? null : lv.level_order)}
              onUpdate={(field, value) => update(lv.level_order, field as keyof LevelSetting, value)}
              onBadgeLabelUpdate={(v) => updateBadgeLabel(lv.level_order, v)}
              onToggleActive={() => toggleActive(lv.level_order)}
              setChanged={setChanged}
              setLevels={setLevels}
            />
          ))}

          {changed && (
            <Pressable style={[s.bottomSave, { backgroundColor: C.tint }]} onPress={save} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.bottomSaveTxt}>변경사항 저장</Text>
              }
            </Pressable>
          )}
        </ScrollView>
      )}

      <ConfirmModal
        visible={confirmModal.visible}
        title="저장하지 않고 나가시겠습니까?"
        message="변경한 내용이 저장되지 않습니다."
        confirmLabel="나가기"
        cancelLabel="취소"
        onConfirm={() => { confirmModal.action?.(); setConfirmModal({ visible: false, action: null }); }}
        onCancel={() => setConfirmModal({ visible: false, action: null })}
      />
    </View>
  );
}

interface CardProps {
  lv: LevelSetting;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: string, value: string) => void;
  onBadgeLabelUpdate: (v: string) => void;
  onToggleActive: () => void;
  setChanged: (v: boolean) => void;
  setLevels: React.Dispatch<React.SetStateAction<LevelSetting[]>>;
}

function LevelCard({ lv, expanded, onToggle, onUpdate, onBadgeLabelUpdate, onToggleActive, setChanged, setLevels }: CardProps) {
  const inactive = lv.is_active === false;
  const badgePreview: LevelDef = {
    level_order: lv.level_order,
    level_name: lv.level_name,
    badge_type: lv.badge_type,
    badge_label: lv.badge_label || lv.level_name,
    badge_color: lv.badge_color,
    badge_text_color: lv.badge_text_color,
  };

  function setBadgeType(t: string) {
    setLevels(prev => prev.map(l => l.level_order === lv.level_order ? { ...l, badge_type: t } : l));
    setChanged(true);
  }
  function setBadgeColor(c: string) {
    const isDark = isDarkColor(c);
    setLevels(prev => prev.map(l =>
      l.level_order === lv.level_order
        ? { ...l, badge_color: c, badge_text_color: isDark ? "#FFFFFF" : "#1A1A1A" }
        : l
    ));
    setChanged(true);
  }

  const hasContent = lv.level_description || lv.learning_content || lv.promotion_test_rule;

  return (
    <View style={[s.card, inactive && s.cardInactive]}>
      {/* 카드 헤더 */}
      <Pressable style={s.cardHeader} onPress={onToggle}>
        <View style={{ opacity: inactive ? 0.45 : 1 }}>
          <LevelBadge level={badgePreview} size="md" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[s.cardTitle, inactive && { color: C.textMuted }]}>
              레벨 {lv.level_order}
              {lv.level_name !== String(lv.level_order) ? ` · ${lv.level_name}` : ""}
            </Text>
            {inactive && (
              <View style={s.inactiveBadge}>
                <Text style={s.inactiveBadgeTxt}>사용 안함</Text>
              </View>
            )}
          </View>
          {hasContent ? (
            <Text style={[s.cardSub, inactive && { color: C.textMuted }]} numberOfLines={1}>
              {lv.level_description || lv.learning_content}
            </Text>
          ) : (
            <Text style={[s.cardSub, { color: C.textMuted }]}>내용 없음 (탭하여 편집)</Text>
          )}
        </View>
        <Pressable
          style={[s.activeToggle, { backgroundColor: inactive ? "#F3F4F6" : "#DDF2EF", borderColor: inactive ? C.border : "#A7D9D6" }]}
          onPress={(e) => { e.stopPropagation(); onToggleActive(); }}
          hitSlop={8}
        >
          <Feather name={inactive ? "eye-off" : "eye"} size={14} color={inactive ? C.textMuted : C.tint} />
        </Pressable>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={C.textSecondary} style={{ marginLeft: 4 }} />
      </Pressable>

      {/* 확장 영역 */}
      {expanded && (
        <View style={s.cardBody}>
          <View style={s.divider} />

          {/* 레벨명 */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>레벨 표시명</Text>
            <TextInput
              style={s.input}
              value={lv.level_name}
              onChangeText={v => onUpdate("level_name", v)}
              placeholder="예: 1, A, Beginner, 흰모자"
              placeholderTextColor={C.textMuted}
            />
          </View>

          {/* 레벨 설명 */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>레벨 설명</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={lv.level_description}
              onChangeText={v => onUpdate("level_description", v)}
              placeholder="이 레벨이 어떤 단계인지 간단히 설명"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </View>

          {/* 학습 내용 */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>이 레벨에서 배우는 내용</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={lv.learning_content}
              onChangeText={v => onUpdate("learning_content", v)}
              placeholder="예: 자유형 킥, 배영 팔돌리기, 기초 호흡"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* 승급 기준 */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>다음 레벨 승급 기준 / 테스트</Text>
            <TextInput
              style={[s.input, s.multiline]}
              value={lv.promotion_test_rule}
              onChangeText={v => onUpdate("promotion_test_rule", v)}
              placeholder="예: 자유형 25m 완주, 배영 15m 가능"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          <View style={s.divider} />
          <Text style={s.sectionLabel}>뱃지 설정</Text>

          {/* 뱃지 타입 */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>뱃지 형태</Text>
            <View style={s.badgeTypeRow}>
              {BADGE_TYPES.map(bt => (
                <Pressable
                  key={bt.key}
                  style={[s.typeBtn, lv.badge_type === bt.key && { backgroundColor: C.tint, borderColor: C.tint }]}
                  onPress={() => setBadgeType(bt.key)}
                >
                  <Text style={[s.typeBtnTxt, lv.badge_type === bt.key && { color: "#fff" }]}>{bt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 뱃지 표시 텍스트 (text/mixed) */}
          {lv.badge_type !== "icon" && (
            <View style={s.fieldBlock}>
              <Text style={s.fieldLabel}>뱃지 표시 텍스트</Text>
              <TextInput
                style={s.input}
                value={lv.badge_label}
                onChangeText={onBadgeLabelUpdate}
                placeholder="뱃지에 표시할 짧은 텍스트"
                placeholderTextColor={C.textMuted}
                maxLength={6}
              />
            </View>
          )}

          {/* 색상 선택 */}
          <View style={s.fieldBlock}>
            <Text style={s.fieldLabel}>뱃지 색상</Text>
            <View style={s.colorRow}>
              {BADGE_COLORS.map(col => (
                <Pressable
                  key={col.value}
                  style={[
                    s.colorDot,
                    { backgroundColor: col.value, borderColor: col.value === "#FFFFFF" ? C.border : col.value },
                    lv.badge_color === col.value && s.colorDotSelected,
                  ]}
                  onPress={() => setBadgeColor(col.value)}
                >
                  {lv.badge_color === col.value && (
                    <Feather name="check" size={12} color={isDarkColor(col.value) ? "#fff" : "#333"} />
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          {/* 미리보기 */}
          <View style={s.previewBlock}>
            <Text style={s.fieldLabel}>미리보기</Text>
            <View style={s.previewRow}>
              <LevelBadge level={badgePreview} size="sm" showName />
              <LevelBadge level={badgePreview} size="md" showName />
              <LevelBadge level={badgePreview} size="lg" showName />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 10 },
  saveBtnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoCard: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 16,
  },
  infoTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 20 },
  card: {
    backgroundColor: "#fff", borderRadius: 16, marginBottom: 10,
    borderWidth: 1, borderColor: C.border,
    shadowColor: "#0000000F", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 4, elevation: 1,
  },
  cardInactive: {
    backgroundColor: "#FAFAFA", borderColor: "#DDD9D5", opacity: 0.85,
  },
  inactiveBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#D1D5DB",
  },
  inactiveBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  activeToggle: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginLeft: 8,
  },
  cardHeader: {
    flexDirection: "row", alignItems: "center", padding: 14, gap: 4,
  },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  cardBody: { paddingHorizontal: 14, paddingBottom: 16 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  fieldBlock: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, fontFamily: "Inter_400Regular", color: C.text,
    backgroundColor: C.background,
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  sectionLabel: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 10 },
  badgeTypeRow: { flexDirection: "row", gap: 8 },
  typeBtn: {
    flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
  },
  typeBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  colorDot: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  colorDotSelected: {
    borderWidth: 3, borderColor: "#333",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3,
  },
  previewBlock: { marginTop: 4 },
  previewRow: { flexDirection: "row", gap: 20, alignItems: "flex-end", marginTop: 6, paddingHorizontal: 8 },
  bottomSave: {
    marginTop: 12, padding: 16, borderRadius: 14, alignItems: "center",
  },
  bottomSaveTxt: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
