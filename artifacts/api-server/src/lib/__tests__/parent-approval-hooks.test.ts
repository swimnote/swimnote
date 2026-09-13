/**
 * parent-approval-hooks.test.ts — P0-2 소급 알림 전용 테스트
 *
 * TC-A ~ TC-K + TC-ID + TC-PUSH-TEXT (명세 §11)
 *
 * 모든 테스트는 DB / push-service를 vi.mock factory로 교체.
 * 실제 DB / 실제 push / Production DB backfill 없음.
 *
 * 핵심 규칙:
 *   beforeEach에서 vi.resetAllMocks() 사용.
 *   vi.clearAllMocks()는 mockResolvedValueOnce 큐를 초기화하지 않으므로
 *   이전 테스트의 잔여 once값이 다음 테스트에 오염됨 → resetAllMocks 필수.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn() },
  superAdminDb: { execute: vi.fn() },
}));

vi.mock("../push-service.js", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

// ── SUT (mock 등록 이후 import) ────────────────────────────────────────────────

import { onParentApproved } from "../parent-approval-hooks.js";
import { db } from "@workspace/db";
import { sendPushToUser } from "../push-service.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PARENT_ID  = "pa_test_001";
const STUDENT_ID = "stu_test_001";
const POOL_ID    = "pool_test_001";

const REPORT_A = { ref_id: "gr_A", created_at: "2026-05-01T00:00:00.000Z" };
const REPORT_B = { ref_id: "gr_B", created_at: "2026-06-01T00:00:00.000Z" };
const REPORT_C = { ref_id: "gr_C", created_at: "2026-07-01T00:00:00.000Z" }; // latest

const VERIFY_FOUND  = [{ id: "ps_123" }]; // 검증 통과
const VERIFY_EMPTY: never[] = [];          // 검증 실패

// helper — mock 시퀀스 세팅 (반드시 resetAllMocks 이후 호출)
function setupMocks(opts: {
  verifyRows?: any[];
  insertedRows?: Array<{ ref_id: string; created_at: string }>;
} = {}) {
  const { verifyRows = VERIFY_FOUND, insertedRows = [] } = opts;
  vi.mocked(db.execute)
    .mockResolvedValueOnce({ rows: verifyRows } as any)   // Step1: 검증 쿼리
    .mockResolvedValueOnce({ rows: insertedRows } as any); // Step2: INSERT RETURNING
}

// ── lifecycle ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  // clearAllMocks()는 once 큐 미초기화 → 테스트 간 오염 발생.
  // resetAllMocks()는 call 기록 + once 큐 모두 초기화.
  vi.resetAllMocks();
  // resetAllMocks()가 구현까지 초기화하므로 기본 push mock 재설정 필수.
  // (미설정 시 sendPushToUser가 undefined를 반환 → .catch() TypeError)
  vi.mocked(sendPushToUser).mockResolvedValue(undefined);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("onParentApproved — P0-2 소급 알림", () => {

  // ── TC-A: 과거 PUBLISHED 3건 → DB 2회 호출(검증+INSERT) ──────────────────
  it("TC-A: 과거 PUBLISHED 3건 → DB execute 2회(검증+INSERT)", async () => {
    setupMocks({ insertedRows: [REPORT_A, REPORT_B, REPORT_C] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2);

    const insertStr = JSON.stringify(vi.mocked(db.execute).mock.calls[1][0]);
    expect(insertStr).toContain("GROWTH_REPORT_PUBLISHED");
    expect(insertStr).toContain("CONFLICT");
  });

  // ── TC-B: created_at = published_at (소급 날짜 보존) ─────────────────────
  it("TC-B: INSERT SQL이 gr.published_at을 created_at 소스로 사용", async () => {
    setupMocks({ insertedRows: [REPORT_A] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    const insertStr = JSON.stringify(vi.mocked(db.execute).mock.calls[1][0]);
    expect(insertStr).toContain("published_at");
    expect(insertStr).toContain("created_at");
  });

  // ── TC-C: push는 RETURNING 최신 1건만 ────────────────────────────────────
  it("TC-C: RETURNING [A,B,C] → push는 최신(C) 1건만", async () => {
    setupMocks({ insertedRows: [REPORT_A, REPORT_B, REPORT_C] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    expect(vi.mocked(sendPushToUser)).toHaveBeenCalledTimes(1);
    const pushArgs = vi.mocked(sendPushToUser).mock.calls[0];
    expect(pushArgs[0]).toBe(PARENT_ID);
    expect((pushArgs[5] as any).growth_report_id).toBe(REPORT_C.ref_id);
  });

  // ── TC-D: 동일 승인 retry → RETURNING 0건 → push 없음 ───────────────────
  it("TC-D: RETURNING 0건(ON CONFLICT 전부 skip) → push 없음", async () => {
    setupMocks({ insertedRows: [] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    expect(vi.mocked(sendPushToUser)).not.toHaveBeenCalled();
  });

  // ── TC-E: C 기존 / A,B 신규 → RETURNING [A,B] → push는 B(최신 신규)만 ──
  it("TC-E: C 기존 / A,B 신규 → RETURNING [A,B] → push는 B(최신 신규)만", async () => {
    setupMocks({ insertedRows: [REPORT_A, REPORT_B] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    expect(vi.mocked(sendPushToUser)).toHaveBeenCalledTimes(1);
    const pushArgs = vi.mocked(sendPushToUser).mock.calls[0];
    expect((pushArgs[5] as any).growth_report_id).toBe(REPORT_B.ref_id);
  });

  // ── TC-F: 최신(C) 기존 / A,B 신규 → C 재push 금지 ───────────────────────
  it("TC-F: C 기존 / A,B 신규 → push는 B(최신 신규), C 재push 금지", async () => {
    setupMocks({ insertedRows: [REPORT_A, REPORT_B] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    const pushArgs = vi.mocked(sendPushToUser).mock.calls[0];
    expect((pushArgs[5] as any).growth_report_id).not.toBe(REPORT_C.ref_id);
    expect((pushArgs[5] as any).growth_report_id).toBe(REPORT_B.ref_id);
  });

  // ── TC-G: cross-pool → 검증 실패 → INSERT 없음 ───────────────────────────
  it("TC-G: 검증 실패(cross-pool) → INSERT 호출 안 됨 / push 없음", async () => {
    // verifyRows=VERIFY_EMPTY: DB가 해당 (parentId, studentId, poolId) 관계를 찾지 못함
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: VERIFY_EMPTY } as any);

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: "pool_OTHER" });

    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1); // 검증만, INSERT 없음
    expect(vi.mocked(sendPushToUser)).not.toHaveBeenCalled();
  });

  // ── TC-H: 보호자 2명 — 대상 parentId만 쿼리에 포함 ──────────────────────
  it("TC-H: 쿼리가 대상 parentId만 포함, 다른 보호자 미포함", async () => {
    const OTHER_PARENT = "pa_other_999";
    setupMocks({ insertedRows: [REPORT_B] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    // 검증 쿼리에 PARENT_ID 포함, 다른 보호자 미포함
    const verifyStr = JSON.stringify(vi.mocked(db.execute).mock.calls[0][0]);
    expect(verifyStr).toContain(PARENT_ID);
    expect(verifyStr).not.toContain(OTHER_PARENT);

    // INSERT 쿼리에 PARENT_ID 포함, 다른 보호자 미포함
    const insertStr = JSON.stringify(vi.mocked(db.execute).mock.calls[1][0]);
    expect(insertStr).toContain(PARENT_ID);
    expect(insertStr).not.toContain(OTHER_PARENT);
  });

  // ── TC-I: PUBLISHED 0건(신규 학생) → 정상 no-op ──────────────────────────
  it("TC-I: 신규 학생(PUBLISHED 0건) → RETURNING 0 → 에러 없이 완료, push 없음", async () => {
    setupMocks({ insertedRows: [] });

    await expect(
      onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID }),
    ).resolves.toBeUndefined();

    expect(vi.mocked(sendPushToUser)).not.toHaveBeenCalled();
  });

  // ── TC-J: hook 내부 INSERT 실패 → reject propagate → caller가 .catch()로 처리 ──
  //
  //   명세: "hook 실패 시 parent approval rollback 금지, 에러 로그만"
  //   → onParentApproved는 에러를 그대로 throw
  //   → caller가 .catch(e => console.warn(...))로 처리하여 approval 유지
  it("TC-J: DB INSERT 실패 → reject propagate (caller가 .catch로 처리)", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ rows: VERIFY_FOUND } as any)  // 검증 통과
      .mockRejectedValueOnce(new Error("DB 연결 오류"));       // INSERT 실패

    await expect(
      onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID }),
    ).rejects.toThrow("DB 연결 오류");

    expect(vi.mocked(sendPushToUser)).not.toHaveBeenCalled();
  });

  // ── TC-K: push 실패 → notification INSERT 유지 ───────────────────────────
  //   push 실패는 내부에서 .catch()로 처리 → onParentApproved는 resolve
  it("TC-K: push 실패 → onParentApproved 정상 resolve (INSERT 유지)", async () => {
    setupMocks({ insertedRows: [REPORT_B] });
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error("push 서버 오류"));

    await expect(
      onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID }),
    ).resolves.toBeUndefined();

    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2); // 검증+INSERT 모두 완료
  });

  // ── TC-ID: notification ID가 gen_random_uuid 기반 (MD5/결정론적 ID 금지) ──
  it("TC-ID: INSERT SQL이 gen_random_uuid 사용, MD5 / notif_bf_ 없음", async () => {
    setupMocks({ insertedRows: [REPORT_A] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    const insertStr = JSON.stringify(vi.mocked(db.execute).mock.calls[1][0]);
    expect(insertStr).toContain("gen_random_uuid");
    expect(insertStr).not.toContain("MD5");
    expect(insertStr).not.toContain("notif_bf_");
  });

  // ── TC-PUSH-TEXT: 소급 전용 push 문구 확인 ────────────────────────────────
  it("TC-PUSH-TEXT: 소급 push 제목·본문 확인", async () => {
    setupMocks({ insertedRows: [REPORT_B] });

    await onParentApproved({ parentId: PARENT_ID, studentId: STUDENT_ID, poolId: POOL_ID });

    const [, , , title, body] = vi.mocked(sendPushToUser).mock.calls[0];
    expect(title).toBe("확인할 수 있는 성장리포트가 있습니다");
    expect(body).toBe("아이의 성장리포트를 SWIMNOTE에서 확인해보세요.");
  });
});
