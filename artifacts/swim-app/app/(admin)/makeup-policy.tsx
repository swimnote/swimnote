/**
 * 보강 정책 설정 화면
 * - 만료 유형: 당월 말일 / 다음달 말일 / 지정 일수
 * - 주간 횟수별 보강 한도 (1회/2회/3회 이상)
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;

type ExpiryType = "end_of_month" | "next_month_end" | "fixed_days";

interface Policy {
  expiry_type: ExpiryType;
  expiry_days: number | null;
  limit_weekly_1: number;
  limit_weekly_2: number;
  limit_weekly_3: number;
}

const EXPIRY_OPTIONS: { value: ExpiryType; label: string; desc: string }[] = [
  { value: "end_of_month",   label: "당월 말일",    desc: "결석한 달의 마지막 날까지 보강 가능" },
  { value: "next_month_end", label: "다음달 말일",   desc: "결석 다음 달 마지막 날까지 보강 가능" },
  { value: "fixed_days",     label: "지정 일수",     desc: "결석일로부터 지정한 일수까지 보강 가능" },
];

export default function MakeupPolicyScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [policy, setPolicy] = useState<Policy>({
    expiry_type: "end_of_month",
    expiry_days: null,
    limit_weekly_1: 2,
    limit_weekly_2: 4,
    limit_weekly_3: 5,
  });
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [daysInput, setDaysInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiRequest(token, "/admin/makeup-policy");
      if (r.ok) {
        const data = await r.json();
        setPolicy(data);
        setDaysInput(data.expiry_days ? String(data.expiry_days) : "");
      }
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: any = {
        expiry_type:    policy.expiry_type,
        expiry_days:    policy.expiry_type === "fixed_days" ? Number(daysInput) : null,
        limit_weekly_1: policy.limit_weekly_1,
        limit_weekly_2: policy.limit_weekly_2,
        limit_weekly_3: policy.limit_weekly_3,
      };
      await apiRequest(token, "/admin/makeup-policy", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setShowConfirm(false);
    } finally { setSaving(false); }
  };

  const limitInputProps = (val: number, key: keyof Policy) => ({
    value: String(val),
    keyboardType: "numeric" as const,
    onChangeText: (t: string) => {
      const n = parseInt(t, 10);
      if (!isNaN(n) && n >= 0 && n <= 30)
        setPolicy(p => ({ ...p, [key]: n }));
      else if (t === "")
        setPolicy(p => ({ ...p, [key]: 0 }));
    },
    style: [s.limitInput, { borderColor: themeColor }],
  });

  if (loading) {
    return (
      <View style={s.root}>
        <SubScreenHeader title="보강 정책 설정" />
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <SubScreenHeader title="보강 정책 설정" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 만료 정책 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>보강권 만료 정책</Text>
          <Text style={s.sectionDesc}>결석 발생 시 자동 생성되는 보강권의 만료 기준을 설정합니다.</Text>
          {EXPIRY_OPTIONS.map(opt => (
            <Pressable
              key={opt.value}
              style={[s.optCard, policy.expiry_type === opt.value && { borderColor: themeColor, backgroundColor: "#F0FBF9" }]}
              onPress={() => setPolicy(p => ({ ...p, expiry_type: opt.value }))}
            >
              <View style={s.radioRow}>
                <View style={[s.radio, policy.expiry_type === opt.value && { borderColor: themeColor }]}>
                  {policy.expiry_type === opt.value && <View style={[s.radioDot, { backgroundColor: themeColor }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optLabel, policy.expiry_type === opt.value && { color: themeColor }]}>{opt.label}</Text>
                  <Text style={s.optDesc}>{opt.desc}</Text>
                </View>
              </View>
              {opt.value === "fixed_days" && policy.expiry_type === "fixed_days" && (
                <View style={s.daysRow}>
                  <Text style={s.daysLabel}>만료 일수</Text>
                  <TextInput
                    value={daysInput}
                    onChangeText={setDaysInput}
                    keyboardType="numeric"
                    placeholder="30"
                    style={[s.daysInput, { borderColor: themeColor }]}
                    maxLength={3}
                  />
                  <Text style={s.daysUnit}>일</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* 월별 보강 한도 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>월별 보강 한도 (주간 횟수별)</Text>
          <Text style={s.sectionDesc}>
            회원의 주간 수업 횟수에 따라 한 달에 받을 수 있는 최대 보강 횟수를 설정합니다.{"\n"}
            한도 초과 시 결석해도 보강권이 자동 생성되지 않습니다.
          </Text>

          <View style={s.limitCard}>
            <LimitRow
              label="주 1회 회원"
              desc="weekly_count = 1"
              {...limitInputProps(policy.limit_weekly_1, "limit_weekly_1")}
            />
            <View style={s.divider} />
            <LimitRow
              label="주 2회 회원"
              desc="weekly_count = 2"
              {...limitInputProps(policy.limit_weekly_2, "limit_weekly_2")}
            />
            <View style={s.divider} />
            <LimitRow
              label="주 3회 이상 회원"
              desc="weekly_count ≥ 3"
              {...limitInputProps(policy.limit_weekly_3, "limit_weekly_3")}
            />
          </View>
        </View>

        {/* 저장 버튼 */}
        <Pressable
          style={[s.saveBtn, { backgroundColor: themeColor }]}
          onPress={() => setShowConfirm(true)}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <>
                <Feather name="save" size={16} color="#fff" />
                <Text style={s.saveBtnTxt}>정책 저장</Text>
              </>
          }
        </Pressable>
      </ScrollView>

      <ConfirmModal
        visible={showConfirm}
        title="보강 정책 저장"
        message={`설정한 보강 정책을 저장합니까?\n\n• 만료: ${EXPIRY_OPTIONS.find(o => o.value === policy.expiry_type)?.label}${policy.expiry_type === "fixed_days" ? ` (${daysInput}일)` : ""}\n• 주 1회 한도: 월 ${policy.limit_weekly_1}회\n• 주 2회 한도: 월 ${policy.limit_weekly_2}회\n• 주 3회+ 한도: 월 ${policy.limit_weekly_3}회`}
        confirmText="저장"
        onConfirm={handleSave}
        onCancel={() => setShowConfirm(false)}
      />
    </View>
  );
}

function LimitRow({ label, desc, value, onChangeText, style }: {
  label: string; desc: string;
  value: string; onChangeText: (t: string) => void; style: any;
}) {
  return (
    <View style={s.limitRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.limitLabel}>{label}</Text>
        <Text style={s.limitDesc}>{desc}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
        maxLength={2}
        style={style}
      />
      <Text style={s.limitUnit}>회/월</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.background },
  section:      { marginBottom: 24 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: C.text, marginBottom: 4 },
  sectionDesc:  { fontSize: 12, color: C.textSecondary, marginBottom: 12, lineHeight: 18 },
  optCard:      { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: C.border },
  radioRow:     { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  radio:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  radioDot:     { width: 10, height: 10, borderRadius: 5 },
  optLabel:     { fontSize: 14, fontWeight: "700", color: C.text },
  optDesc:      { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  daysRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingLeft: 32 },
  daysLabel:    { fontSize: 13, color: C.text, fontWeight: "600" },
  daysInput:    { width: 70, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: "700", textAlign: "center", backgroundColor: "#fff" },
  daysUnit:     { fontSize: 13, color: C.textSecondary },
  limitCard:    { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: C.border },
  limitRow:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  limitLabel:   { fontSize: 14, fontWeight: "700", color: C.text },
  limitDesc:    { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  limitInput:   { width: 54, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, fontSize: 16, fontWeight: "700", textAlign: "center", backgroundColor: "#fff" },
  limitUnit:    { fontSize: 12, color: C.textSecondary },
  divider:      { height: 1, backgroundColor: C.border, marginHorizontal: 14 },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
  saveBtnTxt:   { fontSize: 16, fontWeight: "700", color: "#fff" },
});
