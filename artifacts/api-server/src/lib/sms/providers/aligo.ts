/**
 * 알리고 (Aligo) provider
 * API: https://apis.aligo.in/send/
 * Auth: API key + user_id in request body
 */
export async function sendAligoSms({
  phone,
  message,
  from,
}: {
  phone: string;
  message: string;
  from: string;
}): Promise<void> {
  const apiKey = process.env.SMS_API_KEY;
  const userId = process.env.SMS_USER_ID;
  if (!apiKey || !userId) throw new Error("알리고: SMS_API_KEY / SMS_USER_ID 미설정");

  const params = new URLSearchParams({
    key:      apiKey,
    user_id:  userId,
    sender:   from.replace(/-/g, ""),
    receiver: phone.replace(/-/g, ""),
    msg:      message,
    msg_type: "SMS",
    testmode_yn: "N",
  });

  const res = await fetch("https://apis.aligo.in/send/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({})) as any;
  if (String(data?.result_code) !== "1") {
    throw new Error(`알리고 발송 실패: ${data?.message ?? data?.result_code ?? "알 수 없는 오류"}`);
  }
}
