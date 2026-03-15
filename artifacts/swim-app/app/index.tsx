import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LOGIN_LABELS } from "@/constants/auth";

const C = Colors.light;
const _DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ||
  (_DOMAIN ? `https://${_DOMAIN}/api` : "/api");

type MsgType = "success" | "info" | "error";

export default function LoginIdScreen() {
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: MsgType } | null>(null);

  async function handleNext() {
    const id = identifier.trim();
    if (!id) {
      setMsg({ text: "아이디를 입력해주세요.", type: "error" });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/check-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: id }),
      });
      const data = await res.json();
      if (data.exists) {
        setMsg({ text: LOGIN_LABELS.existsMsg, type: "success" });
        setTimeout(() => router.push({ pathname: "/login", params: { id } } as any), 600);
      } else {
        setMsg({ text: LOGIN_LABELS.newIdMsg, type: "info" });
        setTimeout(() => router.push({ pathname: "/register", params: { id } } as any), 700);
      }
    } catch {
      setMsg({ text: "서버 연결에 실패했습니다.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  const msgBg = msg?.type === "success" ? "#D1FAE5" : msg?.type === "info" ? "#DBEAFE" : "#FEE2E2";
  const msgColor = msg?.type === "success" ? "#059669" : msg?.type === "info" ? "#1D4ED8" : C.error;
  const msgIcon = msg?.type === "success" ? "check-circle" : msg?.type === "info" ? "info" : "alert-circle";

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === "web" ? 80 : 60), paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoArea}>
          <View style={[styles.logoBox, { backgroundColor: C.tint }]}>
            <Feather name="droplet" size={36} color="#fff" />
          </View>
          <Text style={[styles.appName, { color: C.text }]}>{LOGIN_LABELS.appName}</Text>
          <Text style={[styles.appSub, { color: C.textSecondary }]}>{LOGIN_LABELS.appSub}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>{LOGIN_LABELS.idInput.label}</Text>
            <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="user" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={identifier}
                onChangeText={v => { setIdentifier(v); setMsg(null); }}
                placeholder={LOGIN_LABELS.idInput.placeholder}
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleNext}
                editable={!loading}
              />
            </View>
            <Text style={[styles.helper, { color: C.textMuted }]}>{LOGIN_LABELS.idInput.helper}</Text>
          </View>

          {!!msg && (
            <View style={[styles.msgBox, { backgroundColor: msgBg }]}>
              <Feather name={msgIcon as any} size={14} color={msgColor} />
              <Text style={[styles.msgText, { color: msgColor }]}>{msg.text}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleNext}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : (
                <View style={styles.btnInner}>
                  <Text style={styles.btnText}>{LOGIN_LABELS.nextBtn}</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </View>
              )
            }
          </Pressable>
        </View>

        <View style={[styles.poolSearchCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.poolSearchHeader}>
            <View style={[styles.poolSearchIcon, { backgroundColor: C.tintLight }]}>
              <Feather name="search" size={18} color={C.tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.poolSearchTitle, { color: C.text }]}>{LOGIN_LABELS.poolSearch.title}</Text>
              <Text style={[styles.poolSearchSub, { color: C.textSecondary }]}>{LOGIN_LABELS.poolSearch.sub}</Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.poolSearchBtn,
              { backgroundColor: C.tintLight, borderColor: C.tint, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => router.push("/pool-join-request")}
          >
            <Feather name="map-pin" size={15} color={C.tint} />
            <Text style={[styles.poolSearchBtnText, { color: C.tint }]}>{LOGIN_LABELS.poolSearch.btn}</Text>
          </Pressable>
        </View>

        <View style={styles.footerLinks}>
          <Pressable style={styles.footerRow} onPress={() => router.push("/register")}>
            <Feather name="plus-circle" size={13} color={C.textMuted} />
            <Text style={[styles.footerText, { color: C.textSecondary }]}>수영장 사업자 가입 신청</Text>
          </Pressable>
          <Pressable style={styles.footerRow} onPress={() => router.push("/teacher-invite-join")}>
            <Feather name="mail" size={13} color={C.textMuted} />
            <Text style={[styles.footerText, { color: C.textSecondary }]}>선생님 초대 코드로 가입</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 22 },
  logoArea: { alignItems: "center", gap: 12 },
  logoBox: { width: 76, height: 76, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold" },
  appSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  card: {
    borderRadius: 20, padding: 22, gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  helper: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  msgBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  msgText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  poolSearchCard: {
    borderRadius: 18, padding: 18, gap: 14, borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  poolSearchHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  poolSearchIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  poolSearchTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  poolSearchSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  poolSearchBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 44, borderRadius: 12, borderWidth: 1.5,
  },
  poolSearchBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  footerLinks: { alignItems: "center", gap: 12 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
