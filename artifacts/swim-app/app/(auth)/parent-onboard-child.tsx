/**
 * parent-onboard-child.tsx — STEP 2: 자녀 검색 및 선택
 * 수영장 학생 명부에서 이름으로 검색 → 직접 선택 → simple-parent-register 호출
 */
import {
  ArrowLeft, Check, CircleAlert, Droplet, Minus,
  Plus, Search, UserCheck, X,
} from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface StudentInfo { id: string; name: string; birth_year?: string | null; }

export default function ParentOnboardChildScreen() {
  const insets = useSafeAreaInsets();
  const { setParentSession } = useAuth();
  const params = useLocalSearchParams<{
    pool_id: string;
    pool_name: string;
    name?: string;
    loginId?: string;
    pw?: string;
    phone?: string;
  }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching]   = useState(false);
  const [results, setResults]       = useState<StudentInfo[] | null>(null);
  const [selected, setSelected]     = useState<StudentInfo[]>([]);
  const [error, setError]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poolId   = params.pool_id   ?? "";
  const poolName = params.pool_name ?? "";
  const parentPhone = params.phone ?? "";
  const parentName  = params.name  ?? "";

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !poolId) { setResults(null); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `${API_BASE}/auth/pool-student-search?pool_id=${encodeURIComponent(poolId)}&name=${encodeURIComponent(q.trim())}`
      );
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [poolId]);

  function onSearchChange(q: string) {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(q), 400);
  }

  function selectStudent(s: StudentInfo) {
    if (selected.some(st => st.id === s.id)) return;
    if (selected.length >= 4) { setError("최대 4명까지 선택할 수 있습니다."); return; }
    setSelected(prev => [...prev, s]);
    setSearchQuery("");
    setResults(null);
    setError("");
  }

  function removeSelected(id: string) {
    setSelected(prev => prev.filter(s => s.id !== id));
  }

  async function handleSubmit() {
    setError("");
    if (!params.loginId || !params.pw || !parentPhone) {
      setError("회원가입 정보가 없습니다. 처음부터 다시 시도해주세요."); return;
    }
    if (!poolId) {
      setError("수영장 정보가 없습니다. 이전 단계로 돌아가 수영장을 선택해주세요."); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/simple-parent-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_name: parentName,
          phone: parentPhone,
          loginId: params.loginId,
          password: params.pw,
          pool_id: poolId,
          child_ids: selected.map(s => s.id),
          child_names: selected.map(s => s.name),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || json.message || "가입 중 오류가 발생했습니다."); return;
      }
      await setParentSession(json.token, json.parent);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  const isAlreadySelected = (id: string) => selected.some(s => s.id === id);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 20) }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>
        <StepBar current={2} />
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 타이틀 */}
        <Text style={[s.title, { color: C.text }]}>자녀 연결</Text>
        <Text style={[s.sub, { color: C.textSecondary }]}>
          다니는 수영장 명부에서 자녀를 찾아 선택해주세요.
        </Text>

        {/* 선택된 수영장 */}
        <View style={[s.poolBadge, { backgroundColor: C.tintLight, borderColor: C.tint }]}>
          <Droplet size={14} color={C.tint} />
          <Text style={[s.poolBadgeTxt, { color: C.tint }]}>{poolName}</Text>
        </View>

        {/* 오류 */}
        {!!error && (
          <View style={[s.errorBox, { backgroundColor: "#F9DEDA" }]}>
            <CircleAlert size={13} color={C.error} />
            <Text style={[s.errorTxt, { color: C.error }]}>{error}</Text>
          </View>
        )}

        {/* 자녀 검색 */}
        <View style={[s.card, { backgroundColor: C.card }]}>
          <Text style={[s.cardTitle, { color: C.text }]}>자녀 이름 검색</Text>
          <Text style={[s.cardSub, { color: C.textSecondary }]}>
            이름 일부만 입력해도 검색됩니다. 형제·자매가 있으면 여러 명 선택 가능합니다.
          </Text>

          {/* 검색 입력 */}
          <View style={[s.searchRow, {
            borderColor: searchQuery ? C.tint : C.border,
            backgroundColor: C.background,
          }]}>
            <Search size={16} color={searchQuery ? C.tint : C.textMuted} />
            <TextInput
              style={[s.searchInput, { color: C.text }]}
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder="자녀 이름 입력..."
              placeholderTextColor={C.textMuted}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => doSearch(searchQuery)}
            />
            {searching && <ActivityIndicator size="small" color={C.tint} />}
            {!searching && !!searchQuery && (
              <Pressable onPress={() => { setSearchQuery(""); setResults(null); }} hitSlop={8}>
                <X size={16} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {/* 검색 결과 */}
          {results !== null && (
            <View style={s.resultWrap}>
              {results.length === 0 ? (
                <View style={s.emptyResult}>
                  <Text style={[s.emptyResultTxt, { color: C.textSecondary }]}>
                    '{searchQuery}'(으)로 등록된 학생이 없습니다.{"\n"}
                    수영장 담당자에게 학생 등록을 먼저 요청해주세요.
                  </Text>
                </View>
              ) : (
                results.map(st => {
                  const already = isAlreadySelected(st.id);
                  return (
                    <Pressable
                      key={st.id}
                      style={({ pressed }) => [
                        s.resultItem,
                        {
                          backgroundColor: already ? C.tintLight : C.background,
                          borderColor: already ? C.tint : C.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                      onPress={() => already ? null : selectStudent(st)}
                    >
                      <View style={[s.resultAvatar, {
                        backgroundColor: already ? C.tint : "#E5E7EB",
                      }]}>
                        {already
                          ? <Check size={14} color="#fff" />
                          : <Text style={[s.resultAvatarTxt, { color: C.textSecondary }]}>{st.name?.[0]}</Text>
                        }
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.resultName, { color: already ? C.tint : C.text }]}>{st.name}</Text>
                        {st.birth_year && (
                          <Text style={[s.resultSub, { color: C.textMuted }]}>{st.birth_year}년생</Text>
                        )}
                      </View>
                      {already
                        ? <Text style={[s.alreadyTxt, { color: C.tint }]}>선택됨</Text>
                        : (
                          <View style={[s.selectBtn, { backgroundColor: C.tint }]}>
                            <Plus size={14} color="#fff" />
                            <Text style={s.selectBtnTxt}>선택</Text>
                          </View>
                        )
                      }
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
        </View>

        {/* 선택된 자녀 목록 */}
        {selected.length > 0 && (
          <View style={[s.card, { backgroundColor: C.card }]}>
            <View style={s.selectedHeader}>
              <UserCheck size={16} color="#2E9B6F" />
              <Text style={[s.cardTitle, { color: "#2E9B6F" }]}>선택된 자녀 ({selected.length}명)</Text>
            </View>
            {selected.map(st => (
              <View
                key={st.id}
                style={[s.selectedItem, { backgroundColor: "#DFF3EC", borderColor: "#A7F3D0" }]}
              >
                <View style={[s.resultAvatar, { backgroundColor: "#2EC4B6" }]}>
                  <Text style={[s.resultAvatarTxt, { color: "#fff" }]}>{st.name?.[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.resultName, { color: "#2E9B6F" }]}>{st.name}</Text>
                  {st.birth_year && (
                    <Text style={[s.resultSub, { color: "#4CAF50" }]}>{st.birth_year}년생</Text>
                  )}
                </View>
                <Pressable
                  onPress={() => removeSelected(st.id)}
                  hitSlop={8}
                  style={[s.removeBtn, { backgroundColor: "#A7F3D0" }]}
                >
                  <Minus size={14} color="#2E9B6F" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* 자녀 없이 가입 안내 */}
        <View style={[s.hintBox, { backgroundColor: "#FFF9EC", borderColor: "#FDE68A" }]}>
          <CircleAlert size={14} color="#D97706" />
          <Text style={[s.hintTxt, { color: "#92400E" }]}>
            자녀가 목록에 없으면 수영장에 학생 등록을 먼저 요청해주세요.{"\n"}
            학생 등록 후 다시 시도하거나, 담당자에게 연결을 요청하세요.
          </Text>
        </View>

        {/* 가입 완료 버튼 */}
        <Pressable
          style={({ pressed }) => [
            s.submitBtn,
            {
              backgroundColor: submitting ? C.textMuted : (selected.length > 0 ? C.button : C.tint),
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : (
              <>
                {selected.length > 0
                  ? <UserCheck size={18} color="#fff" />
                  : <Plus size={18} color="#fff" />
                }
                <Text style={s.submitTxt}>
                  {selected.length > 0
                    ? `자녀 ${selected.length}명 연결하고 가입 완료`
                    : "자녀 선택 없이 가입 완료"
                  }
                </Text>
              </>
            )
          }
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StepBar({ current }: { current: number }) {
  const steps = [1, 2];
  return (
    <View style={sb.row}>
      {steps.map((step, i) => (
        <React.Fragment key={step}>
          {i > 0 && <View style={[sb.line, { backgroundColor: step <= current ? C.tint : C.border }]} />}
          <View style={[sb.dot, { backgroundColor: step < current ? "#2E9B6F" : step === current ? C.tint : C.border }]}>
            {step < current
              ? <Check size={12} color="#fff" />
              : <Text style={[sb.dotTxt, { color: step === current ? "#fff" : C.textMuted }]}>{step}</Text>
            }
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const sb = StyleSheet.create({
  row:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dot:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dotTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  line:   { flex: 1, height: 2, maxWidth: 40 },
});

const s = StyleSheet.create({
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  content:        { paddingHorizontal: 20, paddingTop: 20, gap: 14 },
  title:          { fontSize: 22, fontFamily: "Pretendard-Regular" },
  sub:            { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 21 },
  poolBadge:      { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  poolBadgeTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  errorBox:       { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12 },
  errorTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 19 },
  card:           { borderRadius: 18, padding: 18, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle:      { fontSize: 16, fontFamily: "Pretendard-Regular" },
  cardSub:        { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  searchRow:      { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 48 },
  searchInput:    { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  resultWrap:     { gap: 8, marginTop: 4 },
  emptyResult:    { padding: 16, alignItems: "center" },
  emptyResultTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  resultItem:     { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 },
  resultAvatar:   { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  resultAvatarTxt:{ fontSize: 14, fontFamily: "Pretendard-Regular" },
  resultName:     { fontSize: 15, fontFamily: "Pretendard-Regular" },
  resultSub:      { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  alreadyTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  selectBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  selectBtnTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  selectedHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectedItem:   { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 },
  removeBtn:      { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  hintBox:        { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  hintTxt:        { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 19 },
  submitBtn:      { height: 54, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  submitTxt:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
