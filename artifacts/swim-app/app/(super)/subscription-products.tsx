/**
 * (super)/subscription-products.tsx — 구독 상품 설정
 * subscriptionStore — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SubscriptionPlan } from "@/domain/types";

const P = "#7C3AED";

const EMPTY_FORM = {
  name:          "",
  code:          "",
  memberLimit:   "",
  baseStorageMb: "",
  monthlyPrice:  "",
  includesVideo: false,
  note:          "",
};

type FormState = typeof EMPTY_FORM;

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtMb(mb: number | null | undefined): string {
  if (!mb || mb === 0) return "0 MB";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// ── 플랜 카드 ─────────────────────────────────────────────────────
function PlanCard({
  plan,
  onEdit,
  onToggle,
}: {
  plan: SubscriptionPlan;
  onEdit: (plan: SubscriptionPlan) => void;
  onToggle: (plan: SubscriptionPlan) => void;
}) {
  const priceStr = plan.monthlyPrice === 0 ? "무료" : `₩${plan.monthlyPrice.toLocaleString()}/월`;

  return (
    <View style={[pc.card, (!plan.isActive || plan.isArchived) && pc.cardInactive]}>
      <View style={pc.top}>
        <View style={pc.tierBadge}>
          <Text style={pc.tierTxt}>{plan.code.toUpperCase()}</Text>
        </View>
        <Text style={[pc.name, (!plan.isActive || plan.isArchived) && { color: "#9CA3AF" }]}>{plan.name}</Text>
        <Text style={pc.price}>{priceStr}</Text>
      </View>

      <View style={pc.row}>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>최대 회원 수</Text>
          <Text style={pc.infoVal}>{plan.memberLimit == null ? "무제한" : `${plan.memberLimit}명`}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>기본 용량</Text>
          <Text style={pc.infoVal}>{fmtMb(plan.baseStorageMb)}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>영상 포함</Text>
          <Text style={pc.infoVal}>{plan.includesVideo ? "포함" : "미포함"}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>상태</Text>
          <Text style={[pc.infoVal, { color: plan.isActive ? "#059669" : "#DC2626" }]}>
            {plan.isArchived ? "보관됨" : plan.isActive ? "활성" : "비활성"}
          </Text>
        </View>
      </View>

      {plan.note ? (
        <View style={pc.noteBox}>
          <Text style={pc.noteTxt}>{plan.note}</Text>
        </View>
      ) : null}

      <View style={pc.actions}>
        <Pressable style={[pc.btn, { backgroundColor: "#EDE9FE" }]} onPress={() => onEdit(plan)}>
          <Feather name="edit-2" size={13} color={P} />
          <Text style={[pc.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable
          style={[pc.btn, { backgroundColor: plan.isActive ? "#FEF3C7" : "#D1FAE5" }]}
          onPress={() => onToggle(plan)}>
          <Feather name={plan.isActive ? "pause-circle" : "play-circle"} size={13}
            color={plan.isActive ? "#D97706" : "#059669"} />
          <Text style={[pc.btnTxt, { color: plan.isActive ? "#D97706" : "#059669" }]}>
            {plan.isActive ? "비활성화" : "활성화"}
          </Text>
        </Pressable>
        <Text style={pc.updatedAt}>수정: {fmtDateTime(plan.updatedAt)}</Text>
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
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
  noteBox:      { backgroundColor: "#FEF3C7", borderRadius: 8, padding: 8, marginBottom: 10 },
  noteTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400E" },
  actions:      { flexDirection: "row", gap: 8, alignItems: "center" },
  btn:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
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
        name:          initial.name,
        code:          initial.code,
        memberLimit:   initial.memberLimit == null ? "" : String(initial.memberLimit),
        baseStorageMb: String(initial.baseStorageMb),
        monthlyPrice:  String(initial.monthlyPrice),
        includesVideo: initial.includesVideo,
        note:          initial.note ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [initial, visible]);

  const setVal = (k: keyof FormState, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  const textFields: { key: keyof FormState; label: string; placeholder?: string; numeric?: boolean }[] = [
    { key: "name",          label: "상품명",         placeholder: "예: 스탠다드" },
    { key: "code",          label: "코드 키",         placeholder: "예: pro_100" },
    { key: "memberLimit",   label: "최대 회원 수",    placeholder: "빈칸이면 무제한", numeric: true },
    { key: "baseStorageMb", label: "기본 용량 (MB)",  placeholder: "5120", numeric: true },
    { key: "monthlyPrice",  label: "월 요금 (원)",    placeholder: "0", numeric: true },
    { key: "note",          label: "메모 (선택)",     placeholder: "내부 참고용 메모" },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F9FAFB" }} edges={["top"]}>
        <View style={fm.header}>
          <Pressable onPress={onClose} style={fm.close}><Feather name="x" size={20} color="#6B7280" /></Pressable>
          <Text style={fm.title}>{isEdit ? "구독 상품 수정" : "구독 상품 생성"}</Text>
          <Pressable style={fm.saveBtn} onPress={() => onSave(form)}>
            <Text style={fm.saveTxt}>저장</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
            {textFields.map(f => (
              <View key={f.key as string}>
                <Text style={fm.label}>{f.label}</Text>
                <TextInput
                  style={fm.input}
                  value={String(form[f.key])}
                  onChangeText={v => setVal(f.key, v)}
                  placeholder={f.placeholder ?? ""}
                  placeholderTextColor="#9CA3AF"
                  keyboardType={f.numeric ? "numeric" : "default"}
                />
              </View>
            ))}

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}>
              <Text style={[fm.label, { marginBottom: 0, flex: 1 }]}>영상 업로드 포함</Text>
              <Switch
                value={form.includesVideo}
                onValueChange={v => setVal("includesVideo", v)}
                trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }}
                thumbColor={form.includesVideo ? P : "#9CA3AF"}
              />
            </View>
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
  input:   { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", minHeight: 42 },
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function SubscriptionProductsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const plans       = useSubscriptionStore(s => s.plans);
  const addPlan     = useSubscriptionStore(s => s.addPlan);
  const updatePlan  = useSubscriptionStore(s => s.updatePlan);
  const createLog   = useAuditLogStore(s => s.createLog);

  const [refreshing,   setRefreshing]   = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [editTarget,   setEditTarget]   = useState<SubscriptionPlan | null>(null);

  function handleSave(form: FormState) {
    if (!form.name.trim() || !form.code.trim()) {
      Alert.alert("입력 오류", "상품명과 코드 키는 필수입니다."); return;
    }

    const patch: Partial<SubscriptionPlan> = {
      name:          form.name.trim(),
      memberLimit:   form.memberLimit ? parseInt(form.memberLimit) || null : null,
      baseStorageMb: parseInt(form.baseStorageMb) || 5120,
      monthlyPrice:  parseInt(form.monthlyPrice) || 0,
      includesVideo: form.includesVideo,
      note:          form.note.trim(),
      updatedAt:     new Date().toISOString(),
    };

    if (editTarget) {
      updatePlan(editTarget.id, patch);
      createLog({ category: '구독', title: `구독 상품 수정: ${form.name}`, actorName, impact: 'medium' });
    } else {
      addPlan({
        id:            `plan-${Date.now()}`,
        code:          form.code.trim() as any,
        name:          form.name.trim(),
        memberLimit:   form.memberLimit ? parseInt(form.memberLimit) || null : null,
        baseStorageMb: parseInt(form.baseStorageMb) || 5120,
        monthlyPrice:  parseInt(form.monthlyPrice) || 0,
        includesVideo: form.includesVideo,
        isActive:      true,
        isArchived:    false,
        note:          form.note.trim(),
        createdAt:     new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
      });
      createLog({ category: '구독', title: `구독 상품 생성: ${form.name}`, actorName, impact: 'high' });
    }
    setShowForm(false);
    setEditTarget(null);
  }

  function handleToggle(plan: SubscriptionPlan) {
    const newActive = !plan.isActive;
    Alert.alert(
      newActive ? "상품 활성화" : "상품 비활성화",
      `'${plan.name}' 상품을 ${newActive ? "활성화" : "비활성화"}하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "확인",
          style: newActive ? "default" : "destructive",
          onPress: () => {
            updatePlan(plan.id, { isActive: newActive, updatedAt: new Date().toISOString() });
            createLog({
              category: '구독',
              title: `구독 상품 ${newActive ? "활성화" : "비활성화"}: ${plan.name}`,
              actorName,
              impact: 'high',
            });
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="구독 상품 설정" subtitle="플랫폼 구독 플랜 관리" />

      <Pressable style={s.createBtn}
        onPress={() => { setEditTarget(null); setShowForm(true); }}>
        <Feather name="plus-circle" size={16} color="#fff" />
        <Text style={s.createBtnTxt}>새 상품 생성</Text>
      </Pressable>

      <FlatList
        data={plans}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            onEdit={p => { setEditTarget(p); setShowForm(true); }}
            onToggle={handleToggle}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="package" size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>등록된 구독 상품이 없습니다</Text>
          </View>
        }
      />

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
  createBtn:    { flexDirection: "row", alignItems: "center", gap: 6, margin: 16, marginBottom: 0, backgroundColor: P, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  createBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  empty:        { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
