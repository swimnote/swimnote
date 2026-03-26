/**
 * 네이버 클라우드 SENS (Simple & Easy Notification Service) SMS provider
 * https://api.ncloud-docs.com/docs/ai-application-service-sens-smsv2
 *
 * 환경변수:
 *   NAVER_SENS_ACCESS_KEY   — IAM 액세스 키
 *   NAVER_SENS_SECRET_KEY   — IAM 시크릿 키
 *   NAVER_SENS_SERVICE_ID   — SENS 서비스 ID (SMS 채널)
 *   NAVER_SENS_SENDER_PHONE — 등록된 발신번호 (하이픈 제외 숫자)
 */
import { createHmac } from "crypto";

const API_HOST = "https://sens.apigw.ntruss.com";

function buildSignature(
  method: string,
  url: string,
  timestamp: string,
  accessKey: string,
  secretKey: string,
): string {
  const message = `${method} ${url}\n${timestamp}\n${accessKey}`;
  return createHmac("sha256", secretKey).update(message).digest("base64");
}

export async function sendSensSmS({
  phone,
  message,
}: {
  phone: string;
  message: string;
  from?: string;
}): Promise<void> {
  const accessKey  = process.env.NAVER_SENS_ACCESS_KEY;
  const secretKey  = process.env.NAVER_SENS_SECRET_KEY;
  const serviceId  = process.env.NAVER_SENS_SERVICE_ID;
  const senderPhone = process.env.NAVER_SENS_SENDER_PHONE;

  if (!accessKey || !secretKey || !serviceId || !senderPhone) {
    throw new Error(
      "SENS 환경변수 미설정: NAVER_SENS_ACCESS_KEY / NAVER_SENS_SECRET_KEY / NAVER_SENS_SERVICE_ID / NAVER_SENS_SENDER_PHONE",
    );
  }

  const urlPath  = `/sms/v2/services/${serviceId}/messages`;
  const timestamp = String(Date.now());
  const signature = buildSignature("POST", urlPath, timestamp, accessKey, secretKey);

  const body = {
    type:        "SMS",
    contentType: "COMM",
    countryCode: "82",
    from:        senderPhone.replace(/[-\s]/g, ""),
    content:     message,
    messages: [
      { to: phone.replace(/[-\s]/g, "") },
    ],
  };

  console.log(`[SENS] SMS 발송 시도 → ${phone.slice(0, 3)}****${phone.slice(-4)}`);

  const res = await fetch(`${API_HOST}${urlPath}`, {
    method: "POST",
    headers: {
      "Content-Type":           "application/json; charset=utf-8",
      "x-ncp-apigw-timestamp":  timestamp,
      "x-ncp-iam-access-key":   accessKey,
      "x-ncp-apigw-signature-v2": signature,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({})) as any;

  if (!res.ok) {
    const reason = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
    console.error(`[SENS] 발송 실패: ${reason}`);
    throw new Error(`SENS SMS 발송 실패: ${reason}`);
  }

  const statusCode = data?.statusCode ?? data?.status ?? "";
  // SENS 성공 응답: statusCode "202"
  if (String(statusCode) !== "202") {
    const reason = data?.statusName ?? data?.message ?? String(statusCode);
    console.error(`[SENS] 발송 거부: ${reason}`);
    throw new Error(`SENS SMS 발송 거부: ${reason}`);
  }

  console.log(`[SENS] 발송 성공 (requestId: ${data?.requestId ?? "N/A"})`);
}
