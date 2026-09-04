---
name: WP-X03-T1 완료 상태
description: X Setup 공식 DOCX 양식 binary 등록 완료 상태 (auto-generation 제거)
---

## 결과

- SHA: 8f0c667c (T1 main), 5c55f3dc (lockfile fix)
- TC: 1190/1190 (변화 없음)
- Render: dep-da11rmc9v7es73ada0rg (build_failed — docx 제거 lockfile 미갱신) → 재배포 필요
- iOS OTA production: 01a00c49-037b-7bc4-84f0-7f296baa73e9
- iOS OTA preview: 61cf273b
- Android OTA production: 01a00c4d-c203-7160-b593-e8d69103bc47
- Android OTA preview: 01a00c4e-5b85-7d03-9a3b-3d87d2db1291

## 공식 파일

| 파일 | 크기 | SHA-256 |
|------|------|---------|
| SWIMNOTE_X_커리큘럼_작성양식_v1.0.docx | 40,195 bytes | 797339d9fe76880d21b33487325f7dde85053380c4367a46b592b56bb0e42753 |
| SWIMNOTE_X_홈페이지_제작자료_양식_v1.0.docx | 39,184 bytes | 9921f96d11ee5a9d7c3b94563abf740ad3b3fdf9b6ccdf931646db230fe6507d |

## 주요 변경

- `src/assets/templates/` 에 공식 바이너리 2종 저장
- `xSetupTemplates.ts` 완전 재작성: docx 패키지 → readFile + R2 업로드
- 버전: 1.0.0 → **1.0** (공식 파일명 기준)
- R2 키: `x-setup/templates/{type}_v1.0.docx`
- `getTemplateMeta()` 추가
- docx@8.5.0 package.json 제거 + lockfile 갱신
- App x-setup.tsx: Word 표준 안내 배너 추가

## 자동생성 코드 제거 완료

- `buildCurriculumDoc()` 함수 제거
- `buildWebsiteDoc()` 함수 제거
- `docx` npm 패키지 제거
- startup에서 공식 바이너리 읽어서 R2에 등록 (idempotent)
