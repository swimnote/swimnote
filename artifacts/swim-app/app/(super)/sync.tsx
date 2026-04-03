/**
 * 슈퍼관리자 — 변경분 동기화 관리 화면
 * API: /super/sync/stats, /super/sync/tenants, /super/sync/snapshots
 *      /super/sync/run, /super/sync/snapshot
 */
import { Archive, Clock, RefreshCw, Table } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useAuditLogStore } from "@/store/auditLogStore";

const C = Colors.light;
const ACCENT = "#7C3AED";

function fmtDate(d: string | null) {
  if (!d) return "없음";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "없음";
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtNum(n: number) {
  return n.toLocaleString("ko-KR");
}

interface SyncStats {
  pending:          number;
  synced:           number;
  total:            number;
  snapshots:        number;
  last_synced_at:   string | null;
  last_snapshot_at: string | null;
  by_table:         { table_name: string; pending: number }[];
}

interface TenantRow {
  tenant_id:      string;
  pool_name:      string;
  pending:        number;
  synced:         number;
  last_change_at: string | null;
}

interface SnapshotRow {
  id:             string;
  snapshot_type:  "incremental" | "full";
  record_count:   number;
  created_at:     string;
}

function StatCard({ label, value, icon, color, sub }: {
  label: string; value: string | number; icon: any; color: string; sub?: string;
}) {
  return (
    <View style={[s.statCard, { backgroundColor: C.card }]}>
      <View style={[s.statIcon, { backgroundColor: color + "20" }]}>
        <LucideIcon name={icon} size={18} color={color} />
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
  const { adminUser, token } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";
  const createLog = useAuditLogStore(st => st.createLog);

  const [stats, setStats] = useState<SyncStats | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);

  const [loading,          setLoading]          = useState(true);
  const [refreshing,       setRefreshing]       = useState(false);
  const [runningSync,      setRunningSync]      = useState(false);
  const [runningSnapshot,  setRunningSnapshot]  = useState(false);
  const [confirmSync,      setConfirmSync]      = useState(false);
  const [confirmSnapshot,  setConfirmSnapshot]  = useState(false);

  const loadAll = useCallback(async () => {
    if (!token) return;
    try {
      const [statsRes, tenantsRes, snapshotsRes] = await Promise.all([
        apiRequest(token, "/super/sync/stats"),
        apiRequest(token, "/super/sync/tenants"),
        apiRequest(token, "/super/sync/snapshots"),
      ]);
      if (statsRes.ok)     setStats(await statsRes.json());
      if (tenantsRes.ok)   setTenants(await tenantsRes.json());
      if (snapshotsRes.ok) setSnapshots(await snapshotsRes.json());
    } catch (e) {
      console.warn("[sync] loadAll error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  function onRefresh() {
    setRefreshing(true);
    loadAll();
  }

  async function doSync() {
    setConfirmSync(false);
    setRunningSync(true);
    try {
      const res = await apiRequest(token!, "/super/sync/run", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        createLog({ category: "구독", title: `증분 동기화 실행 완료`, detail: JSON.stringify(data), actorName, impact: "medium" });
        await loadAll();
      } else {
        Alert.alert("오류", data.error ?? "동기화 실패");
      }
    } catch (e) {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally {
      setRunningSync(false);
    }
  }

  async function doSnapshot() {
    setConfirmSnapshot(false);
    setRunningSnapshot(true);
    try {
      const res = await apiRequest(token!, "/super/sync/snapshot", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        createLog({ category: "구독", title: `전체 스냅샷 생성 완료`, detail: JSON.stringify(data), actorName, impact: "medium" });
        await loadAll();
      } else {
        Alert.alert("오류", data.error ?? "스냅샷 생성 실패");
      }
    } catch (e) {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally {
      setRunningSnapshot(false);
    }
  }

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <SubScreenHeader title="데이터 동기화" subtitle="서버 기반 변경분 수집 및 스냅샷 관리" homePath="/(super)/more" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ACCENT} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="데이터 동기화" subtitle="서버 기반 변경분 수집 및 스냅샷 관리" homePath="/(super)/more" />

      <ScrollView showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 20 }}>

        {/* ─── 동기화 현황 ─── */}
        <View style={{ gap: 10 }}>
          <Text style={[s.sectionTitle, { color: C.text }]}>동기화 현황</Text>
          <View style={s.statRow}>
            <StatCard label="대기중"  value={stats?.pending ?? 0}   icon="clock"         color="#D97706" sub="sync_status=pending" />
            <StatCard label="완료"    value={stats?.synced ?? 0}    icon="check-circle"  color="#2EC4B6" sub="sync_status=synced" />
          </View>
          <View style={s.statRow}>
            <StatCard label="총 변경분" value={stats?.total ?? 0}     icon="database"  color={ACCENT}   sub="누적 기록" />
            <StatCard label="스냅샷"    value={stats?.snapshots ?? 0}  icon="archive"   color="#0EA5E9" sub="생성 횟수" />
          </View>

          <View style={[s.infoBox, { backgroundColor: C.card }]}>
            <View style={s.infoRow}>
              <RefreshCw size={13} color={C.textMuted} />
              <Text style={[s.infoLabel, { color: C.textMuted }]}>마지막 동기화</Text>
              <Text style={[s.infoVal, { color: C.text }]}>{fmtDate(stats?.last_synced_at ?? null)}</Text>
            </View>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <View style={s.infoRow}>
              <Archive size={13} color={C.textMuted} />
              <Text style={[s.infoLabel, { color: C.textMuted }]}>마지막 전체 스냅샷</Text>
              <Text style={[s.infoVal, { color: C.text }]}>{fmtDate(stats?.last_snapshot_at ?? null)}</Text>
            </View>
            <View style={[s.divider, { backgroundColor: C.border }]} />
            <View style={s.infoRow}>
              <Clock size={13} color={C.textMuted} />
              <Text style={[s.infoLabel, { color: C.textMuted }]}>자동 실행</Text>
              <Text style={[s.infoVal, { color: C.text }]}>증분 매일 03:00 · 전체 매주 일 02:00</Text>
            </View>
          </View>
        </View>

        {/* ─── 즉시 실행 ─── */}
        <View style={{ gap: 10 }}>
          <Text style={[s.sectionTitle, { color: C.text }]}>즉시 실행</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              style={({ pressed }) => [s.runBtn, { backgroundColor: "#D97706", opacity: pressed || runningSync ? 0.8 : 1, flex: 1 }]}
              onPress={() => setConfirmSync(true)} disabled={runningSync}>
              {runningSync ? <ActivityIndicator color="#fff" size="small" />
                : <RefreshCw size={16} color="#fff" />}
              <Text style={s.runBtnTxt}>증분 동기화</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.runBtn, { backgroundColor: "#0EA5E9", opacity: pressed || runningSnapshot ? 0.8 : 1, flex: 1 }]}
              onPress={() => setConfirmSnapshot(true)} disabled={runningSnapshot}>
              {runningSnapshot ? <ActivityIndicator color="#fff" size="small" />
                : <Archive size={16} color="#fff" />}
              <Text style={s.runBtnTxt}>전체 스냅샷</Text>
            </Pressable>
          </View>
          <Text style={[s.hint, { color: C.textMuted }]}>
            * 증분 동기화: pending 변경분을 수집 후 synced로 전환{"\n"}
            * 전체 스냅샷: 핵심 테이블 레코드 수를 기록하여 복구 기준점 생성
          </Text>
        </View>

        {/* ─── 테이블별 대기 현황 ─── */}
        {(stats?.by_table ?? []).length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: C.text }]}>테이블별 대기 현황</Text>
            <View style={[s.tableBox, { backgroundColor: C.card }]}>
              {(stats!.by_table).map((row, idx) => (
                <View key={row.table_name}>
                  {idx > 0 && <View style={[s.divider, { backgroundColor: C.border }]} />}
                  <View style={s.tableRow}>
                    <View style={[s.tableIcon, { backgroundColor: "#FFF1BF" }]}>
                      <Table size={13} color="#D97706" />
                    </View>
                    <Text style={[s.tableName, { color: C.text }]}>{row.table_name}</Text>
                    <View style={[s.pendingBadge, { backgroundColor: row.pending > 0 ? "#FFF1BF" : "#E6FFFA" }]}>
                      <Text style={[s.pendingBadgeTxt, { color: row.pending > 0 ? "#D97706" : "#2EC4B6" }]}>
                        {fmtNum(row.pending)}건
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── 수영장별 현황 ─── */}
        {tenants.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[s.sectionTitle, { color: C.text }]}>수영장별 현황</Text>
            <View style={[s.tableBox, { backgroundColor: C.card }]}>
              {tenants.map((t, idx) => (
                <View key={t.tenant_id}>
                  {idx > 0 && <View style={[s.divider, { backgroundColor: C.border }]} />}
                  <View style={s.tenantRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.tenantName, { color: C.text }]}>{t.pool_name}</Text>
                      <Text style={[s.tenantSub, { color: C.textMuted }]}>최근 변경: {fmtDate(t.last_change_at)}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 3 }}>
                      {t.pending > 0 && (
                        <View style={[s.pendingBadge, { backgroundColor: "#FFF1BF" }]}>
                          <Text style={[s.pendingBadgeTxt, { color: "#D97706" }]}>대기 {fmtNum(t.pending)}</Text>
                        </View>
                      )}
                      <Text style={[s.tenantSub, { color: C.textMuted }]}>완료 {fmtNum(t.synced)}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ─── 스냅샷 이력 ─── */}
        <View style={{ gap: 10 }}>
          <Text style={[s.sectionTitle, { color: C.text }]}>스냅샷 이력</Text>
          {snapshots.length === 0 ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Archive size={22} color={C.textMuted} />
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>생성된 스냅샷이 없습니다</Text>
            </View>
          ) : (
            <View style={[s.tableBox, { backgroundColor: C.card }]}>
              {snapshots.map((snap, idx) => {
                const isFull = snap.snapshot_type === "full";
                return (
                  <View key={snap.id}>
                    {idx > 0 && <View style={[s.divider, { backgroundColor: C.border }]} />}
                    <View style={s.snapRow}>
                      <View style={[s.snapIcon, { backgroundColor: isFull ? "#E6FFFA" : "#DFF3EC" }]}>
                        <LucideIcon name={isFull ? "archive" : "git-commit"} size={13} color="#2EC4B6" />
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
                  </View>
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
  root:           { flex: 1 },
  sectionTitle:   { fontSize: 15, fontFamily: "Pretendard-Regular" },
  statRow:        { flexDirection: "row", gap: 10 },
  statCard:       { flex: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10,
                    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  statIcon:       { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLabel:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  statValue:      { fontSize: 22, fontFamily: "Pretendard-Regular" },
  statSub:        { fontSize: 10, fontFamily: "Pretendard-Regular" },
  infoBox:        { borderRadius: 14, overflow: "hidden",
                    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  infoRow:        { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  infoLabel:      { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular" },
  infoVal:        { fontSize: 12, fontFamily: "Pretendard-Regular" },
  divider:        { height: 1 },
  runBtn:         { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14,
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  runBtnTxt:      { color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" },
  hint:           { fontSize: 11, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  tableBox:       { borderRadius: 14, overflow: "hidden",
                    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  tableRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  tableIcon:      { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tableName:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  pendingBadge:   { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pendingBadgeTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular" },
  tenantRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  tenantName:     { fontSize: 13, fontFamily: "Pretendard-Regular" },
  tenantSub:      { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  snapRow:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  snapIcon:       { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  snapType:       { fontSize: 13, fontFamily: "Pretendard-Regular" },
  snapDate:       { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  snapCount:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  emptyBox:       { borderRadius: 14, padding: 32, alignItems: "center", gap: 8 },
  emptyTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
