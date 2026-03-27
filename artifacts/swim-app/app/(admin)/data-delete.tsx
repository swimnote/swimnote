/**
 * 삭제·보존 정책 허브
 * A. 복구 가능 데이터   B. 보존 기간 정책   C. 원본 데이터 삭제 (킬 스위치)
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
  { key: "photo",  label: "사진",      icon: "image"     as const, color: "#1B4965", bg: "#E6FAF8" },
  { key: "video",  label: "영상",      icon: "video"     as const, color: "#1B4965", bg: "#E6FAF8" },
  { key: "record", label: "기록/일지", icon: "book-open" as const, color: "#1B4965", bg: "#E6FAF8" },
];

const MONTH_OPTIONS = [1, 3, 6, 12];

const RETENTION_TYPES = [
  { key: "photo",     label: "사진",       icon: "image"      as const, color: "#1B4965", bg: "#E6FAF8" },
  { key: "video",     label: "영상",       icon: "video"      as const, color: "#1B4965", bg: "#E6FAF8" },
  { key: "record",    label: "기록/일지",  icon: "book-open"  as const, color: "#1B4965", bg: "#E6FAF8" },
  { key: "messenger", label: "메신저",     icon: "message-square" as const, color: "#1B4965", bg: "#E6FAF8" },
];
const RETENTION_OPTIONS = [6, 12, 24, 36, 0]; // 0 = 영구 보관

function retentionLabel(m: number) {
  if (m === 0) return "영구 보관";
  if (m < 12) return `${m}개월`;
  return `${m / 12}년`;
}

type KsStep = "select" | "preview" | "done";

export default function DataDeleteScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  /* ─ 보존 기간 정책 상태 ─ */
  const [retention, setRetention] = useState<Record<string, number>>({
    photo: 12, video: 24, record: 36, messenger: 0,
  });
  const [retentionSaved, setRetentionSaved] = useState(false);

  /* ─ 킬 스위치 상태 ─ */
  const [step,           setStep]           = useState<KsStep>("select");
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

  function resetKs() {
    setStep("select");
    setPreview(null);
    setPassword("");
    setResult(null);
  }

  const selectedType = KS_TYPES.find(k => k.key === ksType)!;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="삭제·보존 정책" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 40, gap: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ═══ A. 복구 가능 데이터 ═══ */}
        <View>
          <View style={s.sectionHeader}>
            <View style={[s.sectionDot, { backgroundColor: "#2EC4B6" }]} />
            <View>
              <Text style={s.sectionTitle}>복구 가능 데이터</Text>
              <Text style={s.sectionSub}>소프트 삭제된 회원·데이터 — 아직 복구 가능</Text>
            </View>
          </View>
          <View style={[s.card, { backgroundColor: C.card }]}>
            <Pressable
              style={({ pressed }) => [s.menuRow, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => router.push("/(admin)/withdrawn-members")}
            >
              <View style={[s.menuIcon, { backgroundColor: "#E6FFFA" }]}>
                <Feather name="user-x" size={20} color="#2EC4B6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.menuLabel}>탈퇴·삭제 회원</Text>
                <Text style={s.menuSub}>소프트 삭제 상태 — 원본 데이터 복구 가능</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          </View>
          <View style={s.infoBox}>
            <Feather name="info" size={13} color="#2EC4B6" />
            <Text style={s.infoText}>탈퇴 후 보존 기간 안에는 관리자가 데이터를 복구할 수 있습니다. 보존 기간 초과 시 자동 파기됩니다.</Text>
          </View>
        </View>

        {/* ═══ B. 보존 기간 정책 ═══ */}
        <View>
          <View style={s.sectionHeader}>
            <View style={[s.sectionDot, { backgroundColor: "#2EC4B6" }]} />
            <View>
              <Text style={s.sectionTitle}>보존 기간 정책</Text>
              <Text style={s.sectionSub}>데이터 유형별 자동 파기 기간 설정</Text>
            </View>
          </View>
          <View style={[s.card, { backgroundColor: C.card }]}>
            {RETENTION_TYPES.map((rt, idx) => (
              <View
                key={rt.key}
                style={[s.retentionRow, idx < RETENTION_TYPES.length - 1 && s.rowBorder]}
              >
                <View style={[s.menuIcon, { backgroundColor: rt.bg }]}>
                  <Feather name={rt.icon} size={18} color={rt.color} />
                </View>
                <Text style={[s.menuLabel, { flex: 1 }]}>{rt.label}</Text>
                <View style={s.chipRow}>
                  {RETENTION_OPTIONS.map(m => (
                    <Pressable
                      key={m}
                      onPress={() => { setRetention(prev => ({ ...prev, [rt.key]: m })); setRetentionSaved(false); }}
                      style={[
                        s.chip,
                        retention[rt.key] === m && { backgroundColor: "#E6FFFA", borderColor: "#2EC4B6" },
                      ]}
                    >
                      <Text style={[s.chipText, retention[rt.key] === m && { color: "#2EC4B6" }]}>
                        {retentionLabel(m)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
          <Pressable
            style={[s.saveBtn, { backgroundColor: retentionSaved ? "#2EC4B6" : themeColor }]}
            onPress={() => setRetentionSaved(true)}
          >
            <Feather name={retentionSaved ? "check" : "save"} size={15} color="#fff" />
            <Text style={s.saveBtnText}>{retentionSaved ? "저장됨" : "보존 정책 저장"}</Text>
          </Pressable>
        </View>

        {/* ═══ C. 원본 데이터 삭제 (킬 스위치) ═══ */}
        <View>
          <View style={s.sectionHeader}>
            <View style={[s.sectionDot, { backgroundColor: "#D96C6C" }]} />
            <View>
              <Text style={s.sectionTitle}>원본 데이터 삭제</Text>
              <Text style={s.sectionSub}>복구 불가 — 선택 기간 파일 영구 삭제</Text>
            </View>
          </View>

          <View style={s.warnBanner}>
            <Feather name="alert-triangle" size={16} color="#D96C6C" />
            <Text style={s.warnText}>삭제된 원본 파일은 복구할 수 없습니다. 이벤트 로그는 보존됩니다.</Text>
          </View>

          {/* STEP 1: 선택 */}
          {step === "select" && (
            <View style={{ gap: 12, marginTop: 12 }}>
              <Text style={s.stepLabel}>삭제할 데이터 종류</Text>
              {KS_TYPES.map(kt => (
                <Pressable
                  key={kt.key}
                  onPress={() => setKsType(kt.key)}
                  style={[s.typeRow, { borderColor: ksType === kt.key ? kt.color : C.border, backgroundColor: ksType === kt.key ? kt.bg : C.card }]}
                >
                  <View style={[s.menuIcon, { backgroundColor: kt.bg }]}>
                    <Feather name={kt.icon} size={20} color={kt.color} />
                  </View>
                  <Text style={[s.menuLabel, { color: ksType === kt.key ? kt.color : C.text }]}>{kt.label}</Text>
                  {ksType === kt.key && <Feather name="check-circle" size={20} color={kt.color} style={{ marginLeft: "auto" }} />}
                </Pressable>
              ))}

              <Text style={[s.stepLabel, { marginTop: 4 }]}>삭제 기간 (이상 전)</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {MONTH_OPTIONS.map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setKsMonths(m)}
                    style={[s.monthChip, { borderColor: ksMonths === m ? "#D96C6C" : C.border, backgroundColor: ksMonths === m ? "#F9DEDA" : C.card }]}
                  >
                    <Text style={[s.monthChipText, { color: ksMonths === m ? "#D96C6C" : C.text }]}>{m}개월</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={[s.primaryBtn, { backgroundColor: "#D96C6C", marginTop: 4 }]}
                onPress={loadPreview}
                disabled={previewLoading}
              >
                {previewLoading
                  ? <ActivityIndicator color="#fff" />
                  : <><Feather name="search" size={16} color="#fff" /><Text style={s.primaryBtnText}>미리보기</Text></>
                }
              </Pressable>
            </View>
          )}

          {/* STEP 2: 미리보기 + 비밀번호 */}
          {step === "preview" && preview && (
            <View style={{ gap: 12, marginTop: 12 }}>
              <View style={s.previewCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <View style={[s.menuIcon, { backgroundColor: selectedType.bg }]}>
                    <Feather name={selectedType.icon} size={18} color={selectedType.color} />
                  </View>
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#D96C6C" }}>
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

              <Text style={s.stepLabel}>관리자 비밀번호 확인</Text>
              <TextInput
                style={s.pwInput}
                placeholder="비밀번호를 입력하세요"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                autoFocus
              />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={resetKs}>
                  <Text style={s.secondaryBtnText}>← 다시 선택</Text>
                </Pressable>
                <Pressable
                  style={[s.primaryBtn, { flex: 2, backgroundColor: password.length > 0 ? "#D96C6C" : "#FCA5A5", opacity: execLoading ? 0.7 : 1 }]}
                  onPress={execute}
                  disabled={execLoading || password.length === 0}
                >
                  {execLoading
                    ? <ActivityIndicator color="#fff" />
                    : <><Feather name="trash-2" size={16} color="#fff" /><Text style={s.primaryBtnText}>영구 삭제</Text></>
                  }
                </Pressable>
              </View>
            </View>
          )}

          {/* STEP 3: 결과 */}
          {step === "done" && result && (
            <View style={{ gap: 12, marginTop: 12 }}>
              <View style={s.resultCard}>
                <View style={[s.resultIcon, { backgroundColor: result.ok ? "#E6FFFA" : "#F9DEDA" }]}>
                  <Feather name={result.ok ? "check-circle" : "alert-circle"} size={36} color={result.ok ? "#2EC4B6" : "#D96C6C"} />
                </View>
                <Text style={[s.resultMsg, { color: result.ok ? "#2EC4B6" : "#D96C6C" }]}>{result.message}</Text>
              </View>
              <Pressable style={[s.primaryBtn, { backgroundColor: C.button }]} onPress={resetKs}>
                <Text style={s.primaryBtnText}>다시 시작</Text>
              </Pressable>
            </View>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  sectionDot:    { width: 4, height: "100%" as any, borderRadius: 2, minHeight: 36, marginTop: 2 },
  sectionTitle:  { fontSize: 16, fontFamily: "Pretendard-Bold", color: C.text },
  sectionSub:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },

  card:         { borderRadius: 16, overflow: "hidden", backgroundColor: "#fff", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  menuRow:      { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  menuIcon:     { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  menuLabel:    { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.text },
  menuSub:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },

  infoBox:  { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 10, padding: 10, backgroundColor: "#DFF3EC", borderRadius: 10 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#065F46", lineHeight: 18 },

  retentionRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, padding: 14 },
  rowBorder:    { borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  chipRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip:         { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: "#F1F5F9" },
  chipText:     { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },

  saveBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 14, marginTop: 10 },
  saveBtnText: { fontSize: 14, fontFamily: "Pretendard-Bold", color: "#fff" },

  warnBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#FEF2F2", padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#FECACA" },
  warnText:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Medium", color: "#D96C6C", lineHeight: 18 },

  stepLabel:    { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#6B7280" },
  typeRow:      { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  monthChip:    { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  monthChipText:{ fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  primaryBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 16 },
  primaryBtnText: { fontSize: 15, fontFamily: "Pretendard-Bold", color: "#fff" },
  secondaryBtn:   { height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFC" },
  secondaryBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#6B7280" },

  previewCard:  { backgroundColor: "#FEF2F2", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#FECACA" },
  previewRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  previewLabel: { fontSize: 14, fontFamily: "Pretendard-Medium", color: "#111827" },
  previewValue: { fontSize: 16, fontFamily: "Pretendard-Bold", color: "#D96C6C" },

  pwInput:   { height: 50, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, paddingHorizontal: 16, fontSize: 15, fontFamily: "Pretendard-Regular", backgroundColor: "#F1F5F9" },
  resultCard:{ alignItems: "center", gap: 16, paddingVertical: 32, backgroundColor: "#F1F5F9", borderRadius: 18 },
  resultIcon:{ width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  resultMsg: { fontSize: 16, fontFamily: "Pretendard-Bold", textAlign: "center", paddingHorizontal: 16 },
});
