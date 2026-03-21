/**
 * (super)/storage.tsx — 저장공간 관리
 * 80%경고 / 95%차단예정(CTA) / 100%차단 — 과금 유도형 흐름
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useStorageStore } from "@/store/storageStore";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { StoragePolicy } from "@/domain/types";

const GREEN = "#059669";
const WARN  = "#D97706";
const DANGER= "#DC2626";

const TABS = [
  { key: "all",       label: "전체" },
  { key: "blocked95", label: "차단 예정" },
  { key: "warning80", label: "경고" },
  { key: "spike",     label: "급증" },
  { key: "deletion",  label: "삭제 예정" },
];

function fmtMb(mb: number): string {
  if (!mb || mb === 0) return "0 MB";
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function hoursLeft(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  return `${h}h 후 삭제`;
}

// 사용률 단계 계산
function getStorageStage(pct: number): 'normal' | 'warn80' | 'danger95' | 'blocked100' {
  if (pct >= 100) return 'blocked100';
  if (pct >= 95)  return 'danger95';
  if (pct >= 80)  return 'warn80';
  return 'normal';
}

// 예상 추가 비용 계산 (10GB = ₩9,900/월 기준)
function estimateCost(extraGb: number): string {
  const cost = Math.ceil(extraGb / 10) * 9900;
  return `₩${cost.toLocaleString('ko-KR')}/월`;
}

export default function StorageScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const policies         = useStorageStore(s => s.policies);
  const storageTab       = useStorageStore(s => s.storageTab);
  const setStorageTab    = useStorageStore(s => s.setStorageTab);
  const setStoragePolicy = useStorageStore(s => s.setStoragePolicy);
  const getByTab         = useStorageStore(s => s.getByTab);

  const scheduleAutoDelete = useOperatorsStore(s => s.scheduleAutoDelete);
  const updateOperator     = useOperatorsStore(s => s.updateOperator);
  const createLog          = useAuditLogStore(s => s.createLog);

  const [refreshing,    setRefreshing]    = useState(false);
  const [editOp,        setEditOp]        = useState<StoragePolicy | null>(null);
  const [newStorageMb,  setNewStorageMb]  = useState("");
  const [saving,        setSaving]        = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [ctaModal,      setCtaModal]      = useState<StoragePolicy | null>(null);
  const [overrideLoading, setOverrideLoading] = useState<string | null>(null);

  const tab      = storageTab;
  const filtered = useMemo(() => getByTab(), [policies, storageTab]);

  const counts = useMemo(() => ({
    all:       policies.length,
    blocked95: policies.filter(p => p.isBlocked95).length,
    warning80: policies.filter(p => p.isWarning80 && !p.isBlocked95).length,
    spike:     policies.filter(p => p.uploadSpikeFlag).length,
    deletion:  policies.filter(p => !!p.autoDeleteScheduledAt).length,
  }), [policies]);

  function handleSave() {
    if (!editOp) return;
    const mb = parseFloat(newStorageMb) * 1024;
    if (isNaN(mb) || mb < 0) return;
    setSaving(true);
    setStoragePolicy(editOp.operatorId, { extraMb: Math.round(mb) });
    createLog({ category: '저장공간', title: `추가 용량 부여: ${editOp.operatorName} +${newStorageMb}GB`, detail: `+${newStorageMb}GB 추가 / 과금 유도`, actorName, impact: 'medium', operatorId: editOp.operatorId, operatorName: editOp.operatorName });
    setSaving(false); setEditOp(null);
  }

  function deferDeletion(p: StoragePolicy) {
    setActionLoading(p.operatorId);
    const at = new Date(Date.now() + 48 * 3600000).toISOString();
    scheduleAutoDelete(p.operatorId, at);
    createLog({ category: '저장공간', title: `삭제 유예 48h: ${p.operatorName}`, detail: '48시간 유예 설정', actorName, impact: 'medium', operatorId: p.operatorId, operatorName: p.operatorName });
    setTimeout(() => setActionLoading(null), 500);
  }

  function doEmergencyOverride(p: StoragePolicy) {
    setOverrideLoading(p.operatorId);
    const until = new Date(Date.now() + 24 * 3600000).toISOString();
    updateOperator(p.operatorId, { storageOverrideUntil: until, storageOverrideBy: actorName } as any);
    setStoragePolicy(p.operatorId, { extraMb: 1024 }); // 임시 1GB 추가
    createLog({ category: '저장공간', title: `긴급 업로드 허용 24h: ${p.operatorName}`, detail: '관리자 override — 임시 1GB 추가, 24시간 후 자동 원복', actorName, impact: 'high', operatorId: p.operatorId, operatorName: p.operatorName });
    setTimeout(() => setOverrideLoading(null), 500);
  }

  const renderItem = ({ item: p }: { item: StoragePolicy }) => {
    const stage = getStorageStage(p.usedPercent);
    const barColor = stage === 'blocked100' ? DANGER : stage === 'danger95' ? DANGER : stage === 'warn80' ? WARN : GREEN;
    const isDeletion = !!p.autoDeleteScheduledAt;
    const extraNeededGb = Math.max(0, Math.ceil((p.usedMb - p.totalMb * 0.9) / 1024));

    return (
      <View style={[s.row,
        stage === 'blocked100' && s.rowBlocked,
        stage === 'danger95'   && s.rowDanger,
        stage === 'warn80'     && s.rowWarn,
      ]}>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Pressable onPress={() => router.push(`/(super)/operator-detail?id=${p.operatorId}` as any)}>
              <Text style={s.opName}>{p.operatorName}</Text>
            </Pressable>
            {stage === 'blocked100' && <View style={s.blockedTag}><Text style={s.blockedTagTxt}>업로드 차단</Text></View>}
            {stage === 'danger95'   && <View style={s.dangerTag}><Text style={s.dangerTagTxt}>차단 예정</Text></View>}
            {stage === 'warn80'     && <View style={s.warnTag}><Text style={s.warnTagTxt}>80% 경고</Text></View>}
            {p.uploadSpikeFlag && (
              <View style={s.spikeTag}><Feather name="trending-up" size={9} color={WARN} /><Text style={s.spikeTxt}>급증</Text></View>
            )}
          </View>

          <View style={s.barRow}>
            <View style={s.barBg}>
              <View style={[s.barFill, { width: `${Math.min(p.usedPercent, 100)}%` as any, backgroundColor: barColor }]} />
              {/* 80% 마크 */}
              <View style={[s.barMark, { left: "80%" }]} />
              {/* 95% 마크 */}
              <View style={[s.barMark, { left: "95%", backgroundColor: DANGER }]} />
            </View>
            <Text style={[s.pctTxt, { color: barColor }]}>{p.usedPercent.toFixed(0)}%</Text>
          </View>

          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{fmtMb(p.usedMb)} / {fmtMb(p.totalMb)}</Text>
            {isDeletion && <><Text style={s.metaDot}>·</Text>
              <Text style={[s.metaTxt, { color: DANGER, fontFamily: "Inter_700Bold" }]}>{hoursLeft(p.autoDeleteScheduledAt)}</Text></>}
          </View>

          {/* 과금 유도 CTA — 95% 이상 */}
          {stage === 'danger95' && (
            <View style={s.ctaBar}>
              <Feather name="alert-circle" size={11} color={DANGER} />
              <Text style={s.ctaBarTxt}>
                {extraNeededGb > 0 ? `약 ${extraNeededGb}GB 추가 필요 · 예상 비용 ${estimateCost(extraNeededGb)}` : '추가 용량 구매 또는 상위 플랜 업그레이드'}
              </Text>
              <Pressable style={s.ctaCta} onPress={() => setCtaModal(p)}>
                <Text style={s.ctaCtaTxt}>CTA</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={s.rowActions}>
          {isDeletion && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#FEF3C7" }]}
              onPress={() => deferDeletion(p)} disabled={actionLoading === p.operatorId}>
              {actionLoading === p.operatorId
                ? <ActivityIndicator size="small" color={WARN} />
                : <Text style={[s.actionTxt, { color: WARN }]}>유예</Text>}
            </Pressable>
          )}
          {stage === 'danger95' || stage === 'blocked100' ? (
            <Pressable style={[s.actionBtn, { backgroundColor: "#ECFEFF" }]}
              onPress={() => doEmergencyOverride(p)} disabled={overrideLoading === p.operatorId}>
              {overrideLoading === p.operatorId
                ? <ActivityIndicator size="small" color="#0891B2" />
                : <Text style={[s.actionTxt, { color: "#0891B2" }]}>24h허용</Text>}
            </Pressable>
          ) : null}
          <Pressable style={[s.actionBtn, { backgroundColor: "#D1FAE5" }]}
            onPress={() => { setEditOp(p); setNewStorageMb("0"); }}>
            <Text style={[s.actionTxt, { color: GREEN }]}>용량↑</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="저장공간 관리" homePath="/(super)/dashboard"
        rightSlot={
          <Pressable onPress={() => router.push("/(super)/storage-policy" as any)}
            style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
            <Feather name="settings" size={18} color="#6B7280" />
          </Pressable>
        }
      />

      {/* 정책 배너 */}
      <View style={s.policyBanner}>
        <Text style={s.policyBannerTxt}>
          <Text style={{ fontFamily: "Inter_700Bold" }}>80%</Text> 경고 → <Text style={{ fontFamily: "Inter_700Bold" }}>95%</Text> 차단 예정(CTA) → <Text style={{ fontFamily: "Inter_700Bold" }}>100%</Text> 업로드 차단
        </Text>
      </View>

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4 }}>
        {TABS.map(t => {
          const isActive = tab === t.key;
          const cnt = counts[t.key as keyof typeof counts] ?? 0;
          return (
            <Pressable key={t.key} style={[s.tab, isActive && s.tabActive]} onPress={() => setStorageTab(t.key)}>
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

      {/* 탭별 안내 배너 */}
      {tab === "spike" && (
        <View style={s.spikeBanner}>
          <Feather name="trending-up" size={13} color={WARN} />
          <Text style={s.spikeBannerTxt}>7일 내 업로드 급증 운영자입니다. 비정상 사용 여부를 확인하세요.</Text>
        </View>
      )}
      {tab === "blocked95" && (
        <View style={[s.spikeBanner, { backgroundColor: "#FFF3CD" }]}>
          <Feather name="alert-circle" size={13} color={WARN} />
          <Text style={[s.spikeBannerTxt, { color: "#7C2D12" }]}>95% 초과 — 추가 용량 구매 또는 플랜 업그레이드를 유도하세요. 차단 예정 상태입니다.</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={p => p.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={GREEN}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="hard-drive" size={30} color="#D1D5DB" />
            <Text style={s.emptyTxt}>{TABS.find(t => t.key === tab)?.label} 운영자 없음</Text>
          </View>
        }
      />

      {/* 용량 추가 모달 */}
      {editOp && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditOp(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditOp(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editOp.operatorName}</Text>
              <Text style={m.sub}>현재 {editOp.usedPercent.toFixed(0)}% 사용 · {fmtMb(editOp.usedMb)} / {fmtMb(editOp.totalMb)}</Text>

              <View style={m.infoBar}>
                <View style={m.barBg}>
                  <View style={[m.barFill, { width: `${Math.min(editOp.usedPercent, 100)}%` as any, backgroundColor: editOp.isBlocked95 ? DANGER : GREEN }]} />
                </View>
              </View>

              <View style={m.section}>
                <Text style={m.label}>추가 용량 (GB)</Text>
                <View style={m.qtyRow}>
                  {[0, 5, 10, 20, 50].map(v => (
                    <Pressable key={v} style={[m.qtyBtn, newStorageMb === v.toString() && m.qtyBtnActive]}
                      onPress={() => setNewStorageMb(v.toString())}>
                      <Text style={[m.qtyTxt, newStorageMb === v.toString() && { color: "#fff" }]}>{v}GB</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput style={m.input} value={newStorageMb} onChangeText={setNewStorageMb}
                  keyboardType="decimal-pad" placeholder="직접 입력 (GB)" placeholderTextColor="#9CA3AF" />
                {parseFloat(newStorageMb) > 0 && (
                  <View style={m.costEstimate}>
                    <Feather name="dollar-sign" size={13} color={GREEN} />
                    <Text style={m.costTxt}>예상 추가 비용: {estimateCost(parseFloat(newStorageMb))}</Text>
                  </View>
                )}
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditOp(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>용량 추가</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 과금 유도 CTA 모달 */}
      {ctaModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCtaModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setCtaModal(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{ctaModal.operatorName}</Text>
              <Text style={m.sub}>{ctaModal.usedPercent.toFixed(0)}% 사용 — 차단 예정 상태</Text>

              <View style={m.ctaOption}>
                <Feather name="plus-circle" size={20} color={GREEN} />
                <View style={{ flex: 1 }}>
                  <Text style={m.ctaOptionTitle}>추가 용량 구매</Text>
                  <Text style={m.ctaOptionDesc}>10GB 단위 추가 · 예상 ₩9,900/월 ~</Text>
                </View>
                <Pressable style={[m.ctaBtn, { backgroundColor: GREEN }]}
                  onPress={() => { setCtaModal(null); setEditOp(ctaModal); setNewStorageMb("10"); }}>
                  <Text style={m.ctaBtnTxt}>구매</Text>
                </Pressable>
              </View>

              <View style={m.ctaOption}>
                <Feather name="arrow-up-circle" size={20} color="#7C3AED" />
                <View style={{ flex: 1 }}>
                  <Text style={m.ctaOptionTitle}>상위 플랜 업그레이드</Text>
                  <Text style={m.ctaOptionDesc}>더 많은 저장공간 · 추가 기능 포함</Text>
                </View>
                <Pressable style={[m.ctaBtn, { backgroundColor: "#7C3AED" }]}
                  onPress={() => { setCtaModal(null); router.push("/(super)/subscriptions" as any); }}>
                  <Text style={m.ctaBtnTxt}>업그레이드</Text>
                </Pressable>
              </View>

              <View style={m.ctaOption}>
                <Feather name="clock" size={20} color="#0891B2" />
                <View style={{ flex: 1 }}>
                  <Text style={m.ctaOptionTitle}>긴급 업로드 허용 24h</Text>
                  <Text style={m.ctaOptionDesc}>임시 1GB 추가 · 관리자 override</Text>
                </View>
                <Pressable style={[m.ctaBtn, { backgroundColor: "#0891B2" }]}
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
  safe:           { flex: 1, backgroundColor: "#F0FDF4" },
  policyBanner:   { flexDirection: "row", backgroundColor: "#F0F9FF", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#BAE6FD" },
  policyBannerTxt:{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#0369A1" },
  tabBar:         { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:     { paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
  tab:            { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  tabActive:      { backgroundColor: "#D1FAE5" },
  tabTxt:         { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabTxtActive:   { color: GREEN, fontFamily: "Inter_700Bold" },
  tabBadge:       { backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 7 },
  tabBadgeTxt:    { fontSize: 10, fontFamily: "Inter_700Bold", color: DANGER },
  spikeBanner:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", paddingHorizontal: 14, paddingVertical: 9 },
  spikeBannerTxt: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 16 },
  row:            { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowBlocked:     { borderLeftWidth: 4, borderLeftColor: DANGER, backgroundColor: "#FFF5F5" },
  rowDanger:      { borderLeftWidth: 3, borderLeftColor: WARN },
  rowWarn:        { borderLeftWidth: 3, borderLeftColor: "#FCD34D" },
  rowMain:        { flex: 1, gap: 4 },
  rowTop:         { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  opName:         { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  blockedTag:     { backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  blockedTagTxt:  { fontSize: 9, fontFamily: "Inter_700Bold", color: DANGER },
  dangerTag:      { backgroundColor: "#FEF3C7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  dangerTagTxt:   { fontSize: 9, fontFamily: "Inter_700Bold", color: WARN },
  warnTag:        { backgroundColor: "#FEF9C3", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  warnTagTxt:     { fontSize: 9, fontFamily: "Inter_700Bold", color: "#CA8A04" },
  spikeTag:       { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF3C7", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  spikeTxt:       { fontSize: 9, fontFamily: "Inter_700Bold", color: WARN },
  barRow:         { flexDirection: "row", alignItems: "center", gap: 6 },
  barBg:          { flex: 1, height: 7, borderRadius: 3.5, backgroundColor: "#F3F4F6", overflow: "hidden", position: "relative" },
  barFill:        { height: 7, borderRadius: 3.5 },
  barMark:        { position: "absolute", top: 0, bottom: 0, width: 1.5, backgroundColor: WARN, opacity: 0.5 },
  pctTxt:         { fontSize: 12, fontFamily: "Inter_700Bold", width: 34, textAlign: "right" },
  rowMeta:        { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metaDot:        { fontSize: 10, color: "#D1D5DB" },
  ctaBar:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF7ED",
                    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: "#FED7AA" },
  ctaBarTxt:      { flex: 1, fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A3412" },
  ctaCta:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: WARN },
  ctaCtaTxt:      { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  rowActions:     { gap: 6 },
  actionBtn:      { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, minWidth: 44, alignItems: "center" },
  actionTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:          { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:       { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:          { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: "80%", gap: 14 },
  handle:         { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:          { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:            { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: -8 },
  infoBar:        { backgroundColor: "#F3F4F6", borderRadius: 8, padding: 8 },
  barBg:          { height: 8, borderRadius: 4, backgroundColor: "#E5E7EB", overflow: "hidden" },
  barFill:        { height: 8, borderRadius: 4 },
  section:        { gap: 8 },
  label:          { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  qtyRow:         { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  qtyBtn:         { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  qtyBtnActive:   { backgroundColor: GREEN, borderColor: GREEN },
  qtyTxt:         { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  input:          { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                    fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  costEstimate:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#D1FAE5", padding: 10, borderRadius: 10 },
  costTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#065F46" },
  btnRow:         { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:      { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelBtnFull:  { paddingVertical: 12, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center" },
  cancelTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:        { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: GREEN },
  saveTxt:        { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  ctaOption:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12,
                    backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB" },
  ctaOptionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  ctaOptionDesc:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  ctaBtn:         { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  ctaBtnTxt:      { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
});
