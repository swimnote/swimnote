/**
 * (teacher)/fee-check.tsx — 수업료 납부 체크
 *
 * - 설정에서 "수업료 납부 관리" 켠 경우에만 접근 가능
 * - 월 단위로 학생별 납부/미납 토글
 * - AsyncStorage 로컬 저장 (디바이스 내 보관)
 * - 수영장 전산 쓰는 선생님은 설정에서 끄면 됨
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChevronLeft, ChevronRight, CircleCheck, CircleDollarSign, CircleX, RefreshCw } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface Student {
  id: string;
  name: string;
  status: string;
  class_group_name: string | null;
  parent_name: string | null;
}

type PayMap = Record<string, boolean>;

function monthStr(offset = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}
function storageKey(userId: string, ym: string) {
  return `@swimnote:fee:${userId}:${ym}`;
}

export default function FeeCheckScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [month, setMonth]         = useState(monthStr());
  const [students, setStudents]   = useState<Student[]>([]);
  const [payMap, setPayMap]       = useState<PayMap>({});
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const userId = adminUser?.id ?? "unknown";

  const loadStudents = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teacher/me/members?tab=전체");
      if (res.ok) {
        const data = await res.json();
        const list: Student[] = (data.members ?? data ?? []).filter(
          (s: Student) => s.status === "active" || s.status === "registered"
        );
        setStudents(list);
      }
    } catch (e) {
      console.error("[fee-check] loadStudents", e);
    }
  }, [token]);

  const loadPayMap = useCallback(async (ym: string) => {
    try {
      const raw = await AsyncStorage.getItem(storageKey(userId, ym));
      setPayMap(raw ? JSON.parse(raw) : {});
    } catch {
      setPayMap({});
    }
  }, [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStudents(), loadPayMap(month)]);
    setLoading(false);
    setRefreshing(false);
  }, [loadStudents, loadPayMap, month]);

  useEffect(() => { load(); }, [load]);

  const changeMonth = useCallback(async (dir: -1 | 1) => {
    const next = monthStr(
      (() => {
        const [y, m] = month.split("-").map(Number);
        const d = new Date(y, m - 1 + dir, 1);
        const now = new Date();
        const cur = new Date(now.getFullYear(), now.getMonth(), 1);
        const offset = (d.getFullYear() - cur.getFullYear()) * 12 + (d.getMonth() - cur.getMonth());
        return offset;
      })()
    );
    setMonth(next);
    setLoading(true);
    await loadPayMap(next);
    setLoading(false);
  }, [month, loadPayMap]);

  const toggle = useCallback(async (studentId: string) => {
    const next = { ...payMap, [studentId]: !payMap[studentId] };
    setPayMap(next);
    try {
      await AsyncStorage.setItem(storageKey(userId, month), JSON.stringify(next));
    } catch { /* ignore */ }
  }, [payMap, userId, month]);

  const resetMonth = useCallback(async () => {
    const next: PayMap = {};
    setPayMap(next);
    try {
      await AsyncStorage.removeItem(storageKey(userId, month));
    } catch { /* ignore */ }
  }, [userId, month]);

  const paidCount   = students.filter(s => payMap[s.id]).length;
  const unpaidCount = students.length - paidCount;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader
        title="수업료 납부 관리"
        homePath="/(teacher)/settings"
        right={
          <Pressable style={s.resetBtn} onPress={resetMonth}>
            <RefreshCw size={16} color={C.textMuted} />
          </Pressable>
        }
      />

      {/* 월 선택 */}
      <View style={s.monthRow}>
        <Pressable style={s.monthArrow} onPress={() => changeMonth(-1)}>
          <ChevronLeft size={20} color={C.text} />
        </Pressable>
        <Text style={s.monthLabel}>{monthLabel(month)}</Text>
        <Pressable style={s.monthArrow} onPress={() => changeMonth(1)}>
          <ChevronRight size={20} color={C.text} />
        </Pressable>
      </View>

      {/* 요약 배너 */}
      <View style={[s.summaryRow, { borderColor: themeColor + "30" }]}>
        <View style={[s.summaryChip, { backgroundColor: themeColor + "12" }]}>
          <CircleCheck size={14} color={themeColor} />
          <Text style={[s.summaryText, { color: themeColor }]}>납부 {paidCount}명</Text>
        </View>
        <View style={[s.summaryChip, { backgroundColor: "#FEF2F2" }]}>
          <CircleX size={14} color="#DC2626" />
          <Text style={[s.summaryText, { color: "#DC2626" }]}>미납 {unpaidCount}명</Text>
        </View>
        <Text style={s.summaryTotal}>전체 {students.length}명</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={students}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={themeColor}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <CircleDollarSign size={40} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>담당 학생이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const paid = !!payMap[item.id];
            return (
              <Pressable
                style={[
                  s.card,
                  { backgroundColor: C.card },
                  paid && { borderColor: themeColor + "40", borderWidth: 1.5 },
                ]}
                onPress={() => toggle(item.id)}
                android_ripple={{ color: themeColor + "20" }}
              >
                {/* 왼쪽: 이름 + 반 */}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[s.studentName, { color: C.text }]}>{item.name}</Text>
                  <Text style={[s.studentSub, { color: C.textMuted }]}>
                    {item.class_group_name ?? "반 미배정"}
                    {item.parent_name ? ` · 학부모 ${item.parent_name}` : ""}
                  </Text>
                </View>

                {/* 오른쪽: 납부 상태 토글 */}
                <View
                  style={[
                    s.badge,
                    paid
                      ? { backgroundColor: themeColor + "15" }
                      : { backgroundColor: "#FEF2F2" },
                  ]}
                >
                  {paid ? (
                    <CircleCheck size={16} color={themeColor} />
                  ) : (
                    <CircleX size={16} color="#DC2626" />
                  )}
                  <Text
                    style={[
                      s.badgeText,
                      { color: paid ? themeColor : "#DC2626" },
                    ]}
                  >
                    {paid ? "납부" : "미납"}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* 하단 안내 */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={s.footerText}>
          카드를 누르면 납부/미납이 전환됩니다 · 이 기기에만 저장됩니다
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F8FAFC" },
  resetBtn:     { padding: 8 },
  monthRow:     { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  monthArrow:   { padding: 6 },
  monthLabel:   { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, minWidth: 100, textAlign: "center" },
  summaryRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  summaryChip:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  summaryText:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  summaryTotal: { marginLeft: "auto" as any, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  card:         { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1, gap: 12 },
  studentName:  { fontSize: 15, fontFamily: "Pretendard-Regular" },
  studentSub:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  badge:        { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  badgeText:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  empty:        { alignItems: "center", gap: 12, marginTop: 80 },
  emptyText:    { fontSize: 14, fontFamily: "Pretendard-Regular" },
  footer:       { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: "#fff" },
  footerText:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
});
