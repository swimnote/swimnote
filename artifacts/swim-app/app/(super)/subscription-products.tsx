/**
 * (super)/subscription-products.tsx — 구독 상품 설정
 * 구독 플랜 관리 (Coach30/50/100, Premier200/300/500/1000)
 * API 연동: GET/POST/PUT/PATCH /super/plans
 */
import { CirclePlus, Lock, Package, PenLine, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import { billingEnabled } from "@/config/billing";
import type { SubscriptionPlan } from "@/domain/types";
import { LucideIcon } from "@/components/common/LucideIcon";

const P = "#7C3AED";
const G = "#2EC4B6";

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
  return `${(mb / 1024).toFixed(0)} GB`;
}

// ── 구독 플랜 카드 ──────────────────────────────────────────────
function PlanCard({ plan, onEdit, onToggle }: {
  plan: SubscriptionPlan;
  onEdit: (plan: SubscriptionPlan) => void;
  onToggle: (plan: SubscriptionPlan) => void;
}) {
  const priceStr = plan.monthlyPrice === 0 ? "무료" : `₩${plan.monthlyPrice.toLocaleString()}/월`;
  const isCenter = plan.memberLimit != null && plan.memberLimit >= 200;
  const accentColor = isCenter ? "#F59E0B" : P;
  return (
    <View style={[pc.card, (!plan.isActive || plan.isArchived) && pc.cardInactive]}>
      <View style={pc.top}>
        <View style={[pc.tierBadge, { backgroundColor: isCenter ? "#FEF3C7" : "#EEDDF5" }]}>
          <Text style={[pc.tierTxt, { color: accentColor }]}>{plan.code.toUpperCase()}</Text>
        </View>
        <Text style={[pc.name, (!plan.isActive || plan.isArchived) && { color: "#64748B" }]}>{plan.name}</Text>
        <Text style={[pc.price, { color: accentColor }]}>{priceStr}</Text>
      </View>
      <View style={pc.row}>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>최대 회원</Text>
          <Text style={pc.infoVal}>{plan.memberLimit == null ? "무제한" : `${plan.memberLimit.toLocaleString()}명`}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>기본 용량</Text>
          <Text style={pc.infoVal}>{fmtMb(plan.baseStorageMb)}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>영상</Text>
          <Text style={[pc.infoVal, { color: plan.includesVideo ? G : "#94A3B8" }]}>{plan.includesVideo ? "포함" : "미포함"}</Text>
        </View>
        <View style={pc.infoItem}>
          <Text style={pc.infoLabel}>상태</Text>
          <Text style={[pc.infoVal, { color: plan.isActive ? G : "#D96C6C" }]}>
            {plan.isArchived ? "보관됨" : plan.isActive ? "활성" : "비활성"}
          </Text>
        </View>
      </View>
      {plan.note ? <View style={pc.noteBox}><Text style={pc.noteTxt}>{plan.note}</Text></View> : null}
      <View style={pc.actions}>
        <Pressable style={[pc.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => onEdit(plan)}>
          <PenLine size={13} color={P} />
          <Text style={[pc.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable
          style={[pc.btn, { backgroundColor: plan.isActive ? "#FFF1BF" : "#E6FFFA" }]}
          onPress={() => onToggle(plan)}>
          <LucideIcon name={plan.isActive ? "pause-circle" : "play-circle"} size={13}
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
  tierBadge:   { backgroundColor: "#EEDDF5", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tierTxt:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: P },
  name:        { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  price:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: G },
  row:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  infoItem:    { flex: 1, minWidth: "20%", backgroundColor: "#F1F5F9", borderRadius: 8, padding: 8 },
  infoLabel:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  infoVal:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", marginTop: 2 },
  noteBox:     { backgroundColor: "#FFF1BF", borderRadius: 8, padding: 8, marginBottom: 10 },
  noteTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E" },
  actions:     { flexDirection: "row", gap: 8, alignItems: "center" },
  btn:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
  updatedAt:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginLeft: "auto" },
});

// ── 구독 플랜 폼 모달 ───────────────────────────────────────────
function PlanFormModal({ visible, initial, onClose, onSave }: {
  visible: boolean; initial?: SubscriptionPlan | null;
  onClose: () => void; onSave: (form: FormState) => void;
}) {
  const { token } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [otpVisible, setOtpVisible] = useState(false);
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
    { key: "name" as const,          label: "상품명",         placeholder: "예: Coach50" },
    { key: "code" as const,          label: "코드 키",         placeholder: "예: basic", disabled: isEdit },
    { key: "memberLimit" as const,   label: "최대 회원 수",   placeholder: "빈칸이면 무제한", numeric: true },
    { key: "baseStorageMb" as const, label: "기본 용량 (MB)", placeholder: "5120 = 5GB", numeric: true },
    { key: "monthlyPrice" as const,  label: "월 요금 (원)",   placeholder: "0", numeric: true },
    { key: "note" as const,          label: "메모 (선택)",    placeholder: "내부 참고용" },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#F1F5F9" }} edges={["top"]}>
        <View style={fm.header}>
          <Pressable onPress={onClose} style={fm.close}><X size={20} color="#64748B" /></Pressable>
          <Text style={fm.title}>{isEdit ? "구독 플랜 수정" : "구독 플랜 생성"}</Text>
          <View style={{ width: 28 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 24 }}>
            {textFields.map(f => (
              <View key={f.key}>
                <Text style={fm.label}>{f.label}</Text>
                <TextInput
                  style={[fm.input, (f as any).disabled && { backgroundColor: "#F1F5F9", color: "#94A3B8" }]}
                  value={String(form[f.key])}
                  onChangeText={v => setVal(f.key, v)}
                  placeholder={f.placeholder ?? ""}
                  placeholderTextColor="#94A3B8"
                  keyboardType={f.numeric ? "numeric" : "default"}
                  editable={!(f as any).disabled}
                />
              </View>
            ))}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}>
              <Text style={[fm.label, { marginBottom: 0, flex: 1 }]}>영상 업로드 포함</Text>
              <Switch value={form.includesVideo} onValueChange={v => setVal("includesVideo", v)}
                trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }} thumbColor={form.includesVideo ? P : "#64748B"} />
            </View>
          </ScrollView>
          <View style={fm.bottomBar}>
            <Pressable style={fm.bottomSaveBtn} onPress={() => setOtpVisible(true)}>
              <Lock size={14} color="#fff" />
              <Text style={fm.saveTxt}>{isEdit ? "수정 후 저장" : "생성하기"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
        <OtpGateModal
          visible={otpVisible}
          token={token}
          title={isEdit ? "구독 플랜 수정 OTP" : "구독 플랜 생성 OTP"}
          desc="구독 플랜 변경은 OTP 인증 후에 저장됩니다."
          onSuccess={() => { setOtpVisible(false); onSave(form); }}
          onCancel={() => setOtpVisible(false)}
        />
      </SafeAreaView>
    </Modal>
  );
}

const fm = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  close:         { padding: 4 },
  title:         { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  saveTxt:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  label:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 6 },
  input:         { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", minHeight: 42 },
  bottomBar:     { padding: 16, paddingBottom: 24, borderTopWidth: 1, borderTopColor: "#E5E7EB", backgroundColor: "#F1F5F9" },
  bottomSaveBtn: { backgroundColor: P, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});

// ── API 응답 행 타입 ─────────────────────────────────────────────
interface ApiPlanRow {
  tier: string; plan_id: string; name: string;
  price_per_month: number; member_limit: number;
  storage_gb: number; storage_mb: number; display_storage: string;
  is_active: boolean;
}

function rowToSubscriptionPlan(row: ApiPlanRow): SubscriptionPlan {
  return {
    id:            row.tier,
    code:          row.plan_id || row.tier,
    tier:          row.tier,
    plan_id:       row.plan_id || row.tier,
    name:          row.name,
    memberLimit:   row.member_limit ?? null,
    baseStorageMb: row.storage_mb ?? Math.round(row.storage_gb * 1024),
    displayStorage: row.display_storage ?? "",
    monthlyPrice:  row.price_per_month ?? 0,
    includesVideo: (row.member_limit ?? 0) >= 200,
    isActive:      !!row.is_active,
    isArchived:    false,
    note:          "",
    createdAt:     "",
    updatedAt:     "",
  };
}

// ── 확정 플랜 정보 (DB 초기값 기준) ─────────────────────────────
const PLAN_GUIDE = [
  { group: "Coach (개인 선생님)", color: P, plans: [
    { name: "Coach30",  price: "₩3,500", members: "30명",    storage: "3GB",   video: false },
    { name: "Coach50",  price: "₩6,500", members: "50명",    storage: "5GB",   video: false },
    { name: "Coach100", price: "₩9,500", members: "100명",   storage: "10GB",  video: false },
  ]},
  { group: "Premier (수영장/센터)", color: "#F59E0B", plans: [
    { name: "Premier200",  price: "₩69,000",  members: "200명",  storage: "50GB",  video: true },
    { name: "Premier 300",  price: "₩99,000",  members: "300명",  storage: "80GB",  video: true },
    { name: "Premier 500",  price: "₩149,000", members: "500명",  storage: "130GB", video: true },
    { name: "Premier 1000", price: "₩249,000", members: "1000명", storage: "500GB", video: true },
  ]},
];

// ── 메인 ─────────────────────────────────────────────────────────
export default function SubscriptionProductsScreen() {
  if (!billingEnabled) return null;
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [plans,        setPlans]        = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editPlan,     setEditPlan]     = useState<SubscriptionPlan | null>(null);

  async function loadPlans() {
    setPlansLoading(true);
    try {
      const r = await apiRequest(token, "/super/plans");
      const d = await r.json();
      const rows: ApiPlanRow[] = Array.isArray(d.plans) ? d.plans : [];
      setPlans(rows.map(rowToSubscriptionPlan));
    } catch (e) { console.error("loadPlans:", e); }
    finally { setPlansLoading(false); }
  }

  useEffect(() => { loadPlans(); }, []);

  async function handlePlanSave(form: FormState) {
    if (!form.name.trim()) { Alert.alert("입력 오류", "상품명은 필수입니다."); return; }
    const body = {
      name:           form.name.trim(),
      price_per_month: parseInt(form.monthlyPrice) || 0,
      member_limit:   form.memberLimit ? parseInt(form.memberLimit) || 9999 : 9999,
      storage_mb:     parseInt(form.baseStorageMb) || 5120,
      storage_gb:     (parseInt(form.baseStorageMb) || 5120) / 1024,
    };
    try {
      if (editPlan) {
        const r = await apiRequest(token, `/super/plans/${editPlan.tier}`, { method: "PUT", body: JSON.stringify(body) });
        if (!r.ok) { const d = await r.json(); Alert.alert("수정 실패", d.error ?? "수정에 실패했습니다."); return; }
      } else {
        if (!form.code.trim()) { Alert.alert("입력 오류", "코드 키는 필수입니다."); return; }
        const r = await apiRequest(token, "/super/plans", { method: "POST", body: JSON.stringify({ ...body, tier: form.code.trim() }) });
        if (!r.ok) { const d = await r.json(); Alert.alert("생성 실패", d.error ?? "생성에 실패했습니다."); return; }
      }
      await loadPlans();
    } catch (e) { Alert.alert("오류", "서버 통신에 실패했습니다."); }
    setShowPlanForm(false); setEditPlan(null);
  }

  async function handlePlanToggle(plan: SubscriptionPlan) {
    const newActive = !plan.isActive;
    Alert.alert(newActive ? "상품 활성화" : "상품 비활성화",
      `'${plan.name}' 상품을 ${newActive ? "활성화" : "비활성화"}하시겠습니까?`, [
        { text: "취소", style: "cancel" },
        { text: "확인", style: newActive ? "default" : "destructive", onPress: async () => {
            try {
              const r = await apiRequest(token, `/super/plans/${plan.tier}/toggle`, { method: "PATCH" });
              if (!r.ok) { const d = await r.json(); Alert.alert("오류", d.error ?? "변경에 실패했습니다."); return; }
              await loadPlans();
            } catch { Alert.alert("오류", "서버 통신에 실패했습니다."); }
          }},
      ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="구독 플랜 설정" subtitle="Coach · Premier 플랜 관리" homePath="/(super)/more" />

      <Pressable style={s.createBtn} onPress={() => { setEditPlan(null); setShowPlanForm(true); }}>
        <CirclePlus size={16} color="#fff" />
        <Text style={s.createBtnTxt}>새 구독 플랜 생성</Text>
      </Pressable>

      <FlatList
        data={plans}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PlanCard plan={item} onEdit={p => { setEditPlan(p); setShowPlanForm(true); }} onToggle={handlePlanToggle} />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={plansLoading} tintColor={P} onRefresh={loadPlans} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            {/* 플랜 가이드 */}
            {PLAN_GUIDE.map(g => (
              <View key={g.group} style={s.guideBox}>
                <Text style={[s.guideGroupTxt, { color: g.color }]}>{g.group}</Text>
                <View style={s.guideTable}>
                  <View style={s.guideHeader}>
                    {["상품명", "가격", "회원", "용량", "영상"].map(h => (
                      <Text key={h} style={[s.guideHeaderTxt, h === "상품명" && { flex: 2 }]}>{h}</Text>
                    ))}
                  </View>
                  {g.plans.map(p => (
                    <View key={p.name} style={s.guideRow}>
                      <Text style={[s.guideCellTxt, { flex: 2 }]}>{p.name}</Text>
                      <Text style={s.guideCellTxt}>{p.price}</Text>
                      <Text style={s.guideCellTxt}>{p.members}</Text>
                      <Text style={s.guideCellTxt}>{p.storage}</Text>
                      <Text style={[s.guideCellTxt, { color: p.video ? G : "#94A3B8" }]}>{p.video ? "O" : "X"}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <View style={s.divider} />
            <Text style={s.sectionLabel}>DB 등록 플랜 목록</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Package size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>등록된 구독 플랜이 없습니다</Text>
            <Text style={[s.emptyTxt, { fontSize: 12, marginTop: 4 }]}>위 "새 구독 플랜 생성"으로 추가하세요</Text>
          </View>
        }
      />

      <PlanFormModal
        visible={showPlanForm}
        initial={editPlan}
        onClose={() => { setShowPlanForm(false); setEditPlan(null); }}
        onSave={handlePlanSave}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F8F9FF" },
  createBtn:  { flexDirection: "row", alignItems: "center", gap: 8, margin: 16, marginBottom: 0,
                backgroundColor: P, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  createBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },

  guideBox:   { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  guideGroupTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 8 },
  guideTable: { gap: 0 },
  guideHeader: { flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderColor: "#F1F5F9", gap: 4 },
  guideHeaderTxt: { flex: 1, fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  guideRow:   { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderColor: "#F8FAFC", gap: 4 },
  guideCellTxt: { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  divider:    { height: 1, backgroundColor: "#E5E7EB", marginVertical: 8 },
  sectionLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4 },

  empty:      { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center" },
});
