/**
 * CurriculumProgressGauge.tsx — GAUGE-06
 *
 * 교육과정 진행도 슬림 게이지.
 *
 * 표시 규칙:
 *   - display_confirmed_pct만 게이지 width/text 소스로 사용 (cross-version monotonic)
 *   - active_confirmed_pct는 응답에는 포함되나 UI에 미사용
 *   - 세션 3회 미만 또는 display=0 → 게이지 bar 숨기고 대기 문구 표시
 *   - X mode 전용 (호출 측에서 조건 제어)
 *
 * 금지:
 *   - "실력" / "숙련도" / "완성도" / "점수" 표현
 *   - 레벨별 게이지 (학생당 1개)
 *   - 새 배너/큰 카드/새로운 색상체계
 */

import React from "react";
import { View, Text } from "react-native";
import Colors from "@/constants/colors";
const C = Colors.light;

// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumProgressData {
  student_id: string;
  display_confirmed_pct: number;
  active_confirmed_pct: number;         // debug/reference 전용 — UI 미사용
  active_confirmed_rank: number;
  active_confirmed_total: number;
  active_curriculum_version_id: string | null;
  observation_session_count: number;
  confirmed_at: string | null;
  display_updated_at: string | null;
  is_version_transition: boolean;
}

interface Props {
  data: CurriculumProgressData | null;
  loading?: boolean;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** numeric(5,2) → 정수 %, NaN/null 방어 */
function toDisplayInt(pct: number | null | undefined): number {
  const n = Number(pct);
  if (!isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

/** bar width: 0~100 clamp */
function toBarWidth(pct: number): `${number}%` {
  const clamped = Math.max(0, Math.min(100, pct));
  return `${clamped}%`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CurriculumProgressGauge({ data, loading }: Props) {
  // 로딩 중이면 렌더 없음 (기존 여백 유지)
  if (loading) return null;

  // ── Empty state 판단 ──────────────────────────────────────────────────────
  // 세션 3회 미만 또는 display=0 → 대기 문구만 표시 (0%를 크게 보이지 않음)
  const hasData = !!data;
  const sessionCount = data?.observation_session_count ?? 0;
  const displayPct   = data?.display_confirmed_pct ?? 0;
  const isEmpty      = !hasData || sessionCount < 3 || displayPct <= 0;

  const displayInt = toDisplayInt(displayPct);
  const barWidth   = toBarWidth(displayPct);

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 2,
        marginBottom: 10,
      }}
    >
      {/* 라벨 행 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Pretendard-Medium",
            color: C.textSecondary,
            letterSpacing: -0.1,
          }}
        >
          교육과정 진행도
        </Text>
        {!isEmpty && (
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Pretendard-SemiBold",
              color: "#1B3A70",
            }}
          >
            {displayInt}%
          </Text>
        )}
      </View>

      {/* 진행 바 또는 대기 문구 */}
      {isEmpty ? (
        <Text
          style={{
            fontSize: 11,
            fontFamily: "Pretendard-Regular",
            color: C.textMuted,
            lineHeight: 16,
          }}
        >
          수업 기록이 쌓이면 교육과정 진행도가 표시됩니다.
        </Text>
      ) : (
        <>
          {/* 슬림 progress bar */}
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: C.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 3,
                width: barWidth,
                backgroundColor: "#2EC4B6",
              }}
            />
          </View>
          {/* 보조 문구 */}
          <Text
            style={{
              fontSize: 10,
              fontFamily: "Pretendard-Regular",
              color: C.textMuted,
              marginTop: 4,
            }}
          >
            최근 수업 기록을 기준으로 확인된 교육과정 위치
          </Text>
        </>
      )}
    </View>
  );
}
