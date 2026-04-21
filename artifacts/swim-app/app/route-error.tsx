/**
 * route-error.tsx
 * 세션은 있으나 라우팅에 실패했을 때 표시되는 안전망 화면.
 * 워치독 타임아웃(25s) 이후 kind가 존재할 때 이 화면으로 이동.
 * 사용자가 재시도하거나 로그아웃할 수 있다.
 */
import React, { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";

export default function RouteErrorScreen() {
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    try {
      router.replace("/");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await logout();
      router.replace("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.emoji}>⚠️</Text>
      <Text style={s.title}>화면 전환에 실패했습니다</Text>
      <Text style={s.desc}>
        서버 응답이 지연되거나 네트워크 오류가 발생했습니다.{"\n"}
        재시도하거나, 로그아웃 후 다시 로그인해 주세요.
      </Text>

      {loading ? (
        <ActivityIndicator color="#2EC4B6" style={{ marginTop: 32 }} />
      ) : (
        <View style={s.btnRow}>
          <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
            <Text style={s.retryTxt}>다시 시도</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
            <Text style={s.logoutTxt}>로그아웃</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, justifyContent: "center", alignItems: "center",
    backgroundColor: "#FFFFFF", padding: 36,
  },
  emoji: { fontSize: 48, marginBottom: 20 },
  title: {
    fontSize: 18, fontWeight: "700", color: "#1E293B",
    textAlign: "center", marginBottom: 12,
  },
  desc: {
    fontSize: 14, color: "#64748B", textAlign: "center",
    lineHeight: 22,
  },
  btnRow: { flexDirection: "column", gap: 12, marginTop: 36, width: "100%" },
  retryBtn: {
    backgroundColor: "#2EC4B6", paddingVertical: 14,
    borderRadius: 12, alignItems: "center",
  },
  retryTxt: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  logoutBtn: {
    backgroundColor: "#F1F5F9", paddingVertical: 14,
    borderRadius: 12, alignItems: "center",
  },
  logoutTxt: { color: "#475569", fontSize: 15, fontWeight: "600" },
});
