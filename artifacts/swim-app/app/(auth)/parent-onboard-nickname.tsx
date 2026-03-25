import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

const EXAMPLES = ["엄마", "아빠", "할머니", "할아버지", "이모", "삼촌"];

export default function ParentOnboardNicknameScreen() {
  const { token, updateParentNickname, setLastUsedRole } = useAuth();
  const insets = useSafeAreaInsets();
  const [prefix, setPrefix] = useState(""); // 예: "서태웅"
  const [suffix, setSuffix] = useState("엄마"); // 예: "엄마"
  const [customSuffix, setCustomSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const finalNickname = `${prefix.trim()} ${(suffix === "직접입력" ? customSuffix : suffix).trim()}`.trim();

  async function handleConfirm() {
    if (!finalNickname) { setError("호칭을 입력해주세요."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(token, "/parent/nickname", {
        method: "PUT",
        body: JSON.stringify({ nickname: finalNickname }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "오류가 발생했습니다."); return; }
      updateParentNickname(finalNickname);
      await setLastUsedRole("parent_account");
      router.replace("/(parent)/home" as any);
    } catch { setError("네트워크 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  async function handleSkip() {
    await setLastUsedRole("parent_account");
    router.replace("/(parent)/home" as any);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 20) }]}>
        <View style={styles.stepRow}>
          <View style={[styles.step, { backgroundColor: "#2E9B6F" }]}>
            <Feather name="check" size={14} color="#fff" />
          </View>
          <View style={[styles.stepLine, { backgroundColor: "#2E9B6F" }]} />
          <View style={[styles.step, { backgroundColor: "#2E9B6F" }]}>
            <Feather name="check" size={14} color="#fff" />
          </View>
          <View style={[styles.stepLine, { backgroundColor: C.tint }]} />
          <View style={[styles.step, { backgroundColor: C.tint }]}>
            <Text style={styles.stepText}>3</Text>
          </View>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]}>호칭을 알려주세요</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>
          선생님과 소통할 때 사용되는 호칭입니다.{"\n"}
          실명 대신 이 호칭으로 표시됩니다.
        </Text>

        {/* 미리보기 */}
        <View style={[styles.previewCard, { backgroundColor: C.tintLight }]}>
          <Text style={[styles.previewLabel, { color: C.tint }]}>미리보기</Text>
          <Text style={[styles.previewNickname, { color: C.tint }]}>
            {finalNickname || "김민준 엄마"}
          </Text>
        </View>

        {/* 자녀 이름 입력 */}
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>자녀 이름</Text>
          <View style={[styles.inputRow, { borderColor: prefix ? C.tint : C.border, backgroundColor: C.card }]}>
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={prefix}
              onChangeText={setPrefix}
              placeholder="예: 서태웅"
              placeholderTextColor={C.textMuted}
              returnKeyType="next"
            />
          </View>
        </View>

        {/* 호칭 선택 */}
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>관계 호칭</Text>
          <View style={styles.suffixGrid}>
            {[...EXAMPLES, "직접입력"].map(s => (
              <Pressable
                key={s}
                style={({ pressed }) => [
                  styles.suffixBtn,
                  suffix === s && { backgroundColor: C.tint, borderColor: C.tint },
                  suffix !== s && { backgroundColor: C.card, borderColor: C.border },
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => setSuffix(s)}
              >
                <Text style={[styles.suffixText, { color: suffix === s ? "#fff" : C.text }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
          {suffix === "직접입력" && (
            <View style={[styles.inputRow, { borderColor: customSuffix ? C.tint : C.border, backgroundColor: C.card, marginTop: 8 }]}>
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={customSuffix}
                onChangeText={setCustomSuffix}
                placeholder="직접 입력 (예: 큰아버지)"
                placeholderTextColor={C.textMuted}
                autoFocus
              />
            </View>
          )}
        </View>

        {!!error && (
          <View style={[styles.errBox, { backgroundColor: "#F9DEDA" }]}>
            <Text style={[styles.errText, { color: "#D96C6C" }]}>{error}</Text>
          </View>
        )}

        <View style={styles.btnRow}>
          <Pressable
            style={({ pressed }) => [styles.skipBtn, { borderColor: C.border, opacity: pressed ? 0.7 : 1 }]}
            onPress={handleSkip}
          >
            <Text style={[styles.skipBtnText, { color: C.textSecondary }]}>나중에 설정</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.confirmBtn, { backgroundColor: C.tint, opacity: pressed || loading ? 0.85 : 1, flex: 1 }]}
            onPress={handleConfirm}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : (
                <>
                  <Text style={styles.confirmBtnText}>완료 — 홈으로</Text>
                  <Feather name="arrow-right" size={16} color="#fff" />
                </>
              )
            }
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  step: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  stepLine: { flex: 1, height: 2, maxWidth: 40 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  previewCard: { borderRadius: 16, padding: 18, alignItems: "center", gap: 4 },
  previewLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  previewNickname: { fontSize: 24, fontFamily: "Inter_700Bold" },
  field: { gap: 8 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  suffixGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suffixBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  suffixText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  errBox: { padding: 12, borderRadius: 12 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  skipBtn: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  skipBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  confirmBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
