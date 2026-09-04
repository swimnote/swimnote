/**
 * (parent)/growth-report-history.tsx
 *
 * 성장리포트 전체 기록 — PUBLISHED 리포트 목록.
 *
 * 메인 feed는 최근 5개만 노출하므로
 * 6개월 이전 리포트에 접근하려면 이 화면을 이용.
 *
 * route: /(parent)/growth-report-history?studentId=<id>
 *
 * 목록 item tap → 기존 /(parent)/growth-report-detail?reportId=... 이동.
 *
 * 금지: 새 report detail 구현 금지, AI 호출 금지, DB write 금지.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useSession } from "@/context/auth/SessionContext";
import { apiRequest } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportSummary {
  report_id:     string;
  report_period: string;   // "2026-08"
  published_at:  string;   // ISO
}

interface HistoryResponse {
  success: boolean;
  items:   ReportSummary[];
  has_more: boolean;
  offset:   number;
  limit:    number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPeriod(period: string): string {
  // "2026-08" → "2026년 8월"
  const parts = period.split("-");
  if (parts.length < 2) return period;
  return `${parts[0]}년 ${parseInt(parts[1], 10)}월`;
}

function formatPublishedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. 발행`;
  } catch {
    return "";
  }
}

const LIMIT = 24;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GrowthReportHistoryScreen() {
  const insets    = useSafeAreaInsets();
  const params    = useLocalSearchParams<{ studentId?: string }>();
  const studentId = params.studentId ?? "";
  const { token } = useSession();

  const [items,   setItems]   = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [offset,  setOffset]  = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const fetchPage = useCallback(async (pageOffset: number) => {
    if (!token || !studentId) return;
    try {
      const rawRes = await apiRequest(
        token,
        `/parent/students/${encodeURIComponent(studentId)}/growth-reports?limit=${LIMIT}&offset=${pageOffset}`,
      );
      const res = await rawRes.json() as HistoryResponse;
      if (res.success) {
        setItems(prev => pageOffset === 0 ? res.items : [...prev, ...res.items]);
        setHasMore(res.has_more);
        setOffset(pageOffset + res.items.length);
      } else {
        setError("리포트 목록을 불러올 수 없습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }
  }, [token, studentId]);

  useEffect(() => {
    setLoading(true);
    fetchPage(0).finally(() => setLoading(false));
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await fetchPage(offset);
    setLoadingMore(false);
  }, [hasMore, loadingMore, fetchPage, offset]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderItem({ item }: { item: ReportSummary }) {
    return (
      <Pressable
        style={s.item}
        onPress={() =>
          router.push(`/(parent)/growth-report-detail?reportId=${encodeURIComponent(item.report_id)}` as any)
        }
      >
        <View style={s.itemLeft}>
          <LucideIcon name="file-text" size={20} color={C.textSecondary} />
        </View>
        <View style={s.itemBody}>
          <Text style={s.period}>{formatPeriod(item.report_period)} 성장리포트</Text>
          <Text style={s.publishedAt}>{formatPublishedAt(item.published_at)}</Text>
        </View>
        <LucideIcon name="chevron-right" size={18} color={C.textTertiary} />
      </Pressable>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>성장리포트 전체보기</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <LucideIcon name="alert-circle" size={32} color={C.textTertiary} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <LucideIcon name="inbox" size={32} color={C.textTertiary} />
          <Text style={s.emptyText}>발행된 성장리포트가 없습니다.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.report_id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore
              ? () => (
                  <View style={s.footerLoader}>
                    <ActivityIndicator color={C.primary} />
                  </View>
                )
              : null
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.background },
  header:      {
    flexDirection:  "row",
    alignItems:     "center",
    paddingHorizontal: 16,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor:   C.background,
  },
  backBtn:     { width: 32, alignItems: "flex-start" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: C.text },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  errorText:   { fontSize: 14, color: C.textSecondary, textAlign: "center" },
  emptyText:   { fontSize: 14, color: C.textTertiary, textAlign: "center" },
  item:        {
    flexDirection:   "row",
    alignItems:      "center",
    paddingHorizontal: 20,
    paddingVertical:   16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor:   C.background,
    gap: 12,
  },
  itemLeft:    { width: 32, alignItems: "center" },
  itemBody:    { flex: 1, gap: 2 },
  period:      { fontSize: 15, fontWeight: "600", color: C.text },
  publishedAt: { fontSize: 12, color: C.textTertiary },
  footerLoader:{ padding: 20, alignItems: "center" },
});
