---
name: WP15.5-B/C Fix 완료 상태
description: analytics 분리, AD_IMPRESSION/CLICK 실측, MAU proxy 제거, ParentAdBanner 개선
---

# WP15.5-B/C FINAL COMPATIBILITY FIX 완료

**SHA:** `72733924`  
**완료일:** 2026-08-13

## 변경 파일

| 파일 | 내용 |
|---|---|
| `artifacts/api-server/src/lib/analytics-logger.ts` | 신규 — analytics_events 전용 helper |
| `artifacts/api-server/src/migrations/pool-db-init.ts` | analytics_events 테이블 + 인덱스 3개 추가 |
| `artifacts/api-server/src/routes/auth.ts` | APP_SESSION event_logs 제거 → analytics_events LOGIN_SESSION_START |
| `artifacts/api-server/src/routes/parent.ts` | GET ad-slot의 AD_IMPRESSION logEvent 제거 + POST /parent/ad-events/impression + POST /parent/ad-events/click |
| `artifacts/api-server/src/routes/super.ts` | MAU proxy 제거 → analytics_events 기반 COLLECTING/AVAILABLE + ad_stats 실제값 |
| `artifacts/api-server/src/routes/__tests__/wp15-5bc-fix.test.ts` | 15 TC (A~O) |
| `artifacts/swim-app/components/parent/ParentAdBanner.tsx` | 실제 렌더 후 impression 1회, AD_CLICK+URL안전성, TEXT/IMAGE/IMAGE_WITH_TEXT 분기, FADE |
| `artifacts/swimnote-web/src/pages/super/AnalyticsDashboard.tsx` | MAU proxy → COLLECTING 상태 표시, session_stats/ad_stats 기반 |
| `artifacts/swimnote-web/src/pages/super/AdCreativeManager.tsx` | 미구현 creative_type/effect → 준비중(disabled) |

## 핵심 수정 내용

**analytics 분리:**
- `analytics_events` 테이블 신규 (pool-db-init 정식 migration)
- `analytics-logger.ts`: loginAnalyticsEvent() 전용 helper
- event_logs: 운영/감사 전용 유지, analytics 사용 금지

**APP_SESSION:**
- event_logs 기록 제거
- analytics_events에 LOGIN_SESSION_START로 기록 (parent-login hook)
- 중복: 로그인 자체가 trigger이므로 rate-limit 수준으로 자연 방지

**AD_IMPRESSION:**
- GET /parent/ad-slot에서 impression 기록 제거
- ParentAdBanner가 실제 렌더 후 POST /parent/ad-events/impression 1회 호출
- impressionFired useRef로 중복 방지

**AD_CLICK:**
- POST /parent/ad-events/click 추가
- destination_url http/https 안전성 체크 (SAFE_URL_RE: /^https?:\/\//i)
- 서버측에서도 동일 체크

**Dashboard:**
- mau_proxy 제거
- session_stats: {status: "COLLECTING"|"AVAILABLE", total_sessions, note}
- ad_stats: {total_creatives, active_creatives} (실제값)
- Impressions/Clicks: 0 (실제 데이터 없음 표시)

**Effect 지원 범위:**
- NONE/FADE: 앱에서 실제 지원 (Animated.Value)
- SLIDE/CAROUSEL: AdCreativeManager에서 선택 불가 (준비중)

## 테스트

- 15 TC (A~O, db mock 방식)
- 전체 406/406 통과

## 배포

- Render: GitHub push → 자동 배포 진행 중 (72733924)
- OTA iOS production: 77fb8cfc (runtime 1.6.2)
- OTA Android production: b33d87ac (runtime 1.6.2)
- preview 채널: eas.json preview.channel=production → production OTA 공유

## 검증 목록 (A~O)

A. mau_proxy 없음 ✅
B. LOGIN_SESSION_START → analytics_events ✅
C. GET ad-slot → impression 기록 안 함 ✅
D. POST impression → AD_IMPRESSION ✅
E. 중복 impression 방어 ✅
F. AD_CLICK 기록 ✅
G. http/https URL open 가능 ✅
H. 위험 URL 차단 ✅
I. TEXT 렌더 ✅
J. IMAGE 렌더 ✅
K. IMAGE_WITH_TEXT 렌더 ✅
L. creative 없음 → null ✅
M. parent role만 접근 가능 ✅
N. CRUD regression 없음 ✅
O. analytics_events schema 필수 컬럼 ✅
