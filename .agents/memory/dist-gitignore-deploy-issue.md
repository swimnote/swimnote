---
name: dist gitignore 배포 문제
description: api-server dist가 .gitignored → Replit 재배포 없으면 OLD dist 캐시 사용; swimnote.kr 신규 route 누락 패턴
---

## 규칙

신규 서버 route 추가 후 swimnote.kr에 반영되지 않는 증상이 나타나면:
dist/index.mjs를 확인한다 (빌드 일자 vs route 추가 일자 비교).

## 패턴

- swimnote.kr = Replit Published, `node dist/index.mjs` 실행
- dist/는 .gitignore 등록 → 기본 push에서 제외됨
- 신규 route를 src에 추가해도 dist 미빌드 시 swimnote.kr에 반영 안 됨
- SPA fallback이 HTML 200 반환 → client `res.json()` 예외 → catch block → "네트워크 오류" UI

## 증상

- Render (tsx src/index.ts) = 정상 동작
- swimnote.kr (node dist/index.mjs) = 404 또는 HTML 200 반환
- 클라이언트에서 generic network error 표시

## 핫픽스 절차

1. `pnpm --filter @workspace/api-server run build` (tsx ./build.ts)
2. 새 dist 확인: `grep -c "route-keyword" dist/index.mjs`
3. `git add -f artifacts/api-server/dist/index.mjs` (force-add, gitignore 우회)
4. commit + push
5. **Replit Published 재배포 필수** (dist 반영 위해)

**Why:** dist는 .gitignore에 있어 일반 push로는 swimnote.kr에 반영 안 됨. force-add + Replit re-publish 조합만 신뢰할 수 있음.

## 재발 방지

- 서버 신규 route 추가 후 항상 build + dist 검증
- swimnote.kr와 Render는 별개 runtime — Render 배포만으론 swimnote.kr 미반영
- 2026-08-17 발생: CS-02R support-cases route가 dist 미빌드로 swimnote.kr 누락
