/**
 * CoolSMS (쿨SMS) provider
 * API: https://api.coolsms.co.kr/messages/v4/send
 * Auth: HMAC-SHA256 apiKey, date, salt, signature
 */
import { createHmac, randomBytes } from "crypto";

const API_URL = "https://api.coolsms.co.kr/messages/v4/send";

function buildAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function sendCoolSms({
  phone,
  message,
  from,
}: {
  phone: string;
  message: string;
  from: string;
}): Promise<void> {
  const apiKey    = process.env.SMS_API_KEY;
  const apiSecret = process.env.SMS_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("CoolSMS: SMS_API_KEY / SMS_API_SECRET 미설정");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildAuthHeader(apiKey, apiSecret),
    },
    body: JSON.stringify({
      message: {
        to:   phone.replace(/-/g, ""),
        from: from.replace(/-/g, ""),
        text: message,
        type: "SMS",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as any;
    throw new Error(`CoolSMS 발송 실패 [${res.status}]: ${body?.errorMessage ?? "알 수 없는 오류"}`);
  }

  const data = await res.json().catch(() => ({})) as any;
  if (data?.errorCount && data.errorCount > 0) {
    const firstError = data.resultList?.[0];
    throw new Error(`CoolSMS 발송 실패: ${firstError?.resultMessage ?? "발송 오류"}`);
  }
}
