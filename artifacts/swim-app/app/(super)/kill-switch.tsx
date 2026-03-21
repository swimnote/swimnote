/**
 * (super)/kill-switch.tsx — 킬스위치 (데이터 영구 삭제)
 * 삭제 방식: 전체 / 기간별 / 항목별
 * 실행 전 반드시 확인 요약 표시
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const PURPLE = "#7C3AED";
const RED    = "#DC2626";

type DeleteMode = "all" | "period" | "item";

const PERIOD_OPTS = ["3개월", "6개월", "1년", "직접 입력"];
const PERIOD_MONTHS: Record<string, number | null> = {
  "3개월": 3, "6개월": 6, "1년": 12, "직접 입력": null,
};

const ITEM_OPTS = [
  { key: "photo",       label: "사진",   icon: "image" as const },
  { key: "video",       label: "영상",   icon: "video" as const },
  { key: "diary",       label: "수업일지", icon: "edit-3" as const },
  { key: "attendance",  label: "출결",   icon: "check-square" as const },
  { key: "makeup",      label: "보강",   icon: "repeat" as const },
  { key: "memo",        label: "메모",   icon: "file-text" as const },
  { key: "message",     label: "쪽지",   icon: "message-square" as const },
];

function fmtBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function KillSwitchScreen() {
  const { token } = useAuth();

  const [mode,         setMode]         = useState<DeleteMode | null>(null);
  const [periodOpt,    setPeriodOpt]    = useState("3개월");
  const [customMonths, setCustomMonths] = useState("");
  const [items,        setItems]        = useState<Set<string>>(new Set());
  const [password,     setPassword]     = useState("");

  const [preview,  setPreview]  = useState<any | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);
  const [executing, setExecuting] = useState(false);

  function toggleItem(key: string) {
    setItems(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function getMonths(): number {
    if (mode === "all") return 0;
    if (periodOpt === "직접 입력") return parseInt(customMonths) || 1;
    return PERIOD_MONTHS[periodOpt] || 3;
  }

  function getTypes(): string[] {
    if (mode === "all") return ["photo", "video", "diary", "attendance", "makeup", "memo", "message"];
    if (mode === "period") return ["photo", "video", "diary", "attendance", "makeup", "memo", "message"];
    return Array.from(items);
  }

  async function handlePreview() {
    setError(""); setPreview(null);
    if (mode === "item" && items.size === 0) { setError("삭제할 항목을 선택해주세요."); return; }
    if (mode === "period" && periodOpt === "직접 입력" && !parseInt(customMonths)) {
      setError("기간을 입력해주세요."); return;
    }

    setLoading(true);
    try {
      const months = mode === "all" ? 0 : getMonths();
      const types = getTypes();
      const res = await apiRequest(token, "/admin/kill-switch/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: months || undefined, types }),
      });
      if (res.ok) {
        setPreview(await res.json());
        setShowConf(true);
      } else {
        const d = await res.json();
        setError(d.error || "미리보기 실패");
      }
    } catch { setError("네트워크 오류"); }
    finally { setLoading(false); }
  }

  async function handleExecute() {
    if (!password) { setError("비밀번호를 입력해주세요."); return; }
    setError(""); setExecuting(true);
    try {
      const months = mode === "all" ? 0 : getMonths();
      const types = getTypes();
      const res = await apiRequest(token, "/admin/kill-switch/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: months || undefined, types, password }),
      });
      if (res.ok) {
        setShowConf(false);
        setDone(true);
        setMode(null);
        setItems(new Set());
        setPassword("");
      } else {
        const d = await res.json();
        setError(d.error || "삭제 실패");
      }
    } catch { setError("네트워크 오류"); }
    finally { setExecuting(false); }
  }

  const months = getMonths();
  const types  = getTypes();

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="킬스위치" homePath="/(super)/dashboard" />

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 60 }}>

        {/* 경고 배너 */}
        <View style={s.warnBanner}>
          <Feather name="alert-triangle" size={20} color={RED} />
          <Text style={s.warnText}>
            삭제된 데이터는 <Text style={{ fontFamily: "Inter_700Bold" }}>복구되지 않습니다</Text>.{"\n"}
            실행 전 반드시 내용을 확인하세요.
          </Text>
        </View>

        {done && (
          <View style={[s.warnBanner, { backgroundColor: "#D1FAE5", borderLeftColor: "#10B981" }]}>
            <Feather name="check-circle" size={18} color="#059669" />
            <Text style={[s.warnText, { color: "#065F46" }]}>삭제가 완료되었습니다.</Text>
          </View>
        )}

        {/* 삭제 방식 선택 */}
        <View>
          <Text style={s.sectionTitle}>삭제 방식</Text>
          <View style={s.modeRow}>
            {([
              { id: "all" as const,    label: "전체 삭제",   icon: "trash-2" as const,   color: RED },
              { id: "period" as const, label: "기간별 삭제", icon: "calendar" as const,  color: "#D97706" },
              { id: "item" as const,   label: "항목별 삭제", icon: "filter" as const,    color: PURPLE },
            ]).map(m => (
              <Pressable key={m.id}
                style={[s.modeCard, mode === m.id && { borderColor: m.color, backgroundColor: m.color + "10" }]}
                onPress={() => { setMode(m.id); setPreview(null); setError(""); setDone(false); }}>
                <Feather name={m.icon} size={22} color={mode === m.id ? m.color : "#9CA3AF"} />
                <Text style={[s.modeLabel, mode === m.id && { color: m.color }]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 기간 선택 (기간별 / 전체) */}
        {(mode === "period" || mode === "all") && mode !== "all" && (
          <View>
            <Text style={s.sectionTitle}>삭제 기간</Text>
            <View style={s.chipRow}>
              {PERIOD_OPTS.map(opt => (
                <Pressable key={opt}
                  style={[s.chip, periodOpt === opt && s.chipActive]}
                  onPress={() => setPeriodOpt(opt)}>
                  <Text style={[s.chipTxt, periodOpt === opt && s.chipActiveTxt]}>{opt}</Text>
                </Pressable>
              ))}
            </View>
            {periodOpt === "직접 입력" && (
              <View style={s.customInput}>
                <TextInput style={s.input} value={customMonths} onChangeText={setCustomMonths}
                  keyboardType="number-pad" placeholder="개월 수 입력" placeholderTextColor="#9CA3AF" />
                <Text style={s.inputUnit}>개월</Text>
              </View>
            )}
          </View>
        )}

        {/* 항목 선택 (항목별) */}
        {mode === "item" && (
          <View>
            <Text style={s.sectionTitle}>삭제 항목</Text>
            <View style={s.itemGrid}>
              {ITEM_OPTS.map(opt => {
                const checked = items.has(opt.key);
                return (
                  <Pressable key={opt.key}
                    style={[s.itemChip, checked && s.itemChipActive]}
                    onPress={() => toggleItem(opt.key)}>
                    <Feather name={opt.icon} size={15} color={checked ? PURPLE : "#6B7280"} />
                    <Text style={[s.itemChipTxt, checked && { color: PURPLE }]}>{opt.label}</Text>
                    {checked && <Feather name="check" size={13} color={PURPLE} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* 전체 삭제 안내 */}
        {mode === "all" && (
          <View style={[s.warnBanner, { backgroundColor: "#FEF2F2", borderLeftColor: RED }]}>
            <Feather name="alert-octagon" size={18} color={RED} />
            <Text style={[s.warnText, { color: RED }]}>
              모든 기간·모든 항목(사진, 영상, 수업일지, 출결, 보강, 메모, 쪽지)이 영구 삭제됩니다.
            </Text>
          </View>
        )}

        {!!error && <Text style={s.errorTxt}>{error}</Text>}

        {/* 실행 버튼 */}
        {mode && (
          <Pressable
            style={[s.execBtn, { opacity: loading ? 0.6 : 1 }]}
            onPress={handlePreview} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="eye" size={16} color="#fff" />
                 <Text style={s.execBtnTxt}>삭제 대상 미리보기</Text></>
            }
          </Pressable>
        )}
      </ScrollView>

      {/* 확인 모달 */}
      {showConf && preview && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setShowConf(false)}>
          <Pressable style={m.backdrop} onPress={() => setShowConf(false)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <View style={m.header}>
                <Feather name="alert-triangle" size={22} color={RED} />
                <Text style={m.title}>삭제 실행 확인</Text>
                <Pressable onPress={() => setShowConf(false)} style={{ marginLeft: "auto", padding: 4 }}>
                  <Feather name="x" size={20} color="#6B7280" />
                </Pressable>
              </View>

              <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}>

                {/* 요약 */}
                <View style={m.summaryBox}>
                  <Text style={m.summaryTitle}>삭제 대상 요약</Text>
                  <View style={m.summaryRow}>
                    <Text style={m.summaryLabel}>기간</Text>
                    <Text style={m.summaryVal}>
                      {mode === "all" ? "전체 (기간 무관)" : `${months}개월 이전`}
                    </Text>
                  </View>
                  <View style={m.summaryRow}>
                    <Text style={m.summaryLabel}>항목</Text>
                    <Text style={m.summaryVal} numberOfLines={2}>
                      {types.map(t => {
                        const i = ITEM_OPTS.find(o => o.key === t);
                        return i?.label ?? t;
                      }).join(", ")}
                    </Text>
                  </View>
                </View>

                {/* 예상 삭제량 */}
                <View style={m.previewBox}>
                  <Text style={m.previewTitle}>예상 삭제량</Text>
                  {[
                    { label: "사진",    cnt: preview.photo_count,      bytes: preview.photo_bytes },
                    { label: "영상",    cnt: preview.video_count,      bytes: preview.video_bytes },
                    { label: "수업일지", cnt: preview.record_count,     bytes: preview.record_bytes },
                  ].map(r => r.cnt > 0 && (
                    <View key={r.label} style={m.previewRow}>
                      <Text style={m.previewLabel}>{r.label}</Text>
                      <Text style={m.previewVal}>{r.cnt}개 ({fmtBytes(r.bytes)})</Text>
                    </View>
                  ))}
                  <View style={[m.previewRow, { borderTopWidth: 1, borderTopColor: "#F3F4F6", marginTop: 8, paddingTop: 8 }]}>
                    <Text style={[m.previewLabel, { fontFamily: "Inter_700Bold" }]}>합계</Text>
                    <Text style={[m.previewVal, { color: RED, fontFamily: "Inter_700Bold" }]}>
                      {fmtBytes((preview.photo_bytes || 0) + (preview.video_bytes || 0) + (preview.record_bytes || 0))}
                    </Text>
                  </View>
                </View>

                {/* 복구 불가 경고 */}
                <View style={m.dangerBox}>
                  <Feather name="alert-octagon" size={15} color={RED} />
                  <Text style={m.dangerTxt}>이 작업은 되돌릴 수 없습니다. 삭제된 데이터는 복구되지 않습니다.</Text>
                </View>

                {/* 비밀번호 확인 */}
                <View>
                  <Text style={m.passLabel}>계정 비밀번호 입력</Text>
                  <TextInput style={m.passInput} value={password} onChangeText={setPassword}
                    secureTextEntry placeholder="비밀번호" placeholderTextColor="#9CA3AF" />
                </View>

                {!!error && <Text style={s.errorTxt}>{error}</Text>}

                <Pressable style={[m.execBtn, { opacity: executing ? 0.6 : 1 }]}
                  onPress={handleExecute} disabled={executing}>
                  {executing
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="trash-2" size={16} color="#fff" />
                       <Text style={m.execBtnTxt}>영구 삭제 실행</Text></>
                  }
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F5F3FF" },
  warnBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10,
                backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14,
                borderLeftWidth: 4, borderLeftColor: RED },
  warnText:   { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#7F1D1D", lineHeight: 20 },
  sectionTitle:{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 10 },
  modeRow:    { flexDirection: "row", gap: 10 },
  modeCard:   { flex: 1, alignItems: "center", gap: 8, padding: 16, backgroundColor: "#fff",
                borderRadius: 16, borderWidth: 2, borderColor: "#E5E7EB" },
  modeLabel:  { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280", textAlign: "center" },
  chipRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
                borderColor: "#E5E7EB", backgroundColor: "#fff" },
  chipActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  chipTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  chipActiveTxt: { color: "#fff" },
  customInput:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  input:      { flex: 1, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10,
                padding: 10, fontSize: 15, fontFamily: "Inter_500Medium",
                backgroundColor: "#fff", color: "#111827" },
  inputUnit:  { fontSize: 14, fontFamily: "Inter_500Medium", color: "#6B7280" },
  itemGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  itemChip:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12,
                paddingVertical: 9, borderRadius: 12, backgroundColor: "#fff",
                borderWidth: 1.5, borderColor: "#E5E7EB" },
  itemChipActive: { borderColor: PURPLE, backgroundColor: "#EDE9FE" },
  itemChipTxt:{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  errorTxt:   { fontSize: 13, fontFamily: "Inter_500Medium", color: RED, textAlign: "center" },
  execBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                backgroundColor: RED, borderRadius: 14, paddingVertical: 16 },
  execBtnTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

const m = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0,
                 backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                 maxHeight: "85%", paddingBottom: 10 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                 alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "center", gap: 10,
                 paddingHorizontal: 20, paddingVertical: 14 },
  title:       { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryBox:  { backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, gap: 8 },
  summaryTitle:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 4 },
  summaryRow:  { flexDirection: "row", gap: 8 },
  summaryLabel:{ width: 40, fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  summaryVal:  { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#111827" },
  previewBox:  { backgroundColor: "#FEF2F2", borderRadius: 12, padding: 14, gap: 6 },
  previewTitle:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 4 },
  previewRow:  { flexDirection: "row", justifyContent: "space-between" },
  previewLabel:{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
  previewVal:  { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },
  dangerBox:   { flexDirection: "row", alignItems: "flex-start", gap: 8,
                 backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12,
                 borderLeftWidth: 3, borderLeftColor: RED },
  dangerTxt:   { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: RED },
  passLabel:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  passInput:   { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                 fontSize: 15, fontFamily: "Inter_400Regular", color: "#111827", backgroundColor: "#F9FAFB" },
  execBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                 backgroundColor: RED, borderRadius: 14, paddingVertical: 16 },
  execBtnTxt:  { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
