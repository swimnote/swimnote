/**
 * parent-onboard-child.tsx — STEP 2: 보호자·자녀 정보 입력
 * 관계/호칭 + 자녀 최대 3명 (이름 + 생년월일) 입력
 * 제출 시 자동승인 여부 확인 → 결과에 따라 이동
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { checkAutoApproval, useParentJoinStore, type ParentRelation } from "@/store/parentJoinStore";

const C = Colors.light;

const RELATIONS: ParentRelation[] = ["부", "모", "조부", "조모", "기타"];

interface ChildForm { name: string; birthDate: string; }

export default function ParentOnboardChildScreen() {
  const { adminUser, parentAccount } = useAuth();
  const insets   = useSafeAreaInsets();
  const params   = useLocalSearchParams<{ pool_id: string; pool_name: string }>();
  const submitRequest = useParentJoinStore(s => s.submitRequest);

  const [relation, setRelation]       = useState<ParentRelation | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [children, setChildren]       = useState<ChildForm[]>([{ name: "", birthDate: "" }]);
  const [error, setError]             = useState("");
  const [submitting, setSubmitting]   = useState(false);

  const parentPhone = adminUser?.phone ?? parentAccount?.phone ?? "";
  const parentName  = adminUser?.name  ?? parentAccount?.name  ?? "학부모";

  function updateChild(idx: number, field: keyof ChildForm, val: string) {
    setChildren(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  }

  function addChild() {
    if (children.length >= 3) return;
    setChildren(prev => [...prev, { name: "", birthDate: "" }]);
  }

  function removeChild(idx: number) {
    if (children.length <= 1) return;
    setChildren(prev => prev.filter((_, i) => i !== idx));
  }

  function validate(): boolean {
    if (!relation) {
      setError("보호자 관계를 선택해주세요."); return false;
    }
    if (!displayName.trim()) {
      setError("호칭을 입력해주세요. (예: 민수엄마)"); return false;
    }
    const first = children[0];
    if (!first.name.trim()) {
      setError("첫 번째 자녀 이름을 입력해주세요."); return false;
    }
    if (!first.birthDate.trim()) {
      setError("첫 번째 자녀 생년월일을 입력해주세요."); return false;
    }
    for (let i = 1; i < children.length; i++) {
      const c = children[i];
      if (c.name.trim() && !c.birthDate.trim()) {
        setError(`자녀 ${i + 1} 생년월일을 입력해주세요.`); return false;
      }
      if (!c.name.trim() && c.birthDate.trim()) {
        setError(`자녀 ${i + 1} 이름을 입력해주세요.`); return false;
      }
    }
    return true;
  }

  async function handleSubmit() {
    setError("");
    if (!validate()) return;
    setSubmitting(true);

    const validChildren = children.filter(c => c.name.trim() && c.birthDate.trim());
    const result = checkAutoApproval(params.pool_id ?? "", parentPhone, validChildren);

    submitRequest({
      operatorId:    params.pool_id   ?? "unknown",
      operatorName:  params.pool_name ?? "수영장",
      parentId:      adminUser?.id    ?? parentAccount?.id ?? "usr-new",
      parentName,
      parentPhone,
      relation:      relation!,
      displayName:   displayName.trim(),
      children:      validChildren,
      status:        result.status,
      matchStatus:   result.matchStatus,
      matchedStudentIds: result.matchedStudentIds,
    });

    setSubmitting(false);

    if (result.status === "auto_approved") {
      Alert.alert(
        "자동 승인 완료!",
        `자녀 정보가 학생 명부와 일치하여\n즉시 승인되었습니다.\n\n연결된 자녀: ${validChildren.map(c => c.name).join(", ")}`,
        [{ text: "홈으로", onPress: () => router.replace("/(parent)/home" as any) }]
      );
    } else {
      router.replace("/pending" as any);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 68 : 20) }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <StepBar current={2} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: C.text }]}>보호자·자녀 정보</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>
          <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>{params.pool_name}</Text>
          {" "}가입 요청 정보를 입력해주세요.
        </Text>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
            <Feather name="alert-circle" size={13} color={C.error} />
            <Text style={[styles.errorTxt, { color: C.error }]}>{error}</Text>
          </View>
        )}

        {/* ── 보호자 관계 ── */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>보호자 관계</Text>
          <Text style={[styles.cardSub, { color: C.textSecondary }]}>자녀와의 관계를 선택해주세요</Text>
          <View style={styles.relRow}>
            {RELATIONS.map(r => (
              <Pressable
                key={r}
                style={[styles.relBtn, relation === r && { backgroundColor: C.tint, borderColor: C.tint }]}
                onPress={() => setRelation(r)}
              >
                <Text style={[styles.relTxt, { color: relation === r ? "#fff" : C.textSecondary }]}>{r}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: C.textSecondary, marginTop: 14 }]}>호칭 (표시 이름) *</Text>
          <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
            <Feather name="tag" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.input, { color: C.text }]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="예: 민수엄마, 지수아빠, 할머니"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <Text style={[styles.hint, { color: C.textMuted }]}>앱에서 관리자에게 보여질 이름입니다</Text>
        </View>

        {/* ── 자녀 정보 ── */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <Text style={[styles.cardTitle, { color: C.text }]}>자녀 정보</Text>
          <Text style={[styles.cardSub, { color: C.textSecondary }]}>
            최대 3명까지 입력 가능합니다. 자녀 정보가 학생 명부와 일치하면 자동으로 승인됩니다.
          </Text>

          {children.map((child, idx) => (
            <View key={idx} style={[styles.childCard, { borderColor: idx === 0 ? C.tint : C.border }]}>
              <View style={styles.childHeader}>
                <View style={[styles.childBadge, { backgroundColor: idx === 0 ? C.tintLight : "#F3F4F6" }]}>
                  <Text style={[styles.childBadgeTxt, { color: idx === 0 ? C.tint : C.textSecondary }]}>
                    자녀 {idx + 1}{idx === 0 ? " (필수)" : " (선택)"}
                  </Text>
                </View>
                {idx > 0 && (
                  <Pressable onPress={() => removeChild(idx)} hitSlop={8}>
                    <Feather name="x-circle" size={18} color={C.textMuted} />
                  </Pressable>
                )}
              </View>

              <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>이름 *</Text>
              <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name="user" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={child.name}
                  onChangeText={v => updateChild(idx, "name", v)}
                  placeholder="자녀 이름"
                  placeholderTextColor={C.textMuted}
                />
              </View>

              <Text style={[styles.fieldLabel, { color: C.textSecondary, marginTop: 10 }]}>생년월일 *</Text>
              <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name="calendar" size={15} color={C.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={child.birthDate}
                  onChangeText={v => updateChild(idx, "birthDate", v)}
                  placeholder="YYYY-MM-DD  예: 2015-03-15"
                  placeholderTextColor={C.textMuted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
              </View>
            </View>
          ))}

          {children.length < 3 && (
            <Pressable
              style={[styles.addChildBtn, { borderColor: C.border }]}
              onPress={addChild}
            >
              <Feather name="plus-circle" size={16} color={C.tint} />
              <Text style={[styles.addChildTxt, { color: C.tint }]}>자녀 추가</Text>
            </Pressable>
          )}
        </View>

        {/* 자동승인 안내 */}
        <View style={[styles.autoHint, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }]}>
          <Feather name="zap" size={14} color="#059669" />
          <Text style={[styles.autoHintTxt, { color: "#059669" }]}>
            입력한 정보가 학생 명부와 일치하면 즉시 자동 승인됩니다
          </Text>
        </View>

        {/* 제출 버튼 */}
        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            { backgroundColor: submitting ? C.textMuted : C.tint, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Feather name="send" size={16} color="#fff" />
          <Text style={styles.submitTxt}>가입 요청 보내기</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StepBar({ current }: { current: number }) {
  const steps = [1, 2, 3];
  return (
    <View style={sb.row}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <View style={[sb.line, { backgroundColor: s <= current ? C.tint : C.border }]} />}
          <View style={[sb.dot, { backgroundColor: s < current ? "#10B981" : s === current ? C.tint : C.border }]}>
            {s < current
              ? <Feather name="check" size={12} color="#fff" />
              : <Text style={[sb.dotTxt, { color: s === current ? "#fff" : C.textMuted }]}>{s}</Text>
            }
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const sb = StyleSheet.create({
  row:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dot:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dotTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  line:   { flex: 1, height: 2, maxWidth: 40 },
});

const styles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 16 },
  content:      { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  title:        { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text },
  sub:          { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  errorBox:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  errorTxt:     { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  card:         { borderRadius: 18, padding: 18, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle:    { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardSub:      { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  relRow:       { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  relBtn:       { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background },
  relTxt:       { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldLabel:   { fontSize: 12, fontFamily: "Inter_500Medium" },
  inputBox:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  input:        { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  hint:         { fontSize: 11, fontFamily: "Inter_400Regular" },
  childCard:    { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 6, marginTop: 6 },
  childHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  childBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  childBadgeTxt:{ fontSize: 11, fontFamily: "Inter_600SemiBold" },
  addChildBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  addChildTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  autoHint:     { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  autoHintTxt:  { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 19 },
  submitBtn:    { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  submitTxt:    { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
