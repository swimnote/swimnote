/**
 * growth-report-status.tsx
 *
 * NEW FREE AI Growth Report 전용 상태 화면.
 *
 * 입력: studentId (query param)
 *
 * 동작:
 *   PUBLISHED         → growth-report-detail?reportId=... 로 auto-redirect
 *   READY             → "검토 완료, 곧 공개" + 홈 버튼
 *   GENERATING        → "분석 중" + 홈 버튼
 *   DATA_ACCUMULATING → "수업 기록 쌓이는 중" + 수업 기록 확인하기 버튼
 *   NOT_AVAILABLE     → "수업 기록이 쌓이면…" + 설명 + 홈 버튼
 *   FAILED            → 오류 안내 + 재시도 버튼
 *   null/loading      → skeleton
 *
 * 금지: legacy growth-report.tsx (출석 통계) 호출 금지
 *       새 AI 호출 금지 / DB write 금지 / 신규 리포트 생성 버튼 금지
 *
 * route: /(parent)/growth-report-status?studentId=<id>
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LucideIcon } from "@/components/common/LucideIcon";
import { useSession } from "@/context/auth/SessionContext";
import { apiRequest } from "@/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type GrDisplayStatus =
  | "NOT_AVAILABLE"
  | "DATA_ACCUMULATING"
  | "GENERATING"
  | "READY"
  | "PUBLISHED"
  | "FAILED";

type LoadState = "idle" | "loading" | "done" | "error";

// ─── Component ────────────────────────────────────────────────────────────────

export default function GrowthReportStatusScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const { token }     = useSession();
  const insets        = useSafeAreaInsets();
  const mounted       = useRef(true);

  const [loadState,   setLoadState]   = useState<LoadState>("idle");
  const [grStatus,    setGrStatus]    = useState<GrDisplayStatus | null>(null);
  const [reportId,    setReportId]    = useState<string | null>(null);
  const [redirected,  setRedirected]  = useState(false);

  // ── Load status from server ────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    if (!studentId || !token) return;
    setLoadState("loading");
    try {
      const res  = await apiRequest(token, `/parent/students/${encodeURIComponent(studentId)}/growth-report-status`);
      if (!mounted.current) return;
      if (!res.ok) { setLoadState("error"); return; }
      const data = await res.json();
      if (!mounted.current) return;
      const status: GrDisplayStatus | null = data.status ?? null;
      const rId: string | null = data.report_id ?? null;
      setGrStatus(status);
      setReportId(rId);
      setLoadState("done");
    } catch {
      if (!mounted.current) return;
      setLoadState("error");
    }
  }, [studentId, token]);

  useEffect(() => {
    mounted.current = true;
    loadStatus();
    return () => { mounted.current = false; };
  }, [loadStatus]);

  // PUBLISHED + reportId → 자동으로 detail 화면으로 이동
  useEffect(() => {
    if (grStatus === "PUBLISHED" && reportId && !redirected) {
      setRedirected(true);
      router.replace(`/(parent)/growth-report-detail?reportId=${encodeURIComponent(reportId)}` as any);
    }
  }, [grStatus, reportId, redirected]);

  // ── Shared handlers ────────────────────────────────────────────────────────

  const handleGoHome = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(parent)/home" as any);
  };

  const handleViewDiary = () => {
    // /(parent)/diary — 부모 일지 피드 (실제 존재하는 route)
    router.push("/(parent)/diary" as any);
  };

  const handleRetry = () => {
    setLoadState("idle");
    setGrStatus(null);
    setReportId(null);
    loadStatus();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={handleGoHome} hitSlop={12} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color="#1E293B" />
        </Pressable>
        <Text style={s.headerTitle}>AI 성장 리포트</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Loading */}
        {(loadState === "idle" || loadState === "loading") && (
          <View style={s.centerBox}>
            <ActivityIndicator size="large" color="#0369A1" />
            <Text style={s.centerTxt}>리포트 상태를 확인하는 중…</Text>
          </View>
        )}

        {/* Network error */}
        {loadState === "error" && (
          <View style={s.centerBox}>
            <LucideIcon name="wifi-off" size={32} color="#94A3B8" />
            <Text style={s.centerTxt}>상태를 불러올 수 없습니다</Text>
            <Pressable onPress={handleRetry} style={s.actionBtn}>
              <Text style={s.actionTxt}>다시 시도</Text>
            </Pressable>
          </View>
        )}

        {/* Status cards */}
        {loadState === "done" && grStatus !== null && (
          <View style={s.cardWrap}>

            {/* ── PUBLISHED → redirecting (auto-redirect via useEffect) ── */}
            {grStatus === "PUBLISHED" && (
              <View style={[s.card, s.cardGreen]}>
                <LucideIcon name="check-circle" size={22} color="#16A34A" />
                <View style={s.cardBody}>
                  <Text style={[s.cardTitle, { color: "#16A34A" }]}>이번 달 성장 리포트</Text>
                  <Text style={s.cardDesc}>리포트 화면으로 이동합니다…</Text>
                </View>
                <ActivityIndicator size="small" color="#16A34A" />
              </View>
            )}

            {/* ── READY ── */}
            {grStatus === "READY" && (
              <>
                <View style={[s.card, s.cardGreen]}>
                  <LucideIcon name="check-circle" size={22} color="#16A34A" />
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, { color: "#16A34A" }]}>이번 달 성장 리포트</Text>
                    <Text style={s.cardDesc}>검토가 완료되었어요. 곧 공개됩니다.</Text>
                  </View>
                </View>
                <Pressable onPress={handleGoHome} style={s.actionBtn}>
                  <Text style={s.actionTxt}>홈으로 돌아가기</Text>
                </Pressable>
              </>
            )}

            {/* ── GENERATING ── */}
            {grStatus === "GENERATING" && (
              <>
                <View style={[s.card, s.cardBlue]}>
                  <ActivityIndicator size="small" color="#0369A1" />
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, { color: "#0369A1" }]}>이번 달 성장 리포트</Text>
                    <Text style={s.cardDesc}>
                      성장 리포트를 만들고 있어요.{"\n"}완성되면 알려드릴게요.
                    </Text>
                  </View>
                </View>
                <Pressable onPress={handleGoHome} style={s.actionBtn}>
                  <Text style={s.actionTxt}>홈으로 돌아가기</Text>
                </Pressable>
              </>
            )}

            {/* ── DATA_ACCUMULATING ── */}
            {grStatus === "DATA_ACCUMULATING" && (
              <>
                <View style={[s.card, s.cardBlue]}>
                  <LucideIcon name="bar-chart-2" size={22} color="#0369A1" />
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, { color: "#0369A1" }]}>이번 달 성장 리포트</Text>
                    <Text style={s.cardDesc}>
                      조금 더 수업 기록이 쌓이면{"\n"}이번 달 성장 리포트를 만들어드릴게요.
                    </Text>
                  </View>
                </View>
                <View style={s.btnRow}>
                  <Pressable onPress={handleGoHome} style={[s.actionBtn, s.actionBtnFlex]}>
                    <Text style={s.actionTxt}>홈으로 돌아가기</Text>
                  </Pressable>
                  <Pressable onPress={handleViewDiary} style={[s.actionBtn, s.actionBtnFlex, s.actionBtnOutline]}>
                    <Text style={[s.actionTxt, s.actionTxtOutline]}>수업 기록 확인하기</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* ── NOT_AVAILABLE ── */}
            {grStatus === "NOT_AVAILABLE" && (
              <>
                <View style={[s.card, s.cardGray]}>
                  <LucideIcon name="bar-chart-2" size={22} color="#64748B" />
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, { color: "#334155" }]}>이번 달 성장 리포트</Text>
                    <Text style={s.cardDesc}>
                      수업 기록이 쌓이면{"\n"}이번 달 성장 리포트를 확인할 수 있어요.
                    </Text>
                    <Text style={s.cardSubDesc}>
                      수업이 기록될수록 아이의 성장 흐름이 더 정확하게 정리됩니다.
                    </Text>
                  </View>
                </View>
                <View style={s.btnRow}>
                  <Pressable onPress={handleGoHome} style={[s.actionBtn, s.actionBtnFlex]}>
                    <Text style={s.actionTxt}>홈으로 돌아가기</Text>
                  </Pressable>
                  <Pressable onPress={handleViewDiary} style={[s.actionBtn, s.actionBtnFlex, s.actionBtnOutline]}>
                    <Text style={[s.actionTxt, s.actionTxtOutline]}>수업 기록 보기</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* ── FAILED ── */}
            {grStatus === "FAILED" && (
              <>
                <View style={[s.card, s.cardRed]}>
                  <LucideIcon name="alert-circle" size={22} color="#DC2626" />
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, { color: "#DC2626" }]}>이번 달 성장 리포트</Text>
                    <Text style={s.cardDesc}>
                      이번 달 성장 리포트 생성에 문제가 발생했습니다.{"\n"}다음 달 리포트를 기대해주세요.
                    </Text>
                  </View>
                </View>
                <View style={s.btnRow}>
                  <Pressable onPress={handleRetry} style={[s.actionBtn, s.actionBtnFlex]}>
                    <Text style={s.actionTxt}>다시 시도</Text>
                  </Pressable>
                  <Pressable onPress={handleGoHome} style={[s.actionBtn, s.actionBtnFlex, s.actionBtnOutline]}>
                    <Text style={[s.actionTxt, s.actionTxtOutline]}>홈으로 돌아가기</Text>
                  </Pressable>
                </View>
              </>
            )}

          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 16,
    paddingVertical:   12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  backBtn: {
    width:          32,
    height:         32,
    alignItems:     "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize:   16,
    fontFamily: "Pretendard-SemiBold",
    color:      "#0F172A",
  },
  scroll: {
    flexGrow: 1,
    padding:  20,
  },
  centerBox: {
    flex:           1,
    alignItems:     "center",
    justifyContent: "center",
    paddingTop:     80,
    gap:            16,
  },
  centerTxt: {
    fontSize:   14,
    fontFamily: "Pretendard-Regular",
    color:      "#64748B",
    textAlign:  "center",
  },
  cardWrap: {
    paddingTop: 8,
  },
  // ── card variants ──
  card: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           14,
    borderRadius:  16,
    borderWidth:   1,
    padding:       18,
    marginBottom:  16,
  },
  cardGreen: {
    borderColor:     "#86EFAC",
    backgroundColor: "#F0FDF4",
  },
  cardBlue: {
    borderColor:     "#BAE6FD",
    backgroundColor: "#F0F9FF",
  },
  cardGray: {
    borderColor:     "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  cardRed: {
    borderColor:     "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  cardBody: {
    flex: 1,
    gap:  4,
  },
  cardTitle: {
    fontSize:   14,
    fontFamily: "Pretendard-SemiBold",
  },
  cardDesc: {
    fontSize:   13,
    fontFamily: "Pretendard-Regular",
    color:      "#334155",
    lineHeight: 20,
  },
  cardSubDesc: {
    marginTop:  6,
    fontSize:   12,
    fontFamily: "Pretendard-Regular",
    color:      "#64748B",
    lineHeight: 18,
  },
  // ── buttons ──
  btnRow: {
    flexDirection: "row",
    gap:           10,
    marginBottom:  12,
  },
  actionBtn: {
    paddingHorizontal: 20,
    paddingVertical:   12,
    backgroundColor:   "#0F172A",
    borderRadius:      10,
    alignItems:        "center",
    justifyContent:    "center",
    marginBottom:      12,
  },
  actionBtnFlex: {
    flex:         1,
    marginBottom: 0,
  },
  actionBtnOutline: {
    backgroundColor: "#FFFFFF",
    borderWidth:     1,
    borderColor:     "#CBD5E1",
  },
  actionTxt: {
    fontSize:   14,
    fontFamily: "Pretendard-SemiBold",
    color:      "#FFFFFF",
  },
  actionTxtOutline: {
    color: "#334155",
  },
});
