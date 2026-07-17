import { Globe, Lock, Trash2 } from "lucide-react-native";
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
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [webPinSet, setWebPinSet] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPw, setCurrentPw] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/auth/web-pin/status");
      if (res.ok) {
        const data = await res.json();
        setWebPinSet(data.web_pin_set === true);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleSave = async () => {
    if (!newPin) { setMsg({ text: "새 웹 접속 비밀번호를 입력해주세요.", ok: false }); return; }
    if (newPin.length < 4) { setMsg({ text: "웹 접속 비밀번호는 4자리 이상이어야 합니다.", ok: false }); return; }
    if (newPin !== confirmPin) { setMsg({ text: "비밀번호가 일치하지 않습니다.", ok: false }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiRequest(token, "/auth/web-pin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPw, web_pin: newPin }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMsg({ text: "웹 접속 비밀번호가 설정되었습니다.", ok: true });
        setWebPinSet(true);
        setCurrentPw(""); setNewPin(""); setConfirmPin("");
      } else {
        setMsg({ text: data.message || "저장에 실패했습니다.", ok: false });
      }
    } catch { setMsg({ text: "네트워크 오류가 발생했습니다.", ok: false }); }
    finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert(
      "웹 접속 비밀번호 해제",
      "웹 접속 비밀번호를 해제하면 이메일/비밀번호만으로 웹 로그인이 가능합니다. 계속하시겠어요?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제", style: "destructive",
          onPress: async () => {
            setSaving(true);
            setMsg(null);
            try {
              const res = await apiRequest(token, "/auth/web-pin", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ current_password: currentPw, web_pin: null }),
              });
              const data = await res.json();
              if (res.ok && data.success) {
                setMsg({ text: "웹 접속 비밀번호가 해제되었습니다.", ok: true });
                setWebPinSet(false);
                setCurrentPw(""); setNewPin(""); setConfirmPin("");
              } else {
                setMsg({ text: data.message || "해제에 실패했습니다.", ok: false });
              }
            } catch { setMsg({ text: "네트워크 오류가 발생했습니다.", ok: false }); }
            finally { setSaving(false); }
          },
        },
      ]
    );
  };

  return (
    <View style={[s.root, { paddingBottom: insets.bottom }]}>
      <SubScreenHeader title="웹 접속 비밀번호" />
      <KeyboardAwareScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Info Card */}
        <View style={s.infoCard}>
          <View style={s.infoIcon}>
            <LucideIcon name="globe" size={20} color="#0369A1" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.infoTitle}>웹 관리자 전용 보안 비밀번호</Text>
            <Text style={s.infoDesc}>
              swimnote.kr 웹 대시보드에 로그인할 때 이메일/비밀번호 외에 추가로 입력해야 하는 비밀번호입니다.
              앱 로그인에는 영향을 주지 않습니다.
            </Text>
          </View>
        </View>

        {/* Status Badge */}
        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
        ) : (
          <View style={[s.statusBadge, { backgroundColor: webPinSet ? "#DCFCE7" : "#FEF9C3" }]}>
            <LucideIcon name={webPinSet ? "shield-check" : "shield-alert"} size={14} color={webPinSet ? "#16A34A" : "#CA8A04"} />
            <Text style={[s.statusText, { color: webPinSet ? "#16A34A" : "#CA8A04" }]}>
              {webPinSet ? "웹 접속 비밀번호 설정됨" : "웹 접속 비밀번호 미설정"}
            </Text>
          </View>
        )}

        {/* Form */}
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {webPinSet ? "웹 접속 비밀번호 변경" : "웹 접속 비밀번호 설정"}
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
            <Text style={s.label}>새 웹 접속 비밀번호 (4자리 이상)</Text>
            <TextInput
              style={s.input}
              placeholder="새 웹 전용 비밀번호"
              secureTextEntry
              value={newPin}
              onChangeText={setNewPin}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>새 웹 접속 비밀번호 확인</Text>
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
                <Text style={s.saveBtnText}>{webPinSet ? "비밀번호 변경" : "비밀번호 설정"}</Text>
              </>
            )}
          </Pressable>

          {webPinSet && (
            <Pressable style={s.deleteBtn} onPress={handleDelete} disabled={saving}>
              <LucideIcon name="trash-2" size={14} color="#DC2626" />
              <Text style={s.deleteBtnText}>웹 접속 비밀번호 해제</Text>
            </Pressable>
          )}
        </View>

        <Text style={s.hint}>
          웹 접속 비밀번호를 설정하면 swimnote.kr에서 이메일/비밀번호 입력 후 이 비밀번호를 추가로 입력해야 로그인됩니다.
        </Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8F9FB" },
  scroll: { padding: 16, gap: 12 },
  infoCard: {
    flexDirection: "row", gap: 12, alignItems: "flex-start",
    backgroundColor: "#EFF6FF", borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: "#BFDBFE",
  },
  infoIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#DBEAFE",
    alignItems: "center", justifyContent: "center",
  },
  infoTitle: { fontSize: 13, fontWeight: "700", color: "#1E40AF", marginBottom: 4 },
  infoDesc: { fontSize: 12, color: "#3B82F6", lineHeight: 18 },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignSelf: "flex-start",
  },
  statusText: { fontSize: 12, fontWeight: "600" },
  card: {
    backgroundColor: "#fff", borderRadius: 20,
    padding: 20, gap: 16,
    borderWidth: 1, borderColor: "#EBEBEB",
  },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#0A0A0A" },
  fieldGroup: { gap: 6 },
  label: { fontSize: 11, fontWeight: "600", color: "#555" },
  input: {
    borderWidth: 1, borderColor: "#E5E5E5", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#0A0A0A",
  },
  msg: { borderRadius: 10, padding: 12 },
  msgText: { fontSize: 13, fontWeight: "500" },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#0369A1", borderRadius: 14,
    paddingVertical: 14,
  },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10,
  },
  deleteBtnText: { color: "#DC2626", fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 11, color: "#BBB", lineHeight: 18, textAlign: "center", paddingHorizontal: 8 },
});
