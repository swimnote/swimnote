import { ArrowLeft, AtSign, ChevronRight, CircleAlert, CircleCheck, Lock, MapPin, Phone, Search, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE } from "@/context/AuthContext";

const C = Colors.light;

type Pool = { id: string; name: string; address?: string };

export default function TeacherSignupScreen() {
  const insets = useSafeAreaInsets();
  const loginIdRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  const [step, setStep] = useState<"pool" | "info" | "done">("pool");

  /* 수영장 검색 */
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<Pool[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);

  /* 정보 입력 */
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [pw, setPw] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function searchPools() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/pools/public-search?name=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setPools(data.data || []);
    } catch { setPools([]); } finally { setSearching(false); }
  }

  async function handleSubmit() {
    if (!name.trim() || !loginId.trim() || !pw) {
      setError("이름, 아이디, 비밀번호는 필수입니다."); return;
    }
    if (loginId.trim().length < 4) {
      setError("아이디는 4자 이상이어야 합니다."); return;
    }
    if (pw.length < 4) {
      setError("비밀번호는 4자 이상이어야 합니다."); return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/teacher-self-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), loginId: loginId.trim().toLowerCase(), password: pw, phone: phone.trim(), pool_id: selectedPool!.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || data.message || "가입 실패"); return; }
      setStep("done");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  if (step === "done") {
    return (
      <View style={[styles.root, { backgroundColor: C.background }]}>
        <View style={[styles.doneWrap, { paddingTop: insets.top + 60 }]}>
          <View style={[styles.doneIcon, { backgroundColor: "#DFF3EC" }]}>
            <CircleCheck size={40} color="#2E9B6F" />
          </View>
          <Text style={[styles.doneTitle, { color: C.text }]}>가입 요청 완료!</Text>
          <Text style={[styles.doneDesc, { color: C.textSecondary }]}>
            <Text style={{ fontFamily: "Pretendard-Regular", color: C.text }}>{selectedPool?.name}</Text>
            {" "}관리자가 요청을 확인 후 승인하면{"\n"}로그인할 수 있습니다.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.doneBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.replace("/" as any)}
          >
            <Text style={styles.doneBtnText}>로그인 화면으로</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.headerRow}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => (step === "info" ? setStep("pool") : router.back())}>
            <ArrowLeft size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>선생님 회원가입</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* 단계 인디케이터 */}
        <View style={styles.steps}>
          {["수영장 선택", "정보 입력"].map((s, i) => (
            <React.Fragment key={s}>
              <View style={styles.stepItem}>
                <View style={[styles.stepDot, { backgroundColor: (i === 0 && step === "pool") || (i === 1 && step === "info") ? C.tint : C.border }]}>
                  <Text style={[styles.stepNum, { color: (i === 0 && step === "pool") || (i === 1 && step === "info") ? "#fff" : C.textMuted }]}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepLabel, { color: (i === 0 && step === "pool") || (i === 1 && step === "info") ? C.tint : C.textMuted }]}>{s}</Text>
              </View>
              {i < 1 && <View style={[styles.stepLine, { backgroundColor: C.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* 단계 1: 수영장 검색 */}
        {step === "pool" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>수영장 검색</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>소속될 수영장을 검색해주세요</Text>

            <View style={styles.field}>
              <View style={[styles.searchRow, { borderColor: query ? C.tint : C.border, backgroundColor: C.background }]}>
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="수영장 이름으로 검색"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="search"
                  onSubmitEditing={searchPools}
                />
                <Pressable style={({ pressed }) => [styles.searchBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]} onPress={searchPools} disabled={searching}>
                  {searching ? <ActivityIndicator color="#fff" size="small" /> : <Search size={16} color="#fff" />}
                </Pressable>
              </View>
            </View>

            {pools.length > 0 && (
              <View style={[styles.poolList, { borderColor: C.border }]}>
                {pools.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {i > 0 && <View style={[styles.poolDivider, { backgroundColor: C.border }]} />}
                    <Pressable
                      style={({ pressed }) => [styles.poolItem, { opacity: pressed ? 0.7 : 1 }]}
                      onPress={() => { setSelectedPool(p); setStep("info"); }}
                    >
                      <View style={[styles.poolIcon, { backgroundColor: "#EFF4FF" }]}>
                        <MapPin size={14} color={C.tint} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.poolName, { color: C.text }]}>{p.name}</Text>
                        {!!p.address && <Text style={[styles.poolAddr, { color: C.textMuted }]} numberOfLines={1}>{p.address}</Text>}
                      </View>
                      <ChevronRight size={16} color={C.textMuted} />
                    </Pressable>
                  </React.Fragment>
                ))}
              </View>
            )}

            {pools.length === 0 && query.length > 0 && !searching && (
              <Text style={[styles.emptyText, { color: C.textMuted }]}>검색 결과가 없습니다.</Text>
            )}
          </View>
        )}

        {/* 단계 2: 정보 입력 */}
        {step === "info" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.poolBadge, { backgroundColor: "#EFF4FF" }]}>
              <MapPin size={13} color={C.tint} />
              <Text style={[styles.poolBadgeText, { color: C.tint }]}>{selectedPool?.name}</Text>
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>기본 정보 입력</Text>

            {/* 이름 */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>이름 *</Text>
              <View style={[styles.inputRow, { borderColor: name ? C.tint : C.border, backgroundColor: C.background }]}>
                <User size={15} color={name ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={name}
                  onChangeText={v => { setName(v); setError(""); }}
                  placeholder="홍길동"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="next"
                  onSubmitEditing={() => loginIdRef.current?.focus()}
                />
              </View>
            </View>

            {/* 사용할 아이디 (로그인 식별자) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>사용할 아이디 * <Text style={{ color: C.textMuted }}>(4자 이상)</Text></Text>
              <View style={[styles.inputRow, { borderColor: loginId ? C.tint : C.border, backgroundColor: C.background }]}>
                <AtSign size={15} color={loginId ? C.tint : C.textMuted} />
                <TextInput
                  ref={loginIdRef}
                  style={[styles.input, { color: C.text }]}
                  value={loginId}
                  onChangeText={v => { setLoginId(v.toLowerCase().replace(/\s/g, "")); setError(""); }}
                  placeholder="teacher_kim"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => pwRef.current?.focus()}
                />
              </View>
            </View>

            {/* 비밀번호 */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 * <Text style={{ color: C.textMuted }}>(4자 이상)</Text></Text>
              <View style={[styles.inputRow, { borderColor: pw ? C.tint : C.border, backgroundColor: C.background }]}>
                <Lock size={15} color={pw ? C.tint : C.textMuted} />
                <TextInput
                  ref={pwRef}
                  style={[styles.input, { color: C.text }]}
                  value={pw}
                  onChangeText={v => { setPw(v); setError(""); }}
                  placeholder="4자 이상"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                />
                <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                  <LucideIcon name={showPw ? "eye-off" : "eye"} size={15} color={C.textMuted} />
                </Pressable>
              </View>
            </View>

            {/* 전화번호 (선택) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>전화번호 <Text style={{ color: C.textMuted }}>(선택)</Text></Text>
              <View style={[styles.inputRow, { borderColor: phone ? C.tint : C.border, backgroundColor: C.background }]}>
                <Phone size={15} color={phone ? C.tint : C.textMuted} />
                <TextInput
                  ref={phoneRef}
                  style={[styles.input, { color: C.text }]}
                  value={phone}
                  onChangeText={v => { setPhone(v); setError(""); }}
                  placeholder="010-0000-0000"
                  placeholderTextColor={C.textMuted}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
              </View>
            </View>

            {!!error && (
              <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
                <CircleAlert size={14} color={C.error} />
                <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.button, opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>가입 요청 보내기</Text>
              }
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { paddingHorizontal: 20, gap: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { padding: 4 },
  screenTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  steps: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 0 },
  stepItem: { alignItems: "center", gap: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  stepLabel: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  stepLine: { width: 60, height: 2, marginBottom: 18, marginHorizontal: 8 },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  poolBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  poolBadgeText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  cardDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: -8 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderRadius: 14, paddingLeft: 14, height: 52, overflow: "hidden",
  },
  searchBtn: { width: 50, height: 52, alignItems: "center", justifyContent: "center" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  poolList: {
    borderWidth: 1, borderRadius: 14, overflow: "hidden",
  },
  poolDivider: { height: 1 },
  poolItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  poolIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  poolName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  poolAddr: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  emptyText: { textAlign: "center", fontSize: 13, fontFamily: "Pretendard-Regular", paddingVertical: 8 },
  hintText: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  /* 완료 */
  doneWrap: { flex: 1, alignItems: "center", paddingHorizontal: 32, gap: 16 },
  doneIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  doneTitle: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  doneDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  doneBtn: { height: 52, borderRadius: 14, paddingHorizontal: 32, alignItems: "center", justifyContent: "center", marginTop: 12 },
  doneBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },
});
