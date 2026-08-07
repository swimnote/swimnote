/**
 * 학부모 요청 처리 결과 알림 문구 생성
 * ─ 클라이언트가 title/body를 전달하는 방식은 사용 금지
 * ─ 서버에서 항상 buildRequestResultMessage()로 생성
 */
import { REQUEST_TYPE_LABELS } from "../constants/parent-request-types.js";

interface BuildInput {
  requestType: string;
  status: "done" | "rejected";
  adminNote?: string | null;
  requestId: string;
}

interface RequestResultMessage {
  title: string;
  body: string;
  refType: "parent_request";
  refId: string;
  deepLink: string;
}

const DONE_COPY: Record<string, { title: string; body: string }> = {
  absence:    { title: "결석 신청이 처리됐습니다",  body: "선생님이 결석을 확인했습니다." },
  makeup:     { title: "보강 요청이 처리됐습니다",  body: "보강 수업이 배정됐습니다." },
  postpone:   { title: "연기 신청이 처리됐습니다",  body: "선생님이 확인했습니다." },
  withdrawal: { title: "퇴원 신청이 처리됐습니다",  body: "퇴원 절차가 진행됩니다." },
  counseling: { title: "상담 요청이 처리됐습니다",  body: "선생님이 확인했습니다." },
  inquiry:    { title: "문의가 처리됐습니다",       body: "선생님이 답변을 확인했습니다." },
};

export function buildRequestResultMessage({ requestType, status, adminNote, requestId }: BuildInput): RequestResultMessage {
  const typeLabel = REQUEST_TYPE_LABELS[requestType] ?? requestType;
  const deepLink  = `/(parent)/notifications?tab=requests&requestId=${encodeURIComponent(requestId)}`;

  if (status === "rejected") {
    return {
      title:   `${typeLabel}이 거절됐습니다`,
      body:    adminNote?.trim()
        ? `거절 사유: ${adminNote.trim()}`
        : "요청이 거절됐습니다. 수영장에 문의해주세요.",
      refType: "parent_request",
      refId:   requestId,
      deepLink,
    };
  }

  // done
  const copy = DONE_COPY[requestType] ?? {
    title: `${typeLabel}이 처리됐습니다`,
    body:  "선생님이 확인했습니다.",
  };
  return { ...copy, refType: "parent_request", refId: requestId, deepLink };
}
