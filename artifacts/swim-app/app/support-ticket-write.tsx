/**
 * support-ticket-write.tsx — 문의 작성
 *
 * Query params:
 *   type  = general | emergency | security | refund  (없으면 관리자용 선택)
 *   showTypeSelect = true  → 수영장관리자용 유형 선택 먼저
 */
import { Camera, ChevronLeft, MessageCircle, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const P = "#7C3AED";

type TicketType = "general" | "emergency" | "security" | "refund";

const TYPE_CFG: Record<TicketType, { label: string; color: string; bg: string; desc: string }> = {
  general:   { label: "일반",  color: "#0284C7", bg: "#E0F2FE", desc: "일반 문의 및 건의사항" },
  emergency: { label: "긴급",  color: "#DC2626", bg: "#FEF2F2", desc: "서비스 장애·긴급 상황" },
  security:  { label: "보안",  color: "#7C3AED", bg: "#EEDDF5", desc: "보안 이슈·계정 침해" },
  refund:    { label: "환불",  color: "#D97706", bg: "#FFF7ED", desc: "결제·환불 관련 문의" },
};

export default function SupportTicketWriteScreen() {
  const { type: typeParam, showTypeSelect } = useLocalSearchParams<{
    type?: TicketType; showTypeSelect?: string;
  }>();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const showSelect = showTypeSelect === "true";

  const [selectedType, setSelectedType] = useState<TicketType>(
    (typeParam as TicketType) ?? (showSelect ? ("" as any) : "general")
  );
  const [subject,     setSubject]     = useState("");
  const [description, setDescription] = useState("");
  const [images,      setImages]      = useState<string[]>([]);
  const [consultReq,  setConsultReq]  = useState(false);
  const [submitting,  setSubmitting]  = useState(false);

  async function pickImage() {
    if (images.length >= 2) { Alert.alert("최대 2장까지 첨부할 수 있습니다."); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("사진 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.35,
      base64: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const dataUrl = `data:image/jpeg;base64,${base64}`;
    setImages(prev => [...prev, dataUrl]);
  }

  function removeImage(idx: number) {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (!selectedType) { Alert.alert("문의 유형을 선택해주세요."); return; }
    if (!subject.trim()) { Alert.alert("제목을 입력해주세요."); return; }
    if (!description.trim()) { Alert.alert("내용을 입력해주세요."); return; }

    setSubmitting(true);
    try {
      const res = await apiRequest(token, "/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_type: selectedType,
          subject: subject.trim(),
          description: description.trim(),
          image_urls: images,
          consultation_requested: consultReq,
        }),
      });
      if (!res.ok) throw new Error();
      Alert.alert(
        "문의가 접수되었습니다",
        consultReq
          ? "상담 예약도 함께 접수되었습니다. 순서대로 연락드리겠습니다."
          : "확인 후 답변 드리겠습니다.",
        [{ text: "확인", onPress: () => router.back() }]
      );
    } catch {
      Alert.alert("오류", "문의 접수에 실패했습니다. 다시 시도해주세요.");
    } finally { setSubmitting(false); }
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <ChevronLeft size={24} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>문의하기</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 80 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* 유형 선택 (관리자용) */}
          {showSelect && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>문의 유형</Text>
              <View style={s.typeGrid}>
                {(Object.keys(TYPE_CFG) as TicketType[]).map(t => {
                  const cfg = TYPE_CFG[t];
                  const active = selectedType === t;
                  return (
                    <Pressable
                      key={t}
                      style={[s.typeCard, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                      onPress={() => setSelectedType(t)}
                    >
                      <Text style={[s.typeLabel, active && { color: cfg.color }]}>{cfg.label}</Text>
                      <Text style={s.typeDesc} numberOfLines={1}>{cfg.desc}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* 선택된 유형 뱃지 (고정 유형인 경우) */}
          {!showSelect && selectedType && (
            <View style={[s.typeBadgeRow, { backgroundColor: TYPE_CFG[selectedType].bg }]}>
              <Text style={[s.typeBadge, { color: TYPE_CFG[selectedType].color }]}>
                {TYPE_CFG[selectedType].label} 문의
              </Text>
              <Text style={s.typeBadgeSub}>{TYPE_CFG[selectedType].desc}</Text>
            </View>
          )}

          {/* 제목 */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>제목</Text>
            <TextInput
              style={s.input}
              placeholder="문의 제목을 입력해주세요"
              placeholderTextColor={C.textMuted}
              value={subject}
              onChangeText={setSubject}
              maxLength={100}
            />
          </View>

          {/* 내용 */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>내용</Text>
            <TextInput
              style={[s.input, s.textarea]}
              placeholder="문의 내용을 자세히 적어주세요"
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
              maxLength={1000}
            />
            <Text style={s.charCount}>{description.length}/1000</Text>
          </View>

          {/* 사진 첨부 */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>사진 첨부 (선택, 최대 2장)</Text>
            <View style={s.imageRow}>
              {images.map((uri, idx) => (
                <View key={idx} style={s.imageWrap}>
                  <Image source={{ uri }} style={s.thumbImg} />
                  <Pressable style={s.removeImg} onPress={() => removeImage(idx)}>
                    <X size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {images.length < 2 && (
                <Pressable style={s.addImgBtn} onPress={pickImage}>
                  <Camera size={22} color={C.textMuted} />
                  <Text style={s.addImgTxt}>사진 추가</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* 상담 예약 */}
          <Pressable
            style={[s.consultRow, consultReq && s.consultActive]}
            onPress={() => setConsultReq(v => !v)}
          >
            <View style={[s.checkBox, consultReq && s.checkBoxActive]}>
              {consultReq && <Text style={s.checkMark}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.consultTitle, consultReq && { color: P }]}>전화 상담 예약</Text>
              <Text style={s.consultSub}>접수 순서대로 담당자가 직접 연락드립니다</Text>
            </View>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* 제출 버튼 */}
      <View style={[s.submitWrap, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[s.submitBtn, { opacity: submitting ? 0.7 : 1 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.submitTxt}>문의 접수하기</Text>
          }
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
                  backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle:  { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },

  section:      { gap: 6 },
  sectionLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  input:        { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border,
                  paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Pretendard-Regular",
                  color: C.text },
  textarea:     { height: 140, paddingTop: 12 },
  charCount:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "right" },

  typeGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeCard:     { width: "47.5%", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5,
                  borderColor: C.border, padding: 12, gap: 4 },
  typeLabel:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  typeDesc:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  typeBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12 },
  typeBadge:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  typeBadgeSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },

  imageRow:     { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  imageWrap:    { position: "relative" },
  thumbImg:     { width: 90, height: 90, borderRadius: 10 },
  removeImg:    { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
                  backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  addImgBtn:    { width: 90, height: 90, borderRadius: 10, borderWidth: 1.5, borderColor: C.border,
                  borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4,
                  backgroundColor: "#fff" },
  addImgTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  consultRow:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
                  borderRadius: 14, borderWidth: 1.5, borderColor: C.border, padding: 14 },
  consultActive:{ borderColor: P, backgroundColor: "#EEDDF5" },
  checkBox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border,
                  alignItems: "center", justifyContent: "center" },
  checkBoxActive:{ borderColor: P, backgroundColor: P },
  checkMark:    { fontSize: 13, color: "#fff" },
  consultTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  consultSub:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },

  submitWrap:   { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.border,
                  paddingHorizontal: 16, paddingTop: 12 },
  submitBtn:    { backgroundColor: P, borderRadius: 14, paddingVertical: 16,
                  alignItems: "center", justifyContent: "center" },
  submitTxt:    { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
