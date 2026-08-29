/**
 * 학부모 회원 탈퇴 + Pool Isolation 테스트
 *
 * Bug: WithdrawalModal.tsx — free plan에서 choice가 null → handleConfirm() early return
 *       → API 호출 안됨 → 탈퇴 불가
 * Fix: 무료 플랜 "탈퇴 확인" 버튼이 onConfirm(true)을 직접 호출
 *
 * Pool-First Isolation:
 * Pool A에서 탈퇴해도 Pool B 계정은 영향 없음.
 * 탈퇴 API는 WHERE id = userId (자신만) 삭제.
 */

import { describe, it, expect } from "vitest";

// ── 비즈니스 로직 시뮬레이터 ──────────────────────────────────────────────────

type ParentAccount = {
  id: string;
  phone: string;
  swimming_pool_id: string;
  deleted: boolean;
};

let _seq = 0;
function nextId(p: string) { return `${p}_${++_seq}`; }

function createAccount(phone: string, poolId: string): ParentAccount {
  return { id: nextId("acc"), phone, swimming_pool_id: poolId, deleted: false };
}

/** DELETE /auth/account — 자신의 계정만 삭제 */
function deleteAccount(
  db: ParentAccount[],
  callerUserId: string,
  callerPoolId: string,
): { status: number; error?: string } {
  const acc = db.find((a) => a.id === callerUserId);
  if (!acc) return { status: 404, error: "NOT_FOUND" };
  if (acc.swimming_pool_id !== callerPoolId) return { status: 403, error: "FORBIDDEN" };
  acc.deleted = true;
  return { status: 200 };
}

// ── WithdrawalModal 로직 시뮬레이터 ──────────────────────────────────────────

/** 버그 재현: choice === null이면 handleConfirm()이 바로 return */
function handleConfirmBuggy(choice: boolean | null, loading: boolean): boolean {
  if (!choice || loading) return false; // ← bug: choice null → false → early return
  return true; // API 호출 시뮬레이션
}

/** 수정 후: 무료 플랜은 choice 없이 onConfirm(true) 직접 호출 */
function handleFreeConfirmFixed(loading: boolean): boolean {
  if (loading) return false;
  return true; // API 호출 시뮬레이션
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("WithdrawalModal — free plan 탈퇴 버그 수정", () => {
  it("[BUG] handleConfirm()은 choice=null이면 API를 호출하지 않는다", () => {
    expect(handleConfirmBuggy(null, false)).toBe(false);
  });

  it("[BUG] handleConfirm()은 choice=false이면 API를 호출하지 않는다", () => {
    expect(handleConfirmBuggy(false, false)).toBe(false);
  });

  it("[FIX] handleFreeConfirm()은 choice 없이 loading=false면 API를 호출한다", () => {
    expect(handleFreeConfirmFixed(false)).toBe(true);
  });

  it("[FIX] handleFreeConfirm()은 loading=true면 API를 호출하지 않는다", () => {
    expect(handleFreeConfirmFixed(true)).toBe(false);
  });

  it("[FIX] 유료 플랜: choice=true이면 API를 호출한다 (기존 로직 유지)", () => {
    expect(handleConfirmBuggy(true, false)).toBe(true);
  });

  it("[FIX] 유료 플랜: loading=true이면 API를 호출하지 않는다 (기존 로직 유지)", () => {
    expect(handleConfirmBuggy(true, true)).toBe(false);
  });
});

describe("탈퇴 API — Pool Isolation (Pool-First 2.0.0)", () => {
  let db: ParentAccount[];
  let poolA: string;
  let poolB: string;
  let accA: ParentAccount;
  let accB: ParentAccount;

  poolA = nextId("pool");
  poolB = nextId("pool");
  const PHONE = "01012345678";

  beforeEach(() => {
    db = [];
    accA = createAccount(PHONE, poolA);
    accB = createAccount(PHONE, poolB);
    db.push(accA, accB);
  });

  it("Pool A 탈퇴 → Pool A 계정만 삭제됨", () => {
    const res = deleteAccount(db, accA.id, poolA);
    expect(res.status).toBe(200);
    expect(db.find((a) => a.id === accA.id)?.deleted).toBe(true);
  });

  it("Pool A 탈퇴 후 Pool B 계정은 영향 없음", () => {
    deleteAccount(db, accA.id, poolA);
    expect(db.find((a) => a.id === accB.id)?.deleted).toBe(false);
  });

  it("Pool B 탈퇴 → Pool B 계정만 삭제됨", () => {
    const res = deleteAccount(db, accB.id, poolB);
    expect(res.status).toBe(200);
    expect(db.find((a) => a.id === accB.id)?.deleted).toBe(true);
    expect(db.find((a) => a.id === accA.id)?.deleted).toBe(false);
  });

  it("다른 pool의 계정 삭제 시도 → 403 FORBIDDEN", () => {
    // accA token으로 accB(poolB) 삭제 시도
    const res = deleteAccount(db, accB.id, poolA);
    expect(res.status).toBe(403);
    expect(db.find((a) => a.id === accB.id)?.deleted).toBe(false);
  });

  it("존재하지 않는 계정 삭제 → 404", () => {
    const res = deleteAccount(db, "fake_id", poolA);
    expect(res.status).toBe(404);
  });

  it("두 pool 모두 독립적으로 탈퇴 가능", () => {
    deleteAccount(db, accA.id, poolA);
    deleteAccount(db, accB.id, poolB);
    expect(db.every((a) => a.deleted)).toBe(true);
  });

  it("같은 phone 다른 pool → 각각 독립 계정 (탈퇴 전 모두 active)", () => {
    const poolC = nextId("pool");
    const accC = createAccount(PHONE, poolC);
    db.push(accC);
    const accounts = db.filter((a) => a.phone === PHONE && !a.deleted);
    expect(accounts).toHaveLength(3);
  });
});

// vitest가 beforeEach를 사용하므로 import 필요
import { beforeEach } from "vitest";
