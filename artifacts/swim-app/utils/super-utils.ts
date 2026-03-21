/**
 * super-utils.ts — 슈퍼관리자 공통 유틸리티
 * safeDate, fmtDate, fmtRelative, createAuditLog
 */
import { useAuth } from "@/context/AuthContext";

// ── 날짜 안전 파싱 ──────────────────────────────────────
export function safeDate(date: string | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateShort(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const h = Math.floor(m / 60);
  if (m < 1)  return "방금 전";
  if (m < 60) return `${m}분 전`;
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// ── 바이트 → 사람이 읽기 쉬운 형식 ────────────────────
export function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── 감사 로그 생성 ───────────────────────────────────────
export type AuditCategory =
  | "운영자" | "구독" | "결제" | "저장공간" | "데이터" | "정책"
  | "보안" | "기능 플래그" | "읽기전용" | "백업" | "고객센터" | "시스템";

export interface AuditLogPayload {
  category: AuditCategory;
  title: string;
  operatorId?: string;
  operatorName?: string;
  actor: string;
  impact: "low" | "medium" | "high" | "critical";
  detail?: string;
  reason?: string;
}

export async function createAuditLog(
  token: string | null,
  apiRequest: (token: string | null, path: string, opts?: RequestInit) => Promise<Response>,
  payload: AuditLogPayload
): Promise<void> {
  try {
    await apiRequest(token, "/super/op-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category:      payload.category,
        title:         payload.title,
        pool_id:       payload.operatorId ?? null,
        pool_name:     payload.operatorName ?? null,
        actor_name:    payload.actor,
        impact:        payload.impact,
        description:   payload.detail ?? payload.title,
        reason:        payload.reason ?? null,
      }),
    });
  } catch {
    // 감사 로그 실패는 주 작업을 막지 않음
  }
}

// ── 영향도 배지 색상 ─────────────────────────────────────
export const IMPACT_CFG: Record<string, { label: string; color: string; bg: string }> = {
  low:      { label: "낮음",    color: "#059669", bg: "#D1FAE5" },
  medium:   { label: "중간",    color: "#D97706", bg: "#FEF3C7" },
  high:     { label: "높음",    color: "#DC2626", bg: "#FEE2E2" },
  critical: { label: "심각",    color: "#7C3AED", bg: "#EDE9FE" },
};

// ── 구독 상태 설정 ───────────────────────────────────────
export const SUB_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  trial:           { label: "무료 체험",  color: "#0891B2", bg: "#ECFEFF" },
  active:          { label: "구독 중",    color: "#059669", bg: "#D1FAE5" },
  expired:         { label: "만료",       color: "#DC2626", bg: "#FEE2E2" },
  suspended:       { label: "정지",       color: "#D97706", bg: "#FEF3C7" },
  cancelled:       { label: "해지",       color: "#6B7280", bg: "#F3F4F6" },
  refund_pending:  { label: "환불 요청",  color: "#9333EA", bg: "#F3E8FF" },
  chargeback:      { label: "차지백",     color: "#DC2626", bg: "#FEE2E2" },
  readonly:        { label: "읽기전용",   color: "#0284C7", bg: "#E0F2FE" },
  deletion_pending:{ label: "삭제 예정",  color: "#DC2626", bg: "#FEE2E2" },
};

// ── 승인 상태 설정 ───────────────────────────────────────
export const APPROVAL_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "대기",  color: "#D97706", bg: "#FEF3C7" },
  approved: { label: "승인",  color: "#059669", bg: "#D1FAE5" },
  rejected: { label: "반려",  color: "#DC2626", bg: "#FEE2E2" },
};
