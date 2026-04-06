/**
 * (admin)/unit-pricing.tsx — 수업 단가표 설정
 * 주1회/주2회/주3회 월 수업료 설정 → 정산 자동계산에 반영
 */
import { Check, DollarSign } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface PricingItem {
  id: string;
  type_key: string;
  type_name: string;
  monthly_fee: number;
  sessions_per_month: number;
  is_active: boolean;
}

const WEEKLY_TYPES = [
  { key: "weekly_1", label: "주1회 수업", defaultSessions: 4, color: "#2EC4B6" },
  { key: "weekly_2", label: "주2회 수업", defaultSessions: 8, color: "#7C3AED" },
  { key: "weekly_3", label: "주3회 수업", defaultSessions: 12, color: "#D97706" },
];

function formatWon(n: number) {
  return n.toLocaleString("ko-KR");
}

export default function UnitPricingScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const poolId = (adminUser as any)?.swimming_pool_id || "";

  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [fees, setFees] = useState<Record<string, string>>({
    weekly_1: "", weekly_2: "", weekly_3: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/pricing?pool_id=${poolId}`);
      if (res.ok) {
        const data = await res.json();
        const items: PricingItem[] = data.pricing || [];
        setPricing(items);
        const newFees: Record<string, string> = { weekly_1: "", weekly_2: "", weekly_3: "" };
        for (const item of items) {
          if (item.type_key in newFees) {
            newFees[item.type_key] = String(item.monthly_fee || "");
          }
        }
        setFees(newFees);
      }
    } finally { setLoading(false); }
  }, [token, poolId]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true); setSavedMsg("");
    try {
      const items = WEEKLY_TYPES.map(({ key, label, defaultSessions }) => {
        const existing = pricing.find(p => p.type_key === key);
        return {
          type_key: key,
          type_name: existing?.type_name ?? label,
          monthly_fee: parseInt(fees[key] || "0", 10) || 0,
          sessions_per_month: existing?.sessions_per_month ?? defaultSessions,
          is_active: existing?.is_active !== false,
        };
      });

      const allItems = [
        ...items,
        ...pricing.filter(p => !WEEKLY_TYPES.some(w => w.key === p.type_key)).map(p => ({
          type_key: p.type_key,
          type_name: p.type_name,
          monthly_fee: p.monthly_fee,
          sessions_per_month: p.sessions_per_month,
          is_active: p.is_active,
        })),
      ];

      const res = await apiRequest(token, `/pricing/${poolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: allItems }),
      });
      if (res.ok) {
        const data = await res.json();
        setPricing(data.pricing || []);
        setSavedMsg("저장되었습니다.");
      } else {
        setSavedMsg("저장 실패");
      }
    } catch { setSavedMsg("저장 중 오류가 발생했습니다."); }
    finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(""), 3000);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SubScreenHeader
        title="수업 단가표"
        rightSlot={
          <Pressable
            style={[s.saveBtn, { backgroundColor: themeColor, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Check size={14} color="#fff" /><Text style={s.saveBtnTxt}>저장</Text></>
            }
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 안내 */}
          <View style={[s.infoBox, { backgroundColor: themeColor + "12", borderColor: themeColor + "30" }]}>
            <DollarSign size={14} color={themeColor} />
            <Text style={[s.infoTxt, { color: C.text }]}>
              월 수업료를 설정하면 수업시수 × 수업당 단가로{"\n"}선생님 정산이 자동 계산됩니다.
            </Text>
          </View>

          {/* 주1회 / 주2회 / 주3회 */}
          {WEEKLY_TYPES.map(({ key, label, defaultSessions, color }) => {
            const existing = pricing.find(p => p.type_key === key);
            const sessions = existing?.sessions_per_month ?? defaultSessions;
            const fee = parseInt(fees[key] || "0", 10) || 0;
            const perSession = sessions > 0 && fee > 0 ? Math.round(fee / sessions) : 0;

            return (
              <View key={key} style={[s.card, { backgroundColor: C.card }]}>
                {/* 타입 라벨 */}
                <View style={s.cardHeader}>
                  <View style={[s.typeBadge, { backgroundColor: color + "18" }]}>
                    <Text style={[s.typeBadgeTxt, { color }]}>{label}</Text>
                  </View>
                  <Text style={[s.sessionsHint, { color: C.textMuted }]}>
                    월 {sessions}회 기준
                  </Text>
                </View>

                {/* 월 수업료 입력 */}
                <Text style={[s.fieldLabel, { color: C.textSecondary }]}>월 수업료 (객단가)</Text>
                <View style={[s.inputRow, { borderColor: C.border }]}>
                  <TextInput
                    style={[s.input, { color: C.text }]}
                    value={fees[key]}
                    onChangeText={v => setFees(prev => ({ ...prev, [key]: v.replace(/[^0-9]/g, "") }))}
                    placeholder="0"
                    placeholderTextColor={C.textMuted}
                    keyboardType="number-pad"
                  />
                  <Text style={[s.inputSuffix, { color: C.textMuted }]}>원 / 월</Text>
                </View>

                {/* 수업당 단가 계산 */}
                <View style={[s.calcRow, { backgroundColor: "#F8FAFC" }]}>
                  <Text style={[s.calcLabel, { color: C.textMuted }]}>수업당 단가</Text>
                  <Text style={[s.calcVal, { color: perSession > 0 ? color : C.textMuted }]}>
                    {perSession > 0 ? `${formatWon(perSession)}원 / 회` : "—"}
                  </Text>
                </View>
              </View>
            );
          })}

          {/* 저장 결과 메시지 */}
          {savedMsg ? (
            <View style={[s.msgBox, {
              backgroundColor: savedMsg === "저장되었습니다." ? "#E6FFFA" : "#FEE2E2",
              borderColor: savedMsg === "저장되었습니다." ? "#2EC4B6" : "#FCA5A5",
            }]}>
              <Text style={[s.msgTxt, { color: savedMsg === "저장되었습니다." ? "#0F766E" : "#DC2626" }]}>
                {savedMsg}
              </Text>
            </View>
          ) : null}

          {/* 정산 반영 안내 */}
          <View style={[s.noteBox, { borderColor: C.border }]}>
            <Text style={[s.noteTitle, { color: C.text }]}>정산 자동계산 방식</Text>
            <Text style={[s.noteTxt, { color: C.textMuted }]}>
              수업당 단가 = 월 수업료 ÷ 월 수업횟수{"\n"}
              선생님 정산금액 = 수업당 단가 × 실제 수업시수{"\n"}
              + 추가수업비용 (별도 발생 시)
            </Text>
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  saveBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  saveBtnTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },

  infoBox:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 20 },

  card:         { borderRadius: 16, padding: 16, gap: 10,
                  shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  typeBadge:    { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  typeBadgeTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  sessionsHint: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  fieldLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  inputRow:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12,
                  paddingHorizontal: 14, paddingVertical: 4, backgroundColor: "#F8FAFC" },
  input:        { flex: 1, fontSize: 22, fontFamily: "Pretendard-Regular", paddingVertical: 8 },
  inputSuffix:  { fontSize: 14, fontFamily: "Pretendard-Regular", paddingLeft: 4 },

  calcRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  calcLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular" },
  calcVal:      { fontSize: 15, fontFamily: "Pretendard-Regular" },

  msgBox:       { borderRadius: 12, padding: 12, borderWidth: 1, alignItems: "center" },
  msgTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular" },

  noteBox:      { borderRadius: 14, padding: 14, borderWidth: 1, gap: 6 },
  noteTitle:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  noteTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 20 },
});
