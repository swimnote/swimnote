# SWIMNOTE Ad Analytics Foundation
**WP15.5-A — Source of Truth Document**
**Status:** FOUNDATION_READY | Implementation: DEFERRED
**Last updated:** 2026-08-13
**Functional SHA:** d196d9fa

---

## 0. 목적

광고주가 진입했을 때 대규모 구조변경 없이
활성 사용자 / 예상 도달 / 노출 / Unique Reach / Frequency / Click / CTR / 지역·연령 성과를
붙일 수 있도록 **데이터 계약과 확장 위치만** 고정한다.

지금 광고 플랫폼을 구현하지 않는다.  
가짜 analytics 테이블/이벤트/숫자 생성 금지.

---

## 1. Capability Matrix

### A. AVAILABLE_NOW — 현재 DB에서 정확히 계산 가능

| 지표 | Source | 비고 |
|---|---|---|
| 전체 수영장 수 | `swimming_pools` COUNT | |
| 활성 수영장 | `swimming_pools` WHERE `approval_status = 'approved'` AND `subscription_status NOT IN ('expired','suspended','cancelled')` | |
| X 모드 수영장 | `swimming_pools` JOIN x-mode entitlement | WP2 구현 완료 |
| BASIC 수영장 | `subscription_tier` 또는 X mode가 아닌 approved 수영장 | |
| 전체 학생 수 | `students` COUNT | |
| 재학 중인 학생 | `student_class_history` WHERE `left_at IS NULL` | 날짜 시스템 WP에서 통합됨 |
| 전체 parent 계정 수 | `parent_accounts` COUNT | |
| 수영장별 학생 수 | `students.swimming_pool_id` GROUP BY | |
| AI 사용 건수 | `ai_traces` COUNT | WP10 구현 완료 |
| Growth event 검토 현황 | `growth_events` aggregation | WP15 구현 완료 |
| 수영장 등록일 분포 | `swimming_pools.created_at` | |
| 지역별 수영장 분포 | `swimming_pools.address` 부분 파싱 | ⚠️ NEEDS_NORMALIZATION 참고 |

### B. NEEDS_EVENT_TRACKING — instrumentation이 있어야 정확히 계산 가능

> **중요:** 등록 계정 수를 활성 사용자로 부르지 말 것.  
> 현재 `users.last_login_at` / `parent_accounts.last_active_at` 없음.  
> 앱 접속/세션 tracking 없음.

| 지표 | 필요한 이벤트 | 연결 위치 후보 |
|---|---|---|
| DAU (teacher/pool_admin) | `APP_SESSION` | auth `/login` 성공 시 |
| WAU / MAU | `APP_SESSION` | 위와 동일 |
| parent DAU/WAU/MAU | `APP_SESSION` (parent role) | parent-login 성공 시 |
| **활성 parent** | `APP_SESSION` 최소 정의 필요 | parent-login 성공 시 |
| 평균 접속 횟수 | `APP_SESSION` COUNT per user | |
| 재방문율 | `APP_SESSION` 중복 user 비율 | |
| notification open | `NOTIFICATION_OPEN` | 앱 알림 handler |
| feed view | `FEED_VIEW` | 앱 피드 화면 진입 |
| photo view | `PHOTO_VIEW` | 앱 사진 화면 진입 |
| video view | `VIDEO_VIEW` | 앱 영상 화면 진입 |
| notice view | `NOTICE_VIEW` | 앱 공지 화면 진입 |
| report view | `REPORT_VIEW` | 앱 리포트 화면 진입 |
| AI search / use | `AI_SEARCH` | ai-diary route (ai_traces 활용 가능) |
| SNS share | `SNS_SHARE` | 앱 공유 handler |
| Instagram Story share | `INSTAGRAM_STORY_SHARE` | 앱 공유 handler |
| 지역별 학생/parent 분포 | 주소 정규화 또는 별도 region field | NEEDS_NORMALIZATION |

### C. DEFERRED_AD_SYSTEM — 실제 광고 캠페인 시스템이 생겨야 계산 가능

| 지표 | 의존 시스템 |
|---|---|
| Impressions | `ad_impressions` 테이블 + 앱 노출 이벤트 |
| Unique Reach | `ad_impressions` + unique `user_id` 집계 |
| Frequency | Unique Reach 계산 선행 필요 |
| Clicks | `ad_clicks` 테이블 + 앱 클릭 이벤트 |
| CTR | Clicks + Impressions 선행 필요 |
| External Opens | `AD_EXTERNAL_OPEN` 이벤트 |
| Promotion Action | `AD_PROMOTION_ACTION` 이벤트 |
| Conversion | 정의된 conversion event 선행 필요 |

---

## 2. 활성 사용자 정의

**현재 확인된 activity source:**

| Source | 존재 여부 | 비고 |
|---|---|---|
| `users.last_login_at` | ❌ 없음 | 컬럼 없음 |
| `parent_accounts.last_active_at` | ❌ 없음 | 컬럼 없음 |
| `event_logs` 로그인 category | ✅ 있음 | 운영 감사 전용, analytics 부적합 |
| 앱 세션/token refresh tracking | ❌ 없음 | |

**결론:** 현재 "활성 parent"를 정확히 정의할 source 없음.  
향후 정의: 지정 기간 내 `APP_SESSION` 이벤트가 1회 이상 있는 parent.

---

## 3. Analytics Event Namespace (Contract)

이벤트 이름을 여러 방식으로 중복 생성하지 말 것.

### 3A. 활동 이벤트

| 이벤트 이름 | 발생 시점 |
|---|---|
| `APP_SESSION` | 앱 로그인 성공 또는 foreground 복귀 |
| `FEED_VIEW` | 피드 화면 진입 |
| `PHOTO_VIEW` | 사진 화면 진입 |
| `VIDEO_VIEW` | 영상 재생 시작 |
| `NOTICE_VIEW` | 공지 상세 진입 |
| `REPORT_VIEW` | 리포트/성장 화면 진입 |
| `AI_SEARCH` | AI 일지 생성 요청 |
| `SNS_SHARE` | SNS 공유 action |
| `INSTAGRAM_STORY_SHARE` | Instagram Story 공유 action |
| `NOTIFICATION_OPEN` | 푸시 알림 탭하여 진입 |

### 3B. 광고 이벤트 (향후)

| 이벤트 이름 | 발생 시점 |
|---|---|
| `AD_IMPRESSION` | 광고 creative 노출 완료 |
| `AD_CLICK` | 광고 클릭 action |
| `AD_DETAIL_VIEW` | 광고 상세 진입 |
| `AD_EXTERNAL_OPEN` | destination URL 실제 open |
| `AD_PROMOTION_ACTION` | 프로모션 action (향후 정의) |
| `AD_CONVERSION` | 정의된 conversion 발생 |

---

## 4. Event Common Contract

```typescript
interface AnalyticsEvent {
  // 필수
  event_type:        string;       // 3A/3B namespace에서
  occurred_at:       string;       // ISO timestamptz

  // 가능하면
  user_id?:          string;
  swimming_pool_id?: string;
  role?:             "teacher" | "pool_admin" | "parent" | "system";

  // optional
  content_type?:     string;       // "diary" | "photo" | "video" | "notice" | "report"
  content_id?:       string;
  region_code?:      string;       // 향후 정규화 시
  child_age_band?:   AgeBand;      // 4절 참고
  campaign_id?:      string;       // 광고 캠페인 ID
  creative_id?:      string;       // 광고 소재 ID
  placement?:        AdPlacement;  // 5절 참고
  metadata?:         Record<string, unknown>; // ⚠️ PII 금지
}
```

**metadata PII 금지:**
- parent_name, student_name, phone, diary_text, AI prompt 전체, AI response 전체

---

## 5. Unique Parent Counting Rule

한 parent가 여러 child를 가질 수 있음 (`parent_students` N:M 관계).

**규칙:** 임의 targeting 조건을 만족하는 child가 여러 명이어도 parent는 1로 계산.

```sql
-- 예: "초등 저학년 자녀를 가진 활성 parent" 도달
SELECT COUNT(DISTINCT ps.parent_id)
FROM parent_students ps
JOIN students s ON s.id = ps.student_id
WHERE s.birth_year BETWEEN 2018 AND 2022  -- elementary_lower 예시
  AND ps.status = 'active'
-- AND [parent_id IN (활성 parent 목록)]
```

중복 COUNT 금지. `COUNT(DISTINCT parent_id)` 필수.

---

## 6. Age Band Contract

**Source:** `students.birth_year` (연도 단위, 실제 DB에 존재 ✅)  
**주의:** `birth_date` 전체는 일부 테이블에만 있음. `birth_year` 기준 사용.

| Band | birth_year 범위 (2026년 기준) | 비고 |
|---|---|---|
| `preschool` | 2022 이상 (≤ 만 4세) | |
| `elementary_lower` | 2018–2021 (만 5–8세) | 초등 저학년 |
| `elementary_upper` | 2014–2017 (만 9–12세) | 초등 고학년 |
| `middle_school_plus` | 2013 이하 (만 13세+) | |

**Band 재계산:** 매년 `birth_year` 기준 재계산. 하드코딩 금지.

```sql
-- 예: age band 조건
CASE
  WHEN birth_year >= 2022 THEN 'preschool'
  WHEN birth_year >= 2018 THEN 'elementary_lower'
  WHEN birth_year >= 2014 THEN 'elementary_upper'
  ELSE 'middle_school_plus'
END AS age_band
```

생년월일 없는 student는 age targeting 제외 (추정 금지).

---

## 7. Region Source & Contract

**현재 source:** `swimming_pools.address` (자유 텍스트, 예: "서울시 강남구 테헤란로 123")

**Status: NEEDS_NORMALIZATION** — 정확한 province/city/district 파싱 불가.

**향후 targeting 구조 (광고 시작 시 적용):**

```typescript
type RegionSource = "pool_address";  // 개인 주소 아님, 수영장 위치 기준

interface PoolRegion {
  province: string;  // 서울특별시, 경기도, ...
  city:     string;  // 강남구, 수원시, ...
  district?: string; // 상세 동/읍면
}
```

**이번 WP:** address 전체 정규화 migration 금지.  
광고 시작 전에 별도 normalization WP 진행.

---

## 8. KPI Definitions

분모 0이면 항상 0 반환. NaN / Infinity 절대 금지.

| KPI | 공식 | 분모 0 처리 |
|---|---|---|
| Impressions | 광고 creative 노출 완료 횟수 | — |
| Unique Reach | 지정 기간 내 1회 이상 노출 unique user 수 | — |
| Frequency | Impressions / Unique Reach | Unique Reach = 0 → 0 |
| Clicks | 광고 클릭 action 횟수 | — |
| CTR | Clicks / Impressions | Impressions = 0 → 0 |
| External Opens | destination URL 실제 open 횟수 | — |
| Conversion | 정의된 conversion event 발생 횟수 | — |

---

## 9. Ad Placement Contract

WP15.5-C에서 사용할 placement. **이번 WP에서 실제 렌더링 금지.**

| Placement ID | 위치 | 우선순위 |
|---|---|---|
| `PARENT_HOME_BANNER` | 학부모 홈 상단 배너 | **첫 프리미엄 슬롯** |
| `PARENT_FEED_INLINE` | 피드 인라인 (향후) | — |
| `PARENT_REPORT` | 리포트 화면 (향후) | — |
| `PARENT_NOTICE` | 공지 화면 (향후) | — |

**원칙:** 한 화면에 광고 여러 개 도배 금지. 한 placement = 프리미엄 1개 중심 렌더.  
여러 광고 선택 로직(기간/priority/rotation/지역/연령)은 selection engine WP에서.

---

## 10. Creative & Effect Contract

**이번 WP: enum/table 구현 금지. 문서 contract만.**

### Creative Type

| 값 | 설명 |
|---|---|
| `TEXT` | 텍스트 전용 |
| `IMAGE` | 이미지 |
| `IMAGE_WITH_TEXT` | 이미지 + 텍스트 조합 |
| `ANIMATED` | 애니메이션 |
| `SLIDESHOW` | 슬라이드쇼 |
| `SHORT_VIDEO` | 숏 비디오 |

### Effect Type

| 값 | 설명 |
|---|---|
| `NONE` | 효과 없음 |
| `FADE` | 페이드 인/아웃 |
| `SLIDE` | 슬라이드 전환 |
| `CAROUSEL` | 캐러셀 |

---

## 11. Future Ad Data Model (문서 only, DB 생성 금지)

```
Advertiser (1)
  └── Campaign (N)
        └── Creative (N)
              └── Placement (N)
                    └── Impression / Click (N)
```

### advertisers
`id, name, contact_email, status, created_at`

### ad_campaigns
```
id, advertiser_id, name, status,
start_at, end_at,
target_region (jsonb),   -- { province, city }
target_age_band (text[]), -- AgeBand[]
budget_type, budget_amount,
pricing_model,           -- CPM / CPC / 고정
created_at, updated_at
```

### ad_creatives
```
id, campaign_id,
creative_type,  -- CreativeType
headline, body_text,
image_url, destination_url,
effect_type,    -- EffectType
display_order, is_active,
created_at, updated_at
```

### ad_placements
`id, creative_id, placement (AdPlacement), is_active`

### ad_impressions
```
id, creative_id, placement,
user_id, swimming_pool_id,
occurred_at,
age_band, region_code,
metadata (jsonb -- PII 금지)
```

### ad_clicks
```
id, impression_id, creative_id,
user_id, occurred_at
```

### ad_conversions
`id, click_id, conversion_type, occurred_at`

**실제 migration:** 광고 사업 시작 시 별도 WP.

---

## 12. Event Instrumentation 판단

**기존 event_logs:** 운영 감사 전용 (category: 삭제/결제/구독/보안/로그인/AI 등).  
Analytics 목적 이벤트와 분리 필요.

**현재 1~2줄로 붙일 수 있는 후보:**

| 이벤트 | 연결 위치 | 난이도 |
|---|---|---|
| `APP_SESSION` (parent) | `parent-login` 성공 직후 | ★☆☆ (서버 1줄) |
| `APP_SESSION` (teacher) | `/auth/login` 성공 직후 | ★☆☆ (서버 1줄) |
| `AI_SEARCH` | ai-diary generate route (ai_traces 이미 존재) | ★★☆ (중복 방지 필요) |

**앱 여러 화면 수정이 필요한 이벤트:** WP15.5-B/C 또는 후속 광고 WP로 DEFER.

---

## 13. Deferred Implementation List

| 항목 | DEFER 이유 | 담당 WP |
|---|---|---|
| analytics_events 테이블 생성 | 광고 사업 시작 전 불필요 | 광고 WP |
| 앱 화면별 view instrumentation | 앱 여러 화면 수정 필요 | WP15.5-B/C |
| Ad selection engine | campaign/rotation 로직 필요 | 광고 WP |
| Address normalization | migration 필요 | 별도 WP |
| parent last_active_at 컬럼 추가 | 스키마 migration 필요 | WP15.5-B 이후 |
| CTR 실시간 dashboard | impression/click 테이블 선행 | 광고 WP |
| Conversion tracking | conversion 정의 선행 | 광고 WP |

---

## 14. WP15.5-B/C에서 실제로 해야 할 것

**WP15.5-B (SuperAdmin 광고 대시보드):**
1. SuperAdmin에 "광고 개요" 탭
2. AVAILABLE_NOW 지표 표시 (수영장/학생/parent 수, X 수영장 수)
3. `APP_SESSION` 이벤트 서버 hook (parent-login 1~2줄)
4. 단기 MAU 프록시: 지정 기간 내 event_logs 로그인 category COUNT (approximate)

**WP15.5-C (Parent 광고 슬롯):**
1. `PARENT_HOME_BANNER` slot 렌더링 (Creative 없으면 빈 영역 또는 숨김)
2. 광고 Creative 관리 API (super_admin)
3. `AD_IMPRESSION` / `AD_CLICK` 이벤트 최소 구현

---

## 변경 파일

- `docs/AD_ANALYTICS_FOUNDATION.md` (이 문서, 신규)

코드 변경 없음 (문서 only WP).  
Render deploy 금지. OTA 금지.
