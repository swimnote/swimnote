import { z } from "zod";
import { api } from "@/lib/api-client";

// Validate the fields actually rendered. Never turn a malformed envelope into an empty history.
const historySchema = z.object({
  success: z.literal(true),
  reports: z.array(z.object({
    report_id: z.string().min(1),
    report_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    published_at: z.string().nullable(),
  })),
});

class GrHistoryResponseError extends Error {
  constructor() { super("Invalid growth-report history response"); }
}

export async function loadGrHistory(studentId: string, signal?: AbortSignal) {
  const body = await api.get<unknown>(
    `/admin/growth-reports/students/${encodeURIComponent(studentId)}`, { signal },
  );
  const parsed = historySchema.safeParse(body);
  if (!parsed.success) throw new GrHistoryResponseError();
  return parsed.data;
}

/** No raw error messages, response bodies, URLs, member IDs or tokens in the UI/logs. */
export function grHistoryErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "status" in error &&
      typeof error.status === "number" && Number.isInteger(error.status) &&
      error.status >= 400 && error.status <= 599) {
    return `발행 이력 조회 요청에 실패했습니다 (HTTP ${error.status}).`;
  }
  if (error instanceof SyntaxError || error instanceof GrHistoryResponseError) {
    return "응답 형식을 확인하지 못했습니다. 정상적인 빈 이력과는 다릅니다.";
  }
  if (error instanceof TypeError) {
    return "네트워크·보안 정책 등으로 응답을 읽지 못했습니다. 세부 원인은 미확인입니다.";
  }
  return "오류 유형을 확인하지 못했습니다.";
}
