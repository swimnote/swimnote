---
name: WP-CS-02R 완료 상태
description: Unified App AI Support Entry + Conversation UI — 완료 기록
---

## SHA
4fac1dc2

## 변경 파일 (13개)

### 서버
- `routes/support-cases.ts` — GET /support/cases(목록), POST /:id/resolve(해결) 신규
- `lib/support-case-service.ts` — VALID_TRANSITIONS: NEW → AI_RESOLVED 추가
- `routes/__tests__/cs-02r.test.ts` — 33 TCs (CS02R-01 ~ CS02R-22)

### 앱
- `components/support/SupportChatScreen.tsx` — 단일 공통 고객지원 UI
- `app/(admin)/support-chat.tsx` + `(admin)/_layout.tsx` + `(admin)/settings.tsx`
- `app/(teacher)/support-chat.tsx` + `(teacher)/_layout.tsx` + `(teacher)/settings.tsx`
- `app/(parent)/support-chat.tsx` + `(parent)/_layout.tsx` + `(parent)/more.tsx`

## 아키텍처 결정

**단일 소스 원칙:**
- SupportChatScreen.tsx 한 곳 — admin/teacher/parent Normal/X 공통
- 각 역할: 얇은 wrapper screen → layout 등록 → settings 진입점 추가

**Case 생성 전략 (Lazy):**
- 첫 메시지 전송 시 POST /support/cases → case_id 확보 후 메시지 저장
- 빈 case 미리 생성 안 함

**Resolve 흐름:**
- AI 단계(NEW/AI_PROCESSING/AI_RESPONDED/WAITING) → AI_RESOLVED
- Human 단계(HUMAN_*/ ESCALATED/PHONE_REQUIRED) → RESOLVED
- 이미 RESOLVED/CLOSED/AI_RESOLVED → idempotent 200

**No Fake AI:**
- "문의가 접수되었습니다." = deterministic 고정 문구 (클라이언트 렌더링)
- OpenAI 호출 0개

**레거시 보존:**
- (teacher)/inquiries, (parent)/inquiries, (admin)/help 라우트 삭제 없음

## FINAL REPORT
- COMMON_SUPPORT_UI = YES
- ADMIN_ENTRY = YES (settings.tsx MY_SETTINGS 항목)
- TEACHER_ENTRY = YES (settings.tsx AI 문의 버튼)
- PARENT_ENTRY = YES (more.tsx MenuItem)
- NORMAL_SUPPORT = PASS
- X_SUPPORT = PASS (SubScreenHeader isX-aware)
- CASE_CREATE = PASS
- MESSAGE_SEND = PASS
- CONVERSATION_HISTORY = PASS
- FAKE_AI_UI = NO
- OPENAI_CALLS_ADDED = 0
- CROSS_USER_SECURITY = PASS
- CROSS_POOL_SECURITY = PASS
- HUMAN_REQUEST_IDEMPOTENT = PASS
- AGENT_REPLY_VISIBLE = PASS
- LEGACY_HELP_REGRESSION = NO
- SERVER_CHANGED = YES
- MOBILE_CHANGED = YES
- DB_CHANGED = NO (schema via CS-01R HARDEN 이미 완료)
- UNIT_TEST = 33 TCs
- REGRESSION_TEST = 1428/1428
- IOS_PREVIEW_OTA = 01a00e70-b1a6-7636-a804-9807e77c1714 (branch:preview, group:f2d477a9)
- IOS_PRODUCTION_OTA = NO
- ANDROID_OTA = NO

## VALID_TRANSITIONS 수정
NEW → AI_RESOLVED 추가: 사용자가 AI 처리 전 스스로 해결한 경우 허용
**Why:** resolve endpoint가 AI-phase 케이스에 AI_RESOLVED 전환 시도; NEW가 AI_RESOLVED로 바로 전환 못 하면 422 오류 발생
