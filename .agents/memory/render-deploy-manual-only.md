---
name: Render 배포 — Replit 책임 영구 규칙
description: 서버 코드 변경 시 Render Production 배포까지 Replit이 완료 책임 (2026-09-08 영구 변경)
---

## 규칙 (2026-09-08 영구 변경)

서버 코드가 수정되는 모든 작업에서 Render Production 배포는 **Replit 작업 범위에 기본 포함**.

**기본 실행 체인:**
코드 수정 → 테스트 → git main push → Render deploy trigger → 완료 대기 → /health SHA 확인 → smoke test

**PASS 조건:**
main HEAD SHA == Render LIVE /health commit SHA

"GitHub push 완료" / "Render 배포 트리거됨" / "수동 배포 필요" 상태에서 완료보고 금지.

**완료보고 필수 항목:**
1. main HEAD SHA
2. migration 실행 여부
3. Render deploy 결과
4. Render LIVE SHA
5. /health commit
6. Production smoke 결과
7. APP 변경 여부
8. OTA 필요 여부/OTA ID
9. 잔존 blocker

**Why:** 2026-09-08 사용자 영구 지시. 이전 "수동 전용" 규칙 완전 대체.
**How:** RENDER_API_KEY secret으로 Render API 직접 호출하여 deploy trigger.
실패 시: build log 확인 → 최소 수정 → 재배포 → /health 재확인.

## OTA 구분
서버 코드만 변경: Render deploy만 (OTA 하지 않음)
APP JS/TS 변경: OTA 필요 시 별도 수행
서버+APP 동시: Render LIVE 먼저 확정 → smoke → 이후 OTA
Android OTA: 별도 지시 없으면 금지
