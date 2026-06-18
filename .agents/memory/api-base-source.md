---
name: API_BASE 소스 규칙
description: 실기기에서 올바른 API_BASE를 가져오는 방법
---

`types.ts` 등 로컬 파일에서 `API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api"` 형태로 정의하면 실기기에서 env var가 없을 때 `/api`(상대경로)로 fallback → 서버 도달 불가.

**규칙:** 앱 내 모든 `API_BASE` import는 반드시 `@/context/AuthContext`에서 가져와야 함.
`AuthContext`는 `SessionContext`의 `EXPO_PUBLIC_DOMAIN` 기반 full URL(`https://${domain}/api`)을 re-export.

**Why:** Expo 실기기는 localhost가 없으므로 상대경로 fetch는 실패함. AuthContext만이 올바른 full URL을 보장함.

**How to apply:** 새 컴포넌트에서 API 호출할 때 `import { API_BASE } from "@/context/AuthContext"` 사용.
