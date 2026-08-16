---
name: WP-X04 완료 상태
description: Document Structuring / Website Build Package Foundation
---

## 결과

- SHA: 07dac4df
- TS 신규 오류: 0
- TC: 1225 (35 new X04-01~X04-26+)
- iOS OTA: 없음 (client-only 변경 아님)
- Render: 배포 트리거됨 (SHA push 후 자동)

## T1 검증 (선행 작업)

- T1 Render status: live (dep-da12ck1t0dsc)
- 커리큘럼 DOCX SHA-256: 797339d9fe76880d21b33487325f7dde85053380c4367a46b592b56bb0e42753
- 홈페이지 DOCX SHA-256: 9921f96d11ee5a9d7c3b94563abf740ad3b3fdf9b6ccdf931646db230fe6507d
- T1_FULL_PASS = YES

## 신규 파일

| 파일 | 역할 |
|------|------|
| migrations/pool-db-x04.ts | 4개 테이블 (curriculum_profiles/levels/website_profiles/packages) |
| lib/docxParser.ts | fflate+XML, version-aware, NO_HALLUCINATION |
| lib/websitePackager.ts | fflate zipSync, spec.md+data.json+manifest.json |
| routes/x04-structuring.ts | 8개 super_admin 엔드포인트 |
| routes/__tests__/x04-structuring.test.ts | 35 TCs |

## 의존성 추가

- api-server: fflate (ZIP: DOCX 읽기 + 패키지 생성)

## 원칙 준수

- ORIGINAL != STRUCTURED: x_setup_files 절대 미수정 ✅
- NO_HALLUCINATION: 없는 값 → undefined (fabrication 없음) ✅
- VARIABLE_LEVEL_COUNT: 1~10 단계 유연 지원 ✅
- PROVENANCE: submission_id linkage 보존 ✅
- PACKAGE_VERSIONING: overwrite 금지, history 유지 ✅
- DO_NOT_TOUCH list: 모두 무수정 ✅

## Web UI (PoolAdmin.tsx XSetupTab 확장)

- 구조화 실행 버튼
- 커리큘럼/홈페이지 구조화 데이터 보기
- JSON inline 편집 (APPROVED 상태는 잠금)
- 커리큘럼/홈페이지/both 승인 버튼
- 홈페이지 제작 패키지 생성 버튼 (APPROVED 상태에만)
- 패키지 이력 + 다운로드
