/**
 * (admin)/class-capacity-settings.tsx — 반 개설 관리
 * 기본 반 정원(1~20명) 설정. 새 반 생성 시 기본값으로 적용됩니다.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const MIN = 1;
const MAX = 20;

export default function ClassCapacitySettingsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [capacity, setCapacity] = useState(5);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiRequest(token, "/admin/class-settings");
        if (r.ok) {
          const d = await r.json();
          setCapacity(d.default_capacity ?? 5);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await apiRequest(token, "/admin/class-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_capacity: capacity }),
      });
      if (r.ok) {
        setMsg({ text: "반 개설 기본 정원이 저장되었습니다.", ok: true });
        setTimeout(() => setMsg(null), 3000);
      } else {
        const d = await r.json().catch(() => ({}));
        setMsg({ text: d.error ?? "저장에 실패했습니다.", ok: false });
      }
    } catch {
      setMsg({ text: "네트워크 오류가 발생했습니다.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="반 개설 관리" />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={C.brandStrong} />
      ) : (
        <View style={[s.content, { paddingBottom: insets.bottom + 32 }]}>

          {/* ── 설명 카드 ── */}
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>기본 반 정원</Text>
            <Text style={s.infoDesc}>
              새 반을 개설할 때 기본으로 적용되는 정원입니다.{"\n"}
              반별로 개설 시 개별 수정이 가능합니다.
            </Text>
          </View>

          {/* ── Stepper ── */}
          <View style={s.stepperCard}>
            <Text style={s.stepperLabel}>기본 정원</Text>
            <View style={s.stepperRow}>
              <Pressable
                style={[s.stepBtn, capacity <= MIN && s.stepBtnDisabled]}
                onPress={() => setCapacity(v => Math.max(MIN, v - 1))}
                disabled={capacity <= MIN}
                hitSlop={8}
              >
                <LucideIcon name="minus" size={18} color={capacity <= MIN ? C.border : C.text} />
              </Pressable>

              <View style={s.valueBox}>
                <Text style={s.valueText}>{capacity}</Text>
                <Text style={s.valueUnit}>명</Text>
              </View>

              <Pressable
                style={[s.stepBtn, capacity >= MAX && s.stepBtnDisabled]}
                onPress={() => setCapacity(v => Math.min(MAX, v + 1))}
                disabled={capacity >= MAX}
                hitSlop={8}
              >
                <LucideIcon name="plus" size={18} color={capacity >= MAX ? C.border : C.text} />
              </Pressable>
            </View>
            <Text style={s.rangeHint}>최소 {MIN}명 · 최대 {MAX}명</Text>
          </View>

          {/* ── 저장 메시지 ── */}
          {msg && (
            <View style={[s.msgBox, { backgroundColor: msg.ok ? C.brandSoft : "#FEE2E2" }]}>
              {msg.ok
                ? <LucideIcon name="check-circle" size={14} color={C.brandStrong} />
                : <LucideIcon name="alert-circle" size={14} color={C.error} />}
              <Text style={[s.msgText, { color: msg.ok ? C.brandStrong : C.error }]}>{msg.text}</Text>
            </View>
          )}

          {/* ── 저장 버튼 ── */}
          <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.saveBtnText}>저장</Text>}
          </Pressable>

          {/* ── 반별 개별 설정 안내 ── */}
          <View style={s.guideCard}>
            <Text style={s.guideTitle}>반별 개별 설정이 필요한 경우</Text>
            <Text style={s.guideDesc}>
              {'• 특정 반(예: 마스터즈반)의 정원만 별도로 수정하거나, 선생님이 2명 이상 투입되는 반을 운영할 경우\n\n'}
              {'• 수업 스케줄러에서 해당 반을 선택하면 반 정보 화면이 열립니다. 여기서 정원을 직접 수정하거나 선생님을 추가할 수 있습니다.\n\n'}
              {'• 추가된 선생님도 각자 수업 일지를 작성할 수 있습니다. (관리자만 선생님 추가·변경 가능)'}
            </Text>
          </View>

        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 16 },

  infoCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 6,
  },
  infoTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text },
  infoDesc:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },

  stepperCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: C.border, alignItems: "center", gap: 12,
  },
  stepperLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  stepperRow:   { flexDirection: "row", alignItems: "center", gap: 20 },
  stepBtn: {
    width: 44, height: 44, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.background,
  },
  stepBtnDisabled: { borderColor: C.border, opacity: 0.4 },
  valueBox:  { alignItems: "center", minWidth: 72 },
  valueText: { fontSize: 40, fontFamily: "Pretendard-SemiBold", color: C.brandStrong, lineHeight: 46 },
  valueUnit: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: -2 },
  rangeHint: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  msgBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  msgText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },

  saveBtn: {
    backgroundColor: C.primaryAction, borderRadius: 12,
    paddingVertical: 14, alignItems: "center",
  },
  saveBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  guideCard: {
    backgroundColor: "#F0F9FF", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#BAE6FD", gap: 8,
  },
  guideTitle: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#0369A1" },
  guideDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary, lineHeight: 20 },
});
