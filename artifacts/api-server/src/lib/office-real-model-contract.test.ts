import { it, expect, vi } from "vitest";
import { completeOfficeModel } from "./office-model.js";
import { interpretOffice } from "./office-interpret.js";
it("shared SDK path uses exactly one attempt, bounded messages/output and existing timeout", async () => {
  const create = vi.fn(async () => ({ choices: [{ finish_reason: "stop", message: {
    content: '{"kind":"command","command":{"action":"move","fromClassId":"fixture_a","toClassId":"fixture_c"}}' } }] }));
  const model = (input: any) => completeOfficeModel({ chat: { completions: { create } } }, "gpt-4o-mini", input);
  const result = await interpretOffice(model, { text: "fixture_a에서 fixture_c로 반 이동", memberId: "fixture_member" });
  expect(result).toMatchObject({ kind: "proposal", confirmation: "required", command: { action: "move", memberId: "fixture_member" } });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]).toMatchObject([{ model: "gpt-4o-mini", max_tokens: 512 }, { timeout: 12000, maxRetries: 0 }]);
});
it("guardian authentication contact gets a question before model, never remaps to ordinary phone", async () => {
  const model = vi.fn(async () => ({ kind: "command", command: { action: "update", changes: { phone: "010-0000-2222" } } }));
  expect(await interpretOffice(model, { text: "보호자 로그인 인증 전화번호 변경", memberId: "fixture_member" })).toMatchObject({ kind: "clarify" });
  expect(model).not.toHaveBeenCalled();
});
it("revalidates the observed real search output without expanding the literal requested name", async () => {
  const result = await interpretOffice(async () => ({ kind: "search", search: "합성 회원 이름" }),
    { text: "합성 회원 이름 검색만 해줘. 아무것도 변경하지 마.", memberId: "fixture_member" });
  expect(result).toEqual({ kind: "search", search: "합성 회원" });
});
it("oversized actual model messages cause zero SDK calls", async () => {
  const create = vi.fn();
  await expect(completeOfficeModel({ chat: { completions: { create } } }, "gpt-4o-mini", { text: "가".repeat(2000) })).rejects.toMatchObject({ code: "MODEL_INPUT_LIMIT" });
  expect(create).not.toHaveBeenCalled();
});
it("truncation and timeout do not retry or yield proposals", async () => {
  const create = vi.fn(async () => ({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }));
  await expect(completeOfficeModel({ chat: { completions: { create } } }, "gpt-4o-mini", { text: "합성" })).rejects.toMatchObject({ code: "MODEL_OUTPUT" });
  expect(create).toHaveBeenCalledTimes(1);
  const timeout = vi.fn(async () => { throw new Error("synthetic timeout"); });
  await expect(completeOfficeModel({ chat: { completions: { create: timeout } } }, "gpt-4o-mini", { text: "합성" })).rejects.toThrow("synthetic timeout");
  expect(timeout).toHaveBeenCalledTimes(1);
});
