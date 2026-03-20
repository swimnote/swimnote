import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function ParentOnboardChildScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pool_id: string; pool_name: string }>();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    auto_approved: boolean;
    pool_name: string;
    linked_students: string[];
  } | null>(null);
  const [error, setError] = useState("");

  async function connectPool() {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(token, "/parent/onboard-pool", {
        method: "POST",
        body: JSON.stringify({ swimming_pool_id: params.pool_id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "오류가 발생했습니다."); return; }
      setResult(data);
    } catch { setError("네트워크 오류가 발생했습니다."); } finally { setLoading(false); }
  }

  // 화면 진입 시 자동으로 연결 시도
  React.useEffect(() => { connectPool(); }, []);

  function handleNext() {
    if (result?.auto_approved) {
      router.replace("/parent-onboard-nickname" as any);
    } else {
      // 승인 대기 → 역할 선택으로 (다른 역할 선택 or 로그아웃)
      router.replace("/org-role-select" as any);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 20) }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <View style={styles.stepRow}>
          <View style={[styles.step, { backgroundColor: "#10B981" }]}>
            <Feather name="check" size={14} color="#fff" />
          </View>
          <View style={[styles.stepLine, { backgroundColor: C.tint }]} />
          <View style={[styles.step, { backgroundColor: C.tint }]}>
            <Text style={styles.stepText}>2</Text>
          </View>
          <View style={[styles.stepLine, { backgroundColor: C.border }]} />
          <View style={[styles.step, { backgroundColor: C.border }]}>
            <Text style={[styles.stepText, { color: C.textMuted }]}>3</Text>
          </View>
        </View>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={C.tint} />
            <Text style={[styles.loadingText, { color: C.textSecondary }]}>자녀 정보를 확인하고 있습니다...</Text>
          </View>
        ) : error ? (
          <View style={styles.statusBox}>
            <View style={[styles.iconBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={36} color="#EF4444" />
            </View>
            <Text style={[styles.statusTitle, { color: C.text }]}>연결 오류</Text>
            <Text style={[styles.statusDesc, { color: C.textSecondary }]}>{error}</Text>
            <Pressable style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]} onPress={connectPool}>
              <Text style={styles.btnText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : result?.auto_approved ? (
          <View style={styles.statusBox}>
            <View style={[styles.iconBox, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={36} color="#10B981" />
            </View>
            <Text style={[styles.statusTitle, { color: C.text }]}>자녀 연결 완료!</Text>
            <Text style={[styles.statusDesc, { color: C.textSecondary }]}>
              {params.pool_name}에서{"\n"}
              {result.linked_students.length > 0
                ? `${result.linked_students.join(", ")} 자녀가 자동으로 연결되었습니다.`
                : "자녀가 연결되었습니다."
              }
            </Text>
            <Pressable style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]} onPress={handleNext}>
              <Text style={styles.btnText}>다음 — 호칭 설정</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>
          </View>
        ) : result ? (
          <View style={styles.statusBox}>
            <View style={[styles.iconBox, { backgroundColor: "#FEF3C7" }]}>
              <Feather name="clock" size={36} color="#F59E0B" />
            </View>
            <Text style={[styles.statusTitle, { color: C.text }]}>승인 대기 중</Text>
            <Text style={[styles.statusDesc, { color: C.textSecondary }]}>
              {params.pool_name} 관리자에게{"\n"}자녀 연결 승인을 요청했습니다.{"\n\n"}
              승인 후 학부모 홈을 이용하실 수 있습니다.
            </Text>
            <Pressable style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]} onPress={handleNext}>
              <Text style={styles.btnText}>확인</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  stepRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  step: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  stepLine: { flex: 1, height: 2, maxWidth: 40 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20, alignItems: "center", justifyContent: "center" },
  loadingState: { alignItems: "center", gap: 16 },
  loadingText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  statusBox: { alignItems: "center", gap: 16, paddingHorizontal: 10 },
  iconBox: { width: 84, height: 84, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  statusDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, marginTop: 8 },
  btnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
