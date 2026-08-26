/**
 * GrowthReportFullFeed.tsx — FULL REDESIGN FROM ZERO (spec §1~§19)
 *
 * 핵심 원칙:
 *   - 하나의 긴 Instagram 게시물처럼 세로 스크롤
 *   - truncation / lineClamp / maxHeight / overflow hidden 전면 금지
 *   - navy 큰 배경 블록 금지 — 전체 배경 white
 *   - section마다 shadow/radius card 금지 — 얇은 divider만 사용
 *   - typography 4단계 고정
 *
 * Typography (spec §6):
 *   T1 section title  15px SemiBold deep navy
 *   T2 body           14px Regular  line-height 22 deep navy/blue-black
 *   T3 meta           12px Regular  muted blue-gray
 *   T4 action         12px Regular  muted
 *
 * AI calls = 0 (저장된 report_content만 사용)
 * PDF V3 / API / DB / Render / OTA 수정 금지
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

// ─── Color system (spec §5) ───────────────────────────────────────────────────
const DEEP_NAVY   = "#0D2E5A";
const AQUA        = "#25B7CF";
const AQUA_SOFT   = "#D9F2F6";
const AQUA_MIST   = "#F0FAFC";
const AQUA_TEXT   = "#1899B5";
const BODY        = "#1A2E44";
const META        = "#526C78";
const MUTED       = "#7A90A8";
const DIVIDER     = "#EBF1F7";
const WHITE       = "#FFFFFF";

// ─── Typography (spec §6) ─────────────────────────────────────────────────────
const T1: any = { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: DEEP_NAVY };
const T2: any = { fontSize: 14, fontFamily: "Pretendard-Regular",  color: BODY, lineHeight: 22 };
const T3: any = { fontSize: 12, fontFamily: "Pretendard-Regular",  color: META };
const T4: any = { fontSize: 12, fontFamily: "Pretendard-Regular",  color: MUTED };

// ─── Section config (spec §8, §11) ───────────────────────────────────────────
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

  // 커리큘럼 진도 (spec §4)
  const pct        = progressData?.display_confirmed_pct;
  const hasProgress =
    (progressData?.observation_session_count ?? 0) >= 3 &&
    typeof pct === "number" && pct > 0;
  const pctInt = hasProgress ? Math.round(pct!) : 0;

  // 날짜 포맷
  const periodLabel = formatPeriod(item.report_period);

  function goDetail() {
    router.push(`/(parent)/growth-report-detail?reportId=${encodeURIComponent(item.growth_report_id)}`);
  }

  return (
    <View style={{ backgroundColor: WHITE }}>

      {/* ── 1. TOP IDENTITY HEADER (spec §3) ──────────────────────── */}
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: DIVIDER,
        minHeight: 52,
      }}>
        {/* LEFT: 실제 로고 — 28px height (20~30% up from 22px), width auto */}
        <Image
          source={LOGO}
          style={{ height: 28, width: undefined, aspectRatio: 2774 / 998 }}
          resizeMode="contain"
        />

        {/* RIGHT: 월간 리포트 레이블 + 학생/수영장 */}
        <View style={{ marginLeft: "auto" as any, alignItems: "flex-end", paddingRight: 2 }}>
          <Text style={{ ...T3, color: AQUA_TEXT, fontFamily: "Pretendard-SemiBold" }}>
            월간 리포트
          </Text>
          {(studentName || poolName) && (
            <Text style={{ ...T3, marginTop: 2 }}>
              {[studentName, poolName].filter(Boolean).join("  ")}
            </Text>
          )}
        </View>
      </View>

      {/* ── 2. REPORT META STRIP (spec §4) ────────────────────────── */}
      <View style={{
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: DIVIDER,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
      }}>
        <Text style={T3}>{periodLabel}</Text>
        {hasProgress && (
          <>
            <Text style={{ ...T3, color: AQUA_SOFT }}>·</Text>
            <Text style={{ ...T3, color: AQUA_TEXT }}>현재 진도 {pctInt}%</Text>
          </>
        )}
      </View>

      {/* ── CONTENT ────────────────────────────────────────────────── */}
      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator size="small" color={AQUA} />
        </View>
      ) : failed ? (
        <FailState onRetry={fetchDetail} onDetail={goDetail} />
      ) : detail ? (
        <ReportBody
          detail={detail}
          hasProgress={hasProgress}
          pctInt={pctInt}
          onDetail={goDetail}
        />
      ) : null}

    </View>
  );
}

// ─── Report body ──────────────────────────────────────────────────────────────
function ReportBody({
  detail, hasProgress, pctInt, onDetail,
}: {
  detail:      GrowthReportDetail;
  hasProgress: boolean;
  pctInt:      number;
  onDetail:    () => void;
}) {
  const { report_content } = detail;
  const secs = report_content?.sections ?? {};

  const hasSummary = !isEmpty(report_content.summary_text);
  const bodySecs   = BODY_SECTIONS.filter((s) => !isEmpty(secs[s.key]?.text));
  const parentText = secs["parent_support"]?.text ?? "";
  const hasParent  = !isEmpty(parentText);

  // 커리큘럼 진도 bar는 summary 아래에 별도 렌더
  return (
    <View>

      {/* ── 3. SUMMARY (spec §7) ────────────────────────────────── */}
      {hasSummary && (
        <View style={{
          backgroundColor: AQUA_MIST,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 16,
        }}>
          <SectionTitle label="이번 달 한눈에 보기" />
          <Text style={{ ...T2, marginTop: 8 }}>
            {report_content.summary_text}
          </Text>
        </View>
      )}

      {/* 커리큘럼 진도 바 */}
      {hasProgress && (
        <>
          <Hairline />
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}>
              <Text style={T3}>커리큘럼 진도</Text>
              <Text style={{ ...T3, color: AQUA_TEXT, fontFamily: "Pretendard-SemiBold" }}>
                {pctInt}%
              </Text>
            </View>
            <View style={{
              height: 3,
              backgroundColor: AQUA_SOFT,
              borderRadius: 2,
              overflow: "hidden" as const,
            }}>
              <View style={{
                height: "100%" as const,
                width: `${Math.min(100, pctInt)}%` as `${number}%`,
                backgroundColor: AQUA,
                borderRadius: 2,
              }} />
            </View>
          </View>
        </>
      )}

      {/* ── 4. REPORT SECTIONS (spec §8) ────────────────────────── */}
      {bodySecs.map((sec) => (
        <React.Fragment key={sec.key}>
          <Hairline />
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 }}>
            <SectionTitle label={sec.label} />
            <Text style={{ ...T2, marginTop: 8 }}>
              {secs[sec.key]!.text}
            </Text>
          </View>
        </React.Fragment>
      ))}

      {/* ── 5. PARENT SUPPORT (spec §11) ────────────────────────── */}
      {hasParent && (
        <>
          <Hairline />
          <View style={{
            backgroundColor: AQUA_MIST,
            borderTopWidth: 1,
            borderTopColor: AQUA_SOFT,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 20,
          }}>
            <SectionTitle label="가정에서 함께해요" />
            <Text style={{ ...T2, marginTop: 8 }}>
              {parentText}
            </Text>
          </View>
        </>
      )}

      {/* ── 6. ACTION ROW (spec §12) ─────────────────────────────── */}
      <ActionRow onDetail={onDetail} />

    </View>
  );
}

// ─── Section title (spec §8) — 왼쪽 aqua vertical line + T1 text ─────────────
function SectionTitle({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{
        width: 3,
        height: 16,
        borderRadius: 2,
        backgroundColor: AQUA,
      }} />
      <Text style={T1}>{label}</Text>
    </View>
  );
}

// ─── Hairline divider (spec §8) ───────────────────────────────────────────────
function Hairline() {
  return <View style={{ height: 1, backgroundColor: DIVIDER }} />;
}

// ─── Action row (spec §12) ────────────────────────────────────────────────────
function ActionRow({ onDetail }: { onDetail: () => void }) {
  return (
    <View style={{
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: DIVIDER,
      backgroundColor: WHITE,
    }}>
      {/* 좋아요 */}
      <View style={{ padding: 6 }}>
        <LucideIcon name="heart" size={20} color={MUTED} />
      </View>
      {/* 댓글 */}
      <View style={{ padding: 6 }}>
        <LucideIcon name="message-circle" size={20} color={MUTED} />
      </View>

      <View style={{ flex: 1 }} />

      {/* PDF·공유 */}
      <Pressable
        onPress={onDetail}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 6,
          backgroundColor: pressed ? AQUA_MIST : "transparent",
        })}
      >
        <LucideIcon name="download" size={16} color={MUTED} />
        <Text style={{ ...T4, marginLeft: 2 }}>PDF·공유</Text>
      </Pressable>
    </View>
  );
}

// ─── Fail state ───────────────────────────────────────────────────────────────
function FailState({ onRetry, onDetail }: { onRetry: () => void; onDetail: () => void }) {
  return (
    <View style={{ padding: 28, alignItems: "center", gap: 12 }}>
      <Text style={{ ...T3, textAlign: "center" }}>
        리포트를 불러오지 못했습니다.
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onRetry}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: AQUA_SOFT,
            backgroundColor: AQUA_MIST,
          }}
        >
          <Text style={{ ...T4, color: AQUA_TEXT }}>다시 시도</Text>
        </Pressable>
        <Pressable
          onPress={onDetail}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: AQUA_SOFT,
            backgroundColor: AQUA_MIST,
          }}
        >
          <Text style={{ ...T4, color: AQUA_TEXT }}>상세 보기</Text>
        </Pressable>
      </View>
    </View>
  );
}
