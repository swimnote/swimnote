---
name: Render 배포 수동 전용 규칙
description: Render.com 배포는 사용자가 대시보드에서 수동 진행; 자동화 금지
---

## 규칙

Render.com 배포는 **절대 자동화하지 않는다**.

- RENDER_API_KEY를 사용한 자동 deploy 트리거 금지
- RENDER_API_KEY secret 요청 금지
- Render API 직접 호출 금지

## 배포 필요 시 보고 형식

배포가 필요하면 아래 세 가지만 보고하고 멈춘다:

```
- repo: https://github.com/swimnote/swimnote.git
- branch: <branch-name>
- target SHA: <commit-sha>
```

사용자가 Render 대시보드에서 수동으로 배포 후 결과를 알려준다.

**Why:** 2026-08-20 사용자 명시 지시. Render 배포는 사용자 수동 진행.
**How to apply:** 서버 코드 변경 후 Render 배포 필요 시 항상 이 규칙 적용.
