/**
 * 선생님 계정 활성화 화면
 * 로그인 시 needs_activation=true이면 이 화면으로 이동
 */
import { CircleAlert, CircleCheck, Shield, Unlock } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function TeacherActivateScreen() {
  const { teacher_id } = useLocalSearchParams<{ teacher_id: string }>();
  const { setTokenAndUser } = useAuth() as any;
  const insets = useSafeAreaInsets();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const inputs = useRef<TextInput[]>([]);

  function handleOtpChange(val: string, idx: number) {
    const d = val.replace(/[^0-9]/g, "");
    const next = [...otp];
    next[idx] = d.slice(-1);
    setOtp(next);
    if (d && idx < 5) inputs.current[idx + 1]?.focus();
  }

  function handleKeyPress(e: any, idx: number) {
    if (e.nativeEvent.key === "Backspace" && !otp[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  }

  async function handleActivate() {
    const code = otp.join("");
    if (code.length !== 6) { setError("6자리 인증코드를 모두 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      const res = await apiRequest(null, "/auth/activate-teacher", {
        method: "POST",
        body: JSON.stringify({ teacher_id, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "활성화 실패");
      setSuccess(true);
      // 토큰 저장 후 역할에 맞는 홈으로 이동
      if (data.token && setTokenAndUser) {
        await setTokenAndUser(data.token, data.user);
      }
      // 역할 기반 라우팅: super 계열 → super, pool_admin → admin, teacher/기타 → teacher
      const role: string = data.user?.role ?? "";
      const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);
      const POOL_ADMIN_ROLES = new Set(["pool_admin", "sub_admin"]);
      const dest =
        SUPER_ROLES.has(role)      ? "/(super)/dashboard" :
        POOL_ADMIN_ROLES.has(role) ? "/(admin)/dashboard" :
                                     "/(teacher)/today-schedule";
      setTimeout(() => router.replace(dest as any), 1500);
    } catch (err: any) {
      setError(err.message || "활성화에 실패했습니다.");
    } finally { setLoading(false); }
  }

  if (success) {
    return (
      <View style={[styles.root, { backgroundColor: C.background, alignItems: "center", justifyContent: "center" }]}>
        <View style={[styles.successIcon, { backgroundColor: "#E6FFFA" }]}>
          <CircleCheck size={48} color="#2EC4B6" />
        </View>
        <Text style={[styles.successTitle, { color: C.text }]}>계정 활성화 완료!</Text>
        <Text style={[styles.successSub, { color: C.textSecondary }]}>잠시 후 이동합니다...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: C.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 48) }]}>
        <View style={[styles.iconBox, { backgroundColor: C.tintLight }]}>
          <Shield size={32} color={C.tint} />
        </View>
        <Text style={[styles.title, { color: C.text }]}>계정 활성화</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          수영장 관리자로부터 받은{"\n"}6자리 인증코드를 입력해주세요
        </Text>

        {error ? (
          <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
            <CircleAlert size={14} color={C.error} />
            <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.otpRow}>
          {otp.map((val, idx) => (
            <TextInput
              key={idx}
              ref={r => { if (r) inputs.current[idx] = r; }}
              style={[
                styles.otpInput,
                {
                  borderColor: val ? C.tint : C.border,
                  backgroundColor: val ? C.tintLight : C.card,
                  color: C.text,
                }
              ]}
              value={val}
              onChangeText={v => handleOtpChange(v, idx)}
              onKeyPress={e => handleKeyPress(e, idx)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
              selectTextOnFocus
            />
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [styles.btn, { backgroundColor: C.button, opacity: pressed || loading ? 0.85 : 1 }]}
          onPress={handleActivate} disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Unlock size={18} color="#fff" />
              <Text style={styles.btnText}>계정 활성화</Text>
            </>
          )}
        </Pressable>

        <Text style={[styles.hint, { color: C.textMuted }]}>
          인증코드를 받지 못하셨나요?{"\n"}수영장 관리자에게 문의해주세요.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 32, alignItems: "center", gap: 20 },
  iconBox: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Pretendard-SemiBold" },
  subtitle: { fontSize: 15, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 24 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, width: "100%" },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  otpRow: { flexDirection: "row", gap: 10, marginVertical: 8 },
  otpInput: { width: 48, height: 56, borderRadius: 14, borderWidth: 2, fontSize: 24, fontFamily: "Pretendard-SemiBold" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 52, borderRadius: 16, marginTop: 8 },
  btnText: { color: "#fff", fontSize: 17, fontFamily: "Pretendard-Medium" },
  hint: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  successIcon: { width: 96, height: 96, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle: { fontSize: 24, fontFamily: "Pretendard-SemiBold" },
  successSub: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
