---
name: WP-CS22 완료 상태
description: Remaining Knowledge Gaps Finalization — 3개 신규 Knowledge ACTIVE; Support System Core 종료
---

## 결과

- **SHA**: 000bf765 (코드 변경 없음 — DB only)
- **Render**: LIVE (CS20에서 이미 배포됨, CS22는 DB API 작업만)
- **CS22_CLOSE**: YES
- **SUPPORT_SYSTEM_CORE_COMPLETE**: YES
- **TOTAL_ACTIVE**: 26 (기존 23 + 신규 3)

## 신규 Knowledge 3개

| ID | 카테고리 | roles | modes | screen |
|----|----------|-------|-------|--------|
| ki_cs22_xmodeguard_lock_states | X_MODE/X_GUARD | pool_admin,teacher,parent_account | normal,x_pending,x | null |
| ki_cs22_parent_photo_not_visible | MEDIA/PHOTO_ACCESS | parent_account | normal,x | PARENT_PHOTOS |
| ki_cs22_makeup_failure | MAKEUP/MAKEUP_REQUEST | pool_admin,teacher,parent_account | normal,x | null |

## 핵심 지표

| 지표 | 결과 |
|------|------|
| READY_FOR_HUMAN_REVIEW | 3 |
| REVIEW_REQUIRED | 0 |
| BLOCKED | 0 |
| APPROVED | 3/3 |
| NEW_KNOWLEDGE_INSERTED | 3 |
| NEW_KNOWLEDGE_ACTIVATED | 3 |
| EXISTING_ACTIVE_CHANGED | 0 |
| NEW_KNOWLEDGE_RETRIEVAL_FAIL | 0 |
| HARD_CONFLICTS | 0 |
| UNSUPPORTED_TIMING_CLAIMS | 0 |
| INVALID_FRONTEND_SCREEN_ID | 0 |
| HALLUCINATED_UI_PATH | 0 |
| PHOTO_CROSS_CHILD_GUIDANCE | 0 |
| PHOTO_CROSS_POOL_GUIDANCE | 0 |
| RAW_STORAGE_REF_EXPOSED | 0 |
| MAKEUP_ROLE_MISMATCH | 0 |
| INVALID_MAKEUP_ACTION | 0 |
| UNSUPPORTED_CLAIMS | 0 |
| CONTRADICTED_CLAIMS | 0 |
| FALSE_INCIDENT_CLAIM | 0 |
| UNSAFE_OR_UNGROUNDED | 0 |
| KOREAN_QUERY_ENCODING_FAIL | 0 |
| KOREAN_SEARCH_HTTP_400 | 0 |

## P1 XModeGuard Product Truth

- 4개 내부 상태: no_entitlement/not_configured/curriculum_pending/api_error
- 단일 SOLUTION으로 통합 (상태별 분기)
- UNSUPPORTED_TIMING_CLAIMS: 0 (기존 draft의 "5분/1~3영업일" 삭제)
- Source: XModeGuard.tsx:62-186 + xmode.ts:58-76

## P2 Parent Photo Security

- 학부모는 approved parent_students 링크를 통해 본인 자녀 사진만 접근
- raw storage key/bucket path 노출 없음
- PARENT_PHOTOS screen_id 등록됨

## P3 Makeup Policy

- 날짜 범위: ±14일~+28일 (코드 확인)
- Parent는 generic request 제출만 가능 (직접 배정/취소 불가) — 코드 확인
- Teacher: 배정/완료/취소, pool_admin: 추가로 이관 가능

## §16 Korean Search

- 모바일 앱: /support/respond에 JSON message body 전송 (q= 파라미터 사용 안함)
- Admin web: 클라이언트 사이드 필터 (서버 q= 호출 없음)
- 서버 side 한글 검색 5개 fixture: 모두 HTTP 200 ✅

## 다음 단계

CS22 이후 Support System Core 완료. 다음 WP:
1. 10,000개 일지 문장 업로드/검색 인덱스 반영
2. 학부모 AI 커리큘럼 검색 실기기 점검
3. 학부모 AI 성장리포트 내용 엔진
4. 앱 버그 수정
5. 새 iOS/Android 안정화 빌드
