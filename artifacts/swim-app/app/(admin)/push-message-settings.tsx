/**
 * (admin)/push-message-settings.tsx — 푸시 발송 설정 (관리자)
 *
 * 섹션:
 *  1. 수업 일정 알림 시간 (전날, 당일 X시간 전)
 *  2. 메시지 템플릿 (공지, 전날, 당일, 일지, 사진)
 */
import { Clock, PenLine, Save } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = {
  background: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#1A1A1A",
  textMuted: "#8A8A8A",
  primary: "#2EC4B6",
};

const TIME_OPTIONS = [
  "07:00","08:00","09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00","17:00","18:00",
  "19:00","20:00","21:00","22:00",
];
const OFFSET_OPTIONS = [1, 2, 3, 4, 6];

interface PoolSettings {
  prev_day_push_time: string;
  same_day_push_offset: number;
  tpl_notice: string;
  tpl_prev_day: string;
  tpl_same_day: string;
  tpl_diary: string;
  tpl_photo: string;
}

const DEFAULTS: PoolSettings = {
  prev_day_push_time: "20:00",
  same_day_push_offset: 1,
  tpl_notice: "📢 새 공지사항이 등록되었습니다.",
  tpl_prev_day: "📅 내일 수업이 있습니다. 준비하세요!",
  tpl_same_day: "⏰ 오늘 수업 {offset}시간 전입니다.",
  tpl_diary: "📒 새 수업 일지가 작성되었습니다.",
  tpl_photo: "📸 새 사진이 업로드되었습니다.",
};

export default function AdminPushMessageSettingsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [settings, setSettings] = useState<PoolSettings>(DEFAULTS);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/push-settings/pool");
      if (res.ok) {
        const { setting } = await res.json();
        setSettings(s => ({ ...s, ...setting }));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await apiRequest(token, "/push-settings/pool", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("저장 실패");
      setConfirmVisible(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const set = (key: keyof PoolSettings, value: string | number) =>
    setSettings(s => ({ ...s, [key]: value }));

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="푸시 발송 설정" homePath="/(admin)/more" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="푸시 발송 설정" homePath="/(admin)/more" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 80 }}
      >
        {/* ── 수업 일정 알림 시간 ── */}
        <View>
          <View style={s.sectionHeader}>
            <Clock size={14} color={themeColor} />
            <Text style={[s.sectionTitle, { color: themeColor }]}>수업 일정 알림 시간</Text>
          </View>
          <View style={s.card}>
            {/* 전날 알림 시간 */}
            <View style={s.row}>
              <View style={s.rowLeft}>
                <Text style={s.label}>전날 수업 알림 시간</Text>
                <Text style={s.subDesc}>전날 이 시각에 내일 수업 학부모에게 발송</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8, flexDirection: "row" }}>
              {TIME_OPTIONS.map(t => (
                <Pressable
                  key={t}
                  onPress={() => set("prev_day_push_time", t)}
                  style={[s.chip, settings.prev_day_push_time === t && { backgroundColor: themeColor, borderColor: themeColor }]}
                >
                  <Text style={[s.chipText, settings.prev_day_push_time === t && { color: "#fff" }]}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={[s.row, { borderTopWidth: 1, borderTopColor: C.border }]}>
              <View style={s.rowLeft}>
                <Text style={s.label}>당일 수업 알림 (수업 전)</Text>
                <Text style={s.subDesc}>수업 시작 N시간 전에 자동 발송</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingBottom: 14 }}>
              {OFFSET_OPTIONS.map(n => (
                <Pressable
                  key={n}
                  onPress={() => set("same_day_push_offset", n)}
                  style={[s.chip, settings.same_day_push_offset === n && { backgroundColor: themeColor, borderColor: themeColor }]}
                >
                  <Text style={[s.chipText, settings.same_day_push_offset === n && { color: "#fff" }]}>{n}시간 전</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* ── 메시지 템플릿 ── */}
        <View>
          <View style={s.sectionHeader}>
            <PenLine size={14} color={themeColor} />
            <Text style={[s.sectionTitle, { color: themeColor }]}>메시지 템플릿</Text>
          </View>
          <View style={s.card}>
            {([
              { key: "tpl_notice",   label: "공지사항 알림",    hint: "공지 등록 시 발송" },
              { key: "tpl_prev_day", label: "전날 수업 알림",    hint: "전날 발송" },
              { key: "tpl_same_day", label: "당일 수업 알림",    hint: "{offset}은 시간(숫자)으로 자동 대체됩니다" },
              { key: "tpl_diary",    label: "수업 일지 알림",    hint: "일지 작성 시 발송" },
              { key: "tpl_photo",    label: "사진 업로드 알림",  hint: "사진 업로드 시 발송" },
            ] as { key: keyof PoolSettings; label: string; hint: string }[]).map((item, idx) => (
              <View key={item.key} style={[s.templateRow, idx > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                <Text style={s.label}>{item.label}</Text>
                <Text style={s.hintText}>{item.hint}</Text>
                <TextInput
                  style={[s.input, { borderColor: C.border }]}
                  value={String(settings[item.key])}
                  onChangeText={v => set(item.key, v)}
                  placeholder={DEFAULTS[item.key] as string}
                  placeholderTextColor={C.textMuted}
                  multiline
                />
              </View>
            ))}
          </View>
        </View>

        {/* ── 저장 버튼 ── */}
        <Pressable
          style={[s.saveBtn, { backgroundColor: C.primary }]}
          onPress={() => setConfirmVisible(true)}
        >
          <Save size={16} color="#fff" />
          <Text style={s.saveBtnText}>설정 저장</Text>
        </Pressable>
      </ScrollView>

      <ConfirmModal
        visible={confirmVisible}
        title="푸시 설정 저장"
        message="변경된 푸시 발송 설정을 저장하시겠습니까?"
        confirmText={saving ? "저장 중..." : "저장"}
        onConfirm={handleSave}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  card:         { backgroundColor: C.card, borderRadius: 14, overflow: "hidden",
                  borderWidth: 1, borderColor: C.border },
  row:          { flexDirection: "row", alignItems: "center", padding: 14 },
  rowLeft:      { flex: 1, gap: 3 },
  label:        { fontSize: 14, fontWeight: "600", color: C.text },
  subDesc:      { fontSize: 12, color: C.textMuted },
  hintText:     { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  chip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  chipText:     { fontSize: 13, fontWeight: "500", color: C.text },
  templateRow:  { padding: 14, gap: 4 },
  input:        { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13,
                  color: C.text, marginTop: 4, lineHeight: 20 },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: 16, borderRadius: 14 },
  saveBtnText:  { fontSize: 15, fontWeight: "700", color: "#fff" },
});
