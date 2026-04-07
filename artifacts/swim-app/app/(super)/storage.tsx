/**
 * (super)/storage.tsx — 저장공간 관리
 * 80%경고 / 95%차단예정(CTA) / 100%차단 — 과금 유도형 흐름
 * /super/storage-list API 실데이터 연결
 */
import { CircleAlert, CircleArrowUp, CirclePlus, Clock, DollarSign, HardDrive, Lock, Settings, TrendingUp } from "lucide-react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { OtpGateModal } from "@/components/common/OtpGateModal";
import Colors from "@/constants/colors";

const C = Colors.light;
const GREEN = "#2EC4B6";
const WARN  = "#D97706";
const DANGER= "#D96C6C";

interface StorageRow {
  id: string;
  name: string;
  owner_name: string | null;
  base_storage_gb: number;
  extra_storage_gb: number;
  used_storage_bytes: number;
  total_storage_gb: number;
  usage_pct: number;
  upload_blocked: boolean;
}

const TABS = [
  { key: "all",       label: "전체" },
  { key: "blocked95", label: "차단 예정" },
  { key: "warning80", label: "경고" },
];

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / 1048576;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1073741824).toFixed(1)} GB`;
}

function fmtGb(gb: number): string {
  if (!gb || gb === 0) return "0 GB";
  return `${gb.toFixed(1)} GB`;
}

function estimateCost(extraGb: number): string {
  const cost = Math.ceil(extraGb / 10) * 9900;
  return `₩${cost.toLocaleString('ko-KR')}/월`;
}

function getStage(pct: number, blocked: boolean): 'normal' | 'warn80' | 'danger95' | 'blocked100' {
  if (blocked || pct >= 100) return 'blocked100';
  if (pct >= 95) return 'danger95';
  if (pct >= 80) return 'warn80';
  return 'normal';
}

export default function StorageScreen() {
  const { adminUser, token } = useAuth();
  const { operatorId: paramOpId } = useLocalSearchParams<{ operatorId?: string }>();

  const [rows, setRows]           = useState<StorageRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]             = useState("all");
  const [editOp, setEditOp]       = useState<StorageRow | null>(null);
  const [newStorageGb, setNewStorageGb] = useState("");
  const [saving, setSaving]       = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [ctaModal, setCtaModal]   = useState<StorageRow | null>(null);
  const [otpVisible, setOtpVisible] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/super/storage-list");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setRows(data as StorageRow[]);
    } catch { /* silent */ }
  }, [token]);

  // 화면 진입·재진입 시 저장공간 현황 재조회
  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchRows().finally(() => setLoading(false));
  }, [fetchRows]));

  useEffect(() => {
    if (!paramOpId || rows.length === 0) return;
    const target = rows.find(r => r.id === paramOpId);
    if (target) { setEditOp(target); setNewStorageGb("0"); }
  }, [paramOpId, rows]);

  async function onRefresh() {
    setRefreshing(true);
    await fetchRows();
    setRefreshing(false);
  }

  const filtered = useMemo(() => {
    if (tab === "blocked95") return rows.filter(r => r.usage_pct >= 95 || r.upload_blocked);
    if (tab === "warning80") return rows.filter(r => r.usage_pct >= 80 && r.usage_pct < 95 && !r.upload_blocked);
    return rows;
  }, [rows, tab]);

  const counts = useMemo(() => ({
    all:       rows.length,
    blocked95: rows.filter(r => r.usage_pct >= 95 || r.upload_blocked).length,
    warning80: rows.filter(r => r.usage_pct >= 80 && r.usage_pct < 95 && !r.upload_blocked).length,
  }), [rows]);

  async function handleSave() {
    if (!editOp || !token) return;
    const addGb = parseFloat(newStorageGb);
    if (isNaN(addGb) || addGb < 0) return;
    setSaving(true);
    try {
      const newExtra = (editOp.extra_storage_gb || 0) + addGb;
      const res = await apiRequest(token, `/super/storage/${editOp.id}`, {
        method: "PUT",
        body: JSON.stringify({ extra_storage_gb: Math.round(newExtra) }),
      });
      if (res.ok) {
        await fetchRows();
        setEditOp(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deferDeletion(r: StorageRow) {
    if (!token) return;
    setActionLoading(r.id);
    try {
      await apiRequest(token, `/super/operators/${r.id}/defer-deletion`, {
        method: "POST",
        body: JSON.stringify({ hours: 48 }),
      });
      await fetchRows();
    } finally {
      setActionLoading(null);
    }
  }

  async function doEmergencyOverride(r: StorageRow) {
    if (!token) return;
    setActionLoading(r.id + "_override");
    try {
      const newExtra = (r.extra_storage_gb || 0) + 1;
      await apiRequest(token, `/super/storage/${r.id}`, {
        method: "PUT",
        body: JSON.stringify({ extra_storage_gb: newExtra }),
      });
      await fetchRows();
    } finally {
      setActionLoading(null);
    }
  }

  const renderItem = ({ item: r }: { item: StorageRow }) => {
    const stage = getStage(r.usage_pct, r.upload_blocked);
    const barColor = stage === 'blocked100' ? DANGER : stage === 'danger95' ? DANGER : stage === 'warn80' ? WARN : GREEN;
    const usedMb   = r.used_storage_bytes / 1048576;
    const totalMb  = r.total_storage_gb * 1024;
    const extraNeededGb = Math.max(0, Math.ceil(((usedMb / 1024) - r.total_storage_gb * 0.9)));

    return (
      <View style={[s.row,
        stage === 'blocked100' && s.rowBlocked,
        stage === 'danger95'   && s.rowDanger,
        stage === 'warn80'     && s.rowWarn,
      ]}>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Pressable onPress={() => { setEditOp(r); setNewStorageGb("0"); }}>
              <Text style={[s.opName, { textDecorationLine: "underline" }]}>{r.name}</Text>
            </Pressable>
            {stage === 'blocked100' && <View style={s.blockedTag}><Text style={s.blockedTagTxt}>업로드 차단</Text></View>}
            {stage === 'danger95'   && <View style={s.dangerTag}><Text style={s.dangerTagTxt}>차단 예정</Text></View>}
            {stage === 'warn80'     && <View style={s.warnTag}><Text style={s.warnTagTxt}>80% 경고</Text></View>}
          </View>

          <View style={s.barRow}>
            <View style={s.barBg}>
              <View style={[s.barFill, { width: `${Math.min(r.usage_pct, 100)}%` as any, backgroundColor: barColor }]} />
              <View style={[s.barMark, { left: "80%" }]} />
              <View style={[s.barMark, { left: "95%", backgroundColor: DANGER }]} />
            </View>
            <Text style={[s.pctTxt, { color: barColor }]}>{r.usage_pct.toFixed(0)}%</Text>
          </View>

          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{fmtBytes(r.used_storage_bytes)} / {fmtGb(r.total_storage_gb)}</Text>
          </View>

          {stage === 'danger95' && (
            <View style={s.ctaBar}>
              <CircleAlert size={11} color={DANGER} />
              <Text style={s.ctaBarTxt}>
                {extraNeededGb > 0 ? `약 ${extraNeededGb}GB 추가 필요 · 예상 비용 ${estimateCost(extraNeededGb)}` : '추가 용량 구매 또는 상위 플랜 업그레이드'}
              </Text>
              <Pressable style={s.ctaCta} onPress={() => setCtaModal(r)}>
                <Text style={s.ctaCtaTxt}>CTA</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={s.rowActions}>
          {(stage === 'danger95' || stage === 'blocked100') && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#ECFEFF" }]}
              onPress={() => doEmergencyOverride(r)} disabled={actionLoading === r.id + "_override"}>
              {actionLoading === r.id + "_override"
                ? <ActivityIndicator size="small" color={GREEN} />
                : <Text style={[s.actionTxt, { color: GREEN }]}>24h허용</Text>}
            </Pressable>
          )}
          <Pressable style={[s.actionBtn, { backgroundColor: "#E6FFFA" }]}
            onPress={() => { setEditOp(r); setNewStorageGb("0"); }}>
            <Text style={[s.actionTxt, { color: GREEN }]}>용량↑</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="저장공간 관리" homePath="/(super)/op-group"
        rightSlot={
          <Pressable onPress={() => router.push("/(super)/storage-policy?backTo=storage" as any)}
            style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
            <Settings size={18} color="#64748B" />
          </Pressable>
        }
      />

      <View style={s.policyBanner}>
        <Text style={s.policyBannerTxt}>
          <Text style={{ fontFamily: "Pretendard-Regular" }}>80%</Text> 경고 → <Text style={{ fontFamily: "Pretendard-Regular" }}>95%</Text> 차단 예정(CTA) → <Text style={{ fontFamily: "Pretendard-Regular" }}>100%</Text> 업로드 차단
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4 }}>
        {TABS.map(t => {
          const isActive = tab === t.key;
          const cnt = counts[t.key as keyof typeof counts] ?? 0;
          return (
            <Pressable key={t.key} style={[s.tab, isActive && s.tabActive]} onPress={() => setTab(t.key)}>
              <Text style={[s.tabTxt, isActive && s.tabTxtActive]}>{t.label}</Text>
              {cnt > 0 && t.key !== "all" && (
                <View style={[s.tabBadge, isActive && { backgroundColor: GREEN }]}>
                  <Text style={[s.tabBadgeTxt, isActive && { color: "#fff" }]}>{cnt}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === "blocked95" && (
        <View style={[s.spikeBanner, { backgroundColor: "#FFF3CD" }]}>
          <CircleAlert size={13} color={WARN} />
          <Text style={[s.spikeBannerTxt, { color: "#7C2D12" }]}>95% 초과 — 추가 용량 구매 또는 플랜 업그레이드를 유도하세요. 차단 예정 상태입니다.</Text>
        </View>
      )}

      {loading && !refreshing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={GREEN} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={GREEN} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#FFFFFF" }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <HardDrive size={30} color="#D1D5DB" />
              <Text style={s.emptyTxt}>{TABS.find(t2 => t2.key === tab)?.label} 운영자 없음</Text>
            </View>
          }
        />
      )}

      {editOp && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditOp(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditOp(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editOp.name}</Text>
              <Text style={m.sub}>현재 {editOp.usage_pct.toFixed(0)}% 사용 · {fmtBytes(editOp.used_storage_bytes)} / {fmtGb(editOp.total_storage_gb)}</Text>

              <View style={m.infoBar}>
                <View style={m.barBg}>
                  <View style={[m.barFill, { width: `${Math.min(editOp.usage_pct, 100)}%` as any, backgroundColor: editOp.usage_pct >= 95 ? DANGER : GREEN }]} />
                </View>
              </View>

              <View style={m.section}>
                <Text style={m.label}>추가 용량 (GB)</Text>
                <View style={m.qtyRow}>
                  {[0, 5, 10, 20, 50].map(v => (
                    <Pressable key={v} style={[m.qtyBtn, newStorageGb === v.toString() && m.qtyBtnActive]}
                      onPress={() => setNewStorageGb(v.toString())}>
                      <Text style={[m.qtyTxt, newStorageGb === v.toString() && { color: "#fff" }]}>{v}GB</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput style={m.input} value={newStorageGb} onChangeText={setNewStorageGb}
                  keyboardType="decimal-pad" placeholder="직접 입력 (GB)" placeholderTextColor="#64748B" />
                {parseFloat(newStorageGb) > 0 && (
                  <View style={m.costEstimate}>
                    <DollarSign size={13} color={GREEN} />
                    <Text style={m.costTxt}>예상 추가 비용: {estimateCost(parseFloat(newStorageGb))}</Text>
                  </View>
                )}
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditOp(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={() => setOtpVisible(true)} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Lock size={13} color="#fff" />
                      <Text style={m.saveTxt}>용량 추가</Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <OtpGateModal
        visible={otpVisible}
        token={token}
        title="용량 추가 OTP 인증"
        desc="슈퍼관리자의 직접 용량 부여는 OTP 인증 후에 처리됩니다."
        onSuccess={() => { setOtpVisible(false); handleSave(); }}
        onCancel={() => setOtpVisible(false)}
      />

      {ctaModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCtaModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setCtaModal(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{ctaModal.name}</Text>
              <Text style={m.sub}>{ctaModal.usage_pct.toFixed(0)}% 사용 — 차단 예정 상태</Text>

              <View style={m.ctaOption}>
                <CirclePlus size={20} color={GREEN} />
                <View style={{ flex: 1 }}>
                  <Text style={m.ctaOptionTitle}>추가 용량 구매</Text>
                  <Text style={m.ctaOptionDesc}>10GB 단위 추가 · 예상 ₩9,900/월 ~</Text>
                </View>
                <Pressable style={[m.ctaBtn, { backgroundColor: GREEN }]}
                  onPress={() => { setCtaModal(null); setEditOp(ctaModal); setNewStorageGb("10"); }}>
                  <Text style={m.ctaBtnTxt}>구매</Text>
                </Pressable>
              </View>

              <View style={m.ctaOption}>
                <CircleArrowUp size={20} color="#7C3AED" />
                <View style={{ flex: 1 }}>
                  <Text style={m.ctaOptionTitle}>상위 플랜 업그레이드</Text>
                  <Text style={m.ctaOptionDesc}>더 많은 저장공간 · 추가 기능 포함</Text>
                </View>
                <Pressable style={[m.ctaBtn, { backgroundColor: C.button }]}
                  onPress={() => { setCtaModal(null); router.push("/(super)/subscriptions?backTo=storage" as any); }}>
                  <Text style={m.ctaBtnTxt}>업그레이드</Text>
                </Pressable>
              </View>

              <View style={m.ctaOption}>
                <Clock size={20} color="#2EC4B6" />
                <View style={{ flex: 1 }}>
                  <Text style={m.ctaOptionTitle}>긴급 업로드 허용 24h</Text>
                  <Text style={m.ctaOptionDesc}>임시 1GB 추가 · 관리자 override</Text>
                </View>
                <Pressable style={[m.ctaBtn, { backgroundColor: "#2EC4B6" }]}
                  onPress={() => { doEmergencyOverride(ctaModal); setCtaModal(null); }}>
                  <Text style={m.ctaBtnTxt}>허용</Text>
                </Pressable>
              </View>

              <Pressable style={m.cancelBtnFull} onPress={() => setCtaModal(null)}>
                <Text style={m.cancelTxt}>닫기</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#DFF3EC" },
  policyBanner:   { flexDirection: "row", backgroundColor: "#F0F9FF", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#BAE6FD" },
  policyBannerTxt:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0369A1" },
  tabBar:         { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tab:            { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  tabActive:      { backgroundColor: "#E6FFFA" },
  tabTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTxtActive:   { color: GREEN, fontFamily: "Pretendard-Regular" },
  tabBadge:       { backgroundColor: "#F9DEDA", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 7 },
  tabBadgeTxt:    { fontSize: 10, fontFamily: "Pretendard-Regular", color: DANGER },
  spikeBanner:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF1BF", paddingHorizontal: 14, paddingVertical: 9 },
  spikeBannerTxt: { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 16 },
  row:            { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowBlocked:     { borderLeftWidth: 4, borderLeftColor: DANGER, backgroundColor: "#FFF5F5" },
  rowDanger:      { borderLeftWidth: 3, borderLeftColor: WARN },
  rowWarn:        { borderLeftWidth: 3, borderLeftColor: "#FCD34D" },
  rowMain:        { flex: 1, gap: 4 },
  rowTop:         { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  opName:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  blockedTag:     { backgroundColor: "#F9DEDA", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  blockedTagTxt:  { fontSize: 9, fontFamily: "Pretendard-Regular", color: DANGER },
  dangerTag:      { backgroundColor: "#FFF1BF", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  dangerTagTxt:   { fontSize: 9, fontFamily: "Pretendard-Regular", color: WARN },
  warnTag:        { backgroundColor: "#FEF9C3", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  warnTagTxt:     { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#CA8A04" },
  barRow:         { flexDirection: "row", alignItems: "center", gap: 6 },
  barBg:          { flex: 1, height: 7, borderRadius: 3.5, backgroundColor: "#FFFFFF", overflow: "hidden", position: "relative" },
  barFill:        { height: 7, borderRadius: 3.5 },
  barMark:        { position: "absolute", top: 0, bottom: 0, width: 1.5, backgroundColor: WARN, opacity: 0.5 },
  pctTxt:         { fontSize: 12, fontFamily: "Pretendard-Regular", width: 34, textAlign: "right" },
  rowMeta:        { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  ctaBar:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF1BF",
                    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: "#FED7AA" },
  ctaBarTxt:      { flex: 1, fontSize: 10, fontFamily: "Pretendard-Regular", color: "#9A3412" },
  ctaCta:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: WARN },
  ctaCtaTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#fff" },
  rowActions:     { gap: 6 },
  actionBtn:      { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, minWidth: 44, alignItems: "center" },
  actionTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  empty:          { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const m = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:          { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "80%", gap: 14 },
  handle:         { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:          { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:            { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -8 },
  infoBar:        { marginVertical: 4 },
  barBg:          { height: 8, borderRadius: 4, backgroundColor: "#FFFFFF", overflow: "hidden" },
  barFill:        { height: 8 },
  section:        { gap: 8 },
  label:          { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  qtyRow:         { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  qtyBtn:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#E5E7EB" },
  qtyBtnActive:   { backgroundColor: GREEN, borderColor: GREEN },
  qtyTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  input:          { backgroundColor: "#F1F5F9", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  costEstimate:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#E6FFFA", padding: 8, borderRadius: 8 },
  costTxt:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#065F46" },
  btnRow:         { flexDirection: "row", gap: 10 },
  cancelBtn:      { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  saveBtn:        { flex: 1, padding: 14, borderRadius: 12, backgroundColor: GREEN, alignItems: "center" },
  saveTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  ctaOption:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  ctaOptionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  ctaOptionDesc:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  ctaBtn:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  ctaBtnTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  cancelBtnFull:  { padding: 14, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center" },
});
