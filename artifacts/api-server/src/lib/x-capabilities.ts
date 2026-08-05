/**
 * x-capabilities.ts — SWIMNOTE X Capability 판정 모듈 (WP6)
 *
 * 역할:
 *   - XCapabilities interface 및 XCapabilityKey 정의
 *   - computeXCapabilities(modeResult) — 순수 함수, DB 조회 없음
 *   - EMPTY_X_CAPABILITIES 기본값
 *   - CAPABILITY_VERSION 상수
 *
 * 원칙:
 *   - DB 조회 없음 (resolvePoolMode 결과만 입력으로 받음)
 *   - mode === "x" 인 경우에도 미구현 기능은 false 고정
 *   - AI Engine 연결 후 해당 키만 true로 전환
 *   - WP7~WP9에서 재사용 (requireXCapability, 슈퍼관리자 UI)
 */
import type { PoolModeResult } from "./xmode.js";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type XCapabilityKey =
  | "x_mode"
  | "x_dashboard"
  | "ai_diary"
  | "ai_curriculum"
  | "growth_tracking"
  | "parent_ai"
  | "growth_report";

export interface XCapabilities {
  /** mode === "x" 여부 */
  x_mode:          boolean;
  /** X 브랜드 섹션·기본 화면 노출 권한 (mode === "x" 시 true) */
  x_dashboard:     boolean;
  /** AI 일지 V2 — false 고정 (AI Engine 연결 후 전환) */
  ai_diary:        boolean;
  /** AI 커리큘럼 — false 고정 */
  ai_curriculum:   boolean;
  /** 성장 추적 (Growth Event 검토·성장판) — false 고정 */
  growth_tracking: boolean;
  /** 학부모 AI — false 고정 */
  parent_ai:       boolean;
  /** 성장 리포트 — false 고정 */
  growth_report:   boolean;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

export const CAPABILITY_VERSION = "capability_v1";

export const EMPTY_X_CAPABILITIES: XCapabilities = {
  x_mode:          false,
  x_dashboard:     false,
  ai_diary:        false,
  ai_curriculum:   false,
  growth_tracking: false,
  parent_ai:       false,
  growth_report:   false,
};

// ── 순수 판정 함수 ────────────────────────────────────────────────────────────
//
// PoolModeResult(또는 null)를 받아 XCapabilities를 계산한다.
// DB 조회 없음. 상태 변경 없음.
//
// mode === "x"   → x_mode=true, x_dashboard=true, 나머지 false (미구현)
// mode !== "x"   → 전부 false (normal / x_pending 포함)
// null           → 전부 false (방어)
//
export function computeXCapabilities(
  modeResult: PoolModeResult | null,
): XCapabilities {
  if (!modeResult || modeResult.mode !== "x") {
    return { ...EMPTY_X_CAPABILITIES };
  }

  return {
    x_mode:          true,
    x_dashboard:     true,
    // 미구현 기능 — AI Engine·AI Diary·커리큘럼 연결 전까지 false 고정
    ai_diary:        false,
    ai_curriculum:   false,
    growth_tracking: false,
    parent_ai:       false,
    growth_report:   false,
  };
}
