---
name: 업무 대화 스레드 구조
description: parent_request_messages 테이블 구조, auto-create 패턴, teacher/parent API, system message 삽입 시점
---

## 테이블 구조

```sql
CREATE TABLE IF NOT EXISTS parent_request_messages (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  request_id TEXT NOT NULL,
  swimming_pool_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,    -- 'parent' | 'teacher' | 'system'
  sender_id TEXT,               -- system이면 NULL
  message_type TEXT NOT NULL DEFAULT 'message',  -- 'message' | 'system'
  content TEXT NOT NULL,
  is_read_by_teacher BOOLEAN DEFAULT false,
  is_read_by_parent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

## Auto-Create 패턴

`let _messagesTableReady = false;` 플래그로 최초 1회만 CREATE TABLE IF NOT EXISTS 실행.
`ensureMessagesTable()` → 관련 엔드포인트 진입 시마다 호출 (멱등).

**Why:** 별도 migration 없이 기존 route init 패턴에 맞게 구성.

## System Message 삽입 시점

- `PATCH /:id/read` (최초 읽음): "선생님이 {유형}을 확인했습니다."
- `PATCH /parent-requests/:id` (status 변경, statusChanged=true): done→"처리됐습니다." / rejected→"처리하지 못했습니다."

**How to apply:** 새 status endpoint 추가 시 동일 패턴으로 insertSystemMessage 삽입.

## API 권한 규칙

- `GET /parent-requests/:requestId/messages`: teacher → pool 확인; parent → parent_id 확인
- `POST /parent-requests/:requestId/messages`: 동일
- 조회 시 상대방 메시지 자동 읽음 처리 (teacher조회→parent메시지 is_read_by_teacher=true)

## 홈 Badge 연동

`/teacher/overview` → `unread_parent_request_messages` 필드 추가.
today-schedule.tsx badge 조건: `unread_messages > 0 || pending_parent_requests > 0 || unread_parent_request_messages > 0`.

## 컴포넌트 경로

- Teacher용: `artifacts/swim-app/components/teacher/RequestThreadModal.tsx`
- Parent용: `artifacts/swim-app/components/parent/ParentRequestThreadModal.tsx`
- messages-inbox.tsx: [업무 대화] 버튼 + new_message_count 배지
- notifications.tsx: 요청 카드 Pressable → ParentRequestThreadModal

## 수정 이력 (2026-08-08)

### 메시지 전송 실패 원인 및 수정
- **원인**: sendMessage()에서 `setReplyText("")`를 전송 전에 실행 + `catch {}`로 오류 무시
- **수정**: 성공 시에만 clear + Alert로 실패 표시 (텍스트 유지)
- **적용**: RequestThreadModal + ParentRequestThreadModal 동일

### UX 수정
- UnreadMessagesModal: absence/makeup 직행 제거 → 모든 요청 `messages-inbox?tab=requests&requestId=id`
- messages-inbox: `requestId` param 수신 → teal 강조 + FlatList scroll (4초 후 강조 해제)
- notifications(학부모): 카드 전체 Pressable → View, "탭하여..." 문구 제거, [대화] 버튼 추가
- parent-requests.ts: push 문구 "답변이 도착했습니다" 개선

### OTA 배포 완료
- iOS production: update group `821b25de-d325-498c-8fd8-ee125161c748`
- Android production: update group `c3006ca1-45cf-4a55-a988-bee5db6f6438`
