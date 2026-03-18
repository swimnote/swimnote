/**
 * 원본 데이터 삭제 (킬 스위치)
 * 3단계: 선택 → 미리보기 + 비밀번호 → 결과
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

function fmtBytes(b: number) {
  if (b === 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

const KS_TYPES = [
  { key: "photo",  label: "사진",     icon: "image"     as const, color: "#F59E0B", bg: "#FEF3C7" },
  { key: "video",  label: "영상",     icon: "video"     as const, color: "#7C3AED", bg: "#EDE9FE" },
  { key: "record", label: "기록/일지", icon: "book-open" as const, color: "#059669", bg: "#D1FAE5" },
];
const MONTH_OPTIONS = [1, 3, 6, 12];

type Step = "select" | "preview" | "done";

export default function DataDeleteScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [step,           setStep]           = useState<Step>("select");
  const [ksType,         setKsType]         = useState("photo");
  const [ksMonths,       setKsMonths]       = useState(3);
  const [preview,        setPreview]        = useState<{ count: number; total_bytes: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [password,       setPassword]       = useState("");
  const [execLoading,    setExecLoading]    = useState(false);
  const [result,         setResult]         = useState<{ ok: boolean; message: string } | null>(null);

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const res = await apiRequest(token, "/admin/kill-switch/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: [ksType], months: ksMonths }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreview({ count: data.count ?? 0, total_bytes: data.total_bytes ?? 0 });
        setStep("preview");
      }
    } catch (e) { console.error(e); }
    finally { setPreviewLoading(false); }
  }

  async function execute() {
    setExecLoading(true);
    try {
      const res = await apiRequest(token, "/admin/kill-switch/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: [ksType], months: ksMonths, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: `삭제 완료: ${data.deleted_count ?? 0}건, ${fmtBytes(data.deleted_bytes ?? 0)} 정리됨` });
      } else {
        setResult({ ok: false, message: data.error || data.message || "알 수 없는 오류" });
      }
      setStep("done");
      setPassword("");
    } catch (e) {
      setResult({ ok: false, message: "서버 오류가 발생했습니다." });
      setStep("done");
    } finally { setExecLoading(false); }
  }

  function reset() {
    setStep("select");
    setPreview(null);
    setPassword("");
    setResult(null);
  }

  const selectedType = KS_TYPES.find(k => k.key === ksType)!;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="원본 데이터 삭제" onBack={() => router.navigate("/(admin)/data-management" as any)} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 120, gap: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 경고 배너 */}
        <View style={s.warnBanner}>
          <Feather name="alert-triangle" size={18} color="#DC2626" />
          <Text style={s.warnText}>삭제된 원본 파일은 복구할 수 없습니다. 이벤트 로그는 보존됩니다.</Text>
        </View>

        {/* ─── STEP 1: 선택 ─── */}
        {step === "select" && (
          <>
            <Text style={s.sectionLabel}>삭제할 데이터 종류</Text>
            {KS_TYPES.map(kt => (
              <Pressable
                key={kt.key}
                onPress={() => setKsType(kt.key)}
                style={[s.typeRow, { borderColor: ksType === kt.key ? kt.color : C.border, backgroundColor: ksType === kt.key ? kt.bg : C.card }]}
              >
                <View style={[s.typeIcon, { backgroundColor: kt.bg }]}>
                  <Feather name={kt.icon} size={20} color={kt.color} />
                </View>
                <Text style={[s.typeLabel, { color: ksType === kt.key ? kt.color : C.text }]}>{kt.label}</Text>
                {ksType === kt.key && <Feather name="check-circle" size={20} color={kt.color} style={{ marginLeft: "auto" }} />}
              </Pressable>
            ))}

            <Text style={[s.sectionLabel, { marginTop: 4 }]}>삭제 기간 (이상 전)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {MONTH_OPTIONS.map(m => (
                <Pressable
                  key={m}
                  onPress={() => setKsMonths(m)}
                  style={[s.monthChip, { borderColor: ksMonths === m ? "#DC2626" : C.border, backgroundColor: ksMonths === m ? "#FEE2E2" : C.card }]}
                >
                  <Text style={[s.monthChipText, { color: ksMonths === m ? "#DC2626" : C.text }]}>{m}개월</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[s.primaryBtn, { backgroundColor: "#DC2626", marginTop: 8 }]}
              onPress={loadPreview}
              disabled={previewLoading}
            >
              {previewLoading
                ? <ActivityIndicator color="#fff" />
                : <><Feather name="search" size={16} color="#fff" /><Text style={s.primaryBtnText}>미리보기</Text></>
              }
            </Pressable>
          </>
        )}

        {/* ─── STEP 2: 미리보기 + 비밀번호 ─── */}
        {step === "preview" && preview && (
          <>
            <View style={s.previewCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <View style={[s.typeIcon, { backgroundColor: selectedType.bg }]}>
                  <Feather name={selectedType.icon} size={18} color={selectedType.color} />
                </View>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#DC2626" }}>
                  {selectedType.label} · {ksMonths}개월 이상 전
                </Text>
              </View>
              <View style={s.previewRow}>
                <Text style={s.previewLabel}>삭제 대상 건수</Text>
                <Text style={s.previewValue}>{preview.count.toLocaleString()}건</Text>
              </View>
              <View style={s.previewRow}>
                <Text style={s.previewLabel}>예상 정리 용량</Text>
                <Text style={s.previewValue}>{fmtBytes(preview.total_bytes)}</Text>
              </View>
            </View>

            <Text style={s.sectionLabel}>관리자 비밀번호 확인</Text>
            <TextInput
              style={s.pwInput}
              placeholder="비밀번호를 입력하세요"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoFocus
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={reset}>
                <Text style={s.secondaryBtnText}>← 다시 선택</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, { flex: 2, backgroundColor: password.length > 0 ? "#DC2626" : "#FCA5A5", opacity: execLoading ? 0.7 : 1 }]}
                onPress={execute}
                disabled={execLoading || password.length === 0}
              >
                {execLoading
                  ? <ActivityIndicator color="#fff" />
                  : <><Feather name="trash-2" size={16} color="#fff" /><Text style={s.primaryBtnText}>영구 삭제</Text></>
                }
              </Pressable>
            </View>
          </>
        )}

        {/* ─── STEP 3: 결과 ─── */}
        {step === "done" && result && (
          <>
            <View style={s.resultCard}>
              <View style={[s.resultIcon, { backgroundColor: result.ok ? "#D1FAE5" : "#FEE2E2" }]}>
                <Feather name={result.ok ? "check-circle" : "alert-circle"} size={36} color={result.ok ? "#059669" : "#DC2626"} />
              </View>
              <Text style={[s.resultMsg, { color: result.ok ? "#059669" : "#DC2626" }]}>{result.message}</Text>
            </View>
            <Pressable style={[s.primaryBtn, { backgroundColor: themeColor }]} onPress={reset}>
              <Text style={s.primaryBtnText}>다시 시작</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  warnBanner:    { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#FEF2F2", padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#FECACA" },
  warnText:      { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#DC2626", lineHeight: 18 },
  sectionLabel:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  typeRow:       { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  typeIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  typeLabel:     { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  monthChip:     { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  monthChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  primaryBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 16 },
  primaryBtnText:{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  secondaryBtn:  { height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6" },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  previewCard:   { backgroundColor: "#FEF2F2", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#FECACA" },
  previewRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  previewLabel:  { fontSize: 14, fontFamily: "Inter_500Medium", color: "#374151" },
  previewValue:  { fontSize: 16, fontFamily: "Inter_700Bold", color: "#DC2626" },
  pwInput:       { height: 50, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, paddingHorizontal: 16, fontSize: 15, fontFamily: "Inter_400Regular", backgroundColor: "#F9FAFB" },
  resultCard:    { alignItems: "center", gap: 16, paddingVertical: 32, backgroundColor: "#F9FAFB", borderRadius: 18 },
  resultIcon:    { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  resultMsg:     { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center", paddingHorizontal: 16 },
});
