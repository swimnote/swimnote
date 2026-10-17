import { OfficeError } from "./office-command.js";
export const OFFICE_MODEL_INPUT_LIMIT = 4096;
export function officeModelMessages(input: { text: string; memberId?: string }) {
  const messages = [
    { role: "system" as const, content: 'Return JSON only. Allowed: {"kind":"search","search":"..."}, {"kind":"clarify","question":"..."}, {"kind":"command","command":{"action":"update","changes":{"name|phone|birth_date|birth_year|parent_name|memo":"value"}}}, or move with fromClassId,toClassId. Only ONE action on ONE selected member. Multiple ordinary fields in that update are allowed. Compound update+move, multiple members, sending/payment/deletion/bulk/unsupported requests MUST clarify, never silently drop a subtask. Never invent IDs. Unknown member/class ID MUST clarify. Never output URL, SQL, actor, pool, requestId, revision, approval or credentials. Interpretation is NOT execution.' },
    { role: "user" as const, content: JSON.stringify(input) },
  ];
  // Conservative BPE content-token ceiling: >= UTF-8 bytes + fixed allowance for two-message framing.
  // Includes JSON escapes, selected ID and system prompt, not merely JS string length.
  const upperBound = Buffer.byteLength(JSON.stringify(messages), "utf8") + 256;
  if (upperBound > OFFICE_MODEL_INPUT_LIMIT)
    throw new OfficeError(413, "MODEL_INPUT_LIMIT", "모델 입력 한도를 초과했습니다. 전송하지 않았습니다.");
  return messages;
}
