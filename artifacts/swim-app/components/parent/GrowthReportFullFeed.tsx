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
const BODY          = "#1A2E44";   // body text — dark neutral, 기존 유지
const META          = "#526C78";   // metadata gray
const META_DARK     = "#3D5566";   // action row label — too faint 방지
const MUTED         = "#7A90A8";   // inactive / hint
const DIVIDER       = "#E8EDEF";   // neutral gray divider (Type B)
const DIVIDER_A     = "#C2EDE9";   // mint-tinted divider (Type A 경계)
const PROGRESS_TRACK = "#D0F0ED"; // progress bar track (mint-light 계열)

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

  const [detail,  setDetail]  = useState<GrowthReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);

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
        <ReportBody detail={detail} onDetail={goDetail} />
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
      borderBottomWidth: 1,
      borderBottomColor: DIVIDER,
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
            backgroundColor: X_MINT_LIGHT,
            borderWidth: 1,
            borderColor: X_MINT,
            borderRadius: 4,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}>
            <Text style={{ ...T3, color: X_NAVY, fontFamily: "Pretendard-SemiBold" }}>
              월간 리포트
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
        월간 성장 리포트
      </Text>

      {/* Row 3: 학생 · 수영장 · 월 */}
      <Text style={{ ...T3, color: META, marginBottom: hasProgress ? 12 : 0 }}>
        {metaParts.join("  ·  ")}
      </Text>

      {/* Row 4: 커리큘럼 진도 strip (Type C) */}
      {hasProgress && (
        <View style={{
          backgroundColor: X_MINT_LIGHT,
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
function ReportBody({ detail, onDetail }: { detail: GrowthReportDetail; onDetail: () => void }) {
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
          backgroundColor: X_MINT_LIGHT,
          borderBottomWidth: 1,
          borderBottomColor: DIVIDER_A,
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
          <View style={{ height: 1, backgroundColor: DIVIDER_A }} />
          <View style={{
            backgroundColor: X_MINT_LIGHT,
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
      <ActionRow onDetail={onDetail} />

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
function ActionRow({ onDetail }: { onDetail: () => void }) {
  return (
    <View style={{
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: DIVIDER,
      backgroundColor: WHITE,
    }}>
      <Pressable style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 4,
        padding: 6, opacity: pressed ? 0.6 : 1,
      })}>
        <LucideIcon name="heart" size={19} color={MUTED} />
        <Text style={T4}>좋아요</Text>
      </Pressable>

      <Pressable style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 4,
        padding: 6, marginLeft: 4, opacity: pressed ? 0.6 : 1,
      })}>
        <LucideIcon name="message-circle" size={19} color={MUTED} />
        <Text style={T4}>댓글</Text>
      </Pressable>

      <View style={{ flex: 1 }} />

      <Pressable
        onPress={onDetail}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 4,
          paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
          backgroundColor: pressed ? X_MINT_LIGHT : "transparent",
        })}
      >
        <LucideIcon name="download" size={15} color={MUTED} />
        <Text style={T4}>PDF·공유</Text>
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
