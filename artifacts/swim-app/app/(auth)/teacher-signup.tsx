import {
  ArrowLeft, AtSign, Briefcase, ChevronRight, CircleAlert,
  Lock, MapPin, Phone, Search, User, Users,
} from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

type Pool = { id: string; name: string; address?: string };
type SignupType = "affiliated" | "solo";
type Step = "type" | "pool" | "workspace" | "info";

export default function TeacherSignupScreen() {
  const insets = useSafeAreaInsets();
  const { setAdminSession, finishLogin } = useAuth();
  const { phone: prefillPhone, kakaoId, appleId } = useLocalSearchParams<{
    phone?: string; kakaoId?: string; appleId?: string;
  }>();

  const hasSocialId   = !!(appleId || kakaoId);
  const isSocialPhone = !!(prefillPhone && hasSocialId);

  const loginIdRef = useRef<TextInput>(null);
  const pwRef       = useRef<TextInput>(null);
  const phoneRef    = useRef<TextInput>(null);
  const wsRef       = useRef<TextInput>(null);

  const [signupType, setSignupType] = useState<SignupType | null>(hasSocialId ? "affiliated" : null);
  const [step, setStep] = useState<Step>(hasSocialId ? "pool" : "type");

  /* 수영장 검색 (소속) */
  const [query, setQuery]             = useState("");
  const [pools, setPools]             = useState<Pool[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);

  /* 워크스페이스 이름 (개인) */
  const [workspaceName, setWorkspaceName] = useState("");

  /* 공통 정보 */
  const [name,    setName]    = useState("");
  const [loginId, setLoginId] = useState("");
  const [pw,      setPw]      = useState("");
  const [phone,   setPhone]   = useState(prefillPhone || "");
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  /* 단계 이동 */
  function goBack() {
    if (step === "info") {
      setStep(signupType === "solo" ? "workspace" : "pool");
      setError("");
    } else if (step === "pool" || step === "workspace") {
      setStep("type");
      setError("");
    } else {
      router.back();
    }
  }

  async function searchPools() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/pools/public-search?name=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setPools(data.data || []);
    } catch { setPools([]); }
    finally { setSearching(false); }
  }

  function selectPool(p: Pool) {
    setSelectedPool(p);
    setStep("info");
  }

  function handleWorkspaceNext() {
    if (!workspaceName.trim()) { setError("워크스페이스 이름을 입력해주세요."); return; }
    setError("");
    setStep("info");
  }

  async function handleSubmit() {
    if (!name.trim() || !loginId.trim() || !pw) {
      setError("이름, 아이디, 비밀번호는 필수입니다."); return;
    }
    if (loginId.trim().length < 4) { setError("아이디는 4자 이상이어야 합니다."); return; }
    if (pw.length < 4)             { setError("비밀번호는 4자 이상이어야 합니다."); return; }

    setLoading(true); setError("");
    try {
      if (signupType === "solo") {
        /* ── 개인 워크스페이스 (대표) ── */
        const res = await fetch(`${API_BASE}/auth/solo-teacher-signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(), loginId: loginId.trim().toLowerCase(),
            password: pw, phone: phone.trim() || undefined,
            workspace_name: workspaceName.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || data.message || "가입 실패"); return; }
        await setAdminSession(data.token, data.user);
        finishLogin("admin", data.user, null, data.token);
      } else {
        /* ── 소속 수영장 (선생님) ── */
        const res = await fetch(`${API_BASE}/auth/teacher-self-signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(), loginId: loginId.trim().toLowerCase(),
            password: pw, phone: phone.trim() || undefined,
            pool_id: selectedPool!.id,
            ...(kakaoId ? { kakao_id: kakaoId } : {}),
            ...(appleId ? { apple_id: appleId } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || data.message || "가입 실패"); return; }
        await setAdminSession(data.token, data.user);
        finishLogin("admin", data.user, null, data.token);
      }
    } catch { setError("서버 오류가 발생했습니다."); }
    finally   { setLoading(false); }
  }

  /* 단계 인디케이터 */
  const STEPS_AFFILIATED = ["소속", "수영장", "정보"];
  const STEPS_SOLO       = ["소속", "이름", "정보"];
  const stepLabels = signupType === "solo" ? STEPS_SOLO : STEPS_AFFILIATED;
  const stepIndex  = step === "type" ? 0 : step === "pool" || step === "workspace" ? 1 : 2;

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
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={goBack}>
            <ArrowLeft size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>선생님 가입</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* 단계 인디케이터 (type 선택 이후에만) */}
        {step !== "type" && (
          <View style={styles.steps}>
            {stepLabels.map((s, i) => (
              <React.Fragment key={s}>
                <View style={styles.stepItem}>
                  <View style={[styles.stepDot, { backgroundColor: i <= stepIndex ? C.tint : C.border }]}>
                    <Text style={[styles.stepNum, { color: i <= stepIndex ? "#fff" : C.textMuted }]}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepLabel, { color: i <= stepIndex ? C.tint : C.textMuted }]}>{s}</Text>
                </View>
                {i < stepLabels.length - 1 && (
                  <View style={[styles.stepLine, { backgroundColor: i < stepIndex ? C.tint : C.border }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* ── 1단계: 소속 유형 선택 ── */}
        {step === "type" && (
          <View style={styles.typeSection}>
            <View style={styles.typeHeader}>
              <Text style={[styles.typeTitle, { color: C.text }]}>소속을 선택해주세요</Text>
              <Text style={[styles.typeSub, { color: C.textSecondary }]}>
                소속 수영장이 있으면 가입 요청을 보내고,{"\n"}없으면 나만의 워크스페이스를 만드세요
              </Text>
            </View>

            {/* 소속 있음 */}
            <Pressable
              style={({ pressed }) => [styles.typeCard, { backgroundColor: C.card, opacity: pressed ? 0.88 : 1 }]}
              onPress={() => { setSignupType("affiliated"); setStep("pool"); }}
            >
              <View style={[styles.typeIconBox, { backgroundColor: "#EFF4FF" }]}>
                <Users size={28} color="#1D4ED8" />
              </View>
              <View style={styles.typeInfo}>
                <Text style={[styles.typeCardTitle, { color: C.text }]}>소속 수영장 있음</Text>
                <Text style={[styles.typeCardDesc, { color: C.textSecondary }]}>
                  수영장을 검색하고 가입 요청을 보냅니다{"\n"}관리자 승인 후 수업을 시작할 수 있어요
                </Text>
              </View>
              <ChevronRight size={18} color={C.textMuted} />
            </Pressable>

            {/* 소속 없음 (대표) */}
            <Pressable
              style={({ pressed }) => [styles.typeCard, { backgroundColor: C.card, opacity: pressed ? 0.88 : 1 }]}
              onPress={() => { setSignupType("solo"); setStep("workspace"); }}
            >
              <View style={[styles.typeIconBox, { backgroundColor: "#E6FFFA" }]}>
                <Briefcase size={28} color="#2EC4B6" />
              </View>
              <View style={styles.typeInfo}>
                <Text style={[styles.typeCardTitle, { color: C.text }]}>소속 없음 (대표)</Text>
                <Text style={[styles.typeCardDesc, { color: C.textSecondary }]}>
                  나만의 워크스페이스를 만들어 대표로 시작합니다{"\n"}학생·선생님을 직접 관리할 수 있어요
                </Text>
              </View>
              <ChevronRight size={18} color={C.textMuted} />
            </Pressable>
          </View>
        )}

        {/* ── 2단계(소속): 수영장 검색 ── */}
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
                <Pressable
                  style={({ pressed }) => [styles.searchBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
                  onPress={searchPools}
                  disabled={searching}
                >
                  {searching
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Search size={16} color="#fff" />
                  }
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
                      onPress={() => selectPool(p)}
                    >
                      <View style={[styles.poolIcon, { backgroundColor: "#EFF4FF" }]}>
                        <MapPin size={14} color={C.tint} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.poolName, { color: C.text }]}>{p.name}</Text>
                        {!!p.address && (
                          <Text style={[styles.poolAddr, { color: C.textMuted }]} numberOfLines={1}>{p.address}</Text>
                        )}
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

        {/* ── 2단계(대표): 워크스페이스 이름 ── */}
        {step === "workspace" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <Text style={[styles.cardTitle, { color: C.text }]}>워크스페이스 이름</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              나의 수업을 관리할 공간의 이름을 정해주세요{"\n"}나중에 변경할 수 있어요
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>워크스페이스 이름 *</Text>
              <View style={[styles.inputRow, { borderColor: workspaceName ? C.tint : C.border, backgroundColor: C.background }]}>
                <Briefcase size={15} color={workspaceName ? C.tint : C.textMuted} />
                <TextInput
                  ref={wsRef}
                  style={[styles.input, { color: C.text }]}
                  value={workspaceName}
                  onChangeText={v => { setWorkspaceName(v); setError(""); }}
                  placeholder="예: 김코치 수영교실"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={handleWorkspaceNext}
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
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: C.button, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleWorkspaceNext}
            >
              <Text style={styles.submitBtnText}>다음</Text>
            </Pressable>
          </View>
        )}

        {/* ── 3단계: 개인 정보 입력 ── */}
        {step === "info" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            {/* 배지 */}
            {signupType === "affiliated" && selectedPool && (
              <View style={[styles.poolBadge, { backgroundColor: "#EFF4FF" }]}>
                <MapPin size={13} color={C.tint} />
                <Text style={[styles.poolBadgeText, { color: C.tint }]}>{selectedPool.name}</Text>
              </View>
            )}
            {signupType === "solo" && (
              <View style={[styles.poolBadge, { backgroundColor: "#E6FFFA" }]}>
                <Briefcase size={13} color="#2EC4B6" />
                <Text style={[styles.poolBadgeText, { color: "#2EC4B6" }]}>{workspaceName}</Text>
              </View>
            )}

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

            {/* 아이디 */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>
                아이디 * <Text style={{ color: C.textMuted }}>(4자 이상)</Text>
              </Text>
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
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>
                비밀번호 * <Text style={{ color: C.textMuted }}>(4자 이상)</Text>
              </Text>
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

            {/* 전화번호 */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>
                전화번호 {isSocialPhone ? "" : <Text style={{ color: C.textMuted }}>(선택)</Text>}
              </Text>
              <View style={[styles.inputRow, { borderColor: isSocialPhone ? "#2EC4B6" : (phone ? C.tint : C.border), backgroundColor: C.background }]}>
                <Phone size={15} color={isSocialPhone ? "#2EC4B6" : (phone ? C.tint : C.textMuted)} />
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
                  editable={!isSocialPhone}
                />
              </View>
              {isSocialPhone && (
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6" }}>
                  ✓ 휴대폰 인증이 완료되었습니다.
                </Text>
              )}
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
                : <Text style={styles.submitBtnText}>
                    {signupType === "solo" ? "워크스페이스 만들기" : "가입 요청 보내기"}
                  </Text>
              }
            </Pressable>

            {signupType === "affiliated" && (
              <Text style={[styles.hintText, { color: C.textMuted }]}>
                * 관리자 승인 후 로그인이 가능합니다
              </Text>
            )}
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
  stepLine: { width: 48, height: 2, marginBottom: 18, marginHorizontal: 6 },

  /* 타입 선택 */
  typeSection: { gap: 14 },
  typeHeader: { gap: 6 },
  typeTitle: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  typeSub: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20, color: Colors.light.textSecondary },
  typeCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, padding: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  typeIconBox: { width: 60, height: 60, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  typeInfo: { flex: 1, gap: 4 },
  typeCardTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  typeCardDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },

  /* 카드 */
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  poolBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  poolBadgeText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  cardDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: -8, lineHeight: 19 },

  /* 공통 입력 */
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

  /* 수영장 리스트 */
  poolList: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  poolDivider: { height: 1 },
  poolItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  poolIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  poolName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  poolAddr: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  emptyText: { textAlign: "center", fontSize: 13, fontFamily: "Pretendard-Regular", paddingVertical: 8 },

  /* 에러 / 버튼 */
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  hintText: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: -6 },
});
