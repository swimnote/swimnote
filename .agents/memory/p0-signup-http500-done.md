---
name: P0_SIGNUP_HTTP500 완료 상태
description: 학부모 회원가입 POST /auth/v2/parent-register HTTP 500 핫픽스 완료 기록
---

## 결과

- SHA: `074e7f46`
- Render.com: `dep-da09qg8u01pc738mk2ag` — live
- OTA production: group `0119fc1b` / iOS `01a00670-255f`
- OTA preview: group `fe4d4b29` / iOS `01a00670-57ba`

## 확정된 수정 내용 (auth.ts + signup.tsx)

1. **[§6 클라이언트 에러 메시지]** signup.tsx: res.status >= 500 또는 rawError.startsWith("Unexpected response"/"Internal Server Error") → "가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."

2. **[§5 원자성 롤백]** auth.ts: `createdParentId` 변수로 생성된 계정 추적 → `upsertParentV2Pending` 등 후속 처리 실패 시 `DELETE parent_accounts WHERE id = createdParentId` 롤백

3. **[소셜 회원가입 버그]** auth.ts: `apple_id`/`kakao_id` 추출 누락 수정 → INSERT parent_accounts에 apple_id, kakao_id 포함; Apple/Kakao 중복 가입 409 체크 추가

4. **[로깅 개선]** catch 블록에 `e?.stack` 포함; 요청 수신 시 소셜 여부 로깅 추가

## Root cause (확정 불가 — best estimate)

Render.com proxy HTML 500 (서버 mid-restart, 로그 갭 16:39→16:44 UTC Aug 15) → safeJson JSON parse 실패 → raw technical error 노출.
실제 서버 로그 없어 완전 확정 불가. 재발 시 Render 로그로 확인.

## 다음 조치 필요 없음

- A6 device test는 사용자 실기기 확인 후 PHASE B 시작 조건
