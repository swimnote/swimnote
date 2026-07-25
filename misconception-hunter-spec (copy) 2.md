# 오개념 헌터 (Misconception Hunter) — 구현 스펙 문서

> 이 문서는 SWIMNOTE AI 관리자 웹앱에 오개념 헌터 기능을 구현하기 위한 전체 스펙입니다.
> DB는 **Replit DB**를 사용합니다.

---

## 1. 프로젝트 개요

수영 관련 잘못된 정보(오개념/비근거 주장)를 수집·검증·관리하는 관리자 도구입니다.

- **위치**: 기존 앱의 `/ai-admin/` 경로 하위
- **스택**: React + Vite, wouter(라우터), Tailwind CSS v4, Replit DB(백엔드 저장소)
- **언어**: 한국어 UI

---

## 2. 라우팅 구조

```
/ai-admin/                              → 대시보드
/ai-admin/misconception/overview        → 오개념 헌터 개요
/ai-admin/misconception/claim-inbox     → 주장 수집함
/ai-admin/misconception/claim-inbox/:id → 주장 상세
/ai-admin/misconception/verification-workbench → 검증 워크벤치
/ai-admin/misconception/source-intelligence    → 출처 인텔리전스
/ai-admin/misconception/dta-lab                → DTA 검증실
/ai-admin/misconception/hunter-automation      → 자동사냥 설정
/ai-admin/misconception/diagnostic-mapping     → 오류·원인 연결
/ai-admin/misconception/video-analysis-bridge  → 영상분석 연결
/ai-admin/misconception/approved-decisions     → 검증 완료 판정
/ai-admin/misconception/system-blueprint       → 시스템 설계도
```

---

## 3. 사이드바 메뉴 구조

```
대시보드
지식 팩토리     [LIVE]
문서            [LIVE]
지식 DB         [LIVE]
AI 질문 테스트  [LIVE]
오개념 헌터     [NEW]  ← 클릭하면 하위메뉴 펼쳐짐
  ├ 개요
  ├ 주장 수집함
  ├ 검증 워크벤치
  ├ 출처 인텔리전스
  ├ DTA 검증실
  ├ 자동사냥 설정
  ├ 오류·원인 연결
  ├ 영상분석 연결
  ├ 검증 완료 판정
  └ 시스템 설계도
시스템 로그
설정
```

---

## 4. Replit DB 데이터 구조

### 4-1. 오개념 후보 (misconception candidate)

**키 패턴**: `mc:{id}`  
**목록 키**: `mc:list` (id 배열 JSON)

```typescript
interface MisconceptionCandidate {
  id: string;                  // 예: "mc_001"
  core_claim: string;          // 핵심 주장 (필수)
  original_expression?: string; // 원본 표현
  stroke?: string;             // 영법: freestyle | backstroke | breaststroke | butterfly | start | turn | general
  claim_type?: string;         // 유형: misconception | causal_error | overgeneralization | conditional | terminology_only | harmful
  status: string;              // 상태: needs_review | in_progress | approved | rejected | conditional | verified | supported | harmful | terminology_only
  priority?: string;           // 우선순위: high | medium | low
  repeat_count?: number;       // 반복 횟수
  confidence?: number;         // 확신도 0-100
  needs_review?: boolean;      // 검토 필요 여부
  
  // 검증 섹션 A-F
  section_a?: string;          // 출처 정보
  section_b?: string;          // 역학 분석
  section_c?: string;          // 과학적 근거
  section_d?: string;          // 전문가 의견
  section_e?: string;          // 현장 관찰
  section_f?: string;          // 최종 메모
  
  // 판정
  final_verdict?: string;      // 최종 판정
  swimnote_position?: string;  // SWIMNOTE 입장 요약
  
  created_at: string;          // ISO 날짜
  updated_at: string;
}
```

**Replit DB 사용법**:
```typescript
import Database from "@replit/database";
const db = new Database();

// 저장
await db.set(`mc:${id}`, JSON.stringify(candidate));

// 조회
const raw = await db.get(`mc:${id}`);
const candidate = JSON.parse(raw);

// 목록 (prefix 검색)
const keys = await db.list("mc:");
// 단, mc:list 키는 제외하고 실제 데이터 키만 필터링

// 삭제
await db.delete(`mc:${id}`);
```

---

### 4-2. 자동사냥 설정 (hunter settings)

**키**: `hunter:settings`

```typescript
interface HunterSettings {
  search_targets: string[];    // 탐색 대상: web_docs | search_engine | official | research | blog | youtube | community | sns | ebooks | user_question_log
  search_languages: string[];  // 언어: ko | en | ja | zh | es | fr | de | other
  search_strokes: string[];    // 영법 범위: freestyle | backstroke | breaststroke | butterfly | start | turn | underwater | child_swimming | safety 등
  run_schedule: string;        // 실행 주기: manual | daily | weekly | monthly
  collection_criteria: string[]; // 수집 기준
  approval_policy: string;     // 승인 정책: auto_save_only | auto_pending | auto_approve_high
  updated_at: string;
}
```

---

## 5. 시드 데이터 (초기 예시 12건)

```typescript
const seedCandidates = [
  {
    id: "mc_seed_001",
    core_claim: "접영은 큰 웨이브를 만들어야 한다",
    original_expression: "접영할 때 몸을 크게 물결치듯 흔들어야 빠르게 수영할 수 있다",
    stroke: "butterfly",
    claim_type: "misconception",
    status: "needs_review",
    priority: "high",
    repeat_count: 12,
    confidence: 85,
    needs_review: true,
  },
  {
    id: "mc_seed_002",
    core_claim: "자유형은 팔로 물을 세게 밀수록 빨라진다",
    original_expression: "자유형 속도는 팔 힘에 달려 있다",
    stroke: "freestyle",
    claim_type: "causal_error",
    status: "needs_review",
    priority: "high",
    repeat_count: 23,
    confidence: 90,
    needs_review: true,
  },
  {
    id: "mc_seed_003",
    core_claim: "캐치는 물을 움켜쥐는 동작이다",
    original_expression: "캐치 동작은 물을 손으로 꽉 잡는 것",
    stroke: "freestyle",
    claim_type: "conditional",
    status: "in_progress",
    priority: "medium",
    repeat_count: 8,
    confidence: 65,
    needs_review: false,
  },
  {
    id: "mc_seed_004",
    core_claim: "평영킥은 무릎을 최대한 벌려야 한다",
    original_expression: "평영 발차기는 양 무릎을 넓게 벌릴수록 추진력이 커진다",
    stroke: "breaststroke",
    claim_type: "physics_conflict",
    status: "rejected",
    priority: "high",
    repeat_count: 17,
    confidence: 92,
    needs_review: false,
  },
  {
    id: "mc_seed_005",
    core_claim: "배영은 머리를 들면 물이 덜 들어온다",
    original_expression: "배영 시 귀에 물이 들어가면 머리를 더 들어올려야 한다",
    stroke: "backstroke",
    claim_type: "misconception",
    status: "needs_review",
    priority: "medium",
    repeat_count: 5,
    confidence: 78,
    needs_review: true,
  },
  {
    id: "mc_seed_006",
    core_claim: "호흡할 때 머리를 높이 들수록 공기를 많이 마신다",
    original_expression: "숨을 많이 쉬려면 머리를 높이 들어야 한다",
    stroke: "freestyle",
    claim_type: "overgeneralization",
    status: "needs_review",
    priority: "high",
    repeat_count: 19,
    confidence: 88,
    needs_review: true,
  },
  {
    id: "mc_seed_007",
    core_claim: "스트로크 수가 적을수록 무조건 효율적이다",
    original_expression: "25m를 적은 스트로크로 완성할수록 잘하는 것이다",
    stroke: "freestyle",
    claim_type: "overgeneralization",
    status: "in_progress",
    priority: "medium",
    repeat_count: 11,
    confidence: 72,
    needs_review: false,
  },
  {
    id: "mc_seed_008",
    core_claim: "입수킥과 출수킥은 국제 공식 기술용어다",
    original_expression: "접영의 입수킥, 출수킥은 FINA 공식 기술 용어다",
    stroke: "butterfly",
    claim_type: "terminology_only",
    status: "verified",
    priority: "low",
    repeat_count: 4,
    confidence: 95,
    needs_review: false,
  },
  {
    id: "mc_seed_009",
    core_claim: "어린이는 무조건 발차기부터 많이 시켜야 한다",
    original_expression: "수영 입문은 충분하고 완벽한 다른 조건 없이 발차기만 많이 해야한다",
    stroke: "general",
    claim_type: "misconception",
    status: "needs_review",
    priority: "medium",
    repeat_count: 7,
    confidence: 60,
    needs_review: true,
  },
  {
    id: "mc_seed_010",
    core_claim: "선수 자세를 그대로 따라 하면 가장 효과적이다",
    original_expression: "엘리트 선수의 기술을 그대로 흉내 내면 빠르게 발전한다",
    stroke: "general",
    claim_type: "overgeneralization",
    status: "needs_review",
    priority: "high",
    repeat_count: 31,
    confidence: 83,
    needs_review: true,
  },
  {
    id: "mc_seed_011",
    core_claim: "물을 오래 미는 것이 항상 좋다",
    original_expression: "풀 동작은 최대한 길게 미는 것이 효율적이다",
    stroke: "freestyle",
    claim_type: "conditional",
    status: "in_progress",
    priority: "medium",
    repeat_count: 9,
    confidence: 70,
    needs_review: false,
  },
  {
    id: "mc_seed_012",
    core_claim: "평영킥은 무릎을 최대한 벌려야 한다 (중급)",
    original_expression: "중급자용 평영 지도 시 무릎을 넓게 지도",
    stroke: "breaststroke",
    claim_type: "conditional",
    status: "conditional",
    priority: "low",
    repeat_count: 6,
    confidence: 68,
    needs_review: false,
  },
];
```

---

## 6. API 엔드포인트 스펙

모두 `/api/misconception/` 하위로 구성합니다.

### 6-1. 후보 목록 조회
```
GET /api/misconception/candidates
Response: { candidates: MisconceptionCandidate[] }
```

### 6-2. 후보 단건 조회
```
GET /api/misconception/candidates/:id
Response: MisconceptionCandidate
```

### 6-3. 후보 생성
```
POST /api/misconception/candidates
Body: Partial<MisconceptionCandidate>
Response: { success: true, candidate: MisconceptionCandidate }
```

### 6-4. 후보 수정 (상태, 메모 등)
```
PATCH /api/misconception/candidates/:id
Body: Partial<MisconceptionCandidate>
Response: { success: true, candidate: MisconceptionCandidate }
```

### 6-5. 후보 삭제
```
DELETE /api/misconception/candidates/:id
Response: { success: true }
```

### 6-6. 자동사냥 설정 조회
```
GET /api/misconception/hunter-settings
Response: HunterSettings
```

### 6-7. 자동사냥 설정 저장
```
PUT /api/misconception/hunter-settings
Body: HunterSettings
Response: { success: true, settings: HunterSettings }
```

---

## 7. Replit DB 서버 구현 예시 (Express)

```typescript
import Database from "@replit/database";
import { Router } from "express";

const db = new Database();
const router = Router();

// 목록 조회
router.get("/candidates", async (req, res) => {
  const keys = await db.list("mc:");
  const dataKeys = (keys as string[]).filter(k => k !== "mc:list");
  const items = await Promise.all(
    dataKeys.map(async (k) => {
      const raw = await db.get(k);
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    })
  );
  res.json({ candidates: items.filter(Boolean) });
});

// 단건 조회
router.get("/candidates/:id", async (req, res) => {
  const raw = await db.get(`mc:${req.params.id}`);
  if (!raw) return res.status(404).json({ error: "Not found" });
  res.json(typeof raw === "string" ? JSON.parse(raw) : raw);
});

// 생성
router.post("/candidates", async (req, res) => {
  const id = `mc_${Date.now()}`;
  const now = new Date().toISOString();
  const candidate = { id, ...req.body, created_at: now, updated_at: now };
  await db.set(`mc:${id}`, JSON.stringify(candidate));
  res.json({ success: true, candidate });
});

// 수정
router.patch("/candidates/:id", async (req, res) => {
  const raw = await db.get(`mc:${req.params.id}`);
  if (!raw) return res.status(404).json({ error: "Not found" });
  const existing = typeof raw === "string" ? JSON.parse(raw) : raw;
  const updated = { ...existing, ...req.body, updated_at: new Date().toISOString() };
  await db.set(`mc:${req.params.id}`, JSON.stringify(updated));
  res.json({ success: true, candidate: updated });
});

// 삭제
router.delete("/candidates/:id", async (req, res) => {
  await db.delete(`mc:${req.params.id}`);
  res.json({ success: true });
});

// 자동사냥 설정
router.get("/hunter-settings", async (req, res) => {
  const raw = await db.get("hunter:settings");
  if (!raw) return res.json(defaultSettings);
  res.json(typeof raw === "string" ? JSON.parse(raw) : raw);
});

router.put("/hunter-settings", async (req, res) => {
  const settings = { ...req.body, updated_at: new Date().toISOString() };
  await db.set("hunter:settings", JSON.stringify(settings));
  res.json({ success: true, settings });
});

// 시드 데이터 초기화 (서버 시작 시 1회 실행)
export async function seedIfEmpty() {
  const keys = await db.list("mc:");
  if ((keys as string[]).filter(k => !k.includes("list")).length === 0) {
    for (const seed of seedCandidates) {
      const now = new Date().toISOString();
      await db.set(`mc:${seed.id}`, JSON.stringify({
        ...seed,
        created_at: now,
        updated_at: now,
      }));
    }
    console.log("Seeded 12 misconception candidates");
  }
}
```

---

## 8. 페이지별 UI 상세

### 8-1. 대시보드 (`/ai-admin/`)
- 상단 배너: "PROTOTYPE MODE" 배지 + 설명 텍스트
- KPI 카드 4개 (가로 배치):
  - 전체 지식 문서: 247 (Knowledge DB)
  - 오개념 후보: 128 (수집된 주장)
  - 검토 필요: 26 (즉시 검토 필요) — 노란색
  - 검증 완료: 54 (승인된 판정) — 초록색
- 시스템 흐름 다이어그램 (가로 플로우):
  질문입력[LIVE] → 내부DB검색[LIVE] → 확장검색[PROTOTYPE] → 주장추출[PROTOTYPE] → 출처분석[PLANNED] → 과학·DTA검증[PLANNED] → 관리자승인[LIVE] → AI답변반영[PLANNED] → 영상·교정결과학습[LOCKED]
- 빠른 이동 카드 (주장수집함, 검증워크벤치, DTA검증실, 자동사냥설정)
- 시스템 상태 카드

---

### 8-2. 개요 (`/misconception/overview`)
- KPI 8개: 총 후보, 검토 필요, 검증 완료, 반려, 조건부 승인, 높은 확신도, 반복 주장, 자동수집 예정
- 시스템 단계 흐름 (ENGINE 1~6 배지)
- 서브메뉴 그리드 (10개 페이지 카드)

---

### 8-3. 주장 수집함 (`/misconception/claim-inbox`)
- 상단 액션 버튼: `+ 주장 등록`, `질문 추출`, `검색 가져오기`, `CSV`, 새로고침
- 필터 바: 전체 영법 / 전체 유형 / 전체 상태 / 전체 우선순위 / 검토 필요만
- 테이블 컬럼: ID, 핵심 주장, 영법, 유형, 상태, 우선순위, 반복, 확신도, 검토
- 상태 배지 색상:
  - `needs_review` → 빨간색 "검토 필요"
  - `in_progress` → 노란색 "진행중"
  - `verified` → 초록색 "검증 완료"
  - `rejected` → 회색 "반려"
  - `conditional` → 주황색 "조건부"
- API 연동: `GET /api/misconception/candidates`, 실패 시 mock 데이터 사용

---

### 8-4. 주장 상세 (`/misconception/claim-inbox/:id`)
- 헤더: 주장 텍스트 + 상태 배지 + 우선순위 배지
- 섹션 A~F (아코디언 또는 섹션 카드):
  - A. 주장 분류 (영법, 유형, 반복횟수, 확신도)
  - B. 원본 표현 / 수집 출처
  - C. 과학적 분석
  - D. 전문가 의견
  - E. 현장 관찰
  - F. 최종 메모 (textarea, 저장 버튼)
- 상태 변경 드롭다운 + 저장 버튼 → `PATCH /api/misconception/candidates/:id`

---

### 8-5. 검증 워크벤치 (`/misconception/verification-workbench`)
- 3단 레이아웃:
  - 왼쪽: 검증 대상 목록 (상태별 필터된 후보 목록)
  - 가운데: 10단계 스텝 폼
  - 오른쪽: 검증 현황 패널
- 10단계:
  1. 주장 분해 (단일/측정가능/검증가능/범위 체크박스)
  2. 내부 DB 비교
  3. 공식 자료 확인
  4. 연구·전문서적 확인
  5. 출처 독립성 확인
  6. 용어 검증
  7. 물리·생체역학 검증
  8. DTA 검증
  9. 적용 범위 검증
  10. 최종 판정
- 각 단계: 체크박스들 + 노트 textarea + 이전/다음 버튼

---

### 8-6. 출처 인텔리전스 (`/misconception/source-intelligence`)
- KPI 4개: 전체 출처, 공식기관, 연구자료, 신뢰도 50 미만
- 출처 테이블 컬럼: 출처명, 유형, 국가, 권위(A+~F), 연결 주장수, 찬성, 반대, 독립성, 신뢰도(바), 최근 확인
- 상단 버튼: 출처 계보, 반복 감지

---

### 8-7. DTA 검증실 (`/misconception/dta-lab`)
- 주장 선택 드롭다운
- 4개 섹션 테이블 (Direction / Timing / Advance / 기본 물리법칙):
  - 각 행: 항목명, 판정(드롭다운), 근거(입력), 측정(체크박스), 방법(드롭다운), 신뢰도(슬라이더 0-100)
- 저장 버튼 → `PATCH /api/misconception/candidates/:id` (DTA 데이터 포함)

---

### 8-8. 자동사냥 설정 (`/misconception/hunter-automation`)
- 현재 상태 알림 박스 (자동크롤링:비활성, 자동검증:비활성, 관리자승인:활성)
- 6개 설정 섹션 (토글 체크그룹):
  - A. 탐색 대상 (웹문서, 검색엔진, 공식기관, 연구자료, 블로그, 유튜브, 커뮤니티, SNS, 전자책·문서, 사용자질문로그)
  - B. 탐색 언어 (한국어, 영어, 일본어, 중국어, 스페인어, 프랑스어, 독일어, 기타)
  - C. 탐색 범위 영법·기술 (자유형, 배영, 평영, 접영, 스타트, 턴, 수중, 체력훈련, 지도법, 어린이수영, 안전)
  - D. 자동 실행 주기 (수동, 매일, 매주, 매월) — 단일 선택
  - E. 자동 수집 기준 (신규 주장, 반복 확산 주장, SWIMNOTE 충돌 주장, 공식 자료와 충돌, 질문 빈도 상승, 영상 콘텐츠 확산, 지역별 신규 용어)
  - F. 승인 정책 (자동 저장만, 자동 검토 대기, 높은 확신도 자동 승인) — 단일 선택
- 설정 저장 버튼 → `PUT /api/misconception/hunter-settings`

---

### 8-9. 오류·원인 연결 (`/misconception/diagnostic-mapping`)
- 주장 입력 텍스트 + 예시 불러오기 버튼
- 7컬럼 플로우 보드 (가로 스크롤):
  1. 지도 행동 (파란색)
  2. 관찰 오류 (주황색)
  3. 가능한 원인 (노란색)
  4. DTA 손실 (빨간색)
  5. 교정 포인트 (초록색)
  6. SWIMNOTE 진단 (보라색)
  7. 지식DB 연결 (회색)
- 각 컬럼: 항목 태그들 + `+ 추가` 버튼 (클릭 시 입력창)

---

### 8-10. 영상분석 연결 (`/misconception/video-analysis-bridge`)
- 왼쪽: 영상 입력 설정 (드래그앤드롭 업로드 영역 + 영법/촬영방향/레인길이/프레임레이트/수영자키/수영자레벨 설정)
- 오른쪽: 분석 기능 목록 (수면 기준선 설정, 신체 관절 추적, 스트로크 주기 분리, 입수·캐치·폼·푸시 감지, 킥 타이밍 감지, 호흡 시점 감지, DTA 자동 계산[LOCKED], 교정 전후 비교, 오개념 연관 분석 — 전부 PLANNED 배지)
- 하단: 예시 분석 결과 (목업 데이터) 테이블
- 분석 시작 버튼 (비활성, PLANNED 상태)

---

### 8-11. 검증 완료 판정 (`/misconception/approved-decisions`)
- 탭 필터: 전체 / VERIFIED / SUPPORTED / CONDITIONAL / TERMINOLOGY_ONLY / REJECTED / HARMFUL
- 테이블 컬럼: 주장, 최종 판정(배지), SWIMNOTE 입장 요약, 확신도(바), Knowledge DB(미반영/반영), 액션(보기/DB승격/재검토)
- 보고서 생성 버튼

---

### 8-12. 시스템 설계도 (`/misconception/system-blueprint`)
- ENGINE 1~6 카드 그리드 (2열):
  - ENGINE 1: Verified Swimming Knowledge Engine [LIVE]
  - ENGINE 2: Misconception & Diagnostic Intelligence Engine [PROTOTYPE]
  - ENGINE 3: Autonomous Hunter & Crawler [PLANNED]
  - ENGINE 4: DTA Scientific Verification Engine [PLANNED]
  - ENGINE 5: Video Motion Analysis Engine [LOCKED]
  - ENGINE 6: Correction Outcome Learning Engine [LOCKED]
- 전체 순환 흐름 다이어그램 (가로 화살표): 질문 → 주장수집 → 검색 → 검증 → 판정 → 진단규칙 → 영상분석 → 교정 → 결과측정 → 학습 → 재검증
- 편집 가능한 설계 메모 textarea + 저장 버튼

---

## 9. 공통 UI 컴포넌트

```typescript
// 상태 배지
StatusBadge: { status: string } → 색상별 배지
  needs_review → red "검토 필요"
  in_progress  → yellow "진행중"
  approved     → green "승인"
  rejected     → gray "반려"
  conditional  → orange "조건부"
  verified     → green "검증 완료"
  supported    → blue "지지됨"
  harmful      → red "유해"
  terminology_only → purple "용어만"

// 기능 배지
FeatureBadge: { label: string; variant: "live" | "prototype" | "planned" | "locked" }
  live      → green 배경 "✦ LIVE"
  prototype → purple 배경 "⬡ PROTOTYPE"
  planned   → yellow 배경 "◎ PLANNED"
  locked    → gray 배경 "🔒 LOCKED"

// 영법 한글 변환
STROKE_LABELS = {
  freestyle: "자유형", backstroke: "배영", breaststroke: "평영",
  butterfly: "접영", start: "스타트", turn: "턴", general: "종합"
}

// 유형 한글 변환
TYPE_LABELS = {
  misconception: "오개념", causal_error: "인과 오류",
  overgeneralization: "과일반화", conditional: "조건부",
  terminology_only: "용어 혼용", physics_conflict: "물리법칙 충돌",
  harmful: "유해"
}
```

---

## 10. 구현 우선순위

1. **1단계** (필수): 사이드바 + 라우팅 + 주장수집함 + Replit DB 연동 (CRUD)
2. **2단계** (핵심): 주장상세 + 검증워크벤치 + DTA검증실 + 자동사냥설정 저장
3. **3단계** (보완): 출처인텔리전스 + 오류원인연결 + 검증완료판정 + 시스템설계도
4. **4단계** (향후): 영상분석연결 (현재 UI만, 실제 분석 기능은 PLANNED)

---

## 11. 디자인 가이드

- **색상**: slate 계열 기본, blue 강조, 각 상태별 색상 배지
- **폰트**: 시스템 기본 sans-serif
- **레이아웃**: 좌측 사이드바(240px 고정) + 우측 메인 컨텐츠
- **배경**: 사이드바 `#0f172a`(slate-900), 메인 `#f8fafc`(slate-50)
- **카드**: 흰색 배경, 1px border, rounded-xl, 약간의 그림자
- **상단 배너**: "PROTOTYPE MODE" 경고 배너 (노란색 배경)
