/**
 * (super)/subscription-products.tsx — 구독 상품 설정
 * 탭 1: 구독 플랜 | 탭 2: 추가 용량 상품
 * subscriptionStore + extraStorageStore — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useExtraStorageStore } from "@/store/extraStorageStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SubscriptionPlan } from "@/domain/types";
import type { ExtraStorageProduct } from "@/store/extraStorageStore";

const P = "#7C3AED";
const G = "#059669";

const TABS = ["구독 플랜", "추가 용량 상품"] as const;
type Tab = typeof TABS[number];

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

const EMPTY_STORAGE_FORM = {
  name:           "",
  extraStorageMb: "",
  price:          "",
  note:           "",
};
type StorageFormState = typeof EMPTY_STORAGE_FORM;

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtMb(mb: number | null | undefined): string {
  if (!mb || mb === 0) return "0 MB";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(0)} GB`;
}

// ── 구독 플랜 카드 ──────────────────────────────────────────────
function PlanCard({ plan, onEdit, onToggle }: {
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
          <Text style={pc.infoLabel}>최대 회원</Text>
          <Text style={pc.infoVal}>{plan.memberLimit == null ? "무제한" : `${plan.memberLimit}명`}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>기본 용량</Text>
          <Text style={pc.infoVal}>{fmtMb(plan.baseStorageMb)}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>영상</Text>
          <Text style={pc.infoVal}>{plan.includesVideo ? "포함" : "미포함"}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>상태</Text>
          <Text style={[pc.infoVal, { color: plan.isActive ? G : "#DC2626" }]}>
            {plan.isArchived ? "보관됨" : plan.isActive ? "활성" : "비활성"}
          </Text>
        </View>
      </View>
      {plan.note ? <View style={pc.noteBox}><Text style={pc.noteTxt}>{plan.note}</Text></View> : null}
      <View style={pc.actions}>
        <Pressable style={[pc.btn, { backgroundColor: "#EDE9FE" }]} onPress={() => onEdit(plan)}>
          <Feather name="edit-2" size={13} color={P} />
          <Text style={[pc.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable
          style={[pc.btn, { backgroundColor: plan.isActive ? "#FEF3C7" : "#D1FAE5" }]}
          onPress={() => onToggle(plan)}>
          <Feather name={plan.isActive ? "pause-circle" : "play-circle"} size={13}
            color={plan.isActive ? "#D97706" : G} />
          <Text style={[pc.btnTxt, { color: plan.isActive ? "#D97706" : G }]}>
            {plan.isActive ? "비활성화" : "활성화"}
          </Text>
        </Pressable>
        <Text style={pc.updatedAt}>수정: {fmtDateTime(plan.updatedAt)}</Text>
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  cardInactive:{ opacity: 0.55, borderStyle: "dashed" },
  top:         { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  tierBadge:   { backgroundColor: "#EDE9FE", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tierTxt:     { fontSize: 10, fontFamily: "Inter_700Bold", color: P },
  name:        { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827", flex: 1 },
  price:       { fontSize: 13, fontFamily: "Inter_700Bold", color: G },
  row:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  infoItem:    { flex: 1, minWidth: "20%", backgroundColor: "#F9FAFB", borderRadius: 8, padding: 8 },
  infoLabel:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" },
  infoVal:     { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827", marginTop: 2 },
  noteBox:     { backgroundColor: "#FEF3C7", borderRadius: 8, padding: 8, marginBottom: 10 },
  noteTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400E" },
  actions:     { flexDirection: "row", gap: 8, alignItems: "center" },
  btn:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  updatedAt:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
});

// ── 추가 용량 상품 카드 ─────────────────────────────────────────
function StorageProductCard({ product, onEdit, onToggle }: {
  product: ExtraStorageProduct;
  onEdit: (p: ExtraStorageProduct) => void;
  onToggle: (p: ExtraStorageProduct) => void;
}) {
  return (
    <View style={[ep.card, !product.isActive && ep.cardInactive]}>
      <View style={ep.top}>
        <View style={[ep.iconBox, { backgroundColor: product.isActive ? "#D1FAE5" : "#F3F4F6" }]}>
          <Feather name="hard-drive" size={20} color={product.isActive ? G : "#9CA3AF"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ep.name}>{product.name}</Text>
          <Text style={ep.size}>{fmtMb(product.extraStorageMb)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={ep.price}>₩{product.price.toLocaleString()}</Text>
          <View style={[ep.statusBadge, { backgroundColor: product.isActive ? "#D1FAE5" : "#FEE2E2" }]}>
            <Text style={[ep.statusTxt, { color: product.isActive ? G : "#DC2626" }]}>
              {product.isActive ? "판매중" : "비활성"}
            </Text>
          </View>
        </View>
      </View>
      {product.note ? <Text style={ep.note}>{product.note}</Text> : null}
      <View style={ep.actions}>
        <Pressable style={[ep.btn, { backgroundColor: "#EDE9FE" }]} onPress={() => onEdit(product)}>
          <Feather name="edit-2" size={13} color={P} />
          <Text style={[ep.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable
          style={[ep.btn, { backgroundColor: product.isActive ? "#FEF3C7" : "#D1FAE5" }]}
          onPress={() => onToggle(product)}>
          <Feather name={product.isActive ? "pause-circle" : "play-circle"} size={13}
            color={product.isActive ? "#D97706" : G} />
          <Text style={[ep.btnTxt, { color: product.isActive ? "#D97706" : G }]}>
            {product.isActive ? "비활성화" : "활성화"}
          </Text>
        </Pressable>
        <Text style={ep.updatedAt}>수정: {fmtDateTime(product.updatedAt)}</Text>
      </View>
    </View>
  );
}

const ep = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  cardInactive:{ opacity: 0.6, borderStyle: "dashed" },
  top:         { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  iconBox:     { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  name:        { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  size:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: G, marginTop: 2 },
  price:       { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  statusTxt:   { fontSize: 10, fontFamily: "Inter_700Bold" },
  note:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginBottom: 8, lineHeight: 17 },
  actions:     { flexDirection: "row", gap: 8, alignItems: "center" },
  btn:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  updatedAt:   { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
});

// ── 구독 플랜 폼 모달 ───────────────────────────────────────────
function PlanFormModal({ visible, initial, onClose, onSave }: {
  visible: boolean; initial?: SubscriptionPlan | null;
  onClose: () => void; onSave: (form: FormState) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const isEdit = !!initial;
  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name, code: initial.code,
        memberLimit: initial.memberLimit == null ? "" : String(initial.memberLimit),
        baseStorageMb: String(initial.baseStorageMb),
        monthlyPrice: String(initial.monthlyPrice),
        includesVideo: initial.includesVideo,
        note: initial.note ?? "",
      });
    } else { setForm(EMPTY_FORM); }
  }, [initial, visible]);

  const setVal = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  const textFields = [
    { key: "name" as const,          label: "상품명",       placeholder: "예: 스탠다드" },
    { key: "code" as const,          label: "코드 키",       placeholder: "예: pro_100" },
    { key: "memberLimit" as const,   label: "최대 회원 수", placeholder: "빈칸이면 무제한", numeric: true },
    { key: "baseStorageMb" as const, label: "기본 용량(MB)", placeholder: "5120", numeric: true },
    { key: "monthlyPrice" as const,  label: "월 요금(원)",   placeholder: "0", numeric: true },
    { key: "note" as const,          label: "메모(선택)",   placeholder: "내부 참고용" },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F9FAFB" }} edges={["top"]}>
        <View style={fm.header}>
          <Pressable onPress={onClose} style={fm.close}><Feather name="x" size={20} color="#6B7280" /></Pressable>
          <Text style={fm.title}>{isEdit ? "구독 상품 수정" : "구독 상품 생성"}</Text>
          <Pressable style={fm.saveBtn} onPress={() => onSave(form)}><Text style={fm.saveTxt}>저장</Text></Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
            {textFields.map(f => (
              <View key={f.key}>
                <Text style={fm.label}>{f.label}</Text>
                <TextInput style={fm.input} value={String(form[f.key])} onChangeText={v => setVal(f.key, v)}
                  placeholder={f.placeholder ?? ""} placeholderTextColor="#9CA3AF"
                  keyboardType={f.numeric ? "numeric" : "default"} />
              </View>
            ))}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}>
              <Text style={[fm.label, { marginBottom: 0, flex: 1 }]}>영상 업로드 포함</Text>
              <Switch value={form.includesVideo} onValueChange={v => setVal("includesVideo", v)}
                trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }} thumbColor={form.includesVideo ? P : "#9CA3AF"} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── 추가 용량 상품 폼 모달 ──────────────────────────────────────
function StorageFormModal({ visible, initial, onClose, onSave }: {
  visible: boolean; initial?: ExtraStorageProduct | null;
  onClose: () => void; onSave: (form: StorageFormState) => void;
}) {
  const [form, setForm] = useState<StorageFormState>(EMPTY_STORAGE_FORM);
  const isEdit = !!initial;
  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name,
        extraStorageMb: String(initial.extraStorageMb),
        price: String(initial.price),
        note: initial.note ?? "",
      });
    } else { setForm(EMPTY_STORAGE_FORM); }
  }, [initial, visible]);

  const setVal = (k: keyof StorageFormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F9FAFB" }} edges={["top"]}>
        <View style={fm.header}>
          <Pressable onPress={onClose} style={fm.close}><Feather name="x" size={20} color="#6B7280" /></Pressable>
          <Text style={fm.title}>{isEdit ? "추가 용량 상품 수정" : "추가 용량 상품 생성"}</Text>
          <Pressable style={[fm.saveBtn, { backgroundColor: G }]} onPress={() => onSave(form)}><Text style={fm.saveTxt}>저장</Text></Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
            <View>
              <Text style={fm.label}>상품명</Text>
              <TextInput style={fm.input} value={form.name} onChangeText={v => setVal("name", v)} placeholder="예: 추가 30GB" placeholderTextColor="#9CA3AF" />
            </View>
            <View>
              <Text style={fm.label}>추가 용량 (MB)</Text>
              <TextInput style={fm.input} value={form.extraStorageMb} onChangeText={v => setVal("extraStorageMb", v)} placeholder="30720 (30GB)" placeholderTextColor="#9CA3AF" keyboardType="numeric" />
              <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4, fontFamily: "Inter_400Regular" }}>1024MB = 1GB</Text>
            </View>
            <View>
              <Text style={fm.label}>가격 (원)</Text>
              <TextInput style={fm.input} value={form.price} onChangeText={v => setVal("price", v)} placeholder="24900" placeholderTextColor="#9CA3AF" keyboardType="numeric" />
            </View>
            <View>
              <Text style={fm.label}>메모 (선택)</Text>
              <TextInput style={fm.input} value={form.note} onChangeText={v => setVal("note", v)} placeholder="내부 참고용" placeholderTextColor="#9CA3AF" />
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

// ── 메인 ─────────────────────────────────────────────────────────
export default function SubscriptionProductsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";

  const plans       = useSubscriptionStore(s => s.plans);
  const addPlan     = useSubscriptionStore(s => s.addPlan);
  const updatePlan  = useSubscriptionStore(s => s.updatePlan);
  const createLog   = useAuditLogStore(s => s.createLog);

  const products          = useExtraStorageStore(s => s.products);
  const purchases         = useExtraStorageStore(s => s.purchases);
  const opAccounts        = useExtraStorageStore(s => s.opAccounts);
  const createProduct     = useExtraStorageStore(s => s.createProduct);
  const updateProduct     = useExtraStorageStore(s => s.updateProduct);
  const toggleProductActive = useExtraStorageStore(s => s.toggleProductActive);

  const [tab,            setTab]          = useState<Tab>("구독 플랜");
  const [refreshing,     setRefreshing]   = useState(false);
  const [showPlanForm,   setShowPlanForm] = useState(false);
  const [editPlan,       setEditPlan]     = useState<SubscriptionPlan | null>(null);
  const [showStorageForm,setShowStorageForm] = useState(false);
  const [editProduct,    setEditProduct]  = useState<ExtraStorageProduct | null>(null);

  // 추가 용량 통계
  const totalStorageSales  = useMemo(() => purchases.reduce((s, p) => s + p.price, 0), [purchases]);
  const totalStoragePurchased = useMemo(() => purchases.length, [purchases]);
  const unlockedCount      = useMemo(() => opAccounts.filter(a => a.videoUploadUnlocked).length, [opAccounts]);

  function handlePlanSave(form: FormState) {
    if (!form.name.trim() || !form.code.trim()) { Alert.alert("입력 오류", "상품명과 코드 키는 필수입니다."); return; }
    const patch: Partial<SubscriptionPlan> = {
      name: form.name.trim(), memberLimit: form.memberLimit ? parseInt(form.memberLimit) || null : null,
      baseStorageMb: parseInt(form.baseStorageMb) || 5120,
      monthlyPrice: parseInt(form.monthlyPrice) || 0,
      includesVideo: form.includesVideo, note: form.note.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (editPlan) {
      updatePlan(editPlan.id, patch);
      createLog({ category: "구독", title: `구독 상품 수정: ${form.name}`, detail: `가격 ${form.monthlyPrice}원`, actorName, impact: "medium" });
    } else {
      addPlan({ id: `plan-${Date.now()}`, code: form.code.trim() as any, name: form.name.trim(),
        memberLimit: form.memberLimit ? parseInt(form.memberLimit) || null : null,
        baseStorageMb: parseInt(form.baseStorageMb) || 5120,
        monthlyPrice: parseInt(form.monthlyPrice) || 0,
        includesVideo: form.includesVideo, isActive: true, isArchived: false,
        note: form.note.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      createLog({ category: "구독", title: `구독 상품 생성: ${form.name}`, detail: `가격 ${form.monthlyPrice}원`, actorName, impact: "high" });
    }
    setShowPlanForm(false); setEditPlan(null);
  }

  function handlePlanToggle(plan: SubscriptionPlan) {
    const newActive = !plan.isActive;
    Alert.alert(newActive ? "상품 활성화" : "상품 비활성화",
      `'${plan.name}' 상품을 ${newActive ? "활성화" : "비활성화"}하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { text: "확인", style: newActive ? "default" : "destructive", onPress: () => {
            updatePlan(plan.id, { isActive: newActive, updatedAt: new Date().toISOString() });
            createLog({ category: "구독", title: `구독 상품 ${newActive ? "활성화" : "비활성화"}: ${plan.name}`, detail: `${plan.name} → ${newActive ? "활성" : "비활성"}`, actorName, impact: "high" });
          }},
      ]);
  }

  function handleStorageSave(form: StorageFormState) {
    if (!form.name.trim()) { Alert.alert("입력 오류", "상품명을 입력하세요."); return; }
    const extraMb = parseInt(form.extraStorageMb) || 10240;
    const price   = parseInt(form.price) || 9900;
    if (editProduct) {
      updateProduct(editProduct.id, { name: form.name.trim(), extraStorageMb: extraMb, price, note: form.note.trim() }, actorName);
    } else {
      createProduct({ name: form.name.trim(), extraStorageMb: extraMb, price, isActive: true, note: form.note.trim() }, actorName);
    }
    setShowStorageForm(false); setEditProduct(null);
  }

  function handleStorageToggle(product: ExtraStorageProduct) {
    Alert.alert(product.isActive ? "상품 비활성화" : "상품 활성화",
      `'${product.name}'을 ${product.isActive ? "비활성화" : "활성화"}하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { text: "확인", onPress: () => toggleProductActive(product.id, actorName) },
      ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="구독 상품 설정" subtitle="플랜 및 추가 용량 상품 관리" />

      {/* 탭 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t} style={[s.tabItem, tab === t && s.tabItemActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "구독 플랜" ? (
        <>
          <Pressable style={s.createBtn} onPress={() => { setEditPlan(null); setShowPlanForm(true); }}>
            <Feather name="plus-circle" size={16} color="#fff" />
            <Text style={s.createBtnTxt}>새 구독 플랜 생성</Text>
          </Pressable>
          <FlatList
            data={plans}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <PlanCard plan={item} onEdit={p => { setEditPlan(p); setShowPlanForm(true); }} onToggle={handlePlanToggle} />
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
              onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
            ListHeaderComponent={
              <View style={s.infoBox}>
                <Feather name="info" size={13} color={P} />
                <Text style={s.infoTxt}>구독 플랜과 추가 용량 상품은 별개입니다. 추가 용량 탭에서 관리하세요.</Text>
              </View>
            }
            ListEmptyComponent={
              <View style={s.empty}><Feather name="package" size={36} color="#D1D5DB" /><Text style={s.emptyTxt}>등록된 구독 상품이 없습니다</Text></View>
            }
          />
        </>
      ) : (
        <>
          <Pressable style={[s.createBtn, { backgroundColor: G }]} onPress={() => { setEditProduct(null); setShowStorageForm(true); }}>
            <Feather name="plus-circle" size={16} color="#fff" />
            <Text style={s.createBtnTxt}>새 추가 용량 상품 생성</Text>
          </Pressable>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={G}
              onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}>

            {/* 요약 */}
            <View style={s.storageSummary}>
              <View style={s.storageStatCard}>
                <Text style={s.storageStatNum}>{products.filter(p => p.isActive).length}/{products.length}</Text>
                <Text style={s.storageStatLabel}>활성/전체 상품</Text>
              </View>
              <View style={s.storageStatCard}>
                <Text style={s.storageStatNum}>{totalStoragePurchased}건</Text>
                <Text style={s.storageStatLabel}>총 판매 건수</Text>
              </View>
              <View style={s.storageStatCard}>
                <Text style={[s.storageStatNum, { color: G }]}>₩{totalStorageSales.toLocaleString()}</Text>
                <Text style={s.storageStatLabel}>총 판매액</Text>
              </View>
              <View style={s.storageStatCard}>
                <Text style={[s.storageStatNum, { color: "#0891B2" }]}>{unlockedCount}개</Text>
                <Text style={s.storageStatLabel}>영상 잠금해제</Text>
              </View>
            </View>

            {/* 구분 */}
            <View style={s.sectionDivider}>
              <Text style={s.sectionLabel}>추가 용량 상품 목록</Text>
              <Text style={s.sectionHint}>구독 플랜 용량에 추가로 구매 가능</Text>
            </View>

            {products.map(product => (
              <StorageProductCard
                key={product.id}
                product={product}
                onEdit={p => { setEditProduct(p); setShowStorageForm(true); }}
                onToggle={handleStorageToggle}
              />
            ))}

            {products.length === 0 && (
              <View style={s.empty}><Feather name="hard-drive" size={36} color="#D1D5DB" /><Text style={s.emptyTxt}>등록된 추가 용량 상품이 없습니다</Text></View>
            )}
          </ScrollView>
        </>
      )}

      <PlanFormModal
        visible={showPlanForm} initial={editPlan}
        onClose={() => { setShowPlanForm(false); setEditPlan(null); }}
        onSave={handlePlanSave}
      />
      <StorageFormModal
        visible={showStorageForm} initial={editProduct}
        onClose={() => { setShowStorageForm(false); setEditProduct(null); }}
        onSave={handleStorageSave}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#F9FAFB" },
  tabBar:           { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabItem:          { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabItemActive:    { borderBottomWidth: 2, borderBottomColor: P },
  tabTxt:           { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  tabTxtActive:     { color: P },
  createBtn:        { flexDirection: "row", alignItems: "center", gap: 6, margin: 16, marginBottom: 0, backgroundColor: P, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  createBtnTxt:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  infoBox:          { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EDE9FE", borderRadius: 10, padding: 12, marginBottom: 12 },
  infoTxt:          { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#5B21B6", lineHeight: 17 },
  empty:            { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt:         { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  storageSummary:   { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  storageStatCard:  { flex: 1, minWidth: "45%", backgroundColor: "#fff", borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  storageStatNum:   { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  storageStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3, textAlign: "center" },
  sectionDivider:   { borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 12, marginBottom: 12 },
  sectionLabel:     { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  sectionHint:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
});
