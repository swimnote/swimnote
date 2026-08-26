/**
 * GrowthReportFeedCard — Premium visual card for parent feed
 *
 * Design brief: "성장 아카이브"
 *   - 피드에서 리포트가 도착했음을 즉각 인지
 *   - AI 분석 결과를 간결하게 보여주는 전용 composition
 *   - 기존 일지 카드보다 특별하되 앱 전체 디자인 언어와 일치
 *   - Apple-level density: 충분한 white space, 정밀한 타이포그래피
 *
 * Action bar (이번 Step): 위치·디자인만 구현. touch logic 미연결.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";

const C = Colors.light;

// ─── 로컬 색상 상수 ──────────────────────────────────────────────────────────
const NAVY        = "#0F2742";   // 딥 네이비 — header bg, 강조 텍스트
const NAVY_DARK   = "#091D33";   // 더 어두운 네이비 — header gradient 느낌
const AQUA        = "#25B7CF";   // Clear Pool Primary — accent line, dot
const AQUA_SOFT   = "#D9F2F6";   // Clear Pool Soft — action bar bg
const AQUA_MIST   = "#EEF9FB";   // Clear Pool Mist — preview bg
const WHITE       = "#FFFFFF";
const TEXT_ON_NAVY = "#E8F4FF";  // 네이비 위 readability

// ─── Props ───────────────────────────────────────────────────────────────────
interface Preview {
  summary_text?: string;
  headline?: string;
  key_points?: string[];
}

export interface GrowthReportFeedItem {
  type: "GROWTH_REPORT";
  id: string;
  growth_report_id: string;
  student_id: string;
  report_period: string;       // "YYYY-MM"
  published_at: string;
  created_at: string;
  title: string;               // e.g. "8월 성장리포트"
  preview: Preview;
  share_safe: boolean;
}

interface Props {
  item: GrowthReportFeedItem;
  studentName?: string;
  poolName?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function GrowthReportFeedCard({ item, studentName, poolName }: Props) {
  const period = item.report_period ?? "";
  const [year, month] = period.split("-");
  const monthNum = month ? Number(month) : null;
  const dateLabel = year && monthNum ? `${year}년 ${monthNum}월` : period;
  const monthLabel = monthNum ? `${monthNum}월 성장리포트` : "성장리포트";

  const headline   = item.preview?.headline ?? "";
  const keyPoints  = item.preview?.key_points ?? [];
  // key_points 중 최대 3개만 노출 (모바일 스크롤 밀도 고려)
  const visiblePoints = keyPoints.slice(0, 3);

  function handlePress() {
    router.push(
      `/(parent)/growth-report-detail?reportId=${encodeURIComponent(item.growth_report_id)}`,
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${dateLabel} 성장리포트 보기`}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: WHITE,
        // 미세한 shadow — premium depth 표현
        shadowColor: NAVY,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 12,
        elevation: 3,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      {/* ── 1. 헤더 밴드 — 네이비 배경 ────────────────────────────────────── */}
      <HeaderBand monthLabel={monthLabel} poolName={poolName} />

      {/* ── 2. 리포트 Preview 영역 ──────────────────────────────────────────── */}
      <ReportPreview
        dateLabel={dateLabel}
        studentName={studentName}
        headline={headline}
        keyPoints={visiblePoints}
      />

      {/* ── 3. 액션 바 ──────────────────────────────────────────────────────── */}
      <ActionBar />
    </Pressable>
  );
}

// ─── 1. Header Band ───────────────────────────────────────────────────────────
function HeaderBand({
  monthLabel,
  poolName,
}: {
  monthLabel: string;
  poolName?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: NAVY,
        paddingHorizontal: 18,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* 좌: 브랜드 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        {/* 세련된 아이콘 대신 텍스트 배지 — 텍스트 중심 디자인 */}
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: AQUA,
            marginTop: 1,
          }}
        />
        <Text
          style={{
            fontSize: 11,
            fontFamily: "Pretendard-SemiBold",
            color: TEXT_ON_NAVY,
            letterSpacing: 0.8,
          }}
        >
          SwimNote AI
        </Text>
      </View>

      {/* 우: 리포트 타입 + 수영장명 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {poolName ? (
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Pretendard-Regular",
              color: "#7FA8C9",
              maxWidth: 80,
            }}
            numberOfLines={1}
          >
            {poolName}
          </Text>
        ) : null}
        <View
          style={{
            backgroundColor: "#1A3F6A",
            borderRadius: 5,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontFamily: "Pretendard-SemiBold",
              color: AQUA,
              letterSpacing: 0.5,
            }}
          >
            {monthLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── 2. Report Preview ────────────────────────────────────────────────────────
function ReportPreview({
  dateLabel,
  studentName,
  headline,
  keyPoints,
}: {
  dateLabel: string;
  studentName?: string;
  headline: string;
  keyPoints: string[];
}) {
  return (
    <View
      style={{
        backgroundColor: AQUA_MIST,
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 16,
      }}
    >
      {/* ── 날짜 + 학생 이름 ───────────────────────────────────────── */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontFamily: "Pretendard-Bold",
            color: NAVY,
            letterSpacing: -0.3,
            lineHeight: 27,
          }}
        >
          {dateLabel}
        </Text>
        {studentName ? (
          <Text
            style={{
              fontSize: 13,
              fontFamily: "Pretendard-Medium",
              color: C.textSecondary,
              lineHeight: 27,
            }}
          >
            {studentName}
          </Text>
        ) : null}
      </View>

      {/* ── 액센트 라인 ───────────────────────────────────────────── */}
      <View
        style={{
          height: 2,
          backgroundColor: AQUA,
          borderRadius: 1,
          width: 36,
          marginBottom: 14,
        }}
      />

      {/* ── 핵심 성장 헤드라인 ─────────────────────────────────────── */}
      {headline ? (
        <Text
          style={{
            fontSize: 15,
            fontFamily: "Pretendard-SemiBold",
            color: NAVY,
            lineHeight: 23,
            marginBottom: 12,
            letterSpacing: -0.2,
          }}
        >
          {headline}
        </Text>
      ) : null}

      {/* ── Key Points ─────────────────────────────────────────────── */}
      {keyPoints.length > 0 ? (
        <View style={{ gap: 6 }}>
          {keyPoints.map((pt, idx) => (
            <KeyPointRow key={idx} text={pt} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Key Point Row ────────────────────────────────────────────────────────────
function KeyPointRow({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      {/* 작은 bullet — AQUA */}
      <View
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: AQUA,
          marginTop: 7,
          flexShrink: 0,
        }}
      />
      <Text
        style={{
          fontSize: 13,
          fontFamily: "Pretendard-Regular",
          color: C.textSecondary,
          lineHeight: 20,
          flex: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

// ─── 3. Action Bar ────────────────────────────────────────────────────────────
function ActionBar() {
  return (
    <View
      style={{
        backgroundColor: WHITE,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 18,
        paddingVertical: 11,
        // 내부 경계: AQUA_SOFT
        borderTopWidth: 1,
        borderTopColor: AQUA_SOFT,
        gap: 0,
      }}
    >
      {/* 좋아요 */}
      <ActionItem icon="heart" label="좋아요" />
      {/* 댓글 */}
      <ActionItem icon="message-circle" label="댓글" />

      {/* 간격 */}
      <View style={{ flex: 1 }} />

      {/* Instagram — 브랜드 특성 아이콘 */}
      <ActionItem icon="instagram" label="Instagram" />
      {/* PDF 다운로드 */}
      <ActionItem icon="download" label="PDF" />
    </View>
  );
}

function ActionItem({
  icon,
  label,
}: {
  icon: string;
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <LucideIcon name={icon} size={17} color={C.textMuted} />
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Pretendard-Regular",
          color: C.textMuted,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
