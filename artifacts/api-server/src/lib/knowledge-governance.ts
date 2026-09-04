/**
 * knowledge-governance.ts — WP-CS15: Knowledge Authority, Freshness & Conflict Detection
 *
 * Source Authority Model (§6)
 * Knowledge Freshness Assessment (§7)
 * Conflict Detection & Classification (§8-9)
 * Conflict Resolution (§10)
 * Safe Trace Reference Builder (§3)
 *
 * 원칙:
 *   - 새로운 LLM 호출 없음
 *   - ACTIVE/PENDING Knowledge 자동 변경 없음
 *   - conflicting knowledge 임의 merge/average 금지
 */

import type { EvidenceItem } from "./support-resolver.js";

// ── Source Authority Model (§6) ────────────────────────────────────────────────

/**
 * Knowledge source의 신뢰 우선순위.
 * 숫자가 낮을수록 높은 권위.
 */
export const SOURCE_AUTHORITY = {
  /** LEVEL 1: server code, feature registry, DB authoritative state, official policy */
  AUTHORITATIVE_PRODUCT_STATE: 1,
  /** LEVEL 2: ACTIVE FAQ, SOLUTION, GUIDE, POLICY, KNOWLEDGE */
  APPROVED_KNOWLEDGE:          2,
  /** LEVEL 3: confirmed active incident, incident resolution */
  INCIDENT_STATE:              3,
  /** LEVEL 4: prior resolution, heuristic, non-authoritative context */
  DERIVED:                     4,
  /** NONE: PENDING/DRAFT/REJECTED — grounding authority 없음 */
  NONE:                        99,
} as const;

export type SourceAuthorityLevel = typeof SOURCE_AUTHORITY[keyof typeof SOURCE_AUTHORITY];

/**
 * item_type + status로 source authority 결정.
 * status = 'pending' / 'draft' / 'rejected' → NONE (grounding 불가).
 */
export function getSourceAuthority(
  itemType: string,
  dbSourceType: string | null,
  status: string,
): SourceAuthorityLevel {
  // PENDING / non-active → no grounding authority
  if (status !== "active") return SOURCE_AUTHORITY.NONE;

  switch (itemType.toUpperCase()) {
    case "RULE":
    case "DB_STATE":
    case "FRONTEND_MAP":
      return SOURCE_AUTHORITY.AUTHORITATIVE_PRODUCT_STATE;

    case "FAQ":
    case "SOLUTION":
    case "KNOWLEDGE":
    case "GUIDE":
    case "POLICY":
    case "KNOWN_ISSUE":  // KNOWN_ISSUE = approved knowledge (§6 Level 2)
      return SOURCE_AUTHORITY.APPROVED_KNOWLEDGE;

    case "INCIDENT":
      return SOURCE_AUTHORITY.INCIDENT_STATE;

    default:
      // source_type 기반 fallback
      if (dbSourceType === "REGISTRY" || dbSourceType === "CODE") {
        return SOURCE_AUTHORITY.AUTHORITATIVE_PRODUCT_STATE;
      }
      return SOURCE_AUTHORITY.DERIVED;
  }
}

// ── Freshness Assessment (§7) ──────────────────────────────────────────────────

export type FreshnessState =
  | "CURRENT"      // < 30일
  | "REVIEW_DUE"   // 30~90일, 또는 90~365일 revision>1
  | "SUPERSEDED"   // superseded_by_id 존재 (CS15 schema extension)
  | "STALE"        // > 90일 + revision=1 (초기 이후 미수정), 또는 > 365일
  | "UNKNOWN";     // updated_at 없음

const MS_PER_DAY  = 86_400_000;
const DAYS_30     = 30  * MS_PER_DAY;
const DAYS_90     = 90  * MS_PER_DAY;
const DAYS_365    = 365 * MS_PER_DAY;

/**
 * updated_at과 revision으로 freshness 평가.
 * 대규모 CMS 구축 없이 기존 필드 기반.
 */
export function assessFreshness(
  updatedAt: Date | null,
  revision: number,
  supersededById?: string | null,
): FreshnessState {
  if (supersededById) return "SUPERSEDED";
  if (!updatedAt) return "UNKNOWN";

  const ageDays = Date.now() - updatedAt.getTime();

  if (ageDays < DAYS_30)  return "CURRENT";
  if (ageDays < DAYS_90)  return "REVIEW_DUE";
  if (ageDays < DAYS_365) return revision > 1 ? "REVIEW_DUE" : "STALE";
  return "STALE";  // > 365일
}

// ── Conflict Types (§9) ────────────────────────────────────────────────────────

export type ConflictType =
  | "HARD_CONFLICT"      // 동시에 참일 수 없음
  | "CONTEXT_CONFLICT"   // role/mode/platform 분리하면 모두 참
  | "VERSION_CONFLICT"   // 구버전 vs 신버전
  | "AUTHORITY_CONFLICT" // 낮은 authority가 높은 authority와 충돌
  | "NO_CONFLICT";       // 동시 사용 가능

export interface KnowledgeConflictRecord {
  type:           ConflictType;
  item_a_id:      string;
  item_b_id:      string;
  feature:        string | null;
  axis:           string;   // conflict이 발생한 축 (feature/role/mode/version/authority)
  winner_id:      string | null;  // 해결됐으면 우선 id, 아니면 null
  resolution:     "RESOLVED" | "UNRESOLVED" | "N/A";
  rationale:      string;
}

/**
 * EvidenceItem 쌍의 conflict를 탐지.
 * 동일 feature 범위에서만 conflict가 의미 있음.
 */
function detectPairConflict(
  a: EvidenceItem,
  b: EvidenceItem,
): KnowledgeConflictRecord {
  const base = { item_a_id: a.id, item_b_id: b.id, feature: a.feature };

  // 동일 항목 → no conflict
  if (a.id === b.id) {
    return { ...base, type: "NO_CONFLICT", axis: "none", winner_id: null, resolution: "N/A", rationale: "same item" };
  }

  // feature가 없거나 서로 다르면 conflict 없음 (다른 주제)
  if (!a.feature || a.feature !== b.feature) {
    return { ...base, type: "NO_CONFLICT", axis: "none", winner_id: null, resolution: "N/A", rationale: "different or null feature" };
  }

  const authA = getSourceAuthority(a.item_type, a.source_type ?? null, a.status);
  const authB = getSourceAuthority(b.item_type, b.source_type ?? null, b.status);

  // NONE authority → can't conflict (should not be in evidence, but defensive)
  if (authA === SOURCE_AUTHORITY.NONE || authB === SOURCE_AUTHORITY.NONE) {
    return { ...base, type: "NO_CONFLICT", axis: "status", winner_id: null, resolution: "N/A", rationale: "one or both items have NONE authority (pending)" };
  }

  // Authority 차이 → AUTHORITY_CONFLICT
  if (authA !== authB) {
    const winner = authA < authB ? a.id : b.id;  // 낮은 숫자 = 높은 권위
    return {
      ...base,
      type:       "AUTHORITY_CONFLICT",
      axis:       "authority",
      winner_id:  winner,
      resolution: "RESOLVED",
      rationale:  `authority level ${authA} vs ${authB} — level ${Math.min(authA, authB)} wins`,
    };
  }

  // 동일 authority, 동일 item_type, 동일 feature → version or hard conflict
  if (a.item_type === b.item_type) {
    const revA = a.revision ?? 1;
    const revB = b.revision ?? 1;
    if (revA !== revB) {
      const winner = revA > revB ? a.id : b.id;
      return {
        ...base,
        type:       "VERSION_CONFLICT",
        axis:       "version",
        winner_id:  winner,
        resolution: "RESOLVED",
        rationale:  `revision ${revA} vs ${revB} — higher revision wins`,
      };
    }
    // 동일 revision, 동일 type, 동일 feature → HARD_CONFLICT (resolve 불가)
    return {
      ...base,
      type:       "HARD_CONFLICT",
      axis:       "feature+type+revision",
      winner_id:  null,
      resolution: "UNRESOLVED",
      rationale:  "same feature/type/revision from different knowledge items",
    };
  }

  // 동일 authority, 다른 item_type, 동일 feature → CONTEXT_CONFLICT
  // (role/mode/platform이 다를 가능성 있어 일단 CONTEXT_CONFLICT)
  return {
    ...base,
    type:       "CONTEXT_CONFLICT",
    axis:       "item_type+feature",
    winner_id:  null,
    resolution: "UNRESOLVED",
    rationale:  `same feature '${a.feature}' from different types: ${a.item_type} vs ${b.item_type}`,
  };
}

/**
 * Evidence 배열 전체의 conflict 탐지.
 * 모든 쌍 대비 O(n²) — maxItems=5이므로 최대 10 쌍.
 * UNRESOLVED HARD/CONTEXT conflict는 호출자가 LLM에 전달 금지.
 */
export function detectConflicts(items: EvidenceItem[]): KnowledgeConflictRecord[] {
  const conflicts: KnowledgeConflictRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const c = detectPairConflict(items[i], items[j]);
      if (c.type !== "NO_CONFLICT") {
        conflicts.push(c);
      }
    }
  }
  return conflicts;
}

/**
 * Conflict resolution (§10).
 * conflicting items에서 우선 항목 선택.
 * HARD_CONFLICT / UNRESOLVED → null (safe fallback 필요).
 * 임의 merge/average 절대 금지.
 */
export function resolveConflictWinner(
  a: EvidenceItem,
  b: EvidenceItem,
): EvidenceItem | null {
  const c = detectPairConflict(a, b);
  if (c.type === "NO_CONFLICT") return null;
  if (c.resolution === "UNRESOLVED") return null;  // safe fallback — caller must escalate
  if (c.winner_id === a.id) return a;
  if (c.winner_id === b.id) return b;
  return null;
}

/**
 * Evidence 배열에서 HARD_CONFLICT / UNRESOLVED conflict가 있으면 true.
 * 이 경우 LLM에 해당 evidence pair를 전달해서는 안 됨.
 * UNRESOLVED_CONFLICT_EMITTED = 0 목표.
 */
export function hasUnresolvedConflict(items: EvidenceItem[]): boolean {
  const conflicts = detectConflicts(items);
  return conflicts.some(c => c.resolution === "UNRESOLVED");
}

// ── Duplicate ACTIVE Knowledge Audit (§12) ────────────────────────────────────

export type DuplicateClassification =
  | "EXACT_DUPLICATE"  // 완전 동일 (feature+type+role+mode 모두 동일)
  | "NEAR_DUPLICATE"   // 구조적으로 유사 (feature+type 동일, 다른 필드 일부 다름)
  | "VALID_VARIANT"    // 의도적 변형 (e.g. role-specific variants)
  | "REVIEW_REQUIRED"; // 검토 필요

export interface DuplicateCandidate {
  item_a_id:      string;
  item_b_id:      string;
  classification: DuplicateClassification;
  match_axes:     string[];
  rationale:      string;
}

/**
 * Evidence 배열에서 중복 ACTIVE Knowledge 탐지.
 * 자동 병합/삭제 금지. Review candidate 목록만 생성.
 */
export function detectDuplicates(items: EvidenceItem[]): DuplicateCandidate[] {
  const duplicates: DuplicateCandidate[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.id === b.id) continue;

      const matchAxes: string[] = [];
      if (a.feature && a.feature === b.feature) matchAxes.push("feature");
      if (a.category && a.category === b.category) matchAxes.push("category");
      if (a.item_type === b.item_type) matchAxes.push("item_type");
      if (a.status === b.status) matchAxes.push("status");

      if (matchAxes.length < 2) continue; // 관련 없음

      // feature + type + status 모두 동일 → NEAR_DUPLICATE 이상
      if (matchAxes.includes("feature") && matchAxes.includes("item_type") && matchAxes.includes("status")) {
        const revA = a.revision ?? 1;
        const revB = b.revision ?? 1;
        if (revA === revB) {
          duplicates.push({
            item_a_id:      a.id,
            item_b_id:      b.id,
            classification: "EXACT_DUPLICATE",
            match_axes:     matchAxes,
            rationale:      `same feature '${a.feature}', type '${a.item_type}', same revision ${revA}`,
          });
        } else {
          duplicates.push({
            item_a_id:      a.id,
            item_b_id:      b.id,
            classification: "NEAR_DUPLICATE",
            match_axes:     matchAxes,
            rationale:      `same feature '${a.feature}', type '${a.item_type}', different revisions ${revA}/${revB}`,
          });
        }
      } else if (matchAxes.includes("feature")) {
        duplicates.push({
          item_a_id:      a.id,
          item_b_id:      b.id,
          classification: "REVIEW_REQUIRED",
          match_axes:     matchAxes,
          rationale:      `same feature '${a.feature}', different types — may be valid variants`,
        });
      }
    }
  }
  return duplicates;
}

// ── Safe HTTP Trace Reference (§3) ────────────────────────────────────────────

/**
 * HTTP 응답에 포함할 안전한 evidence reference.
 * 내부 DB schema 전체/source text/PII 미포함.
 * opaque ref (knowledge id) + safe metadata만.
 */
export interface SafeEvidenceRef {
  ref:             string;   // knowledge item id (opaque — no semantic meaning to client)
  item_type:       string;   // FAQ / SOLUTION / FRONTEND_MAP etc.
  status:          string;   // always 'active' (PENDING never in evidence)
  revision:        number;   // version number
  freshness_state: FreshnessState;
}

/**
 * EvidenceItem → SafeEvidenceRef 변환.
 * 민감 필드(answer, title, source_ref, feature, category) 제외.
 */
export function buildSafeTraceRef(item: EvidenceItem): SafeEvidenceRef {
  return {
    ref:             item.id,
    item_type:       item.item_type,
    status:          item.status ?? "active",
    revision:        item.revision ?? 1,
    freshness_state: item.freshness_state ?? assessFreshness(
      item.updated_at ? new Date(item.updated_at) : null,
      item.revision ?? 1,
    ),
  };
}

// ── Incident Status (§14) ──────────────────────────────────────────────────────

export type IncidentStatus =
  | "INVESTIGATING"  // 현재 관련 현상을 확인 중
  | "CONFIRMED"      // 확인된 장애 발생
  | "MONITORING"     // 조치 후 모니터링
  | "RESOLVED"       // 해결됨
  | "FALSE_ALARM";   // 실제 장애 아님

/**
 * Incident status에 맞는 safe user message prefix.
 * LLM이 status를 임의로 CONFIRMED로 변경하면 안 됨 (§15).
 * INVESTIGATING과 CONFIRMED를 동일하게 표현 금지.
 */
export function getIncidentSafeMessagePrefix(status: IncidentStatus): string {
  switch (status) {
    case "INVESTIGATING":
      return "현재 관련 현상을 확인 중입니다.";
    case "CONFIRMED":
      return "현재 해당 기능에서 확인된 장애가 있습니다.";
    case "MONITORING":
      return "조치 완료 후 모니터링 중입니다.";
    case "RESOLVED":
      return "해당 장애는 해결된 상태입니다.";
    case "FALSE_ALARM":
      return "관련 장애는 확인되지 않았습니다.";
  }
}

/**
 * User가 outage를 주장했을 때 confirmed incident 없으면 safe fallback.
 * FALSE_INCIDENT_CLAIM = 0 목표.
 */
export const INCIDENT_FALLBACK_MESSAGE =
  "현재 확인된 장애 정보는 없습니다. 먼저 아래 항목을 확인해 주세요.";

/**
 * LLM/AI가 incident status를 변경할 수 있는가? — 절대 금지.
 * Incident status 변경 권한은 server/admin/human controlled path만 (§15).
 */
export const LLM_CAN_MODIFY_INCIDENT_STATUS = false as const;

// ── Audit Immutability Status (§21) ───────────────────────────────────────────

/**
 * 현재 audit log / support_events 구조가 append-only인지 여부.
 * "대규모 infra 변경 금지" — REVIEW_REQUIRED로 보고.
 */
export const AUDIT_LOG_IMMUTABILITY_STATUS = "REVIEW_REQUIRED" as const;
// 이유: support_events는 INSERT-only이나 DELETE 권한 제어가 확인 안 됨.
// support_cases.context_json은 UPDATE 가능 (append-only 아님).
// 운영 수준 immutability (PostgreSQL row-level security, WAL log) 미구성.

// ── Retention Policy (§23) ────────────────────────────────────────────────────

/**
 * Trace/Audit 데이터 retention policy 현황.
 * 코드/정책에 명시적 retention 기간 없음 → NOT_IMPLEMENTED.
 */
export const TRACE_RETENTION_POLICY = "NOT_IMPLEMENTED" as const;
// 이유: ai_traces / support_events에 TTL/retention 정책 없음.
// 임의 retention 기간 창작 금지 (§23).
