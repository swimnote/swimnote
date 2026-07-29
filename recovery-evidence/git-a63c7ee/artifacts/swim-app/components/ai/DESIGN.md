# SwimNote AI Modal Framework — 설계 문서

> 작성일: 2026-07-27  
> 대상: `artifacts/swim-app/components/ai/`

---

## 1. 설계 원칙

| # | 원칙 | 한 줄 요약 |
|---|---|---|
| P1 | **공통 모달** | 모든 AI 기능이 동일한 모달 Shell을 공유한다 |
| P2 | **단일 입력** | 입력 방식(텍스트/음성/OCR/영상)은 모두 `inputText` 하나를 채운다 |
| P3 | **명시적 AI 실행** | AI 생성은 사용자가 "AI 작성" 버튼을 눌렀을 때만 실행한다 |
| P4 | **공통 결과 화면** | 결과 카드 + "수정하기" + "다시 생성"은 모든 Feature가 공유한다 |
| P5 | **마지막 Action만 분기** | 결과 이후 동작(삽입/저장/보고서 생성)만 Feature별로 다르다 |

---

## 2. 레이어 구조

```
components/ai/
│
├── core/                          ← 변경 금지 레이어 (Feature 코드 없음)
│   ├── AIContracts.ts             · 전체 타입/인터페이스 정의
│   ├── AIStateMachine.ts          · 상태 전환 규칙 (순수 함수)
│   ├── AIContext.tsx              · React Context + Provider
│   └── BaseAIModal.tsx            · 모달 Shell (slot 패턴)
│
├── components/                    ← 공통 UI 컴포넌트 (Feature 무관)
│   ├── AIActionBar.tsx            · 버튼 쌍 렌더링
│   ├── AIInputArea.tsx            · TextInput + 음성 버튼
│   ├── AIResultArea.tsx           · 결과 카드
│   ├── AILoading.tsx              · 로딩 화면
│   ├── AIErrorView.tsx            · 에러 화면
│   ├── AIPermissionView.tsx       · 권한 요청 화면
│   └── AIVoiceWaveform.tsx        · 음성 파형 시각화
│
├── hooks/                         ← 공통 Hook
│   ├── useAIStateMachine.ts       · dispatch 편의 래퍼
│   ├── useAIModal.ts              · 모달 열기/닫기 상태
│   ├── useAIMotion.ts             · 애니메이션 유틸
│   └── useAIReducedMotion.ts      · 접근성 모션 감소
│
├── motion/                        ← 애니메이션 프리셋
│   └── AIMotionPreset.ts
│
├── theme/                         ← 디자인 토큰
│   ├── AITheme.ts
│   └── AIPersonality.ts
│
└── features/                      ← Feature별 격리 영역
    ├── diary/                     ← 현재 구현 (선생님 AI 일지)
    │   ├── DiaryAIButton.tsx      · 진입점 (자기완결형 버튼)
    │   ├── DiaryAIContent.tsx     · 입력/결과 레이아웃
    │   ├── DiaryAIActionBar.tsx   · Diary 전용 ActionBar
    │   └── useDiaryAI.ts         · 비즈니스 로직
    │
    ├── growth/                    ← (미구현) 학부모 성장보고서
    ├── consult/                   ← (미구현) 학부모 AI 상담
    ├── video/                     ← (미구현) AI 영상분석
    ├── photo/                     ← (미구현) AI 사진분석
    └── drill/                     ← (미구현) AI 드릴추천
```

---

## 3. 상태 머신

### 상태 목록

| 상태 | 설명 | 사용 Feature |
|---|---|---|
| `CLOSED` | 모달 닫힘 | 공통 |
| `OPENING` | 진입 애니메이션 | 공통 |
| `PERMISSION` | 권한 요청 화면 | 음성/영상/사진 |
| `INPUT` | 입력 대기 | 공통 |
| `RECORDING` | 음성 녹음 중 | 음성 입력 Feature |
| `UPLOADING` | 미디어 업로드 중 | 영상/사진 Feature |
| `PROCESSING` | AI 생성 중 | 공통 |
| `RESULT` | 결과 표시 | 공통 |
| `EDITING` | 결과 직접 편집 중 | (미구현) |
| `COMPLETE` | 삽입/저장 완료 | 공통 |
| `ERROR` | 오류 | 공통 |

### 전환 다이어그램

```
CLOSED
  │ open()
  ▼
OPENING
  │ grantPermission()         requirePermission()
  ├──────────────────────────────────────────────▶ PERMISSION
  │                                                     │ grantPermission()
  ▼                                                     │
INPUT ◀───────────────────────────────────────────────┘
  │  │
  │  │ startRecording()
  │  ▼
  │ RECORDING
  │  │ stopRecording()   ← INPUT으로 복귀 (STT 결과를 inputText에 채우고 대기)
  │  │                     ⚠️ 자동 AI 실행 없음 (P3 원칙)
  │  ▼
  │ INPUT (inputText 채워진 상태)
  │
  │ submit() — "AI 작성" 버튼 눌렀을 때만
  ▼
PROCESSING
  │ receiveResult()
  ▼
RESULT ──── retry('INPUT') ──▶ INPUT   ("✏️ 수정하기" 버튼)
  │ submit()                           ("🔄 다시 생성" 버튼 → PROCESSING)
  │
  │ [Feature별 Action]                 ("✅ 일지에 삽입" / 저장 / 보고서 등)
  ▼
COMPLETE / CLOSED
```

---

## 4. 공통 화면 구성

### 입력 화면 (INPUT / RECORDING)

```
┌─────────────────────────────┐
│  ▬▬  AI 일지 작성            │  ← BaseAIModal 헤더 (Feature별 title)
├─────────────────────────────┤
│                             │
│  [ TextInput               ]│  ← AIInputArea (공통)
│                             │
│  [🎤 음성]                  │  ← 음성 버튼 (공통, inputText만 채움)
│                             │
├─────────────────────────────┤
│  [    취소    ] [🤖 AI 작성] │  ← ActionBar (공통 버튼 + Feature label)
└─────────────────────────────┘
```

### 결과 화면 (RESULT)

```
┌─────────────────────────────┐
│  ▬▬  AI 일지 작성            │
├─────────────────────────────┤
│  입력요약: "수업 내용..."  ✏️ │  ← InputSummary + "수정하기" (공통)
│                             │
│  ┌───────────────────────┐  │
│  │ AI 결과 텍스트          │  │  ← AIResultArea (공통)
│  │ 오늘은 자유형 발차기... │  │
│  └───────────────────────┘  │
│                             │
├─────────────────────────────┤
│ [🔄 다시 생성] [✅ 일지에 삽입]│  ← 공통 2개 + Feature Action 1개
└─────────────────────────────┘
```

**ActionBar 버튼 규칙:**

| 위치 | 버튼 | 담당 | 대상 상태 |
|---|---|---|---|
| 왼쪽(secondary) | 취소 | 공통 | INPUT |
| 오른쪽(primary) | 🤖 AI 작성 | 공통 | INPUT |
| 왼쪽(secondary) | 🔄 다시 생성 | 공통 | RESULT |
| 오른쪽(primary) | **Feature Action** | Feature별 | RESULT |

---

## 5. Feature 확장 패턴

새 Feature 추가 시 아래 파일만 신규 생성하면 됩니다.

### 필수 파일 (3개)

```
features/<name>/
├── <Name>AIButton.tsx      ← 진입점 버튼 (BaseAIModal 조립)
├── <Name>AIContent.tsx     ← 입력/결과 레이아웃
└── use<Name>AI.ts          ← 비즈니스 로직
```

### 선택 파일 (Feature Action이 복잡할 때)

```
features/<name>/
└── <Name>AIActionBar.tsx   ← Feature 전용 Action 버튼
```

### Feature 구현 체크리스트

```
□ AIContracts.ts의 AIFeatureType에 새 타입 추가
□ <Name>AIButton.tsx에서 BaseAIModal 사용 (featureType, title 지정)
□ use<Name>AI.ts에서 useAIStateMachine 사용
□ 음성 종료 시 자동 AI 호출 없음 (P3)
□ "AI 작성" 버튼만 submit() 호출
□ RESULT 화면의 "✏️ 수정하기" = machine.retry('INPUT')
□ RESULT 화면의 "🔄 다시 생성" = handleSubmit()
□ RESULT 화면의 Feature Action = onXxx() 콜백으로 분리
```

### 코드 템플릿 — `use<Name>AI.ts`

```typescript
export function use<Name>AI(options: { onResult?: (text: string) => void; onClose?: () => void }) {
  const machine = useAIStateMachine();
  const [inputText, setInputText] = useState('');
  const [resultText, setResultText] = useState('');

  // 음성 종료 → inputText만 채움, AI 자동 실행 없음
  const handleVoiceStop = () => {
    machine.retry('INPUT');           // RECORDING → INPUT
    // setInputText(transcript);      // STT 결과 주입 (Phase 3)
  };

  // "AI 작성" 버튼 — 사용자 명시적 액션만
  const handleSubmit = async () => {
    machine.submit();                 // INPUT → PROCESSING
    const result = await callAPI(inputText);
    setResultText(result);
    machine.receiveResult();          // PROCESSING → RESULT
  };

  // Feature Action (마지막 단계만 Feature별)
  const handleAction = () => {
    options.onResult?.(resultText);
    options.onClose?.();
  };

  return { inputText, setInputText, resultText, handleVoiceStop, handleSubmit, handleAction, machine };
}
```

---

## 6. 현재 구조 원칙 충족 분석

### ✅ 충족

| 항목 | 근거 |
|---|---|
| BaseAIModal이 Feature 코드 없음 | `content` / `actionBar` slot 패턴 |
| core/ 레이어가 Feature-agnostic | Contracts, StateMachine, Context 모두 순수 |
| components/ 레이어가 Feature-agnostic | AIInputArea, AIResultArea 등 모두 공통 |
| features/ 레이어가 명확히 격리됨 | diary 전용 파일이 features/diary/ 안에만 존재 |
| AIFeatureType에 확장 타입 선언됨 | `'diary' \| 'video' \| 'photo' \| 'consult' \| 'qa'` |

### ⚠️ 수정 필요

| # | 항목 | 현재 상태 | 올바른 상태 | 우선순위 |
|---|---|---|---|---|
| ① | 음성 종료 시 자동 AI 생성 | `stopRecording()` 후 `generateDiary()` 자동 호출 | `stopRecording()` 후 INPUT 복귀만 | **이번 작업** |
| ② | `STOP_RECORDING` 전환 대상 | `AIStateMachine.ts`에서 항상 PROCESSING | RECORDING → INPUT | **이번 작업** |
| ③ | 버튼 라벨 | "다시 입력", "다시 작성", "일지에 삽입" | "✏️ 수정하기", "🔄 다시 생성", "✅ 일지에 삽입" | **이번 작업** |
| ④ | `AIContentProps` 인터페이스 미사용 | 정의만 있고 Feature가 구현하지 않음 | 다음 Feature 추가 전 계약 확정 | 다음 Feature |
| ⑤ | ActionBar 렌더링 위치 이중화 | BaseAIModal의 `actionBar` 슬롯 + DiaryAIContent 자체 `actionBarWrap` 중복 | 하나로 통일 (현재 동작엔 영향 없음) | 다음 Feature |

---

## 7. 이번 작업 범위

### 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `AIStateMachine.ts` | `STOP_RECORDING` 이벤트: `PROCESSING` → `INPUT` 전환으로 변경 |
| `useDiaryAI.ts` | `handleVoicePress`: 녹음 종료 시 `processVoice()` 제거, INPUT 복귀만 |
| `AIInputArea.tsx` | 음성 버튼 라벨: `"음성 입력"` → `"음성"` |
| `DiaryAIActionBar.tsx` | RESULT: `"다시 작성"` → `"🔄 다시 생성"`, `"일지에 삽입"` → `"✅ 일지에 삽입"` |
| `DiaryAIContent.tsx` | `InputSummary` 버튼: `"다시 입력"` → `"✏️ 수정하기"` |

### 변경하지 않는 것

- 모든 버튼의 `onPress` 핸들러
- BaseAIModal 구조
- AIStateMachine의 다른 전환 규칙
- DiaryAIContent의 레이아웃 구조
- ActionBar 렌더링 위치 (⑤번 이중화 문제는 다음 Feature 추가 시 정리)

---

## 8. 향후 Feature 추가 예시

```
features/
├── diary/      ✅ 완료 — 선생님 AI 일지
├── growth/     · 학부모 성장보고서 (onResult → growth report 생성)
├── consult/    · AI 상담 (onResult → 상담 답변 저장)
├── video/      · AI 영상분석 (UPLOADING 상태 사용, onResult → 분석 저장)
└── photo/      · AI 사진분석 (UPLOADING 상태 사용, onResult → 사진 저장)
```

각 Feature는 `AIContracts.ts`의 `AIFeatureType`에 타입 추가 후,
`features/<name>/` 3개 파일만 작성하면 공통 모달을 그대로 사용할 수 있습니다.
