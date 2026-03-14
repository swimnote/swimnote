/**
 * 학부모 수영장 가입 요청 화면
 * - 수영장 이름 검색
 * - 원하는 수영장 선택
 * - 이름/전화번호 입력 후 가입 요청 제출
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

interface PoolResult { id: string; name: string; address: string | null; }

type Step = "search" | "form" | "done";

interface Child { childName: string; childBirthYear: number | null; }

export default function PoolJoinRequestScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("search");

  // 검색 단계
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPool, setSelectedPool] = useState<PoolResult | null>(null);

  // 폼 단계
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [children, setChildren] = useState<Child[]>([{ childName: "", childBirthYear: null }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/pools/public-search?name=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) setResults(data.data);
      else setError("검색 중 오류가 발생했습니다.");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally { setSearching(false); }
  }

  function handleSelectPool(pool: PoolResult) {
    setSelectedPool(pool);
    setStep("form");
    setError("");
  }

  async function handleSubmit() {
    if (!parentName.trim() || !phone.trim()) { setError("이름과 전화번호를 입력해주세요."); return; }
    const validChildren = children.filter(c => c.childName.trim());
    if (validChildren.length === 0) { setError("최소 1명의 자녀 정보를 입력해주세요."); return; }
    if (!selectedPool) return;
    setSubmitting(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/pool-join-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          swimming_pool_id: selectedPool.id,
          parent_name: parentName.trim(),
          phone: phone.trim(),
          children_requested: validChildren,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "오류가 발생했습니다."); return; }
      setStep("done");
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally { setSubmitting(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>수영장 가입 요청</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 단계 표시 */}
      {step !== "done" && (
        <View style={styles.stepRow}>
          {[
            { n: 1, label: "수영장 검색", active: step === "search" },
            { n: 2, label: "정보 입력",   active: step === "form" },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              <View style={styles.stepItem}>
                <View style={[styles.stepCircle, { backgroundColor: s.active ? C.tint : (step === "form" && i === 0 ? C.success : C.border) }]}>
                  {step === "form" && i === 0
                    ? <Feather name="check" size={14} color="#fff" />
                    : <Text style={[styles.stepNum, { color: s.active ? "#fff" : C.textMuted }]}>{s.n}</Text>
                  }
                </View>
                <Text style={[styles.stepLabel, { color: s.active ? C.tint : C.textMuted }]}>{s.label}</Text>
              </View>
              {i < 1 && <View style={[styles.stepLine, { backgroundColor: step === "form" ? C.success : C.border }]} />}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* ── 검색 단계 ─────────────────────────────────────────── */}
      {step === "search" && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionTitle, { color: C.text }]}>가입할 수영장을 검색하세요</Text>
          <Text style={[styles.sectionSub, { color: C.textSecondary }]}>수영장 이름을 입력하면 검색 결과가 나타납니다</Text>

          <View style={[styles.searchRow, { borderColor: C.border, backgroundColor: C.card }]}>
            <Feather name="search" size={18} color={C.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: C.text }]}
              value={query}
              onChangeText={setQuery}
              placeholder="예: 토이키즈, 아쿠아스타..."
              placeholderTextColor={C.textMuted}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {searching ? (
              <ActivityIndicator size="small" color={C.tint} />
            ) : (
              <Pressable onPress={handleSearch} style={[styles.searchBtn, { backgroundColor: C.tint }]}>
                <Text style={styles.searchBtnText}>검색</Text>
              </Pressable>
            )}
          </View>

          {error ? (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          ) : null}

          {results.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={[styles.resultLabel, { color: C.textSecondary }]}>검색 결과 {results.length}개</Text>
              {results.map(pool => (
                <Pressable
                  key={pool.id}
                  style={({ pressed }) => [styles.poolCard, { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => handleSelectPool(pool)}
                >
                  <View style={[styles.poolIcon, { backgroundColor: C.tintLight }]}>
                    <Feather name="droplet" size={20} color={C.tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.poolName, { color: C.text }]}>{pool.name}</Text>
                    {pool.address && <Text style={[styles.poolAddr, { color: C.textMuted }]}>{pool.address}</Text>}
                  </View>
                  <Feather name="chevron-right" size={18} color={C.textMuted} />
                </Pressable>
              ))}
            </View>
          ) : query && !searching && (
            <View style={styles.emptySearch}>
              <Feather name="search" size={32} color={C.textMuted} />
              <Text style={[styles.emptySearchText, { color: C.textMuted }]}>검색 결과가 없습니다{"\n"}수영장 이름을 다시 확인해주세요</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── 폼 단계 ───────────────────────────────────────────── */}
      {step === "form" && selectedPool && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {/* 선택된 수영장 */}
          <View style={[styles.selectedPool, { backgroundColor: C.tintLight, borderColor: C.tint }]}>
            <View style={[styles.poolIcon, { backgroundColor: "#fff" }]}>
              <Feather name="droplet" size={18} color={C.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.selectedPoolName, { color: C.tint }]}>{selectedPool.name}</Text>
              {selectedPool.address && <Text style={[styles.poolAddr, { color: C.tint }]}>{selectedPool.address}</Text>}
            </View>
            <Pressable onPress={() => setStep("search")} style={styles.changeBtn}>
              <Text style={[styles.changeBtnText, { color: C.tint }]}>변경</Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionTitle, { color: C.text }]}>학부모 정보를 입력하세요</Text>
          <Text style={[styles.sectionSub, { color: C.textSecondary }]}>수영장 관리자가 확인 후 승인 처리합니다</Text>

          {error ? (
            <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
            </View>
          ) : null}

          <View style={{ gap: 14 }}>
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>학부모 이름 *</Text>
              <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <Feather name="user" size={16} color={C.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: C.text }]}
                  value={parentName} onChangeText={setParentName}
                  placeholder="홍길동" placeholderTextColor={C.textMuted}
                />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>전화번호 *</Text>
              <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <Feather name="phone" size={16} color={C.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: C.text }]}
                  value={phone} onChangeText={setPhone}
                  placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                />
              </View>
            </View>
            
            {/* 자녀 정보 */}
            <View style={{ gap: 8, marginTop: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>자녀 정보 *</Text>
                <Pressable
                  onPress={() => setChildren([...children, { childName: "", childBirthYear: null }])}
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={[styles.fieldLabel, { color: C.tint }]}>+ 추가</Text>
                </Pressable>
              </View>
              {children.map((child, idx) => (
                <View key={idx} style={{ gap: 6, paddingBottom: 12, borderBottomWidth: idx < children.length - 1 ? 1 : 0, borderBottomColor: C.border }}>
                  <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Feather name="user" size={14} color={C.textMuted} />
                    <TextInput
                      style={[styles.textInput, { color: C.text }]}
                      value={child.childName} onChangeText={v => { const c = [...children]; c[idx].childName = v; setChildren(c); }}
                      placeholder="자녀 이름" placeholderTextColor={C.textMuted}
                    />
                    {children.length > 1 && (
                      <Pressable onPress={() => setChildren(children.filter((_, i) => i !== idx))}>
                        <Feather name="x" size={16} color={C.error} />
                      </Pressable>
                    )}
                  </View>
                  <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Feather name="calendar" size={14} color={C.textMuted} />
                    <TextInput
                      style={[styles.textInput, { color: C.text }]}
                      value={child.childBirthYear?.toString() || ""} onChangeText={v => { const c = [...children]; c[idx].childBirthYear = v ? parseInt(v) : null; setChildren(c); }}
                      placeholder="출생년도 (예: 2015)" placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.noticeBox, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
            <Feather name="info" size={14} color="#D97706" />
            <Text style={[styles.noticeText, { color: "#92400E" }]}>
              가입 요청 후 수영장 관리자가 승인하면{"\n"}
              SMS로 안내 메시지가 발송됩니다.{"\n"}
              승인 전까지는 앱 이용이 제한됩니다.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.tint, opacity: pressed || submitting ? 0.8 : 1 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <><Feather name="send" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>가입 요청 보내기</Text></>
            )}
          </Pressable>
        </ScrollView>
      )}

      {/* ── 완료 단계 ─────────────────────────────────────────── */}
      {step === "done" && (
        <View style={[styles.doneContainer, { paddingBottom: insets.bottom + 40 }]}>
          <View style={[styles.doneIcon, { backgroundColor: "#D1FAE5" }]}>
            <Feather name="check-circle" size={48} color={C.success} />
          </View>
          <Text style={[styles.doneTitle, { color: C.text }]}>가입 요청이 접수됐어요!</Text>
          <Text style={[styles.doneSub, { color: C.textSecondary }]}>
            {selectedPool?.name} 수영장에{"\n"}
            가입 요청을 보냈습니다.{"\n\n"}
            관리자 승인 후 이용 가능하며{"\n"}
            승인 시 문자로 안내드립니다.
          </Text>
          <Pressable
            style={[styles.doneBtn, { backgroundColor: C.tint }]}
            onPress={() => router.replace("/parent-login")}
          >
            <Text style={styles.doneBtnText}>로그인 화면으로</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, justifyContent: "space-between" },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingVertical: 12, gap: 0 },
  stepItem: { alignItems: "center", gap: 4 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stepLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  stepLine: { flex: 1, height: 2, marginBottom: 14, marginHorizontal: 8 },
  content: { padding: 20, gap: 16 },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sectionSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  searchBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  searchBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  resultLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  poolCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  poolIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  poolName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  poolAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptySearch: { alignItems: "center", paddingTop: 40, gap: 12 },
  emptySearchText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  selectedPool: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  selectedPoolName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  changeBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  changeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  textInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  noticeBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  noticeText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52, borderRadius: 14 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  doneContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 20 },
  doneIcon: { width: 96, height: 96, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  doneTitle: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  doneSub: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  doneBtn: { width: "100%", height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
