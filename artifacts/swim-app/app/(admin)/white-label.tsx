import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Switch, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const TINT = "#2EC4B6";

interface WhiteLabelSettings {
  white_label_enabled: boolean;
  hide_platform_name: boolean;
}

export default function WhiteLabelScreen() {
  const insets = useSafeAreaInsets();
  const { token, pool } = useAuth();

  const [settings, setSettings] = useState<WhiteLabelSettings>({
    white_label_enabled: false,
    hide_platform_name: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, "/pools/white-label");
      if (res.ok) {
        const data = await res.json();
        setSettings({
          white_label_enabled: !!data.white_label_enabled,
          hide_platform_name: !!data.hide_platform_name,
        });
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!token) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await apiRequest(token, "/pools/white-label", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("저장 실패");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally { setSaving(false); }
  }

  function toggle(key: keyof WhiteLabelSettings) {
    setSettings(prev => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next.white_label_enabled) next.hide_platform_name = false;
      return next;
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="화이트라벨 설정" onBack={undefined} />

      {loading ? (
        <ActivityIndicator color={TINT} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32, gap: 20 }}
        >
          {/* 설명 카드 */}
          <View style={[styles.descCard, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}>
            <Feather name="tag" size={18} color="#1D4ED8" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.descTitle, { color: "#1D4ED8" }]}>화이트라벨이란?</Text>
              <Text style={[styles.descBody, { color: "#1E40AF" }]}>
                학부모 앱에서 '스윔노트' 플랫폼 이름과 로고를 숨기고, 수영장 자체 브랜드만 표시하는 기능입니다. 프리미엄 구독 기능입니다.
              </Text>
            </View>
          </View>

          {/* 현재 수영장 */}
          <View style={[styles.poolChip, { backgroundColor: C.card, borderColor: C.border }]}>
            <Feather name="droplet" size={14} color={TINT} />
            <Text style={[styles.poolChipTxt, { color: C.textSecondary }]}>적용 수영장</Text>
            <Text style={[styles.poolChipName, { color: C.text }]}>{pool?.name ?? "—"}</Text>
          </View>

          {/* 구독 잠금 안내 */}
          {pool?.subscription_status === "trial" && (
            <View style={[styles.lockCard, { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]}>
              <Feather name="lock" size={16} color="#C2410C" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.lockTitle, { color: "#C2410C" }]}>구독 전용 기능</Text>
                <Text style={[styles.lockBody, { color: "#9A3412" }]}>
                  화이트 라벨 옵션에 구독하실 경우 스윔노트 이름 대신 등록된 수영장 이름 또는 관리자 이름만 표시됩니다.
                </Text>
              </View>
            </View>
          )}

          {/* 설정 토글 목록 */}
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>화이트라벨 옵션</Text>

            <ToggleRow
              icon="shield"
              label="화이트라벨 활성화"
              description="이 수영장에 화이트라벨 기능을 사용합니다"
              value={settings.white_label_enabled}
              onToggle={() => toggle("white_label_enabled")}
              tint={TINT}
              disabled={pool?.subscription_status === "trial"}
            />

            <View style={[styles.divider, { backgroundColor: C.border }]} />

            <ToggleRow
              icon="eye-off"
              label="플랫폼 이름 숨기기"
              description='학부모 앱에서 "스윔노트" 문구와 로고를 숨깁니다'
              value={settings.hide_platform_name}
              onToggle={() => toggle("hide_platform_name")}
              tint={TINT}
              disabled={!settings.white_label_enabled || pool?.subscription_status === "trial"}
            />
          </View>

          {/* 미리보기 */}
          <View style={[styles.section, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>학부모 앱 미리보기</Text>
            <View style={[styles.preview, { backgroundColor: C.background, borderColor: C.border }]}>
              <View style={styles.previewHeader}>
                <View style={[styles.previewIcon, { backgroundColor: "#E8F7F6" }]}>
                  <Text style={{ fontSize: 22 }}>🏊</Text>
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={[styles.previewPoolName, { color: C.text }]}>{pool?.name ?? "내 수영장"}</Text>
                  {!settings.hide_platform_name && (
                    <View style={styles.previewPowered}>
                      <Text style={[styles.previewPoweredTxt, { color: C.textMuted }]}>Powered by 스윔노트</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={[styles.previewNote, { backgroundColor: settings.hide_platform_name ? "#FFF7ED" : "#F0FDF4", borderColor: settings.hide_platform_name ? "#FED7AA" : "#BBF7D0" }]}>
                <Feather name={settings.hide_platform_name ? "eye-off" : "eye"} size={13} color={settings.hide_platform_name ? "#C2410C" : "#15803D"} />
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Medium", color: settings.hide_platform_name ? "#C2410C" : "#15803D" }}>
                  {settings.hide_platform_name ? "스윔노트 표시 숨김" : "스윔노트 표시 중"}
                </Text>
              </View>
            </View>
          </View>

          {/* 저장 버튼 */}
          {error ? <Text style={[styles.errTxt, { color: C.error }]}>{error}</Text> : null}
          <Pressable
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: saved ? "#15803D" : TINT, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name={saved ? "check" : "save"} size={18} color="#fff" />
                <Text style={styles.saveBtnTxt}>{saved ? "저장되었습니다" : "설정 저장"}</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function ToggleRow({
  icon, label, description, value, onToggle, tint, disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
  tint: string;
  disabled?: boolean;
}) {
  const C = Colors.light;
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleDisabled]}>
      <View style={[styles.toggleIcon, { backgroundColor: value && !disabled ? tint + "20" : "#F3F0EE" }]}>
        <Feather name={icon} size={17} color={value && !disabled ? tint : C.textMuted} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.toggleLabel, { color: disabled ? C.textMuted : C.text }]}>{label}</Text>
        <Text style={[styles.toggleDesc, { color: C.textMuted }]} numberOfLines={2}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: "#E5E7EB", true: tint + "88" }}
        thumbColor={value ? tint : "#fff"}
        ios_backgroundColor="#E5E7EB"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  descCard: { flexDirection: "row", gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
  descTitle: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  descBody: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 19 },
  poolChip: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  poolChipTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  poolChipName: { fontSize: 14, fontFamily: "Pretendard-Bold", flex: 1 },
  section: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  sectionTitle: { fontSize: 12, fontFamily: "Pretendard-SemiBold", letterSpacing: 0.4, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, textTransform: "uppercase" },
  divider: { height: 1, marginHorizontal: 16 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  toggleDisabled: { opacity: 0.45 },
  toggleIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toggleLabel: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  toggleDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  preview: { margin: 16, borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  previewIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  previewPoolName: { fontSize: 16, fontFamily: "Pretendard-Bold", color: "#111827" },
  previewPowered: {},
  previewPoweredTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  previewNote: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  lockCard: { flexDirection: "row", gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
  lockTitle: { fontSize: 13, fontFamily: "Pretendard-Bold", marginBottom: 3 },
  lockBody: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  errTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },
  saveBtn: { height: 52, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnTxt: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
});
