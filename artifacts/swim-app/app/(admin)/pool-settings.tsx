import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface PoolSettings {
  id: string; name: string; name_en: string;
  business_reg_number: string; address: string; phone: string; owner_name: string;
  approval_status: string; subscription_status: string;
}

export default function PoolSettingsScreen() {
  const { token, refreshPool } = useAuth();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [form, setForm] = useState({ name: "", name_en: "", address: "", phone: "", owner_name: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [defaultCapacity, setDefaultCapacity] = useState<string>("20");
  const [savingCapacity,  setSavingCapacity]  = useState(false);
  const [capacityMsg,     setCapacityMsg]     = useState("");

  // ── 단가표 관련 ───────────────────────────────────────
  interface PricingItem { id: string; type_key: string; type_name: string; monthly_fee: number; sessions_per_month: number; is_active: boolean; }
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [pricingEdits, setPricingEdits] = useState<Record<string, Partial<PricingItem>>>({});
  const [savingPricing, setSavingPricing] = useState(false);
  const [pricingMsg, setPricingMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [settingsRes, capRes] = await Promise.all([
          apiRequest(token, "/pools/settings"),
          apiRequest(token, "/admin/class-settings"),
        ]);
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setSettings(data);
          setForm({ name: data.name || "", name_en: data.name_en || "", address: data.address || "", phone: data.phone || "", owner_name: data.owner_name || "" });
          // 단가표 로드
          if (data.id) {
            const priceRes = await apiRequest(token, `/pricing?pool_id=${data.id}`);
            if (priceRes.ok) { const pr = await priceRes.json(); setPricing(pr.pricing || []); }
          }
        }
        if (capRes.ok) {
          const capData = await capRes.json();
          setDefaultCapacity(String(capData.default_capacity ?? 20));
        }
      } finally { setLoading(false); }
    })();
  }, [token]);

  function updatePricing(typeKey: string, field: string, value: string | number) {
    setPricingEdits(prev => ({ ...prev, [typeKey]: { ...(prev[typeKey] || {}), [field]: value } }));
  }
  function getPricingVal(p: PricingItem, field: "type_name" | "monthly_fee" | "sessions_per_month") {
    const edit = pricingEdits[p.type_key];
    if (edit && field in edit) return String(edit[field as keyof PricingItem]);
    return String(p[field] ?? "");
  }

  async function handleSavePricing() {
    setSavingPricing(true); setPricingMsg("");
    try {
      const items = pricing.map(p => ({
        type_key: p.type_key,
        type_name: pricingEdits[p.type_key]?.type_name ?? p.type_name,
        monthly_fee: parseInt(String(pricingEdits[p.type_key]?.monthly_fee ?? p.monthly_fee), 10) || 0,
        sessions_per_month: parseInt(String(pricingEdits[p.type_key]?.sessions_per_month ?? p.sessions_per_month), 10) || 4,
        is_active: p.is_active,
      }));
      const res = await apiRequest(token, `/pricing/${settings?.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json();
        setPricing(data.pricing || []); setPricingEdits({});
        setPricingMsg("저장되었습니다."); setTimeout(() => setPricingMsg(""), 3000);
      } else { const d = await res.json(); setPricingMsg("저장 실패: " + d.error); }
    } catch { setPricingMsg("저장 중 오류"); }
    finally { setSavingPricing(false); }
  }

  async function handleSave() {
    if (form.name_en && !/^[a-z0-9_]+$/.test(form.name_en)) {
      setError("영문표시명은 소문자, 숫자, 언더스코어(_)만 사용할 수 있습니다."); return;
    }
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await apiRequest(token, "/pools/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장 실패");
      setSettings(data);
      await refreshPool?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) { setError(err.message || "저장 중 오류"); }
    finally { setSaving(false); }
  }

  async function handleSaveCapacity() {
    const cap = parseInt(defaultCapacity, 10);
    if (isNaN(cap) || cap < 1 || cap > 200) {
      setCapacityMsg("1~200 사이의 숫자를 입력하세요."); return;
    }
    setSavingCapacity(true); setCapacityMsg("");
    try {
      const res = await apiRequest(token, "/admin/class-settings", {
        method: "PATCH",
        body: JSON.stringify({ default_capacity: cap }),
      });
      if (res.ok) {
        setCapacityMsg("저장되었습니다.");
        setTimeout(() => setCapacityMsg(""), 3000);
      }
    } catch { setCapacityMsg("저장 중 오류가 발생했습니다."); }
    finally { setSavingCapacity(false); }
  }

  if (loading) return <View style={[styles.root, { backgroundColor: C.background, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={C.tint} /></View>;

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: C.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.headerTitle, { color: C.text }]}>수영장 설정</Text>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: C.tint, opacity: saving ? 0.6 : 1 }]}
          onPress={handleSave} disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>{saved ? "저장됨 ✓" : "저장"}</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 60 }} showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
            <Feather name="alert-circle" size={14} color={C.error} />
            <Text style={[styles.errText, { color: C.error }]}>{error}</Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>기본 정보</Text>

          {[
            { key: "name", label: "수영장 이름", icon: "droplet", placeholder: "수영장 이름" },
            { key: "address", label: "주소", icon: "map-pin", placeholder: "수영장 주소" },
            { key: "phone", label: "대표 전화", icon: "phone", placeholder: "02-0000-0000" },
            { key: "owner_name", label: "대표자 이름", icon: "user", placeholder: "대표자명" },
          ].map(({ key, label, icon, placeholder }) => (
            <View key={key} style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
              <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                <Feather name={icon as any} size={16} color={C.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: C.text }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder} placeholderTextColor={C.textMuted}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>파일명 설정</Text>
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>영문표시명</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="type" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={form.name_en}
                onChangeText={v => setForm(f => ({ ...f, name_en: v.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                placeholder="예: toykids_hwajeong" placeholderTextColor={C.textMuted}
                autoCapitalize="none"
              />
            </View>
            <Text style={[styles.hint, { color: C.textMuted }]}>소문자·숫자·_ 만 사용 가능</Text>
          </View>

          {form.name_en ? (
            <View style={[styles.previewBox, { backgroundColor: C.tintLight }]}>
              <Feather name="file" size={14} color={C.tint} />
              <Text style={[styles.previewText, { color: C.tint }]}>
                파일명 예시: {form.name_en}_20260314_154530_a3f8.jpg
              </Text>
            </View>
          ) : null}
        </View>

        {/* 반 기본 설정 */}
        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="users" size={16} color={C.tint} />
            <Text style={[styles.sectionTitle, { color: C.text }]}>반 기본 설정</Text>
          </View>
          <Text style={[styles.hint, { color: C.textMuted }]}>
            새 반을 만들 때 기본으로 적용되는 정원입니다. 반별로 개별 수정이 가능합니다.
          </Text>
          <View style={styles.field}>
            <Text style={[styles.label, { color: C.textSecondary }]}>기본 정원 (명)</Text>
            <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="users" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: C.text }]}
                value={defaultCapacity}
                onChangeText={setDefaultCapacity}
                placeholder="20"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Text style={[{ fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, paddingRight: 4 }]}>명</Text>
            </View>
          </View>
          {capacityMsg ? (
            <View style={[styles.msgBox, { backgroundColor: capacityMsg === "저장되었습니다." ? "#D1FAE5" : "#FEE2E2" }]}>
              <Feather name={capacityMsg === "저장되었습니다." ? "check-circle" : "alert-circle"} size={14}
                color={capacityMsg === "저장되었습니다." ? "#059669" : C.error} />
              <Text style={[styles.errText, { color: capacityMsg === "저장되었습니다." ? "#059669" : C.error }]}>{capacityMsg}</Text>
            </View>
          ) : null}
          <Pressable
            style={[styles.saveBtn, { backgroundColor: C.tint, opacity: savingCapacity ? 0.6 : 1, alignSelf: "flex-start", marginTop: 4 }]}
            onPress={handleSaveCapacity}
            disabled={savingCapacity}
          >
            {savingCapacity
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.saveBtnText}>정원 저장</Text>
            }
          </Pressable>
        </View>

        {/* ── 단가표 관리 ───────────────────────────────────── */}
        {pricing.length > 0 && (
          <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="dollar-sign" size={16} color="#7C3AED" />
              <Text style={[styles.sectionTitle, { color: C.text }]}>수업 단가표</Text>
            </View>
            <Text style={[styles.hint, { color: C.textMuted }]}>월 수업료 기준. 주1회=4회, 주2회=8회, 주3회=12회 기본.</Text>
            {pricing.map(p => (
              <View key={p.type_key} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={[styles.label, { color: C.textSecondary }]}>
                  {p.type_key.startsWith("custom") ? "커스텀명" : p.type_name}
                  {p.type_key.startsWith("custom") && <Text style={[styles.hint, { color: C.textMuted }]}> (이름 변경 가능)</Text>}
                </Text>
                {p.type_key.startsWith("custom") && (
                  <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background }]}>
                    <Feather name="tag" size={16} color={C.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={getPricingVal(p, "type_name")}
                      onChangeText={v => updatePricing(p.type_key, "type_name", v)}
                      placeholder={p.type_name} placeholderTextColor={C.textMuted}
                    />
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background, flex: 1 }]}>
                    <Feather name="dollar-sign" size={14} color={C.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={getPricingVal(p, "monthly_fee")}
                      onChangeText={v => updatePricing(p.type_key, "monthly_fee", v)}
                      placeholder="월 수업료" placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                    />
                    <Text style={[{ fontSize: 12, color: C.textMuted, paddingRight: 4 }]}>원</Text>
                  </View>
                  <View style={[styles.inputBox, { borderColor: C.border, backgroundColor: C.background, width: 80 }]}>
                    <TextInput
                      style={[styles.input, { color: C.text, textAlign: "center" }]}
                      value={getPricingVal(p, "sessions_per_month")}
                      onChangeText={v => updatePricing(p.type_key, "sessions_per_month", v)}
                      placeholder="4" placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                    />
                    <Text style={[{ fontSize: 12, color: C.textMuted, paddingRight: 4 }]}>회</Text>
                  </View>
                </View>
              </View>
            ))}
            {pricingMsg ? (
              <View style={[styles.msgBox, { backgroundColor: pricingMsg === "저장되었습니다." ? "#D1FAE5" : "#FEE2E2" }]}>
                <Feather name={pricingMsg === "저장되었습니다." ? "check-circle" : "alert-circle"} size={14}
                  color={pricingMsg === "저장되었습니다." ? "#059669" : C.error} />
                <Text style={[styles.errText, { color: pricingMsg === "저장되었습니다." ? "#059669" : C.error }]}>{pricingMsg}</Text>
              </View>
            ) : null}
            <Pressable
              style={[styles.saveBtn, { backgroundColor: "#7C3AED", opacity: savingPricing ? 0.6 : 1, alignSelf: "flex-start", marginTop: 4 }]}
              onPress={handleSavePricing} disabled={savingPricing}
            >
              {savingPricing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>단가표 저장</Text>}
            </Pressable>
          </View>
        )}

        {/* ── 휴무일 관리 바로가기 ─────────────────────────── */}
        <Pressable
          style={[styles.card, { backgroundColor: "#FEE2E2", shadowColor: C.shadow, flexDirection: "row", alignItems: "center", gap: 12 }]}
          onPress={() => router.push("/(admin)/holidays" as any)}
        >
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#EF444420", alignItems: "center", justifyContent: "center" }}>
            <Feather name="x-square" size={20} color="#EF4444" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: "#DC2626" }]}>휴무일 관리</Text>
            <Text style={[styles.hint, { color: "#EF4444" }]}>달력에서 수영장 휴무일을 설정합니다</Text>
          </View>
          <Feather name="chevron-right" size={18} color="#EF4444" />
        </Pressable>

        {settings && (
          <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>계정 상태</Text>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: C.textSecondary }]}>사업자등록번호</Text>
              <Text style={[styles.statusValue, { color: C.text }]}>{settings.business_reg_number || "미입력"}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: C.textSecondary }]}>승인 상태</Text>
              <View style={[styles.badge, {
                backgroundColor: settings.approval_status === "approved" ? "#D1FAE5" : "#FEF3C7"
              }]}>
                <Text style={[styles.badgeText, {
                  color: settings.approval_status === "approved" ? "#059669" : "#D97706"
                }]}>
                  {settings.approval_status === "approved" ? "승인됨" : settings.approval_status === "pending" ? "심사 중" : "반려"}
                </Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <Text style={[styles.statusLabel, { color: C.textSecondary }]}>구독 상태</Text>
              <Text style={[styles.statusValue, { color: C.text }]}>
                {settings.subscription_status === "trial" ? "체험 중" : settings.subscription_status === "active" ? "구독 중" : settings.subscription_status}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  saveBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, minWidth: 60, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  msgBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  card: { borderRadius: 16, padding: 18, gap: 14, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  field: { gap: 4 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  previewBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  previewText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  statusValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
