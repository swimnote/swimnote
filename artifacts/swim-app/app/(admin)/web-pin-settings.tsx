import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

export default function WebPinSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webPinSet, setWebPinSet] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadStatus = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await apiRequest(token, "/pools/web-pin-status");
      if (r.ok) {
        const data = await r.json();
        setWebPinSet(!!data.isSet);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleSave() {
    if (!token) return;
    if (newPin.length < 4) {
      setMsg({ text: "비밀번호는 4자리 이상이어야 합니다.", ok: false });
      return;
    }
    if (newPin !== confirmPin) {
      setMsg({ text: "새 비밀번호가 일치하지 않습니다.", ok: false });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const r = await apiRequest(token, "/pools/web-pin", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: currentPw,
          newPin,
        }),
      });
      const data = await r.json();
      if (r.ok) {
        setMsg({ text: "성공적으로 저장되었습니다.", ok: true });
        setWebPinSet(true);
        setCurrentPw("");
        setNewPin("");
        setConfirmPin("");
      } else {
        setMsg({ text: data.error || "저장에 실패했습니다.", ok: false });
      }
    } catch (e) {
      setMsg({ text: "오류가 발생했습니다.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    Alert.alert("PIN 해제", "PC 대시보드 PIN을 해제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "해제",
        style: "destructive",
        onPress: async () => {
          if (!token) return;
          setSaving(true);
          try {
            const r = await apiRequest(token, "/pools/web-pin", { method: "DELETE" });
            if (r.ok) {
              setWebPinSet(false);
              setMsg({ text: "비밀번호가 해제되었습니다.", ok: true });
            }
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={[s.root, { paddingBottom: insets.bottom }]}>
      <SubScreenHeader title="PC 대시보드 PIN" />
      <KeyboardAwareScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Info Card */}
        <View style={s.infoCard}>
          <View style={s.infoIcon}>
            <LucideIcon name="globe" size={20} color="#0369A1" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.infoTitle}>PC 대시보드 전용 보안 PIN</Text>
            <Text style={s.infoDesc}>
              X모드 PIN을 설정하면 PC에서 SWIMNOTE 관리자 기능을 사용할 수 있습니다.
              앱 로그인 비밀번호와 별개로 사용되는 PC 전용 추가 보안 PIN입니다.
            </Text>
          </View>
        </View>

        {/* Status Badge */}
        {loading ? (
          <ActivityIndicator color={C.brandStrong} style={{ marginVertical: 16 }} />
        ) : (
          <View style={[s.statusBadge, { backgroundColor: webPinSet ? "#DCFCE7" : "#FEF9C3" }]}>
            <LucideIcon name={webPinSet ? "shield-check" : "alert-circle"} size={14} color={webPinSet ? "#16A34A" : "#CA8A04"} />
            <Text style={[s.statusText, { color: webPinSet ? "#16A34A" : "#CA8A04" }]}>
              {webPinSet ? "PC 대시보드 PIN 설정됨" : "PC 대시보드 PIN 미설정"}
            </Text>
          </View>
        )}

        {/* Form */}
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {webPinSet ? "PC 대시보드 PIN 변경" : "PC 대시보드 PIN 설정"}
          </Text>

          <View style={s.fieldGroup}>
            <Text style={s.label}>현재 앱 로그인 비밀번호 <Text style={{ color: "#AAA", fontWeight: "400" }}>(선택사항)</Text></Text>
            <TextInput
              style={s.input}
              placeholder="입력하지 않아도 됩니다"
              secureTextEntry
              value={currentPw}
              onChangeText={setCurrentPw}
              autoComplete="current-password"
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>새 PC 대시보드 PIN (4자리 이상)</Text>
            <TextInput
              style={s.input}
              placeholder="새 PC 대시보드 PIN"
              secureTextEntry
              value={newPin}
              onChangeText={setNewPin}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>새 PC 대시보드 PIN 확인</Text>
            <TextInput
              style={s.input}
              placeholder="비밀번호 재입력"
              secureTextEntry
              value={confirmPin}
              onChangeText={setConfirmPin}
            />
          </View>

          {msg && (
            <View style={[s.msg, { backgroundColor: msg.ok ? "#DCFCE7" : "#FEF2F2" }]}>
              <Text style={[s.msgText, { color: msg.ok ? "#16A34A" : "#DC2626" }]}>{msg.text}</Text>
            </View>
          )}

          <Pressable
            style={[s.saveBtn, saving && s.disabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <LucideIcon name="lock" size={15} color="#fff" />
                <Text style={s.saveBtnText}>{webPinSet ? "PIN 변경" : "PIN 설정"}</Text>
              </>
            )}
          </Pressable>

          {webPinSet && (
            <Pressable style={s.deleteBtn} onPress={handleDelete} disabled={saving}>
              <LucideIcon name="trash-2" size={14} color="#DC2626" />
              <Text style={s.deleteBtnText}>PC 대시보드 PIN 해제</Text>
            </Pressable>
          )}
        </View>

        <Text style={s.hint}>
          ※ PIN을 분실한 경우 수영장 최고 관리자에게 문의하세요.{"\n"}
          ※ PC 대시보드에서는 더 상세한 정산 및 통계 기능을 제공합니다.
        </Text>

      </KeyboardAwareScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.backgroundSoft },
  scroll: { padding: 20 },

  infoCard: {
    flexDirection: "row",
    backgroundColor: "#F0F9FF",
    borderWidth: 1,
    borderColor: "#BAE6FD",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: { fontSize: 14, fontWeight: "700", color: "#0369A1", marginBottom: 2 },
  infoDesc: { fontSize: 12, color: "#0C4A6E", lineHeight: 18 },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
    marginBottom: 20,
  },
  statusText: { fontSize: 13, fontWeight: "600" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.textStrong, marginBottom: 20 },

  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginBottom: 6 },
  input: {
    height: 48,
    backgroundColor: C.backgroundSoft,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: C.textStrong,
  },

  msg: { padding: 12, borderRadius: 10, marginBottom: 16 },
  msgText: { fontSize: 13, fontWeight: "500", textAlign: "center" },

  saveBtn: {
    height: 50,
    backgroundColor: "#0F2742",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  disabled: { opacity: 0.5 },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  deleteBtn: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  deleteBtnText: { color: "#DC2626", fontSize: 13, fontWeight: "600" },

  hint: {
    marginTop: 24,
    fontSize: 12,
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
});
