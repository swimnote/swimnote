/**
 * (super)/integrity.tsx — WP13 Data Integrity Checker
 *
 * Super Admin 전용 Read-Only integrity report.
 * §22: 수정 버튼 없음. 자동 수정 절대 없음.
 * §20: GET only — DB mutation 0.
 */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;
const PURPLE = "#7C3AED";

type Severity = "CRITICAL" | "WARNING" | "INFO" | "OK";

interface Issue {
  code:            string;
  severity:        string;
  entity_type:     string;
  entity_id:       string;
  pool_id?:        string | null;
  summary:         string;
  evidence:        Record<string, any>;
  suggested_action: string;
  detected_at:     string;
}

interface Summary {
  CRITICAL: number;
  WARNING:  number;
  INFO:     number;
  total:    number;
}

interface ScanResult {
  overall:    Severity;
  summary:    Summary;
  scanned_at: string;
  check_count: number;
  query_count: number;
  n_plus_one: string;
}

// ── Severity colors ────────────────────────────────────────────────────────────
const SEV_CONFIG: Record<string, { bg: string; text: string; icon: string }> = {
  CRITICAL: { bg: "#FEE2E2", text: "#DC2626", icon: "alert-octagon" },
  WARNING:  { bg: "#FEF3C7", text: "#D97706", icon: "alert-triangle" },
  INFO:     { bg: "#DBEAFE", text: "#2563EB", icon: "info" },
  OK:       { bg: "#D1FAE5", text: "#059669", icon: "check-circle" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity] ?? SEV_CONFIG.INFO;
  return (
    <View style={[badge.wrap, { backgroundColor: cfg.bg }]}>
      <LucideIcon name={cfg.icon as any} size={11} color={cfg.text} />
      <Text style={[badge.txt, { color: cfg.text }]}>{severity}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  txt:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
});

// ── Count card ─────────────────────────────────────────────────────────────────
function CountCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[cc.card, { borderLeftColor: color }]}>
      <Text style={[cc.num, { color }]}>{value}</Text>
      <Text style={cc.lbl}>{label}</Text>
    </View>
  );
}

const cc = StyleSheet.create({
  card: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 12, borderLeftWidth: 3, alignItems: "center" },
  num:  { fontSize: 22, fontFamily: "Pretendard-Regular" },
  lbl:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
});

// ── Issue row ──────────────────────────────────────────────────────────────────
function IssueRow({ item }: { item: Issue }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SEV_CONFIG[item.severity] ?? SEV_CONFIG.INFO;

  return (
    <Pressable style={ir.card} onPress={() => setExpanded(e => !e)}>
      <View style={ir.top}>
        <SeverityBadge severity={item.severity} />
        <Text style={ir.code}>{item.code}</Text>
        <LucideIcon name={expanded ? "chevron-up" : "chevron-down"} size={14} color={C.textSecondary} style={{ marginLeft: "auto" }} />
      </View>
      <Text style={ir.summary} numberOfLines={expanded ? undefined : 2}>{item.summary}</Text>
      {item.pool_id && <Text style={ir.meta}>Pool: {item.pool_id.slice(0, 8)}…</Text>}
      {expanded && (
        <View style={[ir.evidenceBox, { borderColor: cfg.bg }]}>
          <Text style={ir.evidenceTxt}>{JSON.stringify(item.evidence, null, 2)}</Text>
          <Text style={[ir.action, { color: cfg.text }]}>권장: {item.suggested_action}</Text>
        </View>
      )}
    </Pressable>
  );
}

const ir = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8 },
  top:         { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  code:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
  summary:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  meta:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 4 },
  evidenceBox: { marginTop: 8, padding: 10, borderWidth: 1, borderRadius: 8, backgroundColor: "#FAFAFA" },
  evidenceTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, fontFamily: "monospace" },
  action:      { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 6, fontWeight: "600" } as any,
});

// ── Main screen ────────────────────────────────────────────────────────────────
export default function IntegrityScreen() {
  const { token } = useAuth();

  const [scanning,   setScanning]   = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [issues,     setIssues]     = useState<Issue[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    setIssues([]);
    try {
      const [summaryRes, issuesRes] = await Promise.all([
        apiRequest(token, "/super/integrity/summary?limit=50"),
        apiRequest(token, "/super/integrity/issues?limit=100"),
      ]);

      if (summaryRes.ok) {
        const data: ScanResult = await summaryRes.json();
        setScanResult(data);
      }
      if (issuesRes.ok) {
        const data = await issuesRes.json();
        setIssues(Array.isArray(data.issues) ? data.issues : []);
      }
    } finally {
      setScanning(false);
    }
  }, [token]);

  const filteredIssues = severityFilter
    ? issues.filter(i => i.severity === severityFilter)
    : issues;

  const overallCfg = SEV_CONFIG[scanResult?.overall ?? "OK"];

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="데이터 무결성 검사" />

      <FlatList
        data={filteredIssues}
        keyExtractor={(item, idx) => `${item.code}_${item.entity_id}_${idx}`}
        contentContainerStyle={s.body}
        ListHeaderComponent={
          <View style={{ gap: 14 }}>
            {/* ── Scan button ──────────────────────────────────────────── */}
            <Pressable
              style={[s.scanBtn, scanning && { opacity: 0.5 }]}
              onPress={handleScan}
              disabled={scanning}
            >
              {scanning
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <LucideIcon name="search" size={16} color="#fff" />
                    <Text style={s.scanBtnTxt}>무결성 검사 실행</Text>
                  </View>
                )
              }
            </Pressable>

            {/* ── Note ──────────────────────────────────────────────────── */}
            <View style={s.note}>
              <LucideIcon name="lock" size={12} color={PURPLE} />
              <Text style={s.noteTxt}>Read-Only 검사 — 데이터를 자동으로 수정하지 않습니다.</Text>
            </View>

            {/* ── Overall badge ─────────────────────────────────────────── */}
            {scanResult && (
              <>
                <View style={[s.overallCard, { backgroundColor: overallCfg.bg }]}>
                  <LucideIcon name={overallCfg.icon as any} size={24} color={overallCfg.text} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={[s.overallText, { color: overallCfg.text }]}>{scanResult.overall}</Text>
                    <Text style={s.overallSub}>
                      {scanResult.check_count}개 항목 검사 · {scanResult.query_count}개 쿼리 · N+1: {scanResult.n_plus_one}
                    </Text>
                    <Text style={s.overallSub}>
                      {new Date(scanResult.scanned_at).toLocaleString("ko-KR")}
                    </Text>
                  </View>
                </View>

                {/* ── Count cards ─────────────────────────────────────────── */}
                <View style={s.countRow}>
                  <CountCard label="CRITICAL" value={scanResult.summary.CRITICAL} color="#DC2626" />
                  <CountCard label="WARNING"  value={scanResult.summary.WARNING}  color="#D97706" />
                  <CountCard label="INFO"     value={scanResult.summary.INFO}     color="#2563EB" />
                </View>

                {/* ── Severity filter ─────────────────────────────────────── */}
                {issues.length > 0 && (
                  <View style={s.filterRow}>
                    {[null, "CRITICAL", "WARNING", "INFO"].map(sev => (
                      <Pressable
                        key={sev ?? "ALL"}
                        style={[s.filterChip, severityFilter === sev && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                        onPress={() => setSeverityFilter(sev)}
                      >
                        <Text style={[s.filterTxt, severityFilter === sev && { color: "#fff" }]}>
                          {sev ?? "전체"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {issues.length === 0 && (
                  <View style={s.emptyBox}>
                    <LucideIcon name="check-circle-2" size={36} color="#059669" />
                    <Text style={s.emptyTxt}>이슈 없음 — 데이터 무결성 정상</Text>
                  </View>
                )}

                {filteredIssues.length > 0 && (
                  <Text style={s.issueCount}>
                    {filteredIssues.length}개 이슈 {severityFilter ? `(${severityFilter})` : ""}
                  </Text>
                )}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => <IssueRow item={item} />}
        ListEmptyComponent={scanResult ? null : (
          <View style={s.emptyBox}>
            <LucideIcon name="database" size={36} color={C.border} />
            <Text style={s.emptyTxt}>검사 버튼을 눌러 시작하세요</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.backgroundSoft },
  body:        { padding: 16, gap: 0, paddingBottom: 40 },

  scanBtn:     { backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  scanBtnTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },

  note:        { flexDirection: "row", alignItems: "center", gap: 6,
                 backgroundColor: "#F5F3FF", borderRadius: 10, padding: 10 },
  noteTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: PURPLE, flex: 1 },

  overallCard: { borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center" },
  overallText: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  overallSub:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#6B7280", marginTop: 2 },

  countRow:    { flexDirection: "row", gap: 10, marginBottom: 4 },

  filterRow:   { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  filterChip:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                 borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  filterTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  emptyBox:    { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  issueCount:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 8 },
});
