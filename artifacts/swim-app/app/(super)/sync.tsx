/**
 * 슈퍼관리자 — 변경분 동기화 관리 화면
 *
 * 구성:
 *   A. 통계 카드 (pending/synced 건수, 마지막 동기화/스냅샷)
 *   B. 테이블별 pending 현황
 *   C. 테넌트별 현황
 *   D. 즉시 실행 버튼 (증분 동기화 / 전체 스냅샷)
 *   E. 스냅샷 이력
 */
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { PageHeader } from "@/components/common/PageHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const ACCENT = "#7C3AED";

function fmtDate(d: string | null) {
  if (!d) return "없음";
  const dt = new Date(d);
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtNum(n: number) {
  return n.toLocaleString("ko-KR");
}

interface SyncStats {
  pending: number;
  synced: number;
  total: number;
  snapshots: number;
  last_synced_at: string | null;
  last_snapshot_at: string | null;
  by_table: { table_name: string; pending: number }[];
}

interface TenantRow {
  tenant_id: string;
  pool_name: string;
  pending: number;
  synced: number;
  last_change_at: string | null;
}

interface SnapshotRow {
  id: string;
  snapshot_type: "incremental" | "full";
  record_count: number;
  created_at: string;
}

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: string | number; icon: any; color: string; sub?: string;
}) {
  return (
    <View style={[s.statCard, { backgroundColor: C.card }]}>
      <View style={[s.statIcon, { backgroundColor: color + "20" }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.statLabel, { color: C.textMuted }]}>{label}</Text>
        <Text style={[s.statValue, { color }]}>{typeof value === "number" ? fmtNum(value) : value}</Text>
        {sub && <Text style={[s.statSub, { color: C.textMuted }]}>{sub}</Text>}
      </View>
    </View>
  );
}

export default function SuperSyncScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [runningSnapshot, setRunningSnapshot] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const [confirmSnapshot, setConfirmSnapshot] = useState(false);

  async function loadAll() {
    try {
      const [sr, tr, snr] = await Promise.all([
        apiRequest(token, "/super/sync/stats").then(r => r.ok ? r.json() : null),
        apiRequest(token, "/super/sync/tenants").then(r => r.ok ? r.json() : []),
        apiRequest(token, "/super/sync/snapshots?limit=10").then(r => r.ok ? r.json() : []),
      ]);
      if (sr) setStats(sr);
      setTenants(tr || []);
      setSnapshots(snr || []);
    } catch {}
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  async function doSync() {
    setConfirmSync(false);
    setRunningSync(true);
    try {
      await apiRequest(token, "/super/sync/run", { method: "POST" });
      await loadAll();
    } catch {} finally { setRunningSync(false); }
  }

  async function doSnapshot() {
    setConfirmSnapshot(false);
    setRunningSnapshot(true);
    try {
      await apiRequest(token, "/super/sync/snapshot", { method: "POST" });
      await loadAll();
    } catch {} finally { setRunningSnapshot(false); }
  }

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <PageHeader title="데이터 동기화" subtitle="서버 기반 변경분 수집 및 스냅샷 관리" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 20 }}
      >
        {/* ─── 통계 개요 ─── */}
        <View style={{ gap: 10 }}>
          <Text style={[s.sectionTitle, { color: C.text }]}>동기화 현황</Text>
          <View style={s.statRow}>
            <StatCard
              label="대기중"
              value={stats?.pending ?? 0}
              icon="clock"
              color="#D97706"
              sub="sync_status=pending"
            />
            <StatCard
              label="완료"
              value={stats?.synced ?? 0}
              icon="check-circle"
              color="#059669"
              sub="sync_status=synced"
            />
          </View>
          <View style={s.statRow}>
            <StatCard
              label="총 변경분"
              value={stats?.total ?? 0}
              icon="database"
              color={ACCENT}
              sub="누적 기록"
            />
            <StatCard
              label="스냅샷"
              value={stats?.snapshots ?? 0}
              icon="archive"
              color="#0EA5E9"
              sub="생성 횟수"
            />
          </View>

          <View style={[s.infoBox, { backgroundColor: C.card }]}>
            <View style={s.infoRow}>
              <Feather name="refresh-cw" size={13} color={C.textMuted} />
              <Text style={[s.infoLabel, { color: C.textMuted }]}>마지막 동기화</Text>
              <Text style={[s.infoVal, { color: C.text }]}>{fmtDate(stats?.last_synced_at ?? null)}</Text>
            </View>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <View style={s.infoRow}>
              <Feather name="archive" size={13} color={C.textMuted} />
              <Text style={[s.infoLabel, { color: C.textMuted }]}>마지막 전체 스냅샷</Text>
              <Text style={[s.infoVal, { color: C.text }]}>{fmtDate(stats?.last_snapshot_at ?? null)}</Text>
            </View>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <View style={s.infoRow}>
              <Feather name="clock" size={13} color={C.textMuted} />
              <Text style={[s.infoLabel, { color: C.textMuted }]}>자동 실행</Text>
              <Text style={[s.infoVal, { color: C.text }]}>증분 매일 03:00 · 전체 매주 일 02:00</Text>
            </View>
          </View>
        </View>

        {/* ─── 즉시 실행 버튼 ─── */}
        <View style={{ gap: 10 }}>
          <Text style={[s.sectionTitle, { color: C.text }]}>즉시 실행</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              style={({ pressed }) => [s.runBtn, { backgroundColor: "#D97706", opacity: pressed || runningSync ? 0.8 : 1, flex: 1 }]}
              onPress={() => setConfirmSync(true)}
              disabled={runningSync}
            >
              {runningSync
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="refresh-cw" size={16} color="#fff" />}
              <Text style={s.runBtnTxt}>증분 동기화</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.runBtn, { backgroundColor: "#0EA5E9", opacity: pressed || runningSnapshot ? 0.8 : 1, flex: 1 }]}
              onPress={() => setConfirmSnapshot(true)}
              disabled={runningSnapshot}
            >
              {runningSnapshot
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="archive" size={16} color="#fff" />}
              <Text style={s.runBtnTxt}>전체 스냅샷</Text>
            </Pressable>
          </View>
          <Text style={[s.hint, { color: C.textMuted }]}>
            * 증분 동기화: pending 변경분을 수집 후 synced로 전환{"\n"}
            * 전체 스냅샷: 핵심 테이블 레코드 수를 기록하여 복구 기준점 생성
          </Text>
        </View>

        {/* ─── 테이블별 현황 ─── */}
        {(stats?.by_table?.length ?? 0) > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: C.text }]}>테이블별 대기 현황</Text>
            <View style={[s.tableBox, { backgroundColor: C.card }]}>
              {stats!.by_table.map((row, idx) => (
                <React.Fragment key={row.table_name}>
                  {idx > 0 && <View style={[s.divider, { backgroundColor: C.border }]} />}
                  <View style={s.tableRow}>
                    <View style={[s.tableIcon, { backgroundColor: "#FFF7ED" }]}>
                      <Feather name="table" size={13} color="#D97706" />
                    </View>
                    <Text style={[s.tableName, { color: C.text }]}>{row.table_name}</Text>
                    <View style={[s.pendingBadge, { backgroundColor: "#FEF3C7" }]}>
                      <Text style={[s.pendingBadgeTxt, { color: "#D97706" }]}>{fmtNum(row.pending)}건</Text>
                    </View>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {/* ─── 테넌트별 현황 ─── */}
        {tenants.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: C.text }]}>수영장별 현황</Text>
            <View style={[s.tableBox, { backgroundColor: C.card }]}>
              {tenants.map((t, idx) => (
                <React.Fragment key={t.tenant_id}>
                  {idx > 0 && <View style={[s.divider, { backgroundColor: C.border }]} />}
                  <View style={s.tenantRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.tenantName, { color: C.text }]}>{t.pool_name}</Text>
                      <Text style={[s.tenantSub, { color: C.textMuted }]}>
                        최근 변경: {fmtDate(t.last_change_at)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 3 }}>
                      {t.pending > 0 && (
                        <View style={[s.pendingBadge, { backgroundColor: "#FEF3C7" }]}>
                          <Text style={[s.pendingBadgeTxt, { color: "#D97706" }]}>대기 {fmtNum(t.pending)}</Text>
                        </View>
                      )}
                      <Text style={[s.tenantSub, { color: C.textMuted }]}>완료 {fmtNum(t.synced)}</Text>
                    </View>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {/* ─── 스냅샷 이력 ─── */}
        <View style={{ gap: 10 }}>
          <Text style={[s.sectionTitle, { color: C.text }]}>스냅샷 이력</Text>
          {snapshots.length === 0 ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Feather name="archive" size={22} color={C.textMuted} />
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>생성된 스냅샷이 없습니다</Text>
            </View>
          ) : (
            <View style={[s.tableBox, { backgroundColor: C.card }]}>
              {snapshots.map((snap, idx) => {
                const isFull = snap.snapshot_type === "full";
                return (
                  <React.Fragment key={snap.id}>
                    {idx > 0 && <View style={[s.divider, { backgroundColor: C.border }]} />}
                    <View style={s.snapRow}>
                      <View style={[s.snapIcon, { backgroundColor: isFull ? "#EFF6FF" : "#ECFDF5" }]}>
                        <Feather name={isFull ? "archive" : "git-commit"} size={13} color={isFull ? "#1D4ED8" : "#059669"} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.snapType, { color: C.text }]}>
                          {isFull ? "전체 스냅샷" : "증분 동기화"}
                        </Text>
                        <Text style={[s.snapDate, { color: C.textMuted }]}>{fmtDate(snap.created_at)}</Text>
                      </View>
                      <Text style={[s.snapCount, { color: C.textSecondary }]}>
                        {fmtNum(snap.record_count)}건
                      </Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <ConfirmModal
        visible={confirmSync}
        title="증분 동기화 실행"
        message={`현재 대기 중인 변경분 ${stats?.pending ?? 0}건을 즉시 수집하여 synced로 처리합니다.`}
        confirmText="동기화 실행"
        onConfirm={doSync}
        onCancel={() => setConfirmSync(false)}
      />
      <ConfirmModal
        visible={confirmSnapshot}
        title="전체 스냅샷 생성"
        message="핵심 테이블의 레코드 수를 기록하여 복구 기준점을 생성합니다."
        confirmText="스냅샷 생성"
        onConfirm={doSnapshot}
        onCancel={() => setConfirmSnapshot(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },

  statRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1, borderRadius: 14, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statSub: { fontSize: 10, fontFamily: "Inter_400Regular" },

  infoBox: {
    borderRadius: 14, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  infoLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  infoVal: { fontSize: 12, fontFamily: "Inter_500Medium" },
  divider: { height: 1 },

  runBtn: {
    borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  runBtnTxt: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 17 },

  tableBox: {
    borderRadius: 14, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  tableRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  tableIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tableName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  pendingBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pendingBadgeTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  tenantRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  tenantName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tenantSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  snapRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  snapIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  snapType: { fontSize: 13, fontFamily: "Inter_500Medium" },
  snapDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  snapCount: { fontSize: 13, fontFamily: "Inter_400Regular" },

  emptyBox: { borderRadius: 14, padding: 32, alignItems: "center", gap: 8 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
