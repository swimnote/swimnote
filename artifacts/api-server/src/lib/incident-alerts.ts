/**
 * lib/incident-alerts.ts — WP9 Incident Alert Channel
 *
 * 운영 채널: ops_alerts 테이블 (기존 createOpsAlert 재사용)
 * Cooldown: time-bucketed dedup key (30분 버킷) — 같은 incident key는 30분 내 1회만 알림
 * Recovery: incident 해소 시 RESOLVED info alert (1회)
 *
 * Secret/PII 금지: incident message는 service/severity/count/time/error_code만 포함
 */
import { createOpsAlert } from "./opsAlerts.js";
import { THRESHOLDS } from "./monitoring.js";

// ── Incident Keys ─────────────────────────────────────────────────────────────

export const INCIDENT = {
  API_5XX_SPIKE:              "API_5XX_SPIKE",
  DB_UNAVAILABLE:             "DB_UNAVAILABLE",
  PUSH_FANOUT_FAILURE:        "PUSH_FANOUT_FAILURE",
  PUSH_FANOUT_STUCK:          "PUSH_FANOUT_STUCK",
  REVENUECAT_WEBHOOK_FAILURE: "REVENUECAT_WEBHOOK_FAILURE",
  GROWTH_BATCH_FAILURE:       "GROWTH_BATCH_FAILURE",
  GROWTH_ANALYSIS_FAILURE:    "GROWTH_ANALYSIS_FAILURE",
  GROWTH_JOB_STUCK:           "GROWTH_JOB_STUCK",
  WORKER_NOT_RUNNING:         "WORKER_NOT_RUNNING",
} as const;

export type IncidentKey = typeof INCIDENT[keyof typeof INCIDENT];

// ── Time-Bucket Dedup ─────────────────────────────────────────────────────────

function getTimeBucket(): number {
  return Math.floor(Date.now() / THRESHOLDS.alertCooldownMs);
}

function dedupeKey(incidentKey: IncidentKey, bucket: number): string {
  return `${incidentKey}:b${bucket}`;
}

function resolvedDedupeKey(incidentKey: IncidentKey, bucket: number): string {
  return `${incidentKey}:resolved:b${bucket}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * 장애 발생 시 호출. cooldown window 내 중복 alert 방지.
 * message에 secret/PII 금지 — service/severity/count/time/error_code만.
 */
export async function fireIncident(
  key: IncidentKey,
  opts: { message: string; severity?: "warning" | "error" }
): Promise<void> {
  const bucket = getTimeBucket();
  const dk = dedupeKey(key, bucket);
  await createOpsAlert({
    type:     `incident:${key}`,
    title:    `[장애] ${key}`,
    message:  opts.message,
    severity: opts.severity ?? "error",
    dedupeKey: dk,
  });
}

/**
 * 장애 해소 시 호출. 동일 cooldown window 내 1회 RESOLVED alert.
 */
export async function resolveIncident(
  key: IncidentKey,
  opts?: { message?: string }
): Promise<void> {
  const bucket = getTimeBucket();
  const dk = resolvedDedupeKey(key, bucket);
  await createOpsAlert({
    type:     `resolved:${key}`,
    title:    `[해소] ${key}`,
    message:  opts?.message ?? "정상 상태로 복구됨",
    severity: "success",
    dedupeKey: dk,
  });
}

// ── Health → Incident mapping ─────────────────────────────────────────────────

import type { SystemHealthSnapshot, FiveXxResult, PushResult, GrowthResult } from "./monitoring.js";

/**
 * 전체 health snapshot을 받아 incident alert를 발화하고 resolution을 처리.
 * 이 함수가 ops-monitor-scheduler에서 2분마다 호출됨.
 */
export async function processHealthIncidents(snapshot: SystemHealthSnapshot & {
  fiveXx: FiveXxResult;
  push: PushResult;
  growth: GrowthResult;
}): Promise<void> {
  const ps: Promise<void>[] = [];

  // DB_UNAVAILABLE
  if (snapshot.db.status === "FAIL") {
    ps.push(fireIncident(INCIDENT.DB_UNAVAILABLE, {
      message: `DB 연결 실패 (${snapshot.db.detail.slice(0, 120)}) @ ${snapshot.checkedAt}`,
      severity: "error",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.DB_UNAVAILABLE, { message: "DB 연결 정상" }));
  }

  // API_5XX_SPIKE
  if (snapshot.fiveXx.spikeDetected) {
    ps.push(fireIncident(INCIDENT.API_5XX_SPIKE, {
      message: `API 5xx spike: ${snapshot.fiveXx.count5min}건/5분, ${snapshot.fiveXx.count15min}건/15분 @ ${snapshot.checkedAt}`,
      severity: "error",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.API_5XX_SPIKE, { message: "5xx 정상 범위" }));
  }

  // PUSH_FANOUT_FAILURE
  if (snapshot.push.failedCount > 0) {
    ps.push(fireIncident(INCIDENT.PUSH_FANOUT_FAILURE, {
      message: `push_fanout_jobs FAILED=${snapshot.push.failedCount} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.PUSH_FANOUT_FAILURE));
  }

  // PUSH_FANOUT_STUCK
  if (snapshot.push.stuckCount > 0) {
    ps.push(fireIncident(INCIDENT.PUSH_FANOUT_STUCK, {
      message: `push_fanout_jobs STUCK=${snapshot.push.stuckCount} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.PUSH_FANOUT_STUCK));
  }

  // REVENUECAT_WEBHOOK_FAILURE
  if (snapshot.revenuecat.status !== "OK") {
    ps.push(fireIncident(INCIDENT.REVENUECAT_WEBHOOK_FAILURE, {
      message: `RevenueCat webhook: ${snapshot.revenuecat.detail.slice(0, 120)} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.REVENUECAT_WEBHOOK_FAILURE));
  }

  // GROWTH_BATCH_FAILURE
  if (snapshot.growth.batchFailed > 0) {
    ps.push(fireIncident(INCIDENT.GROWTH_BATCH_FAILURE, {
      message: `growth_report_batch_jobs FAILED=${snapshot.growth.batchFailed} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.GROWTH_BATCH_FAILURE));
  }

  // GROWTH_ANALYSIS_FAILURE
  if (snapshot.growth.analysisFailed > 0) {
    ps.push(fireIncident(INCIDENT.GROWTH_ANALYSIS_FAILURE, {
      message: `growth_reports analysis FAILED=${snapshot.growth.analysisFailed} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.GROWTH_ANALYSIS_FAILURE));
  }

  // GROWTH_JOB_STUCK
  if (snapshot.growth.batchStuck > 0 || snapshot.growth.analysisStuck > 0) {
    ps.push(fireIncident(INCIDENT.GROWTH_JOB_STUCK, {
      message: `growth job stuck: batch=${snapshot.growth.batchStuck}, analysis=${snapshot.growth.analysisStuck} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.GROWTH_JOB_STUCK));
  }

  // WORKER_NOT_RUNNING
  if (snapshot.workers.status !== "OK") {
    ps.push(fireIncident(INCIDENT.WORKER_NOT_RUNNING, {
      message: `worker ${snapshot.workers.detail.slice(0, 120)} @ ${snapshot.checkedAt}`,
      severity: "warning",
    }));
  } else {
    ps.push(resolveIncident(INCIDENT.WORKER_NOT_RUNNING));
  }

  await Promise.allSettled(ps); // 개별 alert 실패가 전체를 중단하지 않음
}
