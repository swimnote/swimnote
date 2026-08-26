/**
 * GrowthReportFullFeed.tsx — VISUAL REFINEMENT ROUND 2 + X COLOR CORRECTION
 *
 * COLOR SYSTEM: SWIMNOTE X 전용 팔레트만 사용
 *   X_NAVY      #0F172A  — 제목 / 구조 / 강한 정보
 *   X_MINT      #2EC4B6  — accent / active / progress / 강조선
 *   X_MINT_LIGHT #E6FAF8 — 핵심 영역 배경 / badge 배경 / highlight
 *   WHITE       #FFFFFF  — 일반 분석 section
 *   GRAY 계열           — metadata / divider / inactive utility
 *
 * 일반 SWIMNOTE aqua/cyan 계열 (#25B7CF, #E8F7FB, #F0FAFC 등) 전면 제거.
 *
 * 구조 변경 없음. typography 크기 변경 없음.
 * AI calls = 0. PDF V3 / API / DB / Render / OTA 수정 금지.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { LucideIcon } from "@/components/common/LucideIcon";
import type { CurriculumProgressData } from "@/components/CurriculumProgressGauge";
import type { GrowthReportFeedItem } from "@/components/parent/GrowthReportFeedCard";

// ─── Asset ───────────────────────────────────────────────────────────────────
const LOGO = require("@/assets/images/swimnote-ai-report-logo.png");

// ─── SWIMNOTE X Color System ─────────────────────────────────────────────────
const X_NAVY        = "#0F172A";   // 제목 / 구조 / 강한 정보
const X_MINT        = "#2EC4B6";   // accent / active / progress fill / 강조선
const X_MINT_LIGHT  = "#E6FAF8";   // 핵심 영역 배경 / badge 배경 / highlight
const WHITE         = "#FFFFFF";   // 일반 분석 section 배경

// Neutral gray 계열 (보조용)
const BODY          = "#111827";   // body text — high contrast
const META          = "#475569";   // metadata — readable gray
const META_DARK     = "#334155";   // action row label
const MUTED         = "#64748B";   // inactive / hint
const DIVIDER       = "#E2E8F0";   // neutral gray divider
const DIVIDER_A     = "#E2E8F0";   // neutral divider (mint 제거)
const PROGRESS_TRACK = "#E2E8F0"; // progress bar track (neutral)

// ─── Typography ──────────────────────────────────────────────────────────────
const T1: any = { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: X_NAVY };
const T2: any = { fontSize: 14, fontFamily: "Pretendard-Regular",  color: BODY,     lineHeight: 22 };
const T3: any = { fontSize: 12, fontFamily: "Pretendard-Regular",  color: META };
const T4: any = { fontSize: 12, fontFamily: "Pretendard-Regular",  color: META_DARK };

// ─── Section config ───────────────────────────────────────────────────────────
const BODY_SECTIONS = [
  { key: "core_growth",             label: "핵심 성장" },
  { key: "swimming_progress",       label: "수영 교육과정 진행" },
  { key: "behavioral_strengths",    label: "행동 강점" },
  { key: "longitudinal_comparison", label: "이전 기간 비교" },
  { key: "success_conditions",      label: "성공 조건" },
  { key: "teacher_guidance",        label: "교사 관찰 메모" },
  { key: "next_growth_direction",   label: "다음 수업 방향" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isEmpty(text?: string | null): boolean {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  if (/^[\(\（]?이번\s*(달|기간|수업)?\s*(해당)?\s*(내용|사항)?\s*(없음|없어요|없습니다)[\)\）]?\.?$/.test(t)) return true;
  return false;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReportContent {
  summary_text: string;
  sections: Record<string, { text: string } | undefined>;
}
interface GrowthReportDetail {
  report_id:      string;
  report_period:  string;
  report_content: ReportContent;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  item:          GrowthReportFeedItem;
  studentName?:  string;
  poolName?:     string;
  progressData?: CurriculumProgressData | null;
}

// ─── Root component ───────────────────────────────────────────────────────────
export function GrowthReportFullFeed({ item, studentName, poolName, progressData }: Props) {
  const { token } = useAuth();
  const mounted   = useRef(true);

  const [detail,     setDetail]     = useState<GrowthReportDetail | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [failed,     setFailed]     = useState(false);

  // ── Like state ──────────────────────────────────────────────────────────────
  const [myLiked,    setMyLiked]    = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fetchDetail = useCallback(async () => {
    if (!item.growth_report_id) return;
    setLoading(true);
    setFailed(false);
    try {
      const res  = await apiRequest(token, `/parent/growth-reports/${encodeURIComponent(item.growth_report_id)}`);
      const data = await res.json();
      if (!mounted.current) return;
      if (res.ok && data?.report_content) {
        setDetail(data as GrowthReportDetail);
      } else {
        setFailed(true);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [token, item.growth_report_id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // ── Reactions fetch (useFocusEffect → 화면 재진입 시마다 최신화) ─────────────
  const fetchReactions = useCallback(async () => {
    if (!item.growth_report_id || !token) return;
    try {
      const res  = await apiRequest(token, `/parent/growth-reports/${encodeURIComponent(item.growth_report_id)}/reactions`);
      const data = await res.json();
      if (!mounted.current) return;
      if (res.ok && Array.isArray(data?.myReactions)) {
        setMyLiked((data.myReactions as string[]).includes("like"));
      }
    } catch {
      // 실패 시 기존 상태 유지
    }
  }, [token, item.growth_report_id]);

  useFocusEffect(useCallback(() => {
    fetchReactions();
  }, [fetchReactions]));

  // ── Like toggle ─────────────────────────────────────────────────────────────
  async function onLike() {
    if (isToggling) return;
    setIsToggling(true);
    try {
      const res  = await apiRequest(
        token,
        `/parent/growth-reports/${encodeURIComponent(item.growth_report_id)}/reactions`,
        { method: "POST", body: JSON.stringify({ reaction_type: "like" }) },
      );
      const data = await res.json();
      if (!mounted.current) return;
      if (res.ok && typeof data?.active === "boolean") {
        setMyLiked(data.active);
      }
    } catch {
      // 실패 시 기존 상태 유지
    } finally {
      if (mounted.current) setIsToggling(false);
    }
  }

  const pct        = progressData?.display_confirmed_pct;
  const hasProgress =
    (progressData?.observation_session_count ?? 0) >= 3 &&
    typeof pct === "number" && pct > 0;
  const pctInt = hasProgress ? Math.round(pct!) : 0;

  const periodLabel = formatPeriod(item.report_period);

  function goDetail() {
    router.push(`/(parent)/growth-report-detail?reportId=${encodeURIComponent(item.growth_report_id)}`);
  }

  return (
    <View style={{ backgroundColor: WHITE }}>

      {/* ── HEADER ────────────────────────────────────────────────── */}
      <ReportHeader
        studentName={studentName}
        poolName={poolName}
        periodLabel={periodLabel}
        hasProgress={hasProgress}
        pctInt={pctInt}
      />

      {/* ── CONTENT ───────────────────────────────────────────────── */}
      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator size="small" color={X_MINT} />
        </View>
      ) : failed ? (
        <FailState onRetry={fetchDetail} onDetail={goDetail} />
      ) : detail ? (
        <ReportBody
          detail={detail}
          onDetail={goDetail}
          myLiked={myLiked}
          isToggling={isToggling}
          onLike={onLike}
        />
      ) : null}

    </View>
  );
}

// ─── Header (4-row) ──────────────────────────────────────────────────────────
function ReportHeader({
  studentName, poolName, periodLabel, hasProgress, pctInt,
}: {
  studentName?: string;
  poolName?:    string;
  periodLabel:  string;
  hasProgress:  boolean;
  pctInt:       number;
}) {
  const metaParts = [studentName, poolName, periodLabel].filter(Boolean);

  return (
    <View style={{
      backgroundColor: WHITE,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 14,
    }}>

      {/* Row 1: 로고 (좌) + 월간 리포트 badge (우) */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
        <Image
          source={LOGO}
          style={{ height: 28, width: undefined, aspectRatio: 2774 / 998 }}
          resizeMode="contain"
        />
        <View style={{ marginLeft: "auto" as any }}>
          <View style={{
            backgroundColor: X_NAVY,
            borderRadius: 4,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}>
            <Text style={{ ...T3, color: "#FFFFFF", fontFamily: "Pretendard-SemiBold", letterSpacing: 0.5 }}>
              MONTHLY
            </Text>
          </View>
        </View>
      </View>

      {/* Row 2: 월간 성장 리포트 */}
      <Text style={{
        fontSize: 18,
        fontFamily: "Pretendard-SemiBold",
        color: X_NAVY,
        letterSpacing: -0.3,
        marginBottom: 6,
      }}>
        AI 성장 리포트
      </Text>

      {/* Row 3: 학생 · 수영장 · 월 */}
      <Text style={{ ...T3, color: META, marginBottom: hasProgress ? 12 : 0 }}>
        {metaParts.join("  ·  ")}
      </Text>

      {/* Row 4: 커리큘럼 진도 strip (Type C) */}
      {hasProgress && (
        <View style={{
          backgroundColor: "#F0F2F5",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
        }}>
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}>
            <Text style={{ ...T3, color: X_NAVY, fontFamily: "Pretendard-SemiBold" }}>
              커리큘럼 진도
            </Text>
            <Text style={{
              fontSize: 13,
              fontFamily: "Pretendard-SemiBold",
              color: X_MINT,
            }}>
              {pctInt}%
            </Text>
          </View>
          <View style={{
            height: 4,
            backgroundColor: PROGRESS_TRACK,
            borderRadius: 3,
            overflow: "hidden" as const,
          }}>
            <View style={{
              height: "100%" as const,
              width: `${Math.min(100, pctInt)}%` as `${number}%`,
              backgroundColor: X_MINT,
              borderRadius: 3,
            }} />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Report body ──────────────────────────────────────────────────────────────
function ReportBody({
  detail, onDetail, myLiked, isToggling, onLike,
}: {
  detail:      GrowthReportDetail;
  onDetail:    () => void;
  myLiked:     boolean;
  isToggling:  boolean;
  onLike:      () => void;
}) {
  const { report_content } = detail;
  const secs = report_content?.sections ?? {};

  const hasSummary = !isEmpty(report_content.summary_text);
  const bodySecs   = BODY_SECTIONS.filter((s) => !isEmpty(secs[s.key]?.text));
  const parentText = secs["parent_support"]?.text ?? "";
  const hasParent  = !isEmpty(parentText);

  return (
    <View>

      {/* ── TYPE A: 이번 달 한눈에 보기 ────────────────────────────── */}
      {hasSummary && (
        <View style={{
          backgroundColor: "#F5F7FA",
          borderBottomWidth: 1,
          borderBottomColor: DIVIDER,
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 18,
        }}>
          <SectionTitle label="이번 달 한눈에 보기" type="A" />
          <Text style={{ ...T2, marginTop: 10 }}>
            {report_content.summary_text}
          </Text>
        </View>
      )}

      {/* ── TYPE B: 분석 섹션들 ─────────────────────────────────────── */}
      {bodySecs.map((sec) => (
        <React.Fragment key={sec.key}>
          <Hairline />
          <View style={{
            backgroundColor: WHITE,
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: 18,
          }}>
            <SectionTitle label={sec.label} type="B" />
            <Text style={{ ...T2, marginTop: 10 }}>
              {secs[sec.key]!.text}
            </Text>
          </View>
        </React.Fragment>
      ))}

      {/* ── TYPE A: 가정에서 함께해요 ───────────────────────────────── */}
      {hasParent && (
        <>
          <View style={{ height: 1, backgroundColor: DIVIDER }} />
          <View style={{
            backgroundColor: "#F5F7FA",
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: 20,
          }}>
            <SectionTitle label="가정에서 함께해요" type="A" />
            <Text style={{ ...T2, marginTop: 10 }}>
              {parentText}
            </Text>
          </View>
        </>
      )}

      {/* ── ACTION ROW ──────────────────────────────────────────────── */}
      <ActionRow
        onDetail={onDetail}
        myLiked={myLiked}
        isToggling={isToggling}
        onLike={onLike}
      />

    </View>
  );
}

// ─── Section title ────────────────────────────────────────────────────────────
// Type A: X_MINT accent bar (핵심 영역)
// Type B: X_NAVY accent bar (분석 영역)
function SectionTitle({ label, type }: { label: string; type: "A" | "B" }) {
  const barColor = type === "A" ? X_MINT : X_NAVY;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
      <View style={{ width: 3, height: 17, borderRadius: 2, backgroundColor: barColor }} />
      <Text style={T1}>{label}</Text>
    </View>
  );
}

// ─── Hairline divider ─────────────────────────────────────────────────────────
function Hairline() {
  return <View style={{ height: 1, backgroundColor: DIVIDER }} />;
}

// ─── Action row ───────────────────────────────────────────────────────────────
function ActionRow({
  onDetail, myLiked, isToggling, onLike,
}: {
  onDetail:   () => void;
  myLiked:    boolean;
  isToggling: boolean;
  onLike:     () => void;
}) {
  // DiaryFeedItem(home.tsx) 동일 spec
  const LIKE_ACTIVE   = "#E8003D";
  const LIKE_INACTIVE = "#6B7280";

  return (
    <View style={{
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: DIVIDER,
      backgroundColor: WHITE,
      paddingVertical: 4,
      paddingHorizontal: 0,
      justifyContent: "space-around",
    }}>
      {/* 좋아요 — DiaryFeedItem 동일 spec */}
      <Pressable
        onPress={onLike}
        disabled={isToggling}
        style={({ pressed }) => ({
          flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
          paddingVertical: 8, borderRadius: 4,
          opacity: pressed ? 0.7 : (isToggling ? 0.5 : 1),
          gap: 5,
        })}
      >
        <LucideIcon
          name="heart"
          size={20}
          color={myLiked ? LIKE_ACTIVE : LIKE_INACTIVE}
          fill={myLiked ? LIKE_ACTIVE : "none"}
        />
        <Text style={{ ...T4, fontSize: 13, color: myLiked ? LIKE_ACTIVE : META_DARK }}>
          좋아요
        </Text>
      </Pressable>

      {/* 댓글 — stubbed (PHASE 3-B에서 연결) */}
      <Pressable style={({ pressed }) => ({
        flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
        paddingVertical: 8, borderRadius: 4, opacity: pressed ? 0.7 : 1, gap: 5,
      })}>
        <LucideIcon name="message-circle" size={18} color={MUTED} />
        <Text style={{ ...T4, fontSize: 13 }}>댓글</Text>
      </Pressable>

      {/* PDF·공유 */}
      <Pressable
        onPress={onDetail}
        style={({ pressed }) => ({
          flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
          paddingVertical: 8, borderRadius: 4, opacity: pressed ? 0.7 : 1, gap: 5,
        })}
      >
        <LucideIcon name="file-text" size={18} color={MUTED} />
        <Text style={{ ...T4, fontSize: 13 }}>PDF·공유</Text>
      </Pressable>
    </View>
  );
}

// ─── Fail state ───────────────────────────────────────────────────────────────
function FailState({ onRetry, onDetail }: { onRetry: () => void; onDetail: () => void }) {
  return (
    <View style={{ padding: 28, alignItems: "center", gap: 12 }}>
      <Text style={{ ...T3, textAlign: "center" }}>리포트를 불러오지 못했습니다.</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onRetry}
          style={{
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
            borderWidth: 1, borderColor: X_MINT, backgroundColor: X_MINT_LIGHT,
          }}
        >
          <Text style={{ ...T4, color: X_NAVY }}>다시 시도</Text>
        </Pressable>
        <Pressable
          onPress={onDetail}
          style={{
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
            borderWidth: 1, borderColor: X_MINT, backgroundColor: X_MINT_LIGHT,
          }}
        >
          <Text style={{ ...T4, color: X_NAVY }}>상세 보기</Text>
        </Pressable>
      </View>
    </View>
  );
}
