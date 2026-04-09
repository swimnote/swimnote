import { ArrowLeft, AtSign, CircleAlert, Hash, Lock, User, UserCheck } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";

const C = Colors.light;

type StudentInfo = {
  id: string;
  student_name: string;
  birth_year?: string | null;
  pool_name: string;
  swimming_pool_id: string;
};

export default function ParentCodeSignupScreen() {
  const insets = useSafeAreaInsets();
  const { setParentSession } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const parentNameRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const pw2Ref = useRef<TextInput>(null);

  const [step, setStep] = useState<"code" | "confirm" | "account">("code");
  const [code, setCode] = useState(params.code || "");
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);

  useEffect(() => {
    if (params.code && params.code.length >= 4) {
      setCode(params.code.toUpperCase());
    }
  }, [params.code]);

  const [parentName, setParentName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function verifyCode() {
    if (code.trim().length < 4) { setError("코드를 올바르게 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/invite/verify?code=${encodeURIComponent(code.trim().toUpperCase())}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.error_code === "already_linked") {
          setError("이미 가입이 완료된 코드입니다. 로그인 화면에서 로그인해주세요.");
        } else {
          setError(data.error || data.message || "유효하지 않은 코드입니다.");
        }
        return;
      }
      setStudentInfo(data.student);
      setStep("confirm");
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  async function joinWithCode() {
    if (!parentName.trim()) { setError("학부모 이름을 입력해주세요."); return; }
    if (!loginId.trim()) { setError("아이디를 입력해주세요."); return; }
    if (loginId.trim().length < 3) { setError("아이디는 3자 이상이어야 합니다."); return; }
    if (!password || password.length < 4) { setError("비밀번호는 4자리 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    setLoading(true); setError("");
    try {
      const joinRes = await fetch(`${API_BASE}/auth/invite/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          parent_name: parentName.trim(),
          loginId: loginId.trim(),
          password,
        }),
      });
      const joinData = await joinRes.json();
      if (!joinRes.ok) {
        if (joinData.error_code === "already_linked") {
          setError("이미 가입이 완료된 코드입니다. 로그인 화면에서 로그인해주세요.");
        } else {
          setError(joinData.error || joinData.message || "가입 실패");
        }
        return;
      }
      await setParentSession(joinData.token, joinData.parent);
      router.replace("/(parent)/home" as any);
    } catch { setError("서버 오류가 발생했습니다."); } finally { setLoading(false); }
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
          <Pressable
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              if (step === "confirm") { setStep("code"); setStudentInfo(null); }
              else if (step === "account") setStep("confirm");
              else router.back();
            }}
          >
            <ArrowLeft size={20} color={C.text} />
          </Pressable>
          <Text style={[styles.screenTitle, { color: C.text }]}>학부모 가입</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* 단계 1: 초대코드 입력 */}
        {step === "code" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#FFF3E0" }]}>
              <Hash size={24} color="#E4A93A" />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>초대코드 입력</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              수영장에서 받은 초대코드를 입력해주세요.{"\n"}초대코드 없이는 가입이 불가능합니다.
            </Text>

            <View style={styles.field}>
              <View style={[styles.inputRow, { borderColor: code ? C.tint : C.border, backgroundColor: C.background }]}>
                <Hash size={15} color={code ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.codeInput, { color: C.text }]}
                  value={code}
                  onChangeText={v => { setCode(v.toUpperCase()); setError(""); }}
                  placeholder="초대코드 입력"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={verifyCode}
                  maxLength={12}
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
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: "#E4A93A", opacity: pressed || loading ? 0.85 : 1 }]}
              onPress={verifyCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>코드 확인</Text>
              }
            </Pressable>
          </View>
        )}

        {/* 단계 2: 자녀 정보 확인 */}
        {step === "confirm" && studentInfo && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#DFF3EC" }]}>
              <UserCheck size={24} color="#2E9B6F" />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>자녀 정보 확인</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              수영장에 등록된 자녀 정보를 확인해주세요.
            </Text>

            <View style={[styles.infoBox, { backgroundColor: C.background, borderColor: C.border }]}>
              {[
                { label: "수영장", value: studentInfo.pool_name || "-" },
                { label: "자녀 이름", value: studentInfo.student_name },
                ...(studentInfo.birth_year ? [{ label: "출생년도", value: String(studentInfo.birth_year) }] : []),
              ].map((item, i, arr) => (
                <React.Fragment key={item.label}>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: C.textMuted }]}>{item.label}</Text>
                    <Text style={[styles.infoValue, { color: C.text }]}>{item.value}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[styles.infoDivider, { backgroundColor: C.border }]} />}
                </React.Fragment>
              ))}
            </View>

            <Text style={[styles.hintText, { color: C.textMuted }]}>
              내 자녀가 맞으면 아래 버튼을 눌러주세요.
            </Text>

            <Pressable
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: "#2E9B6F", opacity: pressed ? 0.85 : 1 }]}
              onPress={() => setStep("account")}
            >
              <Text style={styles.submitBtnText}>맞습니다, 계속</Text>
            </Pressable>
          </View>
        )}

        {/* 단계 3: 학부모 계정 설정 */}
        {step === "account" && (
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={[styles.iconWrap, { backgroundColor: "#EFF4FF" }]}>
              <Lock size={24} color={C.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: C.text }]}>학부모 계정 설정</Text>
            <Text style={[styles.cardDesc, { color: C.textSecondary }]}>
              학부모 이름과 로그인 정보를 입력해주세요.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>학부모 이름</Text>
              <View style={[styles.inputRow, { borderColor: parentName ? C.tint : C.border, backgroundColor: C.background }]}>
                <User size={15} color={parentName ? C.tint : C.textMuted} />
                <TextInput
                  ref={parentNameRef}
                  style={[styles.input, { color: C.text }]}
                  value={parentName}
                  onChangeText={v => { setParentName(v); setError(""); }}
                  placeholder="학부모 실명"
                  placeholderTextColor={C.textMuted}
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => pwRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>아이디 (3자 이상)</Text>
              <View style={[styles.inputRow, { borderColor: loginId ? C.tint : C.border, backgroundColor: C.background }]}>
                <AtSign size={15} color={loginId ? C.tint : C.textMuted} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={loginId}
                  onChangeText={v => { setLoginId(v); setError(""); }}
                  placeholder="영문/숫자 아이디"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => pwRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 (4자리 이상)</Text>
              <View style={[styles.inputRow, { borderColor: password ? C.tint : C.border, backgroundColor: C.background }]}>
                <Lock size={15} color={password ? C.tint : C.textMuted} />
                <TextInput
                  ref={pwRef}
                  style={[styles.input, { color: C.text }]}
                  value={password}
                  onChangeText={v => { setPassword(v); setError(""); }}
                  placeholder="비밀번호 설정"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="next"
                  onSubmitEditing={() => pw2Ref.current?.focus()}
                />
                <Pressable onPress={() => setShowPw(v => !v)} hitSlop={10}>
                  <LucideIcon name={showPw ? "eye-off" : "eye"} size={15} color={C.textMuted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>비밀번호 확인</Text>
              <View style={[styles.inputRow, {
                borderColor: passwordConfirm && password !== passwordConfirm ? C.error : (passwordConfirm ? C.tint : C.border),
                backgroundColor: C.background,
              }]}>
                <Lock size={15} color={passwordConfirm ? C.tint : C.textMuted} />
                <TextInput
                  ref={pw2Ref}
                  style={[styles.input, { color: C.text }]}
                  value={passwordConfirm}
                  onChangeText={v => { setPasswordConfirm(v); setError(""); }}
                  placeholder="비밀번호 재입력"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showPw}
                  returnKeyType="done"
                  onSubmitEditing={joinWithCode}
                />
              </View>
              {!!passwordConfirm && password !== passwordConfirm && (
                <Text style={{ color: C.error, fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 }}>비밀번호가 일치하지 않습니다</Text>
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
              onPress={joinWithCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>가입 완료</Text>
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
  container: { paddingHorizontal: 20, gap: 24 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { padding: 4 },
  screenTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  cardTitle: { fontSize: 20, fontFamily: "Pretendard-Regular", textAlign: "center" },
  cardDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20, marginTop: -6 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  codeInput: { flex: 1, fontSize: 18, fontFamily: "Pretendard-Regular", textAlign: "center" },
  input: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },
  infoBox: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11 },
  infoLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  infoValue: { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "500" },
  infoDivider: { height: 1 },
  hintText: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  submitBtn: { height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
