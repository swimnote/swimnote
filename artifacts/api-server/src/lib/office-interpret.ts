import { OfficeError, parseOfficeCommand } from "./office-command.js";

/** Only user text + selected IDs are sent. No DB import, member roster, credentials or attachments. */
export type OfficeModel = (input: { text: string; memberId?: string }) => Promise<unknown>;
export const OFFICE_BUSINESS_POLICY = Object.freeze({
  singleOrdinaryUpdateOrMove: "validate-then-execute",
  ambiguous: "clarify",
  sendPaymentDeleteBulk: "confirmation-required",
  // A temporary, common menu/AI release restriction; not the final product policy.
  releaseRestriction: "preview-confirm-until-integrated-acceptance",
});
export async function interpretOffice(model: OfficeModel, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OfficeError(400, "INPUT", "업무 요청이 필요합니다.");
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(k => !["text", "memberId"].includes(k)) || typeof v.text !== "string" || !v.text.trim() || v.text.length > 2000 ||
      v.memberId !== undefined && (typeof v.memberId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(v.memberId)))
    throw new OfficeError(400, "INPUT", "요청과 선택한 회원만 전달할 수 있습니다.");
  // Conservative safety filter, not a general-language completeness proof.
  // Keep the temporary proposal confirmation even for texts that pass this filter.
  const move = /(반|class).{0,60}(이동|옮|move)|move.{0,60}(반|class)/i.test(v.text);
  const update = /(메모|이름|연락처|생년|보호자|memo|name|phone|birth).{0,50}(수정|변경|바꿔|바꾸|update|change|edit)/i.test(v.text);
  if (move && update || /발송|결제|환불|삭제|여러\s*회원|두\s*명|전체\s*회원|bulk|delete|payment/i.test(v.text))
    return { kind: "clarify" as const, question: "한 회원의 일반정보 수정 또는 반이동 한 작업씩 명확히 요청하세요. 이 요청은 실행하지 않았습니다." };
  const result = await model(v as { text: string; memberId?: string });
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new OfficeError(502, "MODEL_OUTPUT", "AI 결과를 확인할 수 없습니다.");
  const r = result as Record<string, unknown>;
  if (r.kind === "clarify" && Object.keys(r).every(k => ["kind", "question"].includes(k)) && typeof r.question === "string" && r.question.length <= 500)
    return { kind: "clarify" as const, question: r.question };
  if (r.kind === "search" && Object.keys(r).every(k => ["kind", "search"].includes(k)) && typeof r.search === "string" && r.search.length <= 200)
    return { kind: "search" as const, search: r.search };
  if (r.kind !== "command" || Object.keys(r).some(k => !["kind", "command"].includes(k)))
    throw new OfficeError(502, "MODEL_OUTPUT", "허용되지 않은 AI 결과입니다.");
  // Model cannot choose the authenticated actor, request identity, revision or confirmation policy.
  if (!r.command || typeof r.command !== "object" || Array.isArray(r.command)) throw new OfficeError(502, "MODEL_OUTPUT", "작업 형식을 확인하세요.");
  const c = r.command as Record<string, unknown>;
  if (Object.keys(c).some(k => !["action", "changes", "fromClassId", "toClassId"].includes(k)) || !v.memberId)
    throw new OfficeError(422, "CLARIFICATION", "회원·출발반·목적 반을 명확히 선택하세요.");
  const validated = parseOfficeCommand({ ...c, memberId: v.memberId, requestId: "validation", expectedRevision: "0".repeat(32) });
  return { kind: "proposal" as const, command: {
    action: validated.action, memberId: validated.memberId, changes: validated.changes,
    fromClassId: validated.fromClassId, toClassId: validated.toClassId,
  }, confirmation: "required" as const, policy: OFFICE_BUSINESS_POLICY };
}
