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

    // GROUP_A 8/13 replace — class_group_id + lesson_date 모두 일치 시에만
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

// ──────────────────────────────────────────────────────────────────────────────
// CASE 1 (spec)  8/13 A반 + B반 existing → A반 재작성 시 A반만 replace
// replace lookup은 반드시 class_group_id + lesson_date 둘 다 일치해야 함
// ──────────────────────────────────────────────────────────────────────────────

/** diary.tsx의 replace 대상 탐색 로직 재현 — class_group_id 가드 포함 */
function findExistingForReplace(
  diaries: Diary[],
  classGroupId: string,
  lessonDate: string,
): Diary | undefined {
  return diaries.find(
    d => d.class_group_id === classGroupId && d.lesson_date === lessonDate && !d.is_deleted,
  );
}

describe("CASE-1: 동일 날짜 다른 반 → A반 재작성이 B반에 영향 없음", () => {
  it("replace lookup이 class_group_id를 포함해야 B반 diary를 건드리지 않음", () => {
    const diaries = [DIARY_0813, DIARY_B_0813];

    // A반 8/13 replace 대상 탐색
    const targetA = findExistingForReplace(diaries, GROUP_A, DATE_0813);
    expect(targetA).toBeDefined();
    expect(targetA!.id).toBe("diary_0813");
    expect(targetA!.class_group_id).toBe(GROUP_A);

    // B반 replace 대상 탐색은 A반 재작성 시 호출되지 않음
    // 하지만 만약 class_group_id 가드 없이 lesson_date만으로 탐색했다면
    // B반 diary도 잘못 선택될 수 있었음
    const wrongLookup = diaries.find(d => d.lesson_date === DATE_0813 && !d.is_deleted);
    // class_group_id 가드 없으면 첫 번째 일치가 반환됨 (GROUP_A or GROUP_B 순서 의존)
    // class_group_id 가드 있으면 정확히 GROUP_A만 반환
    expect(targetA!.class_group_id).toBe(GROUP_A); // 반드시 A반만
    expect(wrongLookup).toBeDefined(); // 가드 없으면 순서 의존

    // A반만 soft-delete
    let updated = softDelete(diaries, targetA!.id);
    const newA: Diary = { id: "diary_0813_new", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
    updated = addDiary(updated, newA);

    // 결과: A반 활성 1건, B반 활성 1건 (건드리지 않음)
    expect(activeDiariesForSlot(updated, GROUP_A, DATE_0813).length).toBe(1);
    expect(activeDiariesForSlot(updated, GROUP_A, DATE_0813)[0].id).toBe("diary_0813_new");
    expect(activeDiariesForSlot(updated, GROUP_B, DATE_0813).length).toBe(1);
    expect(activeDiariesForSlot(updated, GROUP_B, DATE_0813)[0].id).toBe("diary_B_0813");
  });
});

describe("CASE-2: 8/6 A반 + 8/13 A반 → 8/13 재작성 시 8/6 untouched", () => {
  it("findExistingForReplace는 lesson_date가 다른 diary를 반환하지 않음", () => {
    const diaries = [DIARY_0806, DIARY_0813];

    const target = findExistingForReplace(diaries, GROUP_A, DATE_0813);
    expect(target?.id).toBe("diary_0813");

    let updated = softDelete(diaries, target!.id);
    const newDiary: Diary = { id: "diary_0813_new", class_group_id: GROUP_A, lesson_date: DATE_0813, is_deleted: false };
    updated = addDiary(updated, newDiary);

    // 8/6 diary unchanged
    expect(activeDiariesForSlot(updated, GROUP_A, DATE_0806).length).toBe(1);
    expect(activeDiariesForSlot(updated, GROUP_A, DATE_0806)[0].id).toBe("diary_0806");
  });
});

describe("CASE-3: my-schedule 과거 날짜 선택 → diary targetDate 정확히 전달", () => {
  it("parseTargetDate('2026-08-13', '2026-08-29') = '2026-08-13'", () => {
    expect(parseTargetDate("2026-08-13", "2026-08-29")).toBe("2026-08-13");
  });

  it("저장 시 lesson_date = targetDate = '2026-08-13'", () => {
    // 클라이언트가 POST /diaries 에 lesson_date: targetDate 를 전달함
    const payload = { class_group_id: GROUP_A, lesson_date: parseTargetDate("2026-08-13", "2026-08-29") };
    expect(payload.lesson_date).toBe("2026-08-13");
  });
});

describe("CASE-4: 다른 날짜로 이동 후 작성 — 선택 날짜 그대로 전달", () => {
  const TODAY = "2026-08-29";

  it.each([
    ["2026-08-06", "2026-08-06"],
    ["2026-08-13", "2026-08-13"],
    ["2026-08-20", "2026-08-20"],
  ])("lessonDate=%s → targetDate=%s", (param, expected) => {
    expect(parseTargetDate(param, TODAY)).toBe(expected);
  });

  it("lessonDate 미전달 시 today fallback", () => {
    expect(parseTargetDate(undefined, TODAY)).toBe(TODAY);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// QUICK WRITE — 미작성 슬롯 목록 필터링 로직
// /diaries/unwritten-slots 응답 처리: session identity = class_group_id + lesson_date
// ──────────────────────────────────────────────────────────────────────────────

/** 서버 응답 슬롯 타입 */
interface UnwrittenSlot {
  classGroupId: string;
  className: string;
  lessonDate: string;
  scheduleTime: string;
  dayOfWeek: string;
}

/**
 * 클라이언트에서 Quick Write 목록을 구성할 때의 필터 로직 재현.
 * session key = classGroupId + lessonDate
 */
function filterUnwritten(
  allSlots: UnwrittenSlot[],
  writtenKeys: Set<string>, // `${classGroupId}_${lessonDate}`
): UnwrittenSlot[] {
  return allSlots.filter(s => !writtenKeys.has(`${s.classGroupId}_${s.lessonDate}`));
}

/** Quick Write 목록 최근 날짜 우선 정렬 (서버 ascending → reverse) */
function sortNewestFirst(slots: UnwrittenSlot[]): UnwrittenSlot[] {
  return [...slots].sort((a, b) => b.lessonDate.localeCompare(a.lessonDate));
}

const GRP_A = "group_a";
const GRP_B = "group_b";
const D0806 = "2026-08-06";
const D0813 = "2026-08-13";
const D0820 = "2026-08-20";

function makeSlot(classGroupId: string, lessonDate: string, scheduleTime = "19:00"): UnwrittenSlot {
  return { classGroupId, className: classGroupId === GRP_A ? "A반" : "B반", lessonDate, scheduleTime, dayOfWeek: "목" };
}

describe("CASE-A: 8/6 작성됨, 8/13·8/20 미작성 → Quick Write 목록에 8/13·8/20만 표시", () => {
  it("작성된 8/6은 목록에서 제외", () => {
    const serverSlots = [makeSlot(GRP_A, D0806), makeSlot(GRP_A, D0813), makeSlot(GRP_A, D0820)];
    const written = new Set([`${GRP_A}_${D0806}`]);
    const result = filterUnwritten(serverSlots, written);

    expect(result.map(s => s.lessonDate)).not.toContain(D0806);
    expect(result.map(s => s.lessonDate)).toContain(D0813);
    expect(result.map(s => s.lessonDate)).toContain(D0820);
    expect(result).toHaveLength(2);
  });

  it("최근 날짜 우선 정렬: 8/20 → 8/13", () => {
    const unwritten = [makeSlot(GRP_A, D0813), makeSlot(GRP_A, D0820)];
    const sorted = sortNewestFirst(unwritten);
    expect(sorted[0].lessonDate).toBe(D0820);
    expect(sorted[1].lessonDate).toBe(D0813);
  });
});

describe("CASE-B: 8/13 선택 → diary header 8/13, save lesson_date 8/13", () => {
  it("선택된 슬롯의 lessonDate가 diary params로 정확히 전달됨", () => {
    const selected = makeSlot(GRP_A, D0813);
    // diary.tsx params 구성 로직 재현
    const params = {
      classGroupId: selected.classGroupId,
      className:    selected.className,
      lessonDate:   selected.lessonDate,
      startTime:    selected.scheduleTime,
    };
    expect(params.lessonDate).toBe(D0813);
    // diary.tsx는 params.lessonDate → targetDate로 사용
    const targetDate = parseTargetDate(params.lessonDate, "2026-08-29");
    expect(targetDate).toBe(D0813);
  });
});

describe("CASE-C: 8/13 작성 완료 후 Quick Write 재진입 → 8/13 목록에서 제거", () => {
  it("8/13 일지 작성 완료 후 written set에 추가 → 목록에서 제거", () => {
    const serverSlots = [makeSlot(GRP_A, D0813), makeSlot(GRP_A, D0820)];

    // 작성 전: 8/13·8/20 모두 표시
    let written = new Set<string>();
    expect(filterUnwritten(serverSlots, written)).toHaveLength(2);

    // 8/13 작성 완료
    written = new Set([`${GRP_A}_${D0813}`]);
    const after = filterUnwritten(serverSlots, written);

    expect(after.map(s => s.lessonDate)).not.toContain(D0813);
    expect(after.map(s => s.lessonDate)).toContain(D0820);
    expect(after).toHaveLength(1);
  });
});

describe("CASE-D: 같은 반 8/6 작성 + 8/13 미작성 → 8/13 정상 표시", () => {
  it("8/6 작성이 8/13 미작성 판정에 영향 없음", () => {
    const serverSlots = [makeSlot(GRP_A, D0806), makeSlot(GRP_A, D0813)];
    const written = new Set([`${GRP_A}_${D0806}`]);
    const result = filterUnwritten(serverSlots, written);
    expect(result).toHaveLength(1);
    expect(result[0].lessonDate).toBe(D0813);
  });
});

describe("CASE-E: 다른 반 같은 날짜 → 각각 독립적으로 미작성 판정", () => {
  it("GRP_A 8/13 작성됨, GRP_B 8/13 미작성 → B반만 표시", () => {
    const serverSlots = [makeSlot(GRP_A, D0813), makeSlot(GRP_B, D0813)];
    const written = new Set([`${GRP_A}_${D0813}`]);
    const result = filterUnwritten(serverSlots, written);
    expect(result).toHaveLength(1);
    expect(result[0].classGroupId).toBe(GRP_B);
  });

  it("두 반 모두 미작성이면 둘 다 표시", () => {
    const serverSlots = [makeSlot(GRP_A, D0813), makeSlot(GRP_B, D0813)];
    const written = new Set<string>();
    expect(filterUnwritten(serverSlots, written)).toHaveLength(2);
  });
});

describe("CASE-F: 미작성 0건 → empty state", () => {
  it("모든 슬롯이 작성된 경우 결과 빈 배열", () => {
    const serverSlots = [makeSlot(GRP_A, D0806), makeSlot(GRP_A, D0813)];
    const written = new Set([`${GRP_A}_${D0806}`, `${GRP_A}_${D0813}`]);
    expect(filterUnwritten(serverSlots, written)).toHaveLength(0);
  });

  it("슬롯 자체가 없는 경우도 빈 배열", () => {
    expect(filterUnwritten([], new Set())).toHaveLength(0);
  });
});
