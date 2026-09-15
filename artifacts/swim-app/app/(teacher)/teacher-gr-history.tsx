/**
 * (teacher)/teacher-gr-history.tsx
 *
 * 선생님이 특정 학생의 PUBLISHED 성장리포트 이력을 확인하는 화면.
 *
 * route: /(teacher)/teacher-gr-history?studentId=<id>&studentName=<name>
 * API:   GET /teacher/students/:studentId/growth-reports
 *
 * 목록 항목 탭 → /(teacher)/teacher-gr-detail?reportId=...
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
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;

interface ReportItem {
  report_id:     string;
  student_id:    string;
  student_name:  string;
  report_period: string; // "2026-08"
  published_at:  string | null;
  summary_text:  string | null;
}

interface ApiResponse {
  success: boolean;
  reports: ReportItem[];
}

function formatPeriod(period: string): string {
  const parts = period.split("-");
  if (parts.length < 2) return period;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const issueM = m === 12 ? 1 : m + 1;
  const issueY = m === 12 ? y + 1 : y;
  return `${issueY}년 ${issueM}월`;
}

function formatPublishedAt(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. 발행`;
  } catch {
    return "";
  }
}

export default function TeacherGrHistoryScreen() {
  const insets     = useSafeAreaInsets();
  const { token }  = useAuth();
  const params     = useLocalSearchParams<{ studentId?: string; studentName?: string }>();
  const studentId  = params.studentId ?? "";
  const studentName = params.studentName ?? "학생";

  const [items,   setItems]   = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !studentId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiRequest(token, `/teacher/students/${encodeURIComponent(studentId)}/growth-reports`);
      if (r.ok) {
        const data = (await r.json()) as ApiResponse;
        setItems(data.reports ?? []);
      } else if (r.status === 403 || r.status === 404) {
        setError("접근 권한이 없습니다.");
      } else {
        setError("리포트 목록을 불러올 수 없습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token, studentId]);

  useEffect(() => { load(); }, [load]);

  function renderItem({ item }: { item: ReportItem }) {
    return (
      <Pressable
        style={s.item}
        onPress={() =>
          router.push({
            pathname: "/(teacher)/teacher-gr-detail",
            params: { reportId: item.report_id },
          } as any)
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

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>{studentName} 성장리포트</Text>
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
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  backBtn:     { width: 32, alignItems: "flex-start" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: C.text },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  errorText:   { fontSize: 14, color: C.textSecondary, textAlign: "center" },
  emptyText:   { fontSize: 14, color: C.textTertiary, textAlign: "center" },
  item: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.background, gap: 12,
  },
  itemLeft:    { width: 32, alignItems: "center" },
  itemBody:    { flex: 1, gap: 2 },
  period:      { fontSize: 15, fontWeight: "600", color: C.text },
  publishedAt: { fontSize: 12, color: C.textTertiary },
});
