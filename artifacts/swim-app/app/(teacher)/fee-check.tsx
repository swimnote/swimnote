/**
 * (teacher)/fee-check.tsx — 수업료 납부 체크
 *
 * - 설정에서 "납부 체크 기능 사용" 켠 경우에만 접근 가능
 * - 학생마다 수업료 금액 입력 + 납부 버튼
 * - 전월 금액 자동 인계 (학생별 마지막 입력 금액)
 * - 납부 버튼 누르면 납부 확정 → revenue 탭에 합계 표시
 * - AsyncStorage 로컬 저장 (개인 메모 성격)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChevronLeft, ChevronRight, CircleCheck, CircleDollarSign, CircleMinus } from "lucide-react-native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView,
  Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View,
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
}

export interface FeeEntry {
  name: string;
  amount: string;
  paid: boolean;
}
export type FeeMap = Record<string, FeeEntry>;

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function prevMonthStr(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function feeStorageKey(userId: string, ym: string) {
  return `@swimnote:fee:${userId}:${ym}`;
}
function formatWon(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

export default function FeeCheckScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [month, setMonth]         = useState(currentMonthStr());
  const [students, setStudents]   = useState<Student[]>([]);
  const [feeMap, setFeeMap]       = useState<FeeMap>({});
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const userId = adminUser?.id ?? "unknown";

  /* ── 학생 목록 로드 ── */
  const loadStudents = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teacher/me/members?tab=전체");
      if (res.ok) {
        const data = await res.json();
        const list: Student[] = (data.members ?? data ?? []).filter(
          (s: Student) => s.status === "active" || s.status === "registered"
        );
        setStudents(list);
        return list;
      }
    } catch (e) { console.error("[fee-check] loadStudents", e); }
    return [] as Student[];
  }, [token]);

  /* ── 해당 월 납부 데이터 로드 (없으면 전월 금액 인계) ── */
  const loadFeeMap = useCallback(async (ym: string, studentList: Student[]) => {
    try {
      const raw = await AsyncStorage.getItem(feeStorageKey(userId, ym));
      if (raw) {
        setFeeMap(JSON.parse(raw));
        return;
      }
      // 해당 월 데이터 없음 → 전월 금액 자동 인계 (납부 상태는 초기화)
      const prevRaw = await AsyncStorage.getItem(feeStorageKey(userId, prevMonthStr(ym)));
      const prevMap: FeeMap = prevRaw ? JSON.parse(prevRaw) : {};
      const init: FeeMap = {};
      for (const s of studentList) {
        init[s.id] = {
          name: s.name,
          amount: prevMap[s.id]?.amount ?? "",
          paid: false,
        };
      }
      setFeeMap(init);
    } catch {
      setFeeMap({});
    }
  }, [userId]);

  const load = useCallback(async (ym = month) => {
    setLoading(true);
    const list = await loadStudents();
    await loadFeeMap(ym, list);
    setLoading(false);
    setRefreshing(false);
  }, [loadStudents, loadFeeMap, month]);

  useEffect(() => { load(month); }, [month]); // eslint-disable-line

  /* ── 저장 헬퍼 ── */
  const save = useCallback(async (next: FeeMap) => {
    try {
      await AsyncStorage.setItem(feeStorageKey(userId, month), JSON.stringify(next));
    } catch { /* ignore */ }
  }, [userId, month]);

  /* ── 금액 변경 ── */
  const onAmountChange = useCallback((studentId: string, val: string) => {
    const cleaned = val.replace(/[^0-9]/g, "");
    setFeeMap(prev => {
      const next = { ...prev, [studentId]: { ...prev[studentId], amount: cleaned } };
      save(next);
      return next;
    });
  }, [save]);

  /* ── 납부 토글 ── */
  const togglePaid = useCallback((studentId: string) => {
    setFeeMap(prev => {
      const next = {
        ...prev,
        [studentId]: { ...prev[studentId], paid: !prev[studentId]?.paid },
      };
      save(next);
      return next;
    });
  }, [save]);

  /* ── 월 이동 ── */
  const changeMonth = (dir: -1 | 1) => {
    setMonth(m => shiftMonth(m, dir));
  };

  /* ── 요약 계산 ── */
  const paidStudents = students.filter(s => feeMap[s.id]?.paid);
  const totalPaid    = paidStudents.reduce((acc, s) => acc + (parseInt(feeMap[s.id]?.amount || "0", 10)), 0);
  const unpaidCount  = students.length - paidStudents.length;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="수업료 납부 관리" homePath="/(teacher)/settings" />

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
      <View style={[s.summaryBanner, { backgroundColor: themeColor + "10", borderColor: themeColor + "30" }]}>
        <View style={s.summaryItem}>
          <Text style={[s.summaryNum, { color: themeColor }]}>{paidStudents.length}명</Text>
          <Text style={s.summaryLbl}>납부</Text>
        </View>
        <View style={[s.summaryDivider, { backgroundColor: themeColor + "30" }]} />
        <View style={s.summaryItem}>
          <Text style={[s.summaryNum, { color: "#DC2626" }]}>{unpaidCount}명</Text>
          <Text style={s.summaryLbl}>미납</Text>
        </View>
        <View style={[s.summaryDivider, { backgroundColor: themeColor + "30" }]} />
        <View style={s.summaryItem}>
          <Text style={[s.summaryNum, { color: C.text }]}>{formatWon(totalPaid)}</Text>
          <Text style={s.summaryLbl}>총 납부액</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={students}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(month); }}
              tintColor={themeColor}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <CircleDollarSign size={40} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>담당 학생이 없습니다</Text>
            </View>
          }
          ListFooterComponent={
            <Text style={[s.footerNote, { color: C.textMuted }]}>
              전월 수업료가 자동으로 인계됩니다 · 이 기기에만 저장됩니다
            </Text>
          }
          renderItem={({ item }) => {
            const entry  = feeMap[item.id];
            const paid   = !!entry?.paid;
            const amount = entry?.amount ?? "";

            return (
              <View style={[
                s.card,
                { backgroundColor: C.card },
                paid && { borderColor: themeColor, borderWidth: 1.5 },
              ]}>
                {/* 이름 · 반 */}
                <View style={s.cardLeft}>
                  <Text style={[s.studentName, { color: C.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[s.studentSub, { color: C.textMuted }]} numberOfLines={1}>
                    {item.class_group_name ?? "반 미배정"}
                  </Text>
                </View>

                {/* 금액 입력 */}
                <TextInput
                  style={[s.amountInput, { borderColor: paid ? themeColor + "60" : C.border, color: C.text }]}
                  value={amount ? Number(amount).toLocaleString("ko-KR") : ""}
                  onChangeText={v => onAmountChange(item.id, v.replace(/,/g, ""))}
                  placeholder="수업료"
                  placeholderTextColor={C.textMuted}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />

                {/* 납부 버튼 */}
                <Pressable
                  style={[
                    s.paidBtn,
                    paid
                      ? { backgroundColor: themeColor }
                      : { backgroundColor: C.background, borderColor: C.border, borderWidth: 1.5 },
                  ]}
                  onPress={() => togglePaid(item.id)}
                >
                  {paid ? (
                    <CircleCheck size={15} color="#fff" />
                  ) : (
                    <CircleMinus size={15} color={C.textMuted} />
                  )}
                  <Text style={[s.paidBtnText, { color: paid ? "#fff" : C.textMuted }]}>
                    {paid ? "납부" : "미납"}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F8FAFC" },
  monthRow:       { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, gap: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  monthArrow:     { padding: 6 },
  monthLabel:     { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, minWidth: 100, textAlign: "center" },
  summaryBanner:  { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1 },
  summaryItem:    { alignItems: "center", gap: 2 },
  summaryNum:     { fontSize: 16, fontFamily: "Pretendard-Regular" },
  summaryLbl:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  summaryDivider: { width: 1, height: 28 },
  card:           { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardLeft:       { flex: 1, gap: 2, minWidth: 0 },
  studentName:    { fontSize: 14, fontFamily: "Pretendard-Regular" },
  studentSub:     { fontSize: 11, fontFamily: "Pretendard-Regular" },
  amountInput:    { width: 100, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "right" },
  paidBtn:        { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  paidBtnText:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  empty:          { alignItems: "center", gap: 12, marginTop: 80 },
  emptyText:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  footerNote:     { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 8, paddingBottom: 8 },
});
