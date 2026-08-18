---
name: P0 API_BASE Root Cause Fix
description: swimnote.kr = Replit web frontend SPA (NOT api-server). App was sending ALL API calls to wrong server. Fixed to swimnote-api.onrender.com.
---

# API_BASE Root Cause Fix (2026-08-18)

## Rule
API_BASE must always point to `https://swimnote-api.onrender.com/api`.
`swimnote.kr` is the Replit-deployed web FRONTEND (SwimNote 홈페이지 SPA), NOT the api-server.

## Why
- `swimnote.kr` IP = 34.111.179.208 (Google Cloud = Replit deployment of swimnote-web artifact)
- `swimnote-api.onrender.com` IP = 216.24.57.7 (Render.com = actual api-server)
- POST swimnote.kr/api/support/respond → 200 text/html (SPA catch-all)
- POST swimnote-api.onrender.com/api/support/respond → 401 JSON (correct)
- The SPA returns HTTP 200 for ALL routes (catch-all), so `mRes.ok = true` in handleSend
- handleSend never calls `mRes.json()` on success path → HTML body silently ignored
- 0 Supabase writes, no error shown to user, input cleared → "채팅이 아무 반응 없음"

## How to apply
- Any code that calls the api-server MUST use `API_BASE` imported from `SessionContext`
- Hardcoding `swimnote.kr` as an API base is forbidden
- `swimnote.kr` is only valid as a browser `Linking.openURL()` target (website)
- Render.com is the canonical api-server, deployed via GitHub push → auto-build

## Files changed (SHA 35081444)
- context/auth/SessionContext.tsx: API_BASE
- ai/clients/TeacherDiaryAIClient.ts: LEGACY_BASE, GROUNDED_BASE, 2x diagnose URLs
- ai/services/DiaryAIService.ts: SWIMNOTE_API_SERVER_BASE fallback
- ai/features/diary/useDiaryAI.ts: AI_ENGINE_BASE fallback

## OTA
iOS production: 01a01257-89ff-7609-9251-98bd190624f1 (runtime 1.6.3)
