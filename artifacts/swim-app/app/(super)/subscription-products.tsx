/**
 * (super)/subscription-products.tsx — 구독 상품 설정
 * 플랫폼 구독 플랜 CRUD (생성/수정/비활성화)
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useBillingStore, type SubscriptionPlan } from "@/store";
import { fmtDateTime, createAuditLog } from "@/utils/super-utils";

const P = "#7C3AED";

const EMPTY_FORM = {
  name: "",
  tier_key: "",
  min_members: "0",
  max_members: "9999",
  base_storage_gb: "5",
  extra_storage_unit_price: "1000",
  monthly_price: "0",
  annual_price: "0",
  upgrade_policy: "즉시 적용, 차액 즉시 결제",
  downgrade_policy: "즉시 적용, 차액 크레딧 적립",
  credit_policy: "다음 결제 시 자동 차감",
  cancel_policy: "즉시 제한, 읽기전용 전환",
  auto_delete_policy: "해지 후 24시간 미디어 자동 삭제",
};

type FormState = typeof EMPTY_FORM;

function PlanCard({
  plan,
  onEdit,
  onToggle,
}: {
  plan: SubscriptionPlan;
  onEdit: (plan: SubscriptionPlan) => void;
  onToggle: (plan: SubscriptionPlan) => void;
}) {
  const monthlyStr = plan.monthly_price === 0 ? "무료" : `₩${plan.monthly_price.toLocaleString()}/월`;
  const annualStr  = plan.annual_price === 0   ? "—"   : `₩${plan.annual_price.toLocaleString()}/년`;

  return (
    <View style={[pc.card, !plan.is_active && pc.cardInactive]}>
      <View style={pc.top}>
        <View style={pc.tierBadge}>
          <Text style={pc.tierTxt}>{plan.tier_key.toUpperCase()}</Text>
        </View>
        <Text style={[pc.name, !plan.is_active && { color: "#9CA3AF" }]}>{plan.name}</Text>
        <Text style={pc.price}>{monthlyStr}</Text>
      </View>

      <View style={pc.row}>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>회원 수</Text>
          <Text style={pc.infoVal}>{plan.min_members} ~ {plan.max_members}명</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>기본 용량</Text>
          <Text style={pc.infoVal}>{plan.base_storage_gb} GB</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>추가 단가</Text>
          <Text style={pc.infoVal}>₩{plan.extra_storage_unit_price}/GB</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>연간 요금</Text>
          <Text style={pc.infoVal}>{annualStr}</Text>
        </View>
      </View>

      <View style={pc.policySection}>
        {[
          ["업그레이드", plan.upgrade_policy],
          ["다운그레이드", plan.downgrade_policy],
          ["크레딧", plan.credit_policy],
          ["해지", plan.cancel_policy],
          ["자동삭제", plan.auto_delete_policy],
        ].map(([label, val]) => (
          <View key={label} style={pc.policyRow}>
            <Text style={pc.policyLabel}>{label}</Text>
            <Text style={pc.policyVal} numberOfLines={1}>{val}</Text>
          </View>
        ))}
      </View>

      <View style={pc.actions}>
        <Pressable style={[pc.btn, { backgroundColor: "#EDE9FE" }]} onPress={() => onEdit(plan)}>
          <Feather name="edit-2" size={13} color={P} />
          <Text style={[pc.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable
          style={[pc.btn, { backgroundColor: plan.is_active ? "#FEF3C7" : "#D1FAE5" }]}
          onPress={() => onToggle(plan)}
        >
          <Feather name={plan.is_active ? "pause-circle" : "play-circle"} size={13}
            color={plan.is_active ? "#D97706" : "#059669"} />
          <Text style={[pc.btnTxt, { color: plan.is_active ? "#D97706" : "#059669" }]}>
            {plan.is_active ? "비활성화" : "활성화"}
          </Text>
        </Pressable>
        <Text style={pc.updatedAt}>수정: {fmtDateTime(plan.updated_at)}</Text>
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  cardInactive: { opacity: 0.55, borderStyle: "dashed" },
  top:          { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  tierBadge:    { backgroundColor: "#EDE9FE", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tierTxt:      { fontSize: 10, fontFamily: "Inter_700Bold", color: P },
  name:         { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", flex: 1 },
  price:        { fontSize: 13, fontFamily: "Inter_700Bold", color: "#059669" },
  row:          { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  infoItem:     { flex: 1, minWidth: "20%", backgroundColor: "#F9FAFB", borderRadius: 8, padding: 8 },
  infoLabel:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  infoVal:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827", marginTop: 2 },
  policySection:{ borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 10, gap: 5, marginBottom: 12 },
  policyRow:    { flexDirection: "row", gap: 6, alignItems: "center" },
  policyLabel:  { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#9CA3AF", width: 70 },
  policyVal:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#374151", flex: 1 },
  actions:      { flexDirection: "row", gap: 8, alignItems: "center" },
  btn:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                  paddingVertical: 6, borderRadius: 8 },
  btnTxt:       { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  updatedAt:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
});

// ── 플랜 폼 모달 ─────────────────────────────────────────────────
function PlanFormModal({
  visible, initial, onClose, onSave,
}: {
  visible: boolean;
  initial?: SubscriptionPlan | null;
  onClose: () => void;
  onSave: (form: FormState) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const isEdit = !!initial;

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name,
        tier_key: initial.tier_key,
        min_members: String(initial.min_members),
        max_members: String(initial.max_members),
        base_storage_gb: String(initial.base_storage_gb),
        extra_storage_unit_price: String(initial.extra_storage_unit_price),
        monthly_price: String(initial.monthly_price),
        annual_price: String(initial.annual_price),
        upgrade_policy: initial.upgrade_policy,
        downgrade_policy: initial.downgrade_policy,
        credit_policy: initial.credit_policy,
        cancel_policy: initial.cancel_policy,
        auto_delete_policy: initial.auto_delete_policy,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [initial, visible]);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fields: { key: keyof FormState; label: string; placeholder?: string; multiline?: boolean }[] = [
    { key: "name",                    label: "상품명",           placeholder: "예: 스탠다드" },
    { key: "tier_key",                label: "티어 키",          placeholder: "예: standard" },
    { key: "min_members",             label: "최소 회원 수",     placeholder: "0" },
    { key: "max_members",             label: "최대 회원 수",     placeholder: "9999" },
    { key: "base_storage_gb",         label: "기본 용량 (GB)",   placeholder: "5" },
    { key: "extra_storage_unit_price",label: "추가 용량 단가(원/GB)", placeholder: "1000" },
    { key: "monthly_price",           label: "월 요금 (원)",     placeholder: "0" },
    { key: "annual_price",            label: "연 요금 (원)",     placeholder: "0" },
    { key: "upgrade_policy",          label: "업그레이드 정책",  multiline: true },
    { key: "downgrade_policy",        label: "다운그레이드 정책",multiline: true },
    { key: "credit_policy",           label: "크레딧 정책",      multiline: true },
    { key: "cancel_policy",           label: "해지 정책",        multiline: true },
    { key: "auto_delete_policy",      label: "자동삭제 정책",    multiline: true },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F9FAFB" }} edges={["top"]}>
        <View style={fm.header}>
          <Pressable onPress={onClose} style={fm.close}>
            <Feather name="x" size={20} color="#6B7280" />
          </Pressable>
          <Text style={fm.title}>{isEdit ? "구독 상품 수정" : "구독 상품 생성"}</Text>
          <Pressable style={fm.saveBtn} onPress={() => onSave(form)}>
            <Text style={fm.saveTxt}>저장</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
            {fields.map((f) => (
              <View key={f.key}>
                <Text style={fm.label}>{f.label}</Text>
                <TextInput
                  style={[fm.input, f.multiline && { height: 72, textAlignVertical: "top" }]}
                  value={form[f.key]}
                  onChangeText={(v) => set(f.key, v)}
                  placeholder={f.placeholder ?? ""}
                  multiline={f.multiline}
                  keyboardType={
                    ["min_members","max_members","base_storage_gb",
                     "extra_storage_unit_price","monthly_price","annual_price"].includes(f.key)
                      ? "numeric" : "default"
                  }
                />
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const fm = StyleSheet.create({
  header:  { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  close:   { padding: 4 },
  title:   { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  saveBtn: { backgroundColor: P, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  saveTxt: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  label:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:   { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8,
             padding: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", minHeight: 42 },
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function SubscriptionProductsScreen() {
  const { token, adminUser } = useAuth();
  const { plans, setPlans, loadingPlans, setLoadingPlans, addPlan, updatePlan } = useBillingStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<SubscriptionPlan | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const res = await apiRequest(token, "/super/plans");
      if (res.ok) {
        const d = await res.json();
        setPlans(d.plans ?? []);
      }
    } catch {}
    finally { setLoadingPlans(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, []);

  async function handleSave(form: FormState) {
    if (!form.name.trim() || !form.tier_key.trim()) {
      Alert.alert("입력 오류", "상품명과 티어 키는 필수입니다."); return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        tier_key: form.tier_key.trim(),
        min_members: parseInt(form.min_members) || 0,
        max_members: parseInt(form.max_members) || 9999,
        base_storage_gb: parseInt(form.base_storage_gb) || 5,
        extra_storage_unit_price: parseInt(form.extra_storage_unit_price) || 0,
        monthly_price: parseInt(form.monthly_price) || 0,
        annual_price: parseInt(form.annual_price) || 0,
        upgrade_policy: form.upgrade_policy,
        downgrade_policy: form.downgrade_policy,
        credit_policy: form.credit_policy,
        cancel_policy: form.cancel_policy,
        auto_delete_policy: form.auto_delete_policy,
      };

      if (editTarget) {
        const res = await apiRequest(token, `/super/plans/${editTarget.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          updatePlan(editTarget.id, body);
          await createAuditLog(token, apiRequest, {
            category: "구독", title: `구독 상품 수정: ${form.name}`,
            actor: adminUser?.name ?? "슈퍼관리자", impact: "medium",
          });
        }
      } else {
        const res = await apiRequest(token, "/super/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const d = await res.json();
          addPlan({ id: d.id, ...body, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          await createAuditLog(token, apiRequest, {
            category: "구독", title: `구독 상품 생성: ${form.name}`,
            actor: adminUser?.name ?? "슈퍼관리자", impact: "high",
          });
        }
      }
      setShowForm(false);
      setEditTarget(null);
      load();
    } catch {}
    finally { setSaving(false); }
  }

  async function handleToggle(plan: SubscriptionPlan) {
    const newActive = !plan.is_active;
    Alert.alert(
      newActive ? "상품 활성화" : "상품 비활성화",
      `'${plan.name}' 상품을 ${newActive ? "활성화" : "비활성화"}하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "확인",
          style: newActive ? "default" : "destructive",
          onPress: async () => {
            try {
              await apiRequest(token, `/super/plans/${plan.id}/toggle`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ is_active: newActive }),
              });
              updatePlan(plan.id, { is_active: newActive });
              await createAuditLog(token, apiRequest, {
                category: "구독",
                title: `구독 상품 ${newActive ? "활성화" : "비활성화"}: ${plan.name}`,
                actor: adminUser?.name ?? "슈퍼관리자",
                impact: "high",
              });
            } catch {}
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="구독 상품 설정" subtitle="플랫폼 구독 플랜 관리" />

      <Pressable
        style={s.createBtn}
        onPress={() => { setEditTarget(null); setShowForm(true); }}
      >
        <Feather name="plus-circle" size={16} color="#fff" />
        <Text style={s.createBtnTxt}>새 상품 생성</Text>
      </Pressable>

      {loadingPlans && !refreshing ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlanCard
              plan={item}
              onEdit={(p) => { setEditTarget(p); setShowForm(true); }}
              onToggle={handleToggle}
            />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="package" size={36} color="#D1D5DB" />
              <Text style={s.emptyTxt}>등록된 구독 상품이 없습니다</Text>
            </View>
          }
        />
      )}

      <PlanFormModal
        visible={showForm}
        initial={editTarget}
        onClose={() => { setShowForm(false); setEditTarget(null); }}
        onSave={handleSave}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F9FAFB" },
  createBtn:    { flexDirection: "row", alignItems: "center", gap: 6, margin: 16, marginBottom: 0,
                  backgroundColor: P, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  createBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  empty:        { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
