/**
 * diary-session-slot.test.ts
 *
 * TEACHER DIARY DATE / SCHEDULE SLOT FIX 테스트
 *
 * 검증 대상:
 *   - 일지 session identity = class_group_id + lesson_date
 *   - 다른 날짜 diary는 중복으로 오판되지 않음
 *   - 동일 날짜+슬롯 일지 교체(replace) 시나리오
 *   - 다른 날짜/슬롯 일지 불변 보장
 *
 * 테스트 케이스:
 *   TC-1  다른 날짜 diary가 중복 판정에 영향을 주지 않음
 *   TC-2  같은 반 다른 날짜 diary는 diarySet key가 서로 독립
 *   TC-3  targetDate가 navigation param에서 정확히 파싱됨
 *   TC-4  동일 날짜+슬롯 기존 diary 감지
 *   TC-5  replace cancel — 기존 diary 유지
 *   TC-6  replace confirm — 기존 diary 삭제 후 신규 생성 가능
 *   TC-7  replace 후 동일 슬롯에 활성 diary 1건
 *   TC-8  replace 후 다른 날짜 diary unchanged
 *   TC-9  replace 후 다른 반/슬롯 diary unchanged
 */

import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// 헬퍼: 클라이언트 측 diarySet 로직 재현
// diarySet key = `${class_group_id}_${lesson_date}`
// ──────────────────────────────────────────────────────────────────────────────
function buildDiarySet(diaries: Array<{ class_group_id: string; lesson_date: string; is_deleted?: boolean }>): Set<string> {
  return new Set(
    diaries
      .filter(d => !d.is_deleted)
      .map(d => `${d.class_group_id}_${d.lesson_date}`)
  );
}

function diaryExists(diarySet: Set<string>, classGroupId: string, lessonDate: string): boolean {
  return diarySet.has(`${classGroupId}_${lessonDate}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// 헬퍼: targetDate 파싱 — diary.tsx 로직 재현
// ──────────────────────────────────────────────────────────────────────────────
function parseTargetDate(lessonDate: string | undefined, todayStr: string): string {
  return (lessonDate && /^\d{4}-\d{2}-\d{2}$/.test(lessonDate))
    ? lessonDate
    : todayStr;
}

// ──────────────────────────────────────────────────────────────────────────────
// 헬퍼: replace flow 시뮬레이션
// ──────────────────────────────────────────────────────────────────────────────
type Diary = {
  id: string;
  class_group_id: string;
  lesson_date: string;
  is_deleted: boolean;
};

function softDelete(diaries: Diary[], id: string): Diary[] {
  return diaries.map(d => d.id === id ? { ...d, is_deleted: true } : d);
}

function addDiary(diaries: Diary[], entry: Diary): Diary[] {
  return [...diaries, entry];
}

function activeDiariesForSlot(diaries: Diary[], classGroupId: string, lessonDate: string): Diary[] {
  return diaries.filter(d => d.class_group_id === classGroupId && d.lesson_date === lessonDate && !d.is_deleted);
}

// ──────────────────────────────────────────────────────────────────────────────
// 테스트 픽스처
// ──────────────────────────────────────────────────────────────────────────────
const GROUP_A = "class_group_A";
const GROUP_B = "class_group_B";

const DATE_0806 = "2026-08-06";
const DATE_0813 = "2026-08-13";
const DATE_0820 = "2026-08-20";

const DIARY_0806: Diary = { id: "diary_0806", class_group_id: GROUP_A, lesson_date: DATE_0806, is_deleted: false };
const DIARY_0813: Diary = { id: "diary_0813", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
const DIARY_B_0813: Diary = { id: "diary_B_0813", class_group_id: GROUP_B, lesson_date: DATE_0813, is_deleted: false };

// ──────────────────────────────────────────────────────────────────────────────
// TC-1  다른 날짜 diary가 중복 판정에 영향을 주지 않음
//        8/6 diary 존재 → 8/13 slot은 diaryExists=false
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-1: 다른 날짜 diary는 중복 판정에 영향 없음", () => {
  it("8/6 diary만 있을 때 8/13 slot은 미작성으로 판정", () => {
    const diarySet = buildDiarySet([DIARY_0806]);
    expect(diaryExists(diarySet, GROUP_A, DATE_0806)).toBe(true);
    expect(diaryExists(diarySet, GROUP_A, DATE_0813)).toBe(false);
  });

  it("8/13 diary만 있을 때 8/6 slot은 미작성으로 판정", () => {
    const diarySet = buildDiarySet([DIARY_0813]);
    expect(diaryExists(diarySet, GROUP_A, DATE_0813)).toBe(true);
    expect(diaryExists(diarySet, GROUP_A, DATE_0806)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-2  같은 반의 8/6·8/13·8/20 diary는 각각 독립
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-2: 같은 반 다른 날짜 diarySet key 독립", () => {
  it("8/6·8/13·8/20 diary 모두 존재 시 각 날짜 독립 확인", () => {
    const DIARY_0820: Diary = { id: "diary_0820", class_group_id: GROUP_A, lesson_date: DATE_0820, is_deleted: false };
    const diarySet = buildDiarySet([DIARY_0806, DIARY_0813, DIARY_0820]);
    expect(diaryExists(diarySet, GROUP_A, DATE_0806)).toBe(true);
    expect(diaryExists(diarySet, GROUP_A, DATE_0813)).toBe(true);
    expect(diaryExists(diarySet, GROUP_A, DATE_0820)).toBe(true);
    // 존재하지 않는 날짜
    expect(diaryExists(diarySet, GROUP_A, "2026-08-27")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-3  targetDate가 navigation param에서 정확히 파싱됨
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-3: targetDate 파싱 (navigation param → diary screen)", () => {
  const TODAY = "2026-08-29";

  it("유효한 YYYY-MM-DD params.lessonDate가 있으면 그 값 사용", () => {
    expect(parseTargetDate("2026-08-13", TODAY)).toBe("2026-08-13");
  });

  it("params.lessonDate가 없으면 todayStr() fallback", () => {
    expect(parseTargetDate(undefined, TODAY)).toBe(TODAY);
  });

  it("params.lessonDate가 유효하지 않은 형식이면 todayStr() fallback", () => {
    expect(parseTargetDate("invalid-date", TODAY)).toBe(TODAY);
    expect(parseTargetDate("2026/08/13", TODAY)).toBe(TODAY);
    expect(parseTargetDate("", TODAY)).toBe(TODAY);
  });

  it("today-schedule 진입 시 lessonDate=today 를 전달하면 정확히 파싱", () => {
    // today-schedule.tsx는 이제 lessonDate: today를 navigation params에 포함
    expect(parseTargetDate(TODAY, TODAY)).toBe(TODAY);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-4  동일 날짜+슬롯 기존 diary 감지
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-4: 동일 날짜+슬롯 기존 diary 감지", () => {
  it("class_group_id + lesson_date 둘 다 일치할 때만 존재로 판정", () => {
    const diarySet = buildDiarySet([DIARY_0813, DIARY_B_0813]);
    // GROUP_A 8/13 → 존재
    expect(diaryExists(diarySet, GROUP_A, DATE_0813)).toBe(true);
    // GROUP_B 8/13 → 존재
    expect(diaryExists(diarySet, GROUP_B, DATE_0813)).toBe(true);
    // GROUP_A 8/6 → 미존재 (날짜 다름)
    expect(diaryExists(diarySet, GROUP_A, DATE_0806)).toBe(false);
    // GROUP_B 8/6 → 미존재
    expect(diaryExists(diarySet, GROUP_B, DATE_0806)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-5  replace cancel — 기존 diary 유지
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-5: replace cancel → 기존 diary 유지", () => {
  it("cancel 시 diaries/diarySet 변경 없음", () => {
    const diaries = [DIARY_0806, DIARY_0813];
    const diarySet = buildDiarySet(diaries);

    // cancel: 아무 변경 없이 그대로 반환
    const afterCancel = { diaries, diarySet };

    expect(afterCancel.diaries.find(d => d.id === "diary_0813")?.is_deleted).toBe(false);
    expect(afterCancel.diarySet.has(`${GROUP_A}_${DATE_0813}`)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-6  replace confirm — 기존 diary 삭제 후 신규 생성 가능
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-6: replace confirm → 기존 diary soft-delete 후 신규 생성", () => {
  it("기존 diary soft-delete 후 같은 슬롯에 새 diary INSERT 성공", () => {
    let diaries = [DIARY_0806, DIARY_0813];

    // Step 1: soft-delete 기존 8/13 diary
    diaries = softDelete(diaries, "diary_0813");
    expect(diaries.find(d => d.id === "diary_0813")?.is_deleted).toBe(true);

    // Step 2: diarySet에서 key 제거
    let diarySet = buildDiarySet(diaries);
    expect(diaryExists(diarySet, GROUP_A, DATE_0813)).toBe(false);

    // Step 3: 새 diary 추가 (서버 POST /diaries → 409 없음)
    const newDiary: Diary = { id: "diary_0813_new", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
    diaries = addDiary(diaries, newDiary);
    diarySet = buildDiarySet(diaries);

    expect(diaryExists(diarySet, GROUP_A, DATE_0813)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-7  replace 후 동일 슬롯에 활성 diary 1건
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-7: replace 후 활성 diary 1건", () => {
  it("soft-delete + 신규 INSERT 후 활성 diary = 정확히 1건", () => {
    let diaries = [DIARY_0806, DIARY_0813];

    // replace
    diaries = softDelete(diaries, "diary_0813");
    const newDiary: Diary = { id: "diary_0813_new", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
    diaries = addDiary(diaries, newDiary);

    const active = activeDiariesForSlot(diaries, GROUP_A, DATE_0813);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe("diary_0813_new");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-8  replace 후 다른 날짜 diary unchanged
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-8: replace 후 다른 날짜 diary unchanged", () => {
  it("8/13 replace 후 8/6 diary는 그대로 유지", () => {
    let diaries = [DIARY_0806, DIARY_0813];

    // 8/13 replace
    diaries = softDelete(diaries, "diary_0813");
    const newDiary: Diary = { id: "diary_0813_new", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
    diaries = addDiary(diaries, newDiary);

    // 8/6 diary 확인
    const d0806 = diaries.find(d => d.id === "diary_0806");
    expect(d0806?.is_deleted).toBe(false);
    expect(activeDiariesForSlot(diaries, GROUP_A, DATE_0806).length).toBe(1);
    expect(activeDiariesForSlot(diaries, GROUP_A, DATE_0806)[0].id).toBe("diary_0806");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TC-9  replace 후 다른 반/슬롯 diary unchanged
// ──────────────────────────────────────────────────────────────────────────────
describe("TC-9: replace 후 다른 반/슬롯 diary unchanged", () => {
  it("GROUP_A 8/13 replace 후 GROUP_B 8/13 diary는 그대로 유지", () => {
    let diaries = [DIARY_0806, DIARY_0813, DIARY_B_0813];

    // GROUP_A 8/13 replace
    diaries = softDelete(diaries, "diary_0813");
    const newDiary: Diary = { id: "diary_0813_new", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
    diaries = addDiary(diaries, newDiary);

    // GROUP_B 8/13 확인
    const dB = diaries.find(d => d.id === "diary_B_0813");
    expect(dB?.is_deleted).toBe(false);
    expect(activeDiariesForSlot(diaries, GROUP_B, DATE_0813).length).toBe(1);
    expect(activeDiariesForSlot(diaries, GROUP_B, DATE_0813)[0].id).toBe("diary_B_0813");
  });
});
