import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, API_BASE, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

interface PoolResult { id: string; name: string; address: string | null; }
type Step = "pool" | "child" | "done" | "pending";

export default function LinkChildScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { refresh } = useParent();

  const [step, setStep]               = useState<Step>("pool");
  const [query, setQuery]             = useState("");
  const [results, setResults]         = useState<PoolResult[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selectedPool, setSelectedPool] = useState<PoolResult | null>(null);

  const [childName, setChildName]     = useState("");
  const [birthYear, setBirthYear]     = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [linkedName, setLinkedName]   = useState("");
  const [error, setError]             = useState("");

  async function searchPools() {
    if (!query.trim()) return;
    setSearching(true); setError("");
    try {
      const r = await fetch(`${API_BASE}/pools/public-search?name=${encodeURIComponent(query)}`);
      const d = await r.json();
      if (d.success) setResults(d.data ?? []);
      else setError("검색 중 오류가 발생했습니다.");
    } catch { setError("네트워크 오류가 발생했습니다."); }
    finally { setSearching(false); }
  }

  async function handleLink() {
    if (!childName.trim()) { setError("자녀 이름을 입력해주세요."); return; }
    if (!selectedPool) return;
    setSubmitting(true); setError("");
    try {
      const r = await apiRequest(token, "/parent/link-child", {
        method: "POST",
        body: JSON.stringify({
          swimming_pool_id: selectedPool.id,
          child_name: childName.trim(),
          child_birth_year: birthYear ? Number(birthYear) : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "오류가 발생했습니다."); return; }

      if (d.status === "auto_approved") {
        setLinkedName(d.student?.name || childName.trim());
        setStep("done");
        await refresh();
      } else {
        setStep("pending");
      }
    } catch { setError("네트워크 오류가 발생했습니다."); }
    finally { setSubmitting(false); }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 헤더 */}
      <View style={[st.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={st.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[st.title, { color: C.text }]}>자녀 연결하기</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── 1단계: 수영장 검색 ─────────────────────────────────── */}
      {step === "pool" && (
        <ScrollView
          contentContainerStyle={[st.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[st.sectionTitle, { color: C.text }]}>자녀가 다니는 수영장을 찾아주세요</Text>

          <View style={[st.searchRow, { borderColor: C.border, backgroundColor: C.card }]}>
            <Feather name="search" size={18} color={C.textMuted} />
            <TextInput
              style={[st.searchInput, { color: C.text }]}
              value={query} onChangeText={setQuery}
              placeholder="수영장 이름 입력..."
              placeholderTextColor={C.textMuted}
              returnKeyType="search"
              onSubmitEditing={searchPools}
            />
            {searching
              ? <ActivityIndicator size="small" color={C.tint} />
              : <Pressable onPress={searchPools} style={[st.searchBtn, { backgroundColor: C.button }]}>
                  <Text style={st.searchBtnTxt}>검색</Text>
                </Pressable>
            }
          </View>

          {!!error && (
            <View style={[st.errBox, { backgroundColor: "#F9DEDA" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[st.errTxt, { color: C.error }]}>{error}</Text>
            </View>
          )}

          {results.map(pool => (
            <Pressable
              key={pool.id}
              style={({ pressed }) => [st.poolCard, { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
              onPress={() => { setSelectedPool(pool); setStep("child"); setError(""); }}
            >
              <View style={[st.poolIcon, { backgroundColor: C.tintLight }]}>
                <Feather name="droplet" size={20} color={C.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.poolName, { color: C.text }]}>{pool.name}</Text>
                {pool.address && <Text style={[st.poolAddr, { color: C.textMuted }]}>{pool.address}</Text>}
              </View>
              <Feather name="chevron-right" size={18} color={C.textMuted} />
            </Pressable>
          ))}

          {results.length === 0 && query && !searching && (
            <View style={st.emptyBox}>
              <Feather name="search" size={28} color={C.textMuted} />
              <Text style={[st.emptyTxt, { color: C.textMuted }]}>검색 결과가 없습니다</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── 2단계: 자녀 정보 입력 ─────────────────────────────── */}
      {step === "child" && selectedPool && (
        <ScrollView
          contentContainerStyle={[st.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* 선택된 수영장 */}
          <View style={[st.selectedPool, { backgroundColor: C.tintLight, borderColor: C.tint }]}>
            <Feather name="droplet" size={16} color={C.tint} />
            <Text style={[st.selectedPoolName, { color: C.tint }]}>{selectedPool.name}</Text>
            <Pressable onPress={() => { setStep("pool"); setError(""); }}>
              <Text style={{ color: C.tint, fontSize: 13, fontFamily: "Pretendard-Medium" }}>변경</Text>
            </Pressable>
          </View>

          <Text style={[st.sectionTitle, { color: C.text }]}>자녀 정보를 입력해주세요</Text>
          <Text style={[st.sectionSub, { color: C.textSecondary }]}>
            수영장에 등록된 이름과 일치하면 바로 연결됩니다.
          </Text>

          {!!error && (
            <View style={[st.errBox, { backgroundColor: "#F9DEDA" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[st.errTxt, { color: C.error }]}>{error}</Text>
            </View>
          )}

          <View style={{ gap: 14 }}>
            <View style={{ gap: 6 }}>
              <Text style={[st.label, { color: C.textSecondary }]}>자녀 이름 *</Text>
              <View style={[st.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <Feather name="user" size={16} color={C.textMuted} />
                <TextInput
                  style={[st.input, { color: C.text }]}
                  value={childName} onChangeText={setChildName}
                  placeholder="홍길동" placeholderTextColor={C.textMuted}
                />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={[st.label, { color: C.textSecondary }]}>출생 연도 (선택)</Text>
              <View style={[st.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <Feather name="calendar" size={16} color={C.textMuted} />
                <TextInput
                  style={[st.input, { color: C.text }]}
                  value={birthYear} onChangeText={setBirthYear}
                  placeholder="예: 2015" placeholderTextColor={C.textMuted}
                  keyboardType="number-pad" maxLength={4}
                />
              </View>
            </View>
          </View>

          <Pressable
            style={[st.submitBtn, { backgroundColor: C.button, opacity: submitting ? 0.7 : 1 }]}
            onPress={handleLink}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={st.submitTxt}>연결하기</Text>
            }
          </Pressable>
        </ScrollView>
      )}

      {/* ── 완료: 자동 연결 ───────────────────────────────────── */}
      {step === "done" && (
        <View style={st.resultBox}>
          <View style={[st.resultIcon, { backgroundColor: "#E6FFFA" }]}>
            <Feather name="check-circle" size={44} color="#2EC4B6" />
          </View>
          <Text style={[st.resultTitle, { color: C.text }]}>연결 완료!</Text>
          <Text style={[st.resultSub, { color: C.textSecondary }]}>
            {linkedName}이(가) {selectedPool?.name}과{"\n"}성공적으로 연결되었습니다.
          </Text>
          <Pressable
            style={[st.submitBtn, { backgroundColor: C.button, alignSelf: "stretch", marginHorizontal: 32 }]}
            onPress={() => router.replace("/(parent)/home" as any)}
          >
            <Text style={st.submitTxt}>홈으로 이동</Text>
          </Pressable>
        </View>
      )}

      {/* ── 대기 중: 미매칭 ──────────────────────────────────── */}
      {step === "pending" && (
        <View style={st.resultBox}>
          <View style={[st.resultIcon, { backgroundColor: "#FFF1BF" }]}>
            <Feather name="clock" size={44} color="#D97706" />
          </View>
          <Text style={[st.resultTitle, { color: C.text }]}>관리자 확인 중</Text>
          <Text style={[st.resultSub, { color: C.textSecondary }]}>
            수영장에 등록된 학생을 찾지 못했습니다.{"\n"}관리자 확인 후 연결됩니다.
          </Text>
          <Pressable
            style={[st.submitBtn, { backgroundColor: C.button, alignSelf: "stretch", marginHorizontal: 32 }]}
            onPress={() => router.replace("/(parent)/home" as any)}
          >
            <Text style={st.submitTxt}>홈으로 이동</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:          { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  title:            { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  content:          { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  sectionTitle:     { fontSize: 17, fontFamily: "Pretendard-Bold" },
  sectionSub:       { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  searchRow:        { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput:      { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  searchBtn:        { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  searchBtnTxt:     { color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  errBox:           { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errTxt:           { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  poolCard:         { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  poolIcon:         { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  poolName:         { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  poolAddr:         { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  emptyBox:         { alignItems: "center", gap: 10, marginTop: 40 },
  emptyTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular" },
  selectedPool:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  selectedPoolName: { flex: 1, fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  label:            { fontSize: 13, fontFamily: "Pretendard-Medium" },
  inputRow:         { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  input:            { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  submitBtn:        { height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 8 },
  submitTxt:        { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  resultBox:        { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32, gap: 20 },
  resultIcon:       { width: 88, height: 88, borderRadius: 44, justifyContent: "center", alignItems: "center" },
  resultTitle:      { fontSize: 22, fontFamily: "Pretendard-Bold" },
  resultSub:        { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
});
