/**
 * (super)/storage-policy.tsx — 저장공간 정책 설정
 * 로컬 정적 시드 데이터 — API 호출 없음
 */
import { CirclePlus, HardDrive, Info, Lock, PenLine, TriangleAlert, User, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import { useAuditLogStore } from "@/store/auditLogStore";
import Colors from "@/constants/colors";
const C = Colors.light;

const PURPLE = "#7C3AED";

interface Policy {
  tier:               string;
  quota_gb:           number;
  per_member_mb:      number;
  extra_price_per_gb: number;
  description:        string | null;
}

const TIER_META: Record<string, { label: string; color: string; bg: string; memberRange: string }> = {
  free:       { label: "Free (무료)",      color: "#6B7280", bg: "#FFFFFF", memberRange: "최대 10명" },
  starter:    { label: "Coach 30",         color: "#10B981", bg: "#ECFDF5", memberRange: "최대 30명" },
  basic:      { label: "Coach 50",         color: "#0EA5E9", bg: "#EFF6FF", memberRange: "최대 50명" },
  standard:   { label: "Coach 100",        color: "#6366F1", bg: "#EEF2FF", memberRange: "최대 100명" },
  center_200: { label: "Premier 200",      color: "#F59E0B", bg: "#FFFBEB", memberRange: "최대 200명" },
  advance:    { label: "Premier 300",      color: "#F97316", bg: "#FFF7ED", memberRange: "최대 300명" },
  pro:        { label: "Premier 500",      color: "#EF4444", bg: "#FEF2F2", memberRange: "최대 500명" },
  max:        { label: "Premier 1000",     color: PURPLE,    bg: "#F5F3FF", memberRange: "최대 1,000명" },
};

const TIER_ORDER = ["free", "starter", "basic", "standard", "center_200", "advance", "pro", "max"];

// quota_gb: 소수점 사용 (102MB = 0.1GB, 307MB ≈ 0.3GB 등)
const SEED_POLICIES: Policy[] = [
  { tier: "free",       quota_gb: 0.1,  per_member_mb: 10,  extra_price_per_gb: 0,    description: "무료 플랜 기본 제공" },
  { tier: "starter",    quota_gb: 0.3,  per_member_mb: 10,  extra_price_per_gb: 500,  description: null },
  { tier: "basic",      quota_gb: 0.5,  per_member_mb: 10,  extra_price_per_gb: 500,  description: null },
  { tier: "standard",   quota_gb: 1,    per_member_mb: 10,  extra_price_per_gb: 400,  description: null },
  { tier: "center_200", quota_gb: 5,    per_member_mb: 26,  extra_price_per_gb: 350,  description: null },
  { tier: "advance",    quota_gb: 10,   per_member_mb: 34,  extra_price_per_gb: 300,  description: null },
  { tier: "pro",        quota_gb: 20,   per_member_mb: 41,  extra_price_per_gb: 250,  description: null },
  { tier: "max",        quota_gb: 50,   per_member_mb: 51,  extra_price_per_gb: 200,  description: null },
].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));

export default function StoragePolicyScreen() {
  const { adminUser, token } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';
  const createLog = useAuditLogStore(s => s.createLog);
  const insets = useSafeAreaInsets();

  const [policies,    setPolicies]    = useState<Policy[]>(SEED_POLICIES);
  const [editTarget,  setEditTarget]  = useState<Policy | null>(null);
  const [form,        setForm]        = useState({ quota_gb: "", per_member_mb: "", extra_price_per_gb: "", description: "" });
  const [saving,      setSaving]      = useState(false);
  const [formError,   setFormError]   = useState("");
  const [otpVisible,  setOtpVisible]  = useState(false);

  function openEdit(p: Policy) {
    setEditTarget(p);
    setForm({
      quota_gb:           String(p.quota_gb),
      per_member_mb:      String(p.per_member_mb),
      extra_price_per_gb: String(p.extra_price_per_gb),
      description:        p.description || "",
    });
    setFormError("");
  }

  function handleSave() {
    if (!form.quota_gb || !form.per_member_mb) { setFormError("용량과 회원당 평균을 입력해주세요."); return; }
    if (!editTarget) return;
    setSaving(true);
    const updated: Policy = {
      ...editTarget,
      quota_gb:           parseFloat(form.quota_gb) || editTarget.quota_gb,
      per_member_mb:      parseInt(form.per_member_mb) || editTarget.per_member_mb,
      extra_price_per_gb: parseInt(form.extra_price_per_gb) || 0,
      description:        form.description.trim() || null,
    };
    setPolicies(prev => prev.map(p => p.tier === editTarget.tier ? updated : p));
    createLog({ category: '저장공간', title: `저장공간 정책 수정: ${TIER_META[editTarget.tier]?.label}`, detail: `${form.quota_gb}GB 기본 용량`, actorName, impact: 'medium' });
    setSaving(false); setEditTarget(null); setFormError("");
  }

  function fmtGB(gb: number) {
    if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
    if (gb < 1)     return `${Math.round(gb * 1024)} MB`;
    return `${gb} GB`;
  }

  function fmtPrice(won: number) {
    return won.toLocaleString("ko-KR") + "원/GB";
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="저장공간 정책 설정" homePath="/(super)/op-group" />

      <View style={[styles.infoBanner, { marginHorizontal: 20 }]}>
        <Info size={14} color={PURPLE} />
        <Text style={styles.infoText}>
          구독 단계별 기본 제공 용량을 설정합니다. 용량 초과 시 수영장 관리자에게 경고 알림이 발송됩니다.
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 12 }}>
        {policies.map(p => {
          const meta = TIER_META[p.tier] ?? { label: p.tier, color: "#64748B", bg: "#FFFFFF", memberRange: "" };
          return (
            <View key={p.tier} style={[styles.card, { shadowColor: PURPLE + "22" }]}>
              <View style={[styles.cardHeader, { backgroundColor: meta.bg }]}>
                <View>
                  <Text style={[styles.tierLabel, { color: meta.color }]}>{meta.label}</Text>
                  <Text style={[styles.tierRange, { color: meta.color + "AA" }]}>{meta.memberRange}</Text>
                </View>
                <Pressable style={[styles.editBtn, { backgroundColor: meta.color }]} onPress={() => openEdit(p)}>
                  <PenLine size={13} color="#fff" />
                  <Text style={styles.editBtnText}>수정</Text>
                </Pressable>
              </View>

              <View style={styles.cardBody}>
                <View style={styles.policyRow}>
                  <View style={styles.policyItem}>
                    <HardDrive size={14} color="#64748B" />
                    <Text style={styles.policyKey}>기본 용량</Text>
                    <Text style={[styles.policyVal, { color: meta.color }]}>{fmtGB(p.quota_gb)}</Text>
                  </View>
                  <View style={styles.dividerV} />
                  <View style={styles.policyItem}>
                    <User size={14} color="#64748B" />
                    <Text style={styles.policyKey}>회원당 평균</Text>
                    <Text style={[styles.policyVal, { color: meta.color }]}>{p.per_member_mb} MB</Text>
                  </View>
                </View>
                <View style={[styles.extraRow, { borderColor: "#E5E7EB" }]}>
                  <CirclePlus size={13} color="#64748B" />
                  <Text style={styles.extraText}>추가 용량 단가</Text>
                  <Text style={[styles.extraPrice, { color: meta.color }]}>{fmtPrice(p.extra_price_per_gb)}</Text>
                </View>
                {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}
              </View>
            </View>
          );
        })}

        <View style={[styles.thresholdNote, { borderColor: "#FCD34D" }]}>
          <TriangleAlert size={14} color="#D97706" />
          <Text style={styles.thresholdText}>
            사용량이 <Text style={{ fontFamily: "Pretendard-Regular", color: "#D97706" }}>80%</Text> 이상이 되면 수영장 관리자에게 자동으로 경고 알림이 발송됩니다.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={!!editTarget} animationType="slide" transparent onRequestClose={() => setEditTarget(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.handle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editTarget ? (TIER_META[editTarget.tier]?.label ?? editTarget.tier) : ""} 용량 수정
              </Text>
              <Pressable onPress={() => setEditTarget(null)}>
                <X size={22} color="#64748B" />
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            {[
              { key: "quota_gb",           label: "기본 제공 용량 (GB)",    placeholder: "예: 50",    keyboardType: "decimal-pad" as const },
              { key: "per_member_mb",      label: "회원당 평균 용량 (MB)",  placeholder: "예: 167",   keyboardType: "number-pad" as const },
              { key: "extra_price_per_gb", label: "추가 용량 단가 (원/GB)", placeholder: "예: 350",   keyboardType: "number-pad" as const },
              { key: "description",        label: "설명 (선택)",            placeholder: "정책 설명", keyboardType: "default" as const },
            ].map(({ key, label, placeholder, keyboardType }) => (
              <View key={key} style={styles.field}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={form[key as keyof typeof form]}
                  onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor="#64748B"
                  keyboardType={keyboardType}
                />
              </View>
            ))}

            <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.85 : saving ? 0.6 : 1 }]}
              onPress={() => setOtpVisible(true)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Lock size={14} color="#fff" />
                  <Text style={styles.saveBtnText}>모든 변경항목 저장하기</Text>
                </View>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <OtpGateModal
        visible={otpVisible}
        token={token}
        title="저장공간 정책 변경 OTP 인증"
        desc="저장공간 정책 변경은 OTP 인증 후에 저장됩니다."
        onSuccess={() => { setOtpVisible(false); handleSave(); }}
        onCancel={() => setOtpVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  infoBanner:    { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#EEDDF5",
                   borderRadius: 12, padding: 12, marginBottom: 12 },
  infoText:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: PURPLE, lineHeight: 18 },
  card:          { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden",
                   shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  cardHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  tierLabel:     { fontSize: 16, fontFamily: "Pretendard-Regular" },
  tierRange:     { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  editBtn:       { flexDirection: "row", alignItems: "center", gap: 4,
                   paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  editBtnText:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  cardBody:      { padding: 14, gap: 10 },
  policyRow:     { flexDirection: "row", alignItems: "center" },
  policyItem:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  policyKey:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", flex: 1 },
  policyVal:     { fontSize: 14, fontFamily: "Pretendard-Regular" },
  dividerV:      { width: 1, height: 32, backgroundColor: "#E5E7EB", marginHorizontal: 10 },
  extraRow:      { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, paddingTop: 10 },
  extraText:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", flex: 1 },
  extraPrice:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  desc:          { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 16 },
  thresholdNote: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1.5,
                   borderRadius: 12, padding: 12, backgroundColor: "#FFFBEB" },
  thresholdText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 18 },
  overlay:       { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:         { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                   padding: 24, gap: 14 },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  modalHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle:    { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#1F1235" },
  errorText:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  field:         { gap: 5 },
  fieldLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  input:         { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14,
                   height: 46, fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A", backgroundColor: "#F1F5F9" },
  saveBtn:       { height: 50, borderRadius: 14, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnText:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
