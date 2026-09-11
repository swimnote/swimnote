/**
 * sendOperatorAlert — 운영자(슈퍼 어드민)에게 SMS 알림을 보내는 best-effort 헬퍼.
 *
 * - OPERATOR_ALERT_PHONE 환경변수가 없으면 로그만 남기고 종료.
 * - SMS 전송 실패 시 throw하지 않음 (worker 흐름을 막지 않는다).
 * - prefix "[SwimNote ALERT]" 고정.
 */
export async function sendOperatorAlert(message: string): Promise<void> {
  const phone = process.env["OPERATOR_ALERT_PHONE"];
  if (!phone) {
    console.warn("[operator-alert] OPERATOR_ALERT_PHONE not set — skipping SMS");
    return;
  }
  try {
    const { sendSms } = await import("./sms/sendSms.js");
    await sendSms({ phone, message: `[SwimNote ALERT]\n${message}` });
    console.log("[operator-alert] SMS sent:", message.slice(0, 80));
  } catch (err: any) {
    console.error("[operator-alert] SMS send failed:", err.message);
  }
}
