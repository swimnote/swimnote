/**
 * (super)/policy.tsx — 정책 관리
 * 환불 정책 작성/수정/저장
 * 슈퍼관리자 전용 편집, 운영자 모드에서는 읽기 전용
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const PURPLE = "#7C3AED";

interface Policy {
  key: string;
  value: string;
  updated_at: string | null;
  updated_by: string | null;
}

const POLICY_TABS = [
  { key: "refund_policy",    label: "환불 정책" },
  { key: "privacy_policy",   label: "개인정보 처리방침" },
  { key: "terms_of_service", label: "이용 약관" },
];

export default function PolicyScreen() {
  const { token } = useAuth();
  const [policies, setPolicies] = useState<Record<string, Policy>>({});
  const [activeKey, setActiveKey] = useState("refund_policy");
  const [editing,   setEditing]   = useState(false);
  const [draft,     setDraft]     = useState("");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/super/policies");
      if (res.ok) {
        const arr: Policy[] = await res.json();
        const map: Record<string, Policy> = {};
        arr.forEach(p => { map[p.key] = p; });
        setPolicies(map);
      }
    } catch {}
    finally { setLoading(false); }
  }

  async function save() {
    setSaving(true); setError(""); setSuccess("");
    try {
      const res = await apiRequest(token, `/super/policies/${activeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: draft }),
      });
      if (res.ok) {
        setPolicies(prev => ({
          ...prev,
          [activeKey]: { ...prev[activeKey], key: activeKey, value: draft, updated_at: new Date().toISOString(), updated_by: "슈퍼관리자" },
        }));
        setEditing(false);
        setSuccess("저장되었습니다.");
        setTimeout(() => setSuccess(""), 3000);
      } else {
        const d = await res.json();
        setError(d.error || "저장 실패");
      }
    } catch { setError("네트워크 오류"); }
    finally { setSaving(false); }
  }

  const current = policies[activeKey];
  const displayText = current?.value ?? "";
  const updatedAt = current?.updated_at
    ? new Date(current.updated_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="정책 관리" homePath="/(super)/dashboard" />

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabBarContent}>
        {POLICY_TABS.map(t => (
          <Pressable key={t.key}
            style={[s.tab, activeKey === t.key && s.tabActive]}
            onPress={() => { setActiveKey(t.key); setEditing(false); setError(""); setSuccess(""); }}>
            <Text style={[s.tabTxt, activeKey === t.key && s.tabActiveTxt]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>

          {/* 정책 제목 + 액션 버튼 */}
          <View style={s.policyHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.policyTitle}>{POLICY_TABS.find(t => t.key === activeKey)?.label}</Text>
              {updatedAt && (
                <Text style={s.policyMeta}>
                  최종 수정: {updatedAt}
                  {current?.updated_by ? ` · ${current.updated_by}` : ""}
                </Text>
              )}
            </View>
            {!editing ? (
              <Pressable style={s.editBtn}
                onPress={() => { setDraft(displayText); setEditing(true); setSuccess(""); }}>
                <Feather name="edit-2" size={14} color={PURPLE} />
                <Text style={s.editBtnTxt}>{displayText ? "수정" : "작성"}</Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={s.cancelBtn} onPress={() => { setEditing(false); setError(""); }}>
                  <Text style={s.cancelBtnTxt}>취소</Text>
                </Pressable>
                <Pressable style={[s.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={save} disabled={saving}>
                  {saving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.saveBtnTxt}>저장</Text>
                  }
                </Pressable>
              </View>
            )}
          </View>

          {!!success && (
            <View style={s.successBanner}>
              <Feather name="check-circle" size={15} color="#059669" />
              <Text style={s.successTxt}>{success}</Text>
            </View>
          )}
          {!!error && <Text style={s.errorTxt}>{error}</Text>}

          {/* 정책 내용 */}
          <View style={s.contentBox}>
            {editing ? (
              <TextInput
                style={s.textarea}
                value={draft}
                onChangeText={setDraft}
                multiline
                autoFocus
                placeholder="정책 내용을 입력하세요..."
                placeholderTextColor="#9CA3AF"
                textAlignVertical="top"
              />
            ) : displayText ? (
              <Text style={s.contentText}>{displayText}</Text>
            ) : (
              <View style={s.emptyBox}>
                <Feather name="file-text" size={36} color="#D1D5DB" />
                <Text style={s.emptyTxt}>아직 작성된 정책이 없습니다.</Text>
                <Pressable style={s.editBtn}
                  onPress={() => { setDraft(""); setEditing(true); }}>
                  <Feather name="plus" size={14} color={PURPLE} />
                  <Text style={s.editBtnTxt}>지금 작성하기</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* 운영자 안내 */}
          <View style={s.noteBanner}>
            <Feather name="info" size={14} color="#6B7280" />
            <Text style={s.noteTxt}>
              이 정책은 운영자 설정 화면에서 읽기 전용으로 표시됩니다.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabBarContent:{ paddingHorizontal: 16, paddingVertical: 6, gap: 6, flexDirection: "row" },
  tab:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB" },
  tabActive:    { backgroundColor: PURPLE, borderColor: PURPLE },
  tabTxt:       { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabActiveTxt: { color: "#fff" },
  policyHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  policyTitle:  { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  policyMeta:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 3 },
  editBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12,
                  paddingVertical: 8, borderRadius: 10, backgroundColor: "#EDE9FE" },
  editBtnTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: PURPLE },
  cancelBtn:    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  saveBtn:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: PURPLE },
  saveBtnTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  successBanner:{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#D1FAE5",
                  borderRadius: 10, padding: 12 },
  successTxt:   { fontSize: 13, fontFamily: "Inter_500Medium", color: "#065F46" },
  errorTxt:     { fontSize: 13, fontFamily: "Inter_500Medium", color: "#DC2626", textAlign: "center" },
  contentBox:   { backgroundColor: "#fff", borderRadius: 16, padding: 18,
                  borderWidth: 1, borderColor: "#E5E7EB", minHeight: 300 },
  contentText:  { fontSize: 14, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 24 },
  textarea:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827",
                  lineHeight: 24, minHeight: 320 },
  emptyBox:     { alignItems: "center", paddingVertical: 40, gap: 12 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  noteBanner:   { flexDirection: "row", alignItems: "center", gap: 8,
                  backgroundColor: "#F3F4F6", borderRadius: 10, padding: 12 },
  noteTxt:      { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
});
