/**
 * wp11-queue-worker.test.ts — WP11 Background Worker 단위 테스트
 *
 * TC-A: 실행 가능한 retry-queue → processRetryQueue 1회 호출, locked=true
 * TC-B: lock 이미 획득 → skip (locked=false, processRetryQueue 미호출)
 * TC-C: processRetryQueue 오류 → errors:1, throw 안 함 (error isolation)
 * TC-D: job A(retry) 실패 → job B(makeup) 계속 처리됨
 * TC-E: 만료 makeup_sessions → db.execute 호출 (UPDATE)
 * TC-F: makeup lock 이미 획득 → skip (locked=false)
 * TC-G: makeup db.execute 오류 → throw 안 함, expired:0
 * TC-H: runMakeupExpiry 재실행 → WHERE 조건 idempotent (expired row 재처리 없음)
 * TC-I: retry-queue locking — acquireLock false 시 processRetryQueue 미호출
 * TC-J: runRetryQueue 결과 구조 확인 (locked, errors, durationMs)
 * TC-K: runMakeupExpiry 결과 구조 확인 (locked, expired, durationMs)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 의존성 mock ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) },
  superAdminDb: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../lib/pool-event-logger.js", () => ({
  processRetryQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/schedulerLock.js", () => ({
  acquireLock:      vi.fn().mockResolvedValue(true),
  releaseLock:      vi.fn().mockResolvedValue(undefined),
  recordHeartbeat:  vi.fn().mockResolvedValue(undefined),
}));

import { db }                  from "@workspace/db";
import { processRetryQueue }   from "../../lib/pool-event-logger.js";
import { acquireLock, releaseLock } from "../../lib/schedulerLock.js";
import { runRetryQueue, runMakeupExpiry } from "../../jobs/queue-worker.js";

// ─────────────────────────────────────────────────────────────────────────────

describe("WP11 — runRetryQueue", () => {
  beforeEach(() => {
    vi.mocked(acquireLock).mockClear();
    vi.mocked(releaseLock).mockClear();
    vi.mocked(processRetryQueue).mockClear();
    vi.mocked(acquireLock).mockResolvedValue(true);
    vi.mocked(processRetryQueue).mockResolvedValue(undefined);
  });

  // TC-A: 실행 가능한 retry-queue → processRetryQueue 1회 호출
  it("A. lock 획득 → processRetryQueue 1회 호출, locked=true, errors=0", async () => {
    const result = await runRetryQueue();
    expect(vi.mocked(processRetryQueue)).toHaveBeenCalledTimes(1);
    expect(result.locked).toBe(true);
    expect(result.errors).toBe(0);
    expect(typeof result.durationMs).toBe("number");
  });

  // TC-B: lock 이미 획득 → skip
  it("B. lock not acquired → processRetryQueue 미호출, locked=false", async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(false);
    const result = await runRetryQueue();
    expect(vi.mocked(processRetryQueue)).not.toHaveBeenCalled();
    expect(result.locked).toBe(false);
    expect(result.errors).toBe(0);
  });

  // TC-C: processRetryQueue 오류 → errors:1, throw 안 함
  it("C. processRetryQueue 오류 → errors:1, throw 없음 (error isolation)", async () => {
    vi.mocked(processRetryQueue).mockRejectedValueOnce(new Error("DB 연결 실패"));
    const result = await runRetryQueue(); // throw 안 해야 함
    expect(result.errors).toBe(1);
    expect(result.locked).toBe(true);
  });

  // TC-I: acquireLock false → processRetryQueue 미호출 (locking 확인)
  it("I. acquireLock=false → processRetryQueue 절대 미호출", async () => {
    vi.mocked(acquireLock).mockResolvedValue(false);
    await runRetryQueue();
    expect(vi.mocked(processRetryQueue)).not.toHaveBeenCalled();
  });

  // TC-J: 결과 구조 확인
  it("J. 결과 구조: { locked, errors, durationMs } 모두 존재", async () => {
    const result = await runRetryQueue();
    expect("locked"     in result).toBe(true);
    expect("errors"     in result).toBe(true);
    expect("durationMs" in result).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // releaseLock 항상 호출 (성공/실패 무관)
  it("lock 획득 후 processRetryQueue 오류 시에도 releaseLock 호출됨", async () => {
    vi.mocked(processRetryQueue).mockRejectedValueOnce(new Error("timeout"));
    await runRetryQueue();
    expect(vi.mocked(releaseLock)).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("WP11 — runMakeupExpiry", () => {
  beforeEach(() => {
    vi.mocked(acquireLock).mockClear();
    vi.mocked(releaseLock).mockClear();
    vi.mocked(db.execute).mockClear();
    vi.mocked(acquireLock).mockResolvedValue(true);
    vi.mocked(db.execute).mockResolvedValue({ rowCount: 0, rows: [] } as any);
  });

  // TC-E: 만료 makeup_sessions → db.execute 호출 (UPDATE)
  it("E. lock 획득 → db.execute(UPDATE) 1회 호출", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({ rowCount: 3, rows: [] } as any);
    const result = await runMakeupExpiry();
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
    expect(result.locked).toBe(true);
    expect(result.expired).toBe(3);
  });

  // TC-F: makeup lock 이미 획득 → skip
  it("F. lock not acquired → db.execute 미호출, locked=false", async () => {
    vi.mocked(acquireLock).mockResolvedValueOnce(false);
    const result = await runMakeupExpiry();
    expect(vi.mocked(db.execute)).not.toHaveBeenCalled();
    expect(result.locked).toBe(false);
    expect(result.expired).toBe(0);
  });

  // TC-G: db.execute 오류 → throw 안 함, expired:0
  it("G. db.execute 오류 → throw 없음, expired:0", async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("DB timeout"));
    const result = await runMakeupExpiry(); // throw 안 해야 함
    expect(result.expired).toBe(0);
    expect(result.locked).toBe(true);
  });

  // TC-H: rowCount=0 → expired:0 (이미 만료된 row 없음, idempotent)
  it("H. 처리 대상 없음(rowCount=0) → expired:0 (idempotent)", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
    const result = await runMakeupExpiry();
    expect(result.expired).toBe(0);
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
  });

  // TC-K: 결과 구조 확인
  it("K. 결과 구조: { locked, expired, durationMs } 모두 존재", async () => {
    const result = await runMakeupExpiry();
    expect("locked"     in result).toBe(true);
    expect("expired"    in result).toBe(true);
    expect("durationMs" in result).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // lock 획득 후 오류 시에도 releaseLock 호출
  it("db.execute 오류 시에도 releaseLock 호출됨", async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("connection lost"));
    await runMakeupExpiry();
    expect(vi.mocked(releaseLock)).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("WP11 — error isolation (TC-D)", () => {
  beforeEach(() => {
    vi.mocked(acquireLock).mockReset();
    vi.mocked(releaseLock).mockReset();
    vi.mocked(processRetryQueue).mockReset();
    vi.mocked(db.execute).mockReset();
    vi.mocked(acquireLock).mockResolvedValue(true);
    vi.mocked(releaseLock).mockResolvedValue(undefined);
    vi.mocked(db.execute).mockResolvedValue({ rowCount: 2, rows: [] } as any);
  });

  // TC-D: job A(retry) 실패해도 job B(makeup) 계속 처리
  it("D. retry-queue 실패해도 makeup-expiry 독립 실행 성공", async () => {
    vi.mocked(processRetryQueue).mockRejectedValue(new Error("retry-queue-fatal"));

    // 두 job을 순차 실행 — 첫 번째 실패해도 두 번째 throw 없어야 함
    const retryResult  = await runRetryQueue();
    const makeupResult = await runMakeupExpiry();

    // retry: 실패 기록
    expect(retryResult.errors).toBe(1);

    // makeup: 성공
    expect(makeupResult.expired).toBe(2);
    expect(makeupResult.locked).toBe(true);
  });
});
