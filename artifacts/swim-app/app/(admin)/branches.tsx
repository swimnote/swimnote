import { Check, Droplet, Info, Layers, LogIn, MapPin, Phone, Plus } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth, type OwnedPool } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ModalSheet } from "@/components/common/ModalSheet";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;
const TINT = "#2EC4B6";

type CopyOption = "levels" | "pricing";

interface CreateForm {
  name: string;
  address: string;
  phone: string;
}

export default function PoolsScreen() {
  const insets = useSafeAreaInsets();
  const { token, pool: currentPool, switchPool } = useAuth();

  const [pools, setPools] = useState<OwnedPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>({ name: "", address: "", phone: "" });
  const [copyOptions, setCopyOptions] = useState<Set<CopyOption>>(new Set());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function fetchPools() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, "/pools/my-pools");
      const data = await res.json();
      if (mountedRef.current && Array.isArray(data)) setPools(data);
    } catch (err) { console.error(err); }
    finally { if (mountedRef.current) setLoading(false); }
  }

  useEffect(() => {
    fetchPools();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSwitch(p: OwnedPool) {
    if (p.id === currentPool?.id) return;
    setConfirmAction({
      title: "수영장 전환",
      message: `"${p.name}"으로 전환하시겠습니까?\n전환 후 해당 수영장의 데이터로 전환됩니다.`,
      onConfirm: async () => {
        setSwitching(p.id);
        try {
          await switchPool(p.id);
          await fetchPools();
        } catch (e) {
          setConfirmAction({
            title: "전환 실패",
            message: "수영장 전환 중 오류가 발생했습니다.",
            onConfirm: () => setConfirmAction(null),
          });
        } finally {
          if (mountedRef.current) setSwitching(null);
        }
      },
    });
  }

  function toggleCopy(opt: CopyOption) {
    setCopyOptions(prev => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      return next;
    });
  }

  async function handleCreate() {
    if (!form.name.trim()) { setFormError("수영장 이름을 입력해주세요."); return; }
    setSaving(true); setFormError("");
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        copy_levels: copyOptions.has("levels"),
        copy_pricing: copyOptions.has("pricing"),
        source_pool_id: currentPool?.id,
      };
      const res = await apiRequest(token, "/pools/create-pool", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setShowCreate(false);
      setForm({ name: "", address: "", phone: "" });
      setCopyOptions(new Set());
      await fetchPools();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally { setSaving(false); }
  }

  const statusLabel = (s: string) => {
    const MAP: Record<string, string> = { trial: "체험", active: "구독중", expired: "만료", suspended: "정지", cancelled: "해지" };
    return MAP[s] ?? s;
  };
  const statusColor = (s: string) => {
    if (s === "active") return "#15803D";
    if (s === "trial") return TINT;
    return C.textMuted;
  };
  const approvalLabel = (s: string) => {
    const MAP: Record<string, string> = { approved: "승인", pending: "심사중", rejected: "반려" };
    return MAP[s] ?? s;
  };
  const approvalColor = (s: string) => {
    if (s === "approved") return "#15803D";
    if (s === "pending") return "#C2410C";
    return C.error;
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader
        title="내 수영장 관리"
        onBack={undefined}
        rightSlot={
          <Pressable
            onPress={() => { setForm({ name: "", address: "", phone: "" }); setCopyOptions(new Set()); setFormError(""); setShowCreate(true); }}
            style={[styles.addBtn, { backgroundColor: TINT }]}
          >
            <Plus size={15} color="#fff" />
            <Text style={styles.addBtnTxt}>새 수영장</Text>
          </Pressable>
        }
      />

      {/* 안내 배너 */}
      <View style={[styles.infoBanner, { borderColor: "#B2E0DC", backgroundColor: "#E8F7F6" }]}>
        <Info size={14} color={TINT} />
        <Text style={[styles.infoTxt, { color: "#0F6B64" }]}>
          여러 수영장을 운영 중이라면 각 수영장을 독립적으로 관리할 수 있습니다. 전환 시 데이터가 완전히 분리됩니다.
        </Text>
      </View>

      <View style={[styles.countRow, { paddingHorizontal: 20 }]}>
        <Text style={[styles.countTxt, { color: C.textSecondary }]}>
          총 <Text style={{ color: TINT, fontFamily: "Pretendard-Regular" }}>{pools.length}</Text>개 수영장
        </Text>
        <Text style={[styles.activeTxt, { color: C.textMuted }]}>
          현재: <Text style={{ color: TINT, fontFamily: "Pretendard-Regular" }}>{currentPool?.name ?? "—"}</Text>
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={TINT} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32, gap: 14 }}
        >
          {pools.length === 0 && (
            <View style={styles.empty}>
              <Layers size={44} color={C.textMuted} />
              <Text style={[styles.emptyTitle, { color: C.textSecondary }]}>등록된 수영장이 없습니다</Text>
              <Text style={[styles.emptyDesc, { color: C.textMuted }]}>오른쪽 위 버튼으로 수영장을 추가하세요</Text>
            </View>
          )}

          {pools.map((p) => {
            const isActive = p.id === currentPool?.id;
            const isSwitching = switching === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => handleSwitch(p)}
                disabled={isActive || isSwitching}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: C.card,
                    borderColor: isActive ? TINT : C.border,
                    borderWidth: isActive ? 2 : 1,
                    opacity: pressed && !isActive ? 0.88 : 1,
                  },
                ]}
              >
                {/* 상단 행 */}
                <View style={styles.cardTop}>
                  <View style={[styles.poolIcon, { backgroundColor: isActive ? "#E8F7F6" : "#F3F0EE" }]}>
                    {p.logo_emoji ? (
                      <Text style={styles.poolIconEmoji}>{p.logo_emoji}</Text>
                    ) : (
                      <Droplet size={22} color={isActive ? TINT : C.textMuted} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.nameLine}>
                      <Text style={[styles.poolName, { color: C.text }]} numberOfLines={1}>{p.name}</Text>
                      {isActive && (
                        <View style={[styles.activeBadge, { backgroundColor: TINT }]}>
                          <Text style={styles.activeBadgeTxt}>현재</Text>
                        </View>
                      )}
                      {p.is_primary && !isActive && (
                        <View style={[styles.primaryBadge, { borderColor: TINT }]}>
                          <Text style={[styles.primaryBadgeTxt, { color: TINT }]}>기본</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.metaRow}>
                      <View style={[styles.statusPill, { backgroundColor: statusColor(p.subscription_status) + "22" }]}>
                        <Text style={[styles.statusTxt, { color: statusColor(p.subscription_status) }]}>
                          {statusLabel(p.subscription_status)}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: approvalColor(p.approval_status) + "18" }]}>
                        <Text style={[styles.statusTxt, { color: approvalColor(p.approval_status) }]}>
                          {approvalLabel(p.approval_status)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {isSwitching ? (
                    <ActivityIndicator size="small" color={TINT} />
                  ) : !isActive ? (
                    <View style={styles.switchArrow}>
                      <LogIn size={18} color={C.textSecondary} />
                      <Text style={[styles.switchTxt, { color: C.textSecondary }]}>전환</Text>
                    </View>
                  ) : null}
                </View>

                {/* 하단 정보 */}
                {(p.address || p.phone) && (
                  <View style={[styles.cardBottom, { borderTopColor: C.border }]}>
                    {p.address ? (
                      <View style={styles.infoRow}>
                        <MapPin size={12} color={C.textMuted} />
                        <Text style={[styles.infoTxt2, { color: C.textSecondary }]} numberOfLines={1}>{p.address}</Text>
                      </View>
                    ) : null}
                    {p.phone ? (
                      <View style={styles.infoRow}>
                        <Phone size={12} color={C.textMuted} />
                        <Text style={[styles.infoTxt2, { color: C.textSecondary }]}>{p.phone}</Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* 새 수영장 추가 모달 */}
      <ModalSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        title="새 수영장 추가"
      >
        {formError ? <Text style={[styles.errTxt, { color: C.error }]}>{formError}</Text> : null}

        {[
          { key: "name" as const, label: "수영장 이름 *", placeholder: "예: 한강 수영장 분당점" },
          { key: "address" as const, label: "주소 (선택)", placeholder: "경기도 성남시..." },
          { key: "phone" as const, label: "전화번호 (선택)", placeholder: "031-000-0000" },
        ].map(({ key, label, placeholder }) => (
          <View key={key} style={styles.field}>
            <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>{label}</Text>
            <TextInput
              style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
              value={form[key]}
              onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
              placeholder={placeholder}
              placeholderTextColor={C.textMuted}
            />
          </View>
        ))}

        {currentPool && (
          <View style={[styles.copySection, { borderColor: C.border, backgroundColor: C.background }]}>
            <Text style={[styles.copyTitle, { color: C.text }]}>현재 수영장에서 복사</Text>
            <Text style={[styles.copyDesc, { color: C.textMuted }]}>"{currentPool.name}"의 설정을 새 수영장에 복사할 수 있습니다</Text>
            {(["levels", "pricing"] as CopyOption[]).map(opt => (
              <Pressable key={opt} onPress={() => toggleCopy(opt)} style={styles.copyRow}>
                <View style={[styles.checkbox, { borderColor: copyOptions.has(opt) ? TINT : C.border, backgroundColor: copyOptions.has(opt) ? TINT : "transparent" }]}>
                  {copyOptions.has(opt) && <Check size={13} color="#fff" />}
                </View>
                <Text style={[styles.copyLabel, { color: C.text }]}>
                  {opt === "levels" ? "수준 체계 (레벨 설정)" : "수업료 요금표"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.saveBtn, { backgroundColor: TINT, opacity: pressed ? 0.85 : 1 }]}
          onPress={handleCreate}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnTxt}>수영장 만들기</Text>}
        </Pressable>
      </ModalSheet>

      {/* 확인 모달 */}
      <ConfirmModal
        visible={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        confirmText="전환하기"
        onConfirm={() => { const fn = confirmAction?.onConfirm; setConfirmAction(null); fn?.(); }}
        onCancel={() => setConfirmAction(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginHorizontal: 20, marginBottom: 14, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoTxt: { flex: 1, fontSize: 12.5, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  countRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  countTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  activeTxt: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptyDesc: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  card: { borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  poolIcon: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  poolIconEmoji: { fontSize: 24 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  poolName: { fontSize: 16, fontFamily: "Pretendard-Regular", flexShrink: 1 },
  activeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  activeBadgeTxt: { color: "#fff", fontSize: 11, fontFamily: "Pretendard-Regular" },
  primaryBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  primaryBadgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  metaRow: { flexDirection: "row", gap: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  switchArrow: { alignItems: "center", gap: 3 },
  switchTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  cardBottom: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 5 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  infoTxt2: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  errTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Pretendard-Regular" },
  copySection: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  copyTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  copyDesc: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  copyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  copyLabel: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  saveBtn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnTxt: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
