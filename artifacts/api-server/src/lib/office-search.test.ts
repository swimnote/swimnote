import { expect, it, vi } from "vitest";
import { groundedOfficeSearch } from "./office-search.js";
import { interpretOffice } from "./office-interpret.js";
it.each([
  ['"합성가람" 이름 검색만 해줘.', "합성가람", "합성가람"],
  ["합성 검증 회원 이름 검색만 해줘. 아무것도 변경하지 마.", "합성 검증 회원 이름", "합성 검증 회원"],
  ['"합성가람" 회원 찾아줘', "합성가람", "합성가람"],
  ["합성가람 정보 보여줘", "합성가람", "합성가람"],
  ['"긴 이름 이름" 검색해줘', "긴 이름 이름", "긴 이름 이름"],
  ["010-0000-3333 전화번호 검색해줘", "01000003333", "01000003333"],
  ['"합성가람" 검색', "합성", null],
  ['"합성가람" 검색', "합성다른", null],
  ['"합성가람" 검색', "", null],
  ['"합성가람" "합성다른" 검색', "합성가람", null],
  ["조건 없이 검색", "합성가람", null],
  ["합성가람 회원 찾아줘", "합성가람", null],
])("grounds only a literal requested term: %s", (text, generated, expected) => {
  expect(groundedOfficeSearch(text, generated)).toBe(expected);
});
it("mixed lookup/update never calls the model or yields a partial action", async () => {
  const model = vi.fn();
  expect(await interpretOffice(model, { text: '"합성가람" 검색하고 메모를 합성 변경으로 수정', memberId: "fixture_member" }))
    .toMatchObject({ kind: "clarify" });
  expect(model).not.toHaveBeenCalled();
});
it("search-only text can never accept a model-generated mutation even with a selected member", async () => {
  expect(await interpretOffice(async () => ({ kind: "command", command: { action: "update", changes: { memo: "bad" } } }),
    { text: '"합성가람" 검색', memberId: "fixture_member" })).toMatchObject({ kind: "clarify" });
});
it("an empty/broadened model search cannot become a whole-roster query", async () => {
  expect(await interpretOffice(async () => ({ kind: "search", search: "" }), { text: '"합성가람" 검색' }))
    .toMatchObject({ kind: "clarify" });
});
