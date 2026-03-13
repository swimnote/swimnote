import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";

const PURPLE = "#7C3AED";

interface Policy {
  tier: string;
  quota_gb: number;
  per_member_mb: number;
  extra_price_per_gb: number;
  description: string | null;
}

const TIER_META: Record<string, { label: string; color: string; bg: string; memberRange: string }> = {
  free:           { label: "무료 이용",        color: "#6B7280", bg: "#F3F4F6", memberRange: "50명 이하" },
  paid_100:       { label: "100명 플랜",       color: "#059669", bg: "#ECFDF5", memberRange: "51 ~ 100명" },
  paid_300:       { label: "300명 플랜",       color: "#0891B2", bg: "#ECFEFF", memberRange: "101 ~ 300명" },
  paid_500:       { label: "500명 플랜",       color: "#1D4ED8", bg: "#EFF6FF", memberRange: "301 ~ 500명" },
  paid_1000:      { label: "1,000명 플랜",    color: PURPLE,    bg: "#F3E8FF", memberRange: "501 ~ 1,000명" },
  paid_enterprise:{ label: "엔터프라이즈",     color: "#DC2626", bg: "#FEF2F2", memberRange: "1,001명 이상" },
};

const TIER_ORDER = ["free","paid_100","paid_300","paid_500","paid_1000","paid_enterprise"];

export default function StoragePolicyScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Policy | null>(null);
  const [form, setForm] = useState({ quota_gb: "", per_member_mb: "", extra_price_per_gb: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function fetchPolicies() {
    try {
      const res = await apiRequest(token, "/admin/storage-policy");
      const data = await res.json();
      setPolicies(Array.isArray(data) ? data.sort((a: Policy, b: Policy) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
      ) : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchPolicies(); }, []);

  function openEdit(p: Policy) {
    setEditTarget(p);
    setForm({
      quota_gb: String(p.quota_gb),
      per_member_mb: String(p.per_member_mb),
      extra_price_per_gb: String(p.extra_price_per_gb),
      description: p.description || "",
    });
    setFormError("");
  }

  async function handleSave() {
    if (!form.quota_gb || !form.per_member_mb) { setFormError("용량과 회원당 평균을 입력해주세요."); return; }
    if (!editTarget) return;
    setSaving(true); setFormError("");
    try {
      const res = await apiRequest(token, `/admin/storage-policy/${editTarget.tier}`, {
        method: "PUT",
        body: JSON.stringify({
          quota_gb: parseFloat(form.quota_gb),
          per_member_mb: parseInt(form.per_member_mb),
          extra_price_per_gb: parseInt(form.extra_price_per_gb) || 0,
          description: form.description || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPolicies(prev => prev.map(p => p.tier === editTarget.tier ? data : p));
      setEditTarget(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally { setSaving(false); }
  }

  function fmtGB(gb: number) {
    return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`;
  }

  function fmtPrice(won: number) {
    return won.toLocaleString("ko-KR") + "원/GB";
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F3FF" }}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="#1F1235" />
        </Pressable>
        <Text style={styles.title}>저장 용량 정책</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* 안내 배너 */}
      <View style={[styles.infoBanner, { marginHorizontal: 20 }]}>
        <Feather name="info" size={14} color={PURPLE} />
        <Text style={styles.infoText}>
          구독 단계별 기본 제공 용량을 설정합니다. 용량 초과 시 수영장 관리자에게 경고 알림이 발송됩니다.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={PURPLE} size="large" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 12 }}
        >
          {policies.map(p => {
            const meta = TIER_META[p.tier] ?? { label: p.tier, color: "#6B7280", bg: "#F3F4F6", memberRange: "" };
            return (
              <View key={p.tier} style={[styles.card, { shadowColor: PURPLE + "22" }]}>
                {/* 단계 헤더 */}
                <View style={[styles.cardHeader, { backgroundColor: meta.bg }]}>
                  <View>
                    <Text style={[styles.tierLabel, { color: meta.color }]}>{meta.label}</Text>
                    <Text style={[styles.tierRange, { color: meta.color + "AA" }]}>{meta.memberRange}</Text>
                  </View>
                  <Pressable
                    style={[styles.editBtn, { backgroundColor: meta.color }]}
                    onPress={() => openEdit(p)}
                  >
                    <Feather name="edit-2" size={13} color="#fff" />
                    <Text style={styles.editBtnText}>수정</Text>
                  </Pressable>
                </View>

                {/* 정책 상세 */}
                <View style={styles.cardBody}>
                  <View style={styles.policyRow}>
                    <View style={styles.policyItem}>
                      <Feather name="hard-drive" size={14} color="#6B7280" />
                      <Text style={styles.policyKey}>기본 용량</Text>
                      <Text style={[styles.policyVal, { color: meta.color }]}>{fmtGB(Number(p.quota_gb))}</Text>
                    </View>
                    <View style={styles.dividerV} />
                    <View style={styles.policyItem}>
                      <Feather name="user" size={14} color="#6B7280" />
                      <Text style={styles.policyKey}>회원당 평균</Text>
                      <Text style={[styles.policyVal, { color: meta.color }]}>{p.per_member_mb} MB</Text>
                    </View>
                  </View>
                  <View style={[styles.extraRow, { borderColor: "#E5E7EB" }]}>
                    <Feather name="plus-circle" size={13} color="#9CA3AF" />
                    <Text style={styles.extraText}>추가 용량 단가</Text>
                    <Text style={[styles.extraPrice, { color: meta.color }]}>{fmtPrice(p.extra_price_per_gb)}</Text>
                  </View>
                  {p.description ? (
                    <Text style={styles.desc}>{p.description}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {/* 경고 임계치 안내 */}
          <View style={[styles.thresholdNote, { borderColor: "#FCD34D" }]}>
            <Feather name="alert-triangle" size={14} color="#D97706" />
            <Text style={styles.thresholdText}>
              사용량이 <Text style={{ fontFamily: "Inter_700Bold", color: "#D97706" }}>80%</Text> 이상이 되면 수영장 관리자에게 자동으로 경고 알림이 발송됩니다.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* 수정 모달 */}
      <Modal visible={!!editTarget} animationType="slide" transparent onRequestClose={() => setEditTarget(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.handle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editTarget ? (TIER_META[editTarget.tier]?.label ?? editTarget.tier) : ""} 용량 수정
              </Text>
              <Pressable onPress={() => setEditTarget(null)}>
                <Feather name="x" size={22} color="#6B7280" />
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            {[
              { key: "quota_gb",           label: "기본 제공 용량 (GB)",      placeholder: "예: 50",   keyboardType: "decimal-pad" as const },
              { key: "per_member_mb",      label: "회원당 평균 용량 (MB)",    placeholder: "예: 167",  keyboardType: "number-pad" as const },
              { key: "extra_price_per_gb", label: "추가 용량 단가 (원/GB)",   placeholder: "예: 350",  keyboardType: "number-pad" as const },
              { key: "description",        label: "설명 (선택)",              placeholder: "정책 설명", keyboardType: "default" as const },
            ].map(({ key, label, placeholder, keyboardType }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key as keyof typeof form]}
                  onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor="#9CA3AF"
                  keyboardType={keyboardType}
                />
              </View>
            ))}

            <Pressable
              style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>저장하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#1F1235" },
  infoBanner: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#EDE9FE", borderRadius: 12, padding: 12, marginBottom: 12 },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: PURPLE, lineHeight: 18 },
  card: { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  tierLabel: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tierRange: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  editBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  cardBody: { padding: 14, gap: 10 },
  policyRow: { flexDirection: "row", alignItems: "center" },
  policyItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  policyKey: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", flex: 1 },
  policyVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  dividerV: { width: 1, height: 32, backgroundColor: "#E5E7EB", marginHorizontal: 10 },
  extraRow: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, paddingTop: 10 },
  extraText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  extraPrice: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 16 },
  thresholdNote: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1.5, borderRadius: 12, padding: 12, backgroundColor: "#FFFBEB" },
  thresholdText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#1F1235" },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" },
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  input: { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular", color: "#1F2937", backgroundColor: "#F9FAFB" },
  saveBtn: { height: 50, borderRadius: 14, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
