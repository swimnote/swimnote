/**
 * components/super/security-settings/SecurityPolicySection.tsx
 * G. 보안 정책 (로그인 실패 제한 / 계정 잠금 시간 / 재인증 필요 작업)
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SectionTitle } from "./SectionTitle";
import { P, REAUTH_ACTIONS } from "./types";

interface Props {
  maxFail: number;
  lockMinutes: number;
  onMaxFailChange: (v: number) => void;
  onLockMinutesChange: (v: number) => void;
}

export function SecurityPolicySection({
  maxFail,
  lockMinutes,
  onMaxFailChange,
  onLockMinutesChange,
}: Props) {
  return (
    <View style={s.section}>
      <SectionTitle title="G. 보안 정책" />

      <View style={s.policyRow}>
        <Text style={s.policyLabel}>로그인 실패 제한</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable style={s.policyBtn} onPress={() => onMaxFailChange(Math.max(3, maxFail - 1))}>
            <Text style={s.policyBtnTxt}>−</Text>
          </Pressable>
          <Text style={s.policyVal}>{maxFail}회</Text>
          <Pressable style={s.policyBtn} onPress={() => onMaxFailChange(Math.min(10, maxFail + 1))}>
            <Text style={s.policyBtnTxt}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.policyRow}>
        <Text style={s.policyLabel}>계정 잠금 시간</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {([15, 30, 60, 120] as const).map(min => (
            <Pressable
              key={min}
              style={[s.policyChip, lockMinutes === min && s.policyChipActive]}
              onPress={() => onLockMinutesChange(min)}
            >
              <Text style={[s.policyChipTxt, lockMinutes === min && s.policyChipTxtActive]}>
                {min >= 60 ? `${min / 60}h` : `${min}m`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 6, paddingTop: 6 }}>
        <Text style={s.policyLabel}>재인증 필요 작업</Text>
        {REAUTH_ACTIONS.map(act => (
          <View key={act} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
            <Feather name="check-circle" size={12} color={P} />
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" }}>{act}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  section:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
                      borderWidth: 1, borderColor: "#E5E7EB" },
  policyRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  policyLabel:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Medium", color: "#0F172A" },
  policyBtn:        { width: 30, height: 30, borderRadius: 8, backgroundColor: "#FFFFFF",
                      alignItems: "center", justifyContent: "center" },
  policyBtnTxt:     { fontSize: 18, fontFamily: "Pretendard-Bold", color: "#0F172A", lineHeight: 22 },
  policyVal:        { fontSize: 14, fontFamily: "Pretendard-Bold", color: "#0F172A",
                      minWidth: 32, textAlign: "center" },
  policyChip:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#FFFFFF" },
  policyChipActive: { backgroundColor: P },
  policyChipTxt:    { fontSize: 12, fontFamily: "Pretendard-Medium", color: "#64748B" },
  policyChipTxtActive: { color: "#fff" },
});
