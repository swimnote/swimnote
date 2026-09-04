---
name: Kakao Exit Bridge 완료 상태
description: teacher 전환 endpoint + 1.6.3 client notice bridge 완료 현황
---

## 완료 항목

**Server (release/v2.0.0 SHA 0124d8a1 + deploy-photo-clone SHA 892a0a74)**
- `POST /auth/teacher-kakao-migration-register`: 원자적 전환 (BEGIN/ROLLBACK/COMMIT), class_groups/makeup_classes/teacher_invites/push_settings/push_tokens 이전, email=`__archived_kakao_${oldId}`로 archive
- `GET /auth/kakao-remaining-count`: super_admin/pool_admin 전용, PII 마스킹, pool별 집계
- `teacher-self-signup`: KAKAO_MIGRATION_REQUIRED (phone+pool_id Kakao teacher 감지) 분기 추가

**1.6.3 Client (maintenance/v1.6.3-social-exit SHA 6b7fde18)**
- `index.tsx`: handleKakaoLogin → SDK 0 호출, Alert 안내 → general signup
- `signup.tsx`: teacher/parent 409 KAKAO_MIGRATION_REQUIRED → migrationModal 표시 → 전환 endpoint 호출 → 자동 세션 설정

**Tests**
- kakao-exit-bridge.test.ts: KP01-KP16, KT01-KT18, KC01-KC08 (42 PASS)
- Total: 175 PASS

## 보안 판단 §11
- Teacher 전환 인증: phone + pool_id 매칭 (실소유 검증 없음, parent와 동일 수준)
- 결정: 사용자에게 PROCEED/BLOCKED 판단 이관

## 미완료 (사용자 지시 대기)
- 1.6.3 iOS OTA (Android: BUILD_REQUIRED)
- Render.com 배포 (deploy-photo-clone)
- §19 pre-existing 15개 실패 목록 보고

**Why:** Kakao Exit은 1회성 브릿지; 보안 판단은 사용자 결정 필요
**How to apply:** deploy-photo-clone=Render.com 연결됨; iOS OTA만 추가 지시 필요
