import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

export default function PoolApplyScreen() {
  const { token, refreshPool, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [form, setForm] = useState({
    name: "",
    name_en: "",
    business_reg_number: "",
    address: "",
    phone: "",
    owner_name: "",
    admin_name: "",
    admin_email: "",
    admin_phone: "",
  });
  const [regImage, setRegImage] = useState<{ uri: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function setF(key: keyof typeof form) {
    return (v: string) => setForm(f => ({ ...f, [key]: v }));
  }

  async function pickRegImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setRegImage({ uri: result.assets[0].uri });
    }
  }

  async function handleApply() {
    if (!form.name || !form.address || !form.phone || !form.owner_name || !form.business_reg_number ||
        !form.admin_name || !form.admin_email) {
      setError("필수 항목을 모두 입력해주세요."); return;
    }
    const digits = form.business_reg_number.replace(/[^0-9]/g, "");
    if (digits.length !== 10) {
      setError("사업자등록번호 10자리를 올바르게 입력해주세요."); return;
    }
    if (form.name_en && !/^[a-z0-9_]+$/.test(form.name_en)) {
      setError("영문표시명은 소문자, 숫자, 언더스코어(_)만 사용할 수 있습니다."); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email)) {
      setError("관리자 이메일 형식이 올바르지 않습니다."); return;
    }
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("name_en", form.name_en);
      fd.append("business_reg_number", form.business_reg_number);
      fd.append("address", form.address);
      fd.append("phone", form.phone);
      fd.append("owner_name", form.owner_name);
      fd.append("admin_name", form.admin_name);
      fd.append("admin_email", form.admin_email);
      fd.append("admin_phone", form.admin_phone);
      if (regImage) {
        const filename = regImage.uri.split("/").pop() || "business_reg.jpg";
        const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
        fd.append("business_reg_image", {
          uri: regImage.uri, name: filename,
          type: ext === "png" ? "image/png" : "image/jpeg",
        } as any);
      }
      const res = await fetch(`${API_BASE}/api/pools/apply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "신청에 실패했습니다.");
      await refreshPool();
      router.replace("/pending");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "신청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 24), paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: C.tintLight }]}>
            <Feather name="map-pin" size={28} color={C.tint} />
          </View>
          <Text style={[styles.title, { color: C.text }]}>수영장 등록 신청</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            신청 후 플랫폼 운영자 확인을 거쳐{"\n"}승인이 완료되면 서비스를 이용하실 수 있습니다.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color={C.error} />
              <Text style={[styles.errorText, { color: C.error }]}>{error}</Text>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: C.text }]}>수영장 정보</Text>

          {/* 수영장 한글명 */}
          <Field label="수영장 이름 *" icon="droplet">
            <TextInput style={[styles.input, { color: C.text }]} value={form.name} onChangeText={setF("name")}
              placeholder="예: 토이키즈스윔클럽 화정점" placeholderTextColor={C.textMuted} />
          </Field>

          {/* 영문표시명 */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: C.textSecondary }]}>영문표시명 (파일명용)</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="type" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput style={[styles.input, { color: C.text }]} value={form.name_en}
                onChangeText={v => setF("name_en")(v.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="예: toykids_hwajeong" placeholderTextColor={C.textMuted} autoCapitalize="none" />
            </View>
            <Text style={[styles.hint, { color: C.textMuted }]}>소문자·숫자·_ 만 사용 · 사진 파일명에 사용됩니다</Text>
          </View>

          {/* 사업자등록번호 */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: C.textSecondary }]}>사업자등록번호 *</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="file-text" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput style={[styles.input, { color: C.text }]} value={form.business_reg_number}
                onChangeText={v => {
                  const d = v.replace(/[^0-9]/g, "").slice(0, 10);
                  let fmt = d;
                  if (d.length > 5) fmt = `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`;
                  else if (d.length > 3) fmt = `${d.slice(0,3)}-${d.slice(3)}`;
                  setF("business_reg_number")(fmt);
                }}
                placeholder="000-00-00000" placeholderTextColor={C.textMuted}
                keyboardType="number-pad" maxLength={12} />
            </View>
          </View>

          {/* 사업자등록증 이미지 */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: C.textSecondary }]}>사업자등록증 이미지</Text>
            {regImage ? (
              <View style={styles.regImageWrap}>
                <Image source={{ uri: regImage.uri }} style={styles.regImagePreview} resizeMode="contain" />
                <Pressable style={[styles.changeImageBtn, { borderColor: C.border }]} onPress={pickRegImage}>
                  <Feather name="refresh-cw" size={14} color={C.textSecondary} />
                  <Text style={[styles.changeImageText, { color: C.textSecondary }]}>이미지 변경</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={[styles.imagePicker, { borderColor: C.border, backgroundColor: C.background }]} onPress={pickRegImage}>
                <Feather name="upload" size={24} color={C.tint} />
                <Text style={[styles.imagePickerText, { color: C.text }]}>사업자등록증 업로드</Text>
                <Text style={[styles.imagePickerSub, { color: C.textMuted }]}>JPG, PNG 형식 지원</Text>
              </Pressable>
            )}
          </View>

          {/* 주소 */}
          <Field label="주소 *" icon="map-pin">
            <TextInput style={[styles.input, { color: C.text }]} value={form.address} onChangeText={setF("address")}
              placeholder="수영장 주소를 입력하세요" placeholderTextColor={C.textMuted} />
          </Field>

          {/* 대표 전화 */}
          <Field label="대표 전화 *" icon="phone">
            <TextInput style={[styles.input, { color: C.text }]} value={form.phone} onChangeText={setF("phone")}
              placeholder="02-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
          </Field>

          {/* 대표자 이름 */}
          <Field label="대표자 이름 *" icon="user">
            <TextInput style={[styles.input, { color: C.text }]} value={form.owner_name} onChangeText={setF("owner_name")}
              placeholder="사업자 대표자명" placeholderTextColor={C.textMuted} />
          </Field>

          <Text style={[styles.sectionTitle, { color: C.text, marginTop: 8 }]}>관리자 정보</Text>

          {/* 관리자 이름 */}
          <Field label="관리자 이름 *" icon="user">
            <TextInput style={[styles.input, { color: C.text }]} value={form.admin_name} onChangeText={setF("admin_name")}
              placeholder="수영장 관리자명" placeholderTextColor={C.textMuted} />
          </Field>

          {/* 관리자 이메일 (로그인 아이디) */}
          <Field label="관리자 이메일 (로그인 아이디) *" icon="mail">
            <TextInput style={[styles.input, { color: C.text }]} value={form.admin_email} onChangeText={setF("admin_email")}
              placeholder="admin@example.com" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" />
          </Field>

          {/* 관리자 연락처 */}
          <Field label="관리자 연락처" icon="phone">
            <TextInput style={[styles.input, { color: C.text }]} value={form.admin_phone} onChangeText={setF("admin_phone")}
              placeholder="010-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
          </Field>

          <View style={[styles.notice, { backgroundColor: C.tintLight, borderRadius: 10, padding: 12 }]}>
            <Feather name="info" size={14} color={C.tint} />
            <Text style={[styles.noticeText, { color: C.tint }]}>
              신청 내용은 플랫폼 운영자가 직접 검토 후 승인합니다.{"\n"}승인되면 관리자 이메일로 계정이 활성화됩니다.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleApply} disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : (
              <View style={styles.btnContent}>
                <Feather name="send" size={18} color="#fff" />
                <Text style={styles.btnText}>신청서 제출하기</Text>
              </View>
            )}
          </Pressable>
        </View>

        <Pressable onPress={logout} style={styles.logoutBtn}>
          <Text style={[styles.logoutText, { color: C.textMuted }]}>다른 계정으로 로그인</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  const C = Colors.light;
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
      <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
        <Feather name={icon} size={16} color={C.textMuted} style={styles.inputIcon} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 24 },
  header: { alignItems: "center", gap: 12, paddingTop: 8 },
  iconBox: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  card: { borderRadius: 20, padding: 24, gap: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 20, elevation: 4 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 12 },
  fieldWrap: { gap: 4 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  imagePicker: { borderWidth: 2, borderStyle: "dashed", borderRadius: 14, paddingVertical: 28, alignItems: "center", gap: 8 },
  imagePickerText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  imagePickerSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  regImageWrap: { gap: 10 },
  regImagePreview: { width: "100%", height: 180, borderRadius: 12 },
  changeImageBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10 },
  changeImageText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  notice: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  noticeText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  logoutBtn: { alignItems: "center" },
  logoutText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
