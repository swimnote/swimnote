# Teacher Diary AI 재완성 — 사전 설계 감사 보고서

> **작성일**: 2026-07-29  
> **브랜치**: `deploy-photo-clone`  
> **HEAD**: `a74ca6f0`  
> **상태**: 읽기 전용 감사 (코드 수정 없음)

---

## A. Teacher Diary 전체 흐름

### 현재 작동 흐름 (AI 없음)

```
diary.tsx (앱 메인 화면)
│
├─ [상태] selectedGroup, targetDate, classStudents, commonContent, studentNotes
│         token, user (from useAuth)
│
├─ loadClassStudents(classId) → apiRequest(token, /students?class_group_id=...)
│     → setClassStudents(StudentOption[])
│
├─ handleSave()
│     → apiRequest(token, /diaries, POST)
│     → body: { class_group_id, lesson_date, common_content, student_notes[] }
│
└─ <DiaryWriteView ...props /> (write 모드)
     │
     ├─ 공통 일지: TextInput → commonContent
     ├─ 학생 메모: addNoteStudent → StudentNote[] → studentNotes
     └─ onSave() → handleSave() in diary.tsx
```

### 핵심 파일·함수 매핑

| 단계 | 파일 | 주요 함수/상태 |
|------|------|----------------|
| 화면 진입 | `app/(teacher)/diary.tsx` L35 | `useAuth()` → `{ token, adminUser: user }` |
| 수업 선택 | `diary.tsx` L58 | `selectedGroup: TeacherClassGroup \| null` |
| 날짜 | `diary.tsx` L57 | `targetDate: string` (YYYY-MM-DD) |
| 학생 목록 로드 | `diary.tsx` L291–L320 | `loadClassStudents(classId)` → `classStudents: StudentOption[]` |
| 일지 저장 | `diary.tsx` L428–L575 | `handleSave()` → POST /diaries |
| 작성 UI | `DiaryWriteView.tsx` L18 | prop으로 수신, 렌더만 담당 |
| 학생 타입 | `types.ts` L18 | `StudentOption { id, name, birth_year? }` |
| poolId 출처 | `SessionContext.tsx` L45 | `AdminUser.swimming_pool_id: string \| null` |

**중요**: `diary.tsx` L924에 `token={token || ""}` 전달됨. `user?.id`(teacherId), `user?.swimming_pool_id`(poolId)는 `diary.tsx` L35 `useAuth()`에서 접근 가능.

---

## B. dfeddc1 커밋 AI 25개 파일 전수 판정표

기준 커밋: `dfeddc1` (2026-07-28 17:51) — 삭제 전 마지막 존재

| # | 파일 경로 (`components/ai/` 기준) | 줄 수 | 역할 | 재사용 등급 |
|---|-----------------------------------|-------|------|-------------|
| 1 | `core/AIContracts.ts` | 84 | State/타입 전체 계약 (leaf node) | ✅ 원본 그대로 |
| 2 | `core/AIStateMachine.ts` | 173 | State 전환 reducer + 유효성 | ✅ 원본 그대로 |
| 3 | `core/AIContext.tsx` | 68 | AIProvider + useAIContext | ✅ 원본 그대로 |
| 4 | `core/BaseAIModal.tsx` | 317 | 공통 모달 컨테이너 (애니메이션·swipe dismiss) | ✅ 원본 그대로 |
| 5 | `hooks/useAIStateMachine.ts` | 43 | dispatch 편의 래퍼 | ✅ 원본 그대로 |
| 6 | `hooks/useVoiceRecorder.ts` | 177 | expo-av 녹음 캡슐화 | ✅ 원본 그대로 |
| 7 | `hooks/useAIModal.ts` | 미확인 | 모달 열기/닫기 헬퍼 | 📋 읽기 필요 |
| 8 | `hooks/useAIReducedMotion.ts` | 미확인 | 접근성 reduced motion | 📋 읽기 필요 |
| 9 | `hooks/useAIMotion.ts` | 미확인 | Reanimated 공통 훅 | 📋 읽기 필요 |
| 10 | `motion/AIMotionPreset.ts` | 미확인 | 모달 open/close 애니메이션 함수 | 📋 읽기 필요 |
| 11 | `theme/AITheme.ts` | 135 | 디자인 토큰 (색상·간격·타이포·제스처) | ✅ 원본 그대로 |
| 12 | `theme/AIPersonality.ts` | 미확인 | AI 개성/톤 관련 설정 | 📋 읽기 필요 |
| 13 | `components/AIActionBar.tsx` | 미확인 | 공통 ActionBar 렌더 | 📋 읽기 필요 |
| 14 | `components/AIErrorView.tsx` | 미확인 | 오류 화면 렌더 | 📋 읽기 필요 |
| 15 | `components/AIHeader.tsx` | 미확인 | 헤더 (타이틀·크레딧) | 📋 읽기 필요 |
| 16 | `components/AIInputArea.tsx` | 미확인 | 텍스트 입력 + 음성 버튼 | 📋 읽기 필요 |
| 17 | `components/AILoading.tsx` | 미확인 | PROCESSING/UPLOADING 로딩 화면 | 📋 읽기 필요 |
| 18 | `components/AIPermissionView.tsx` | 미확인 | 마이크 권한 요청 화면 | 📋 읽기 필요 |
| 19 | `components/AIResultArea.tsx` | 미확인 | 결과 텍스트 표시 | 📋 읽기 필요 |
| 20 | `components/AIVoiceWaveform.tsx` | 미확인 | 음성 파형 UI | 📋 읽기 필요 |
| 21 | `features/diary/useDiaryAI.ts` | 967 | Diary AI 핵심 비즈니스 로직 Hook | ✅ 원본 그대로 |
| 22 | `features/diary/DiaryAIButton.tsx` | 127 | "AI 작성" 버튼 + 모달 오픈 진입점 | ✅ 원본 그대로 |
| 23 | `features/diary/DiaryAIContent.tsx` | 254 | AI 모달 내 Content 렌더 | ✅ 원본 그대로 |
| 24 | `features/diary/DiaryAIActionBar.tsx` | 99 | State별 버튼 구성 (Submit/Insert/Close) | ✅ 원본 그대로 |
| 25 | `DESIGN.md` | 미확인 | 설계 문서 | 📋 참고만 |

**등급 요약**: 14개 ✅ 원본 그대로 사용 가능, 11개 📋 구현 전 내용 확인 필요 (미확인)

> `📋 읽기 필요` 파일들은 구현 전 `recovery-evidence/git-dfeddc1/` 에서 읽어 내용을 확인해야 한다.  
> 특히 `AIInputArea`, `AIActionBar`, `AILoading`, `AIResultArea`는 `DiaryAIContent.tsx`가 직접 import하므로 **반드시** 확인 필수.

---

## C. useDiaryAI.ts 967줄 기능 단위 분해

### 공개 인터페이스

```typescript
// 입력 (diary.tsx → DiaryWriteView → DiaryAIButton → DiaryAIContent → useDiaryAI)
interface UseDiaryAIOptions {
  existingContent?: string;   // 기존 일지 내용 (컨텍스트용)
  token?:           string;   // JWT Bearer 토큰
  teacherId?:       string;   // 교사 ID (현재 미사용 — 서버 검증 없음)
  classId?:         string;   // 수업 그룹 ID → context.class_id
  date?:            string;   // 수업 날짜 → context.lesson_date
  students?:        StudentContext[];  // [{ id, name }]
  poolId?:          string;   // swimming_pool_id → context.pool_id
  onInsert?:        (result: DiaryInsertResult) => void;  // 삽입 콜백
  onClose?:         () => void;
  onLockChange?:    (locked: boolean) => void;
}

// 출력 (handleInsert 시 diary.tsx로 전달)
interface DiaryInsertResult {
  commonDiary: string;         // setCommonContent()에 사용
  students:    StudentDiaryNote[];  // [{ studentId, studentName, note }]
}
```

### 기능 단위 분해 (L1~967)

| 단위 | 줄 범위 | 기능 | 상태 |
|------|---------|------|------|
| WP1: Request Contract | L51~76 | `TeacherDiaryAIRequest` 타입 정의 | ✅ 완성 |
| WP2: Response Contract | L78~129 | 응답 타입 (외부 `unknown` + 내부 정규화) | ✅ 완성 |
| 상수 | L171~183 | `TIMEOUT_MS=60000`, `MAX_AUTO_RETRY=1`, `AI_ENGINE_BASE` | ✅ 완성 |
| Request ID 생성 | L185~215 | `createDiaryRequestId()` — crypto.randomUUID 우선 | ✅ 완성 |
| Request 사전 검증 | L217~247 | `validateDiaryRequest()` — 7개 필드 검증 | ✅ 완성 |
| Response 정규화 | L249~405 | `normalizeDiaryResponse()` — 9단계 검증 + 변환 | ✅ 완성 |
| Hook 초기화 | L409~454 | refs, state 선언 (abort, inFlight, retry 카운터) | ✅ 완성 |
| 언마운트 정리 | L456~465 | abort + clearTimeout | ✅ 완성 |
| State 자동 전환 | L467~476 | mount → OPENING → INPUT | ✅ 완성 |
| Lock 알림 | L478~481 | `onLockChange` — PROCESSING/RECORDING/RESULT/EDITING | ✅ 완성 |
| 음성 입력 | L483~508 | `handleVoicePress()` — RECORDING 토글 | ✅ 완성 |
| STT 처리 | L510~600 | `processVoice()` — POST /whisper/transcribe, 60s timeout | ✅ 완성 |
| 텍스트 제출 | L602~634 | `handleSubmit()` — 중복 방지, INPUT→PROCESSING | ✅ 완성 |
| 일지 생성 | L642~921 | `generateDiary()` — POST /diary/generate, retry 1회 | ✅ 완성 |
| 최종 삽입 | L923~950 | `handleInsert()` — onInsert 콜백 호출 후 onClose | ✅ 완성 |
| 반환값 | L952~966 | inputText, resultText, handlers, machine, refs | ✅ 완성 |

### 핵심 설계 결정 (재완성 시 반드시 유지)

1. **AI_ENGINE_BASE** (L183): `EXPO_PUBLIC_AI_ENGINE_URL ?? 'https://swimnote.ai.kr'`  
   → 현재 API 서버(swimnote.kr)와 **다른 도메인**. AI 전용 서버 존재 여부 확인 필수.

2. **Stale 판정** (L806~812): `expectedRequestId !== currentRequestIdRef.current` 비교  
   → 응답 도착 전 새 요청이 발생하면 이전 응답 자동 폐기. 레이스 컨디션 방어.

3. **auto retry** (L887~912): timeout/network 오류 시 800ms 후 1회 자동 재시도.  
   → `autoRetryCountRef`로 중복 방지. 사용자 "다시 시도"는 별도 카운터 초기화.

4. **handleInsert 종료 순서** (L941~944): `onInsert(result)` → `onClose()` 순서  
   → STAGE C 주석: `machine.complete()` 비활성화 상태. 복원 시 활성화 여부 결정 필요.

---

## D. useVoiceRecorder.ts 상세 검수

### 결론: 즉시 사용 가능, 주의사항 1건

**파일**: `hooks/useVoiceRecorder.ts` (177줄)

| 항목 | 내용 | 판정 |
|------|------|------|
| 의존 패키지 | `expo-av`, `expo-file-system/legacy` | ✅ 앱에 기설치 |
| 녹음 포맷 | iOS/Android 모두 `.m4a` (AAC, 44100Hz, 128kbps) | ✅ Whisper API 호환 |
| 최대 녹음 | 120초 (`MAX_RECORDING_MS`) | ⚠️ 자동 중지 미구현 |
| 권한 처리 | `Audio.requestPermissionsAsync()` → 3가지 반환값 | ✅ 완성 |
| 언마운트 정리 | `stopAndUnloadAsync()` + clearInterval/clearTimeout | ✅ 완성 |
| 임시 파일 삭제 | `deleteRecording(uri)` → `FileSystem.deleteAsync` | ✅ 완성 |

**주의사항**: `maxTimerRef` (L128~131) — 120초 도달 시 콘솔 로그만 출력하고 실제 중지를 하지 않음.  
→ `stopRecording()`은 외부(`useDiaryAI.handleVoicePress`)에서 호출해야 하며, 앱 화면에서 120초 경과 시 자동 중지 로직 추가 고려 필요. (현재는 무한 녹음 가능)

**`expo-file-system/legacy` import**: Expo SDK 버전에 따라 경로 변경될 수 있음.  
현재 앱의 다른 파일에서 사용하는 import 경로와 통일 필요.

---

## E. 앱 ↔ 서버 계약 비교 (불일치 전부)

### E-1. AI Engine 호출 대상 서버 — 중대 불일치

| 항목 | 앱 (`useDiaryAI.ts` L183) | 현재 API 서버 (`ai.ts`) |
|------|--------------------------|------------------------|
| 도메인 | `swimnote.ai.kr` (별도 AI 서버) | `swimnote.kr` (Render.com) |
| 환경변수 | `EXPO_PUBLIC_AI_ENGINE_URL` | 없음 |

**불일치 의미**: 앱이 `EXPO_PUBLIC_AI_ENGINE_URL`을 설정하지 않으면 `swimnote.ai.kr`에 직접 호출.  
`swimnote.ai.kr`이 존재하지 않으면 → 네트워크 오류 → auto retry 1회 → ERROR 상태.  
→ **AI 라우트를 어느 서버에서 서비스할지 결정 후** `EXPO_PUBLIC_AI_ENGINE_URL` 설정 필수.

**옵션 A**: 현재 `swimnote.kr`(Render.com) 서버에서 서비스 → `EXPO_PUBLIC_AI_ENGINE_URL=https://swimnote.kr`  
**옵션 B**: 별도 `swimnote.ai.kr` 서버 구축 → 별도 작업 필요

---

### E-2. POST /ai/whisper/transcribe 계약 비교

| 항목 | 앱 전송 | 서버 수신 | 판정 |
|------|---------|---------|------|
| Content-Type | multipart/form-data (fetch 자동) | multer `upload.single('audio')` | ✅ |
| 파일 필드명 | `audio` | `req.file` (field: `audio`) | ✅ |
| 파일 포맷 | `audio/m4a` | allowedMime: `['audio/m4a', ...]` | ✅ |
| 파일 크기 제한 | 없음 | 25MB (multer limits) | ✅ |
| Authorization | `Bearer ${token}` | `requireAuth` 미들웨어 | ✅ |
| 응답: request_id | `{ request_id, transcript }` 기대 | `internalId` 반환 (앱 전송 request_id 아님) | ⚠️ |

**E-2 불일치**: 앱은 `WhisperTranscribeResponse.request_id`를 수신하지만 로그 목적으로만 사용. 서버는 `internalId`를 반환. 기능상 문제 없으나 로그 추적 연결 불가.

---

### E-3. POST /ai/diary/generate 계약 비교

**요청 (앱 → 서버)**:

| 필드 | 앱 전송 | 서버 검증 | 판정 |
|------|---------|---------|------|
| `request_id` | `diary_${uuid}` | `isValidExternalRequestId()` | ✅ |
| `schema_version` | `'1.0'` | `=== '1.0'` | ✅ |
| `feature` | `'teacher_diary'` | `=== 'teacher_diary'` | ✅ |
| `input.text` | `inputText.trim()` | `!normalizedInputText` 체크 | ✅ |
| `context.pool_id` | `options.poolId ?? ''` | 필수, trim 검증 | ⚠️ |
| `context.class_id` | `options.classId ?? ''` | 필수 | ✅ |
| `context.lesson_date` | `options.date ?? ''` | 필수 | ✅ |
| `context.student_refs` | `students.map(s => s.id)` | 서버 §9: refs ↔ students 순서 일치 검증 | ✅ |
| `context.students` | `[{ ref: s.id, name: s.name }]` | `typeof s.ref === 'string'`, `typeof s.name === 'string'` | ✅ |

**E-3 불일치 — poolId 공급 경로 미확인**:  
`DiaryAIButton.props.poolId` → `DiaryAIContent.props.poolId` → `useDiaryAI.options.poolId`  
이 값은 `diary.tsx`에서 `user?.swimming_pool_id`로 공급해야 한다.  
현재 `DiaryWriteView`는 `poolId` prop을 받지 않으므로 연결 코드가 없다.

**응답 (서버 → 앱)**:

| 필드 | 서버 반환 | 앱 기대 | 판정 |
|------|---------|---------|------|
| `request_id` | `externalRequestId` (echo) | 응답에 있으면 `expectedRequestId`와 비교 | ✅ |
| `schema_version` | `'1.0'` | 미검증 (단순 수신) | ✅ |
| `result.common` | `string` | `typeof rawCommon !== 'string'` 검증 | ✅ |
| `result.students[].student_ref` | GPT 반환값 (서버가 검증 후 전달) | 앱: `student_ref ?? student_id` 폴백 | ✅ |
| `result.students[].content` | `string` | 앱: `content ?? feedback` 폴백 | ✅ |
| `usage` | `{ input_tokens, output_tokens, total_tokens }` | optional 수신 | ✅ |

---

### E-4. parser_v1 Tenant 격리 — 조건부 이슈

서버 §7 (L254~280): `effectiveMode === 'parser_v1'`일 때 `req.user?.poolId !== context.pool_id`이면 403.  
→ 현재 `DIARY_PIPELINE_MODE` env var 미설정이면 기본 `legacy` 모드 → 격리 검사 건너뜀.  
→ **legacy 모드에서는 poolId 불일치 허용**. 서비스 초기에는 안전하나 parser_v1 전환 전에 poolId 공급 코드 완성 필수.

---

### E-5. 불일치 요약

| # | 분류 | 내용 | 심각도 |
|---|------|------|--------|
| E-1 | AI 서버 엔드포인트 | `swimnote.ai.kr` vs 현재 API 서버 — 연결 불가 가능성 | 🔴 Critical |
| E-2 | Whisper request_id | 서버가 internalId 반환 / 앱은 로그용만 사용 | 🟡 Minor |
| E-3 | poolId 공급 코드 | diary.tsx → DiaryWriteView → DiaryAIButton 연결 없음 | 🔴 Critical |
| E-4 | Tenant 격리 | parser_v1 모드 미전환 시 poolId 불일치 허용됨 | 🟡 향후 이슈 |

---

## F. diary.tsx AI 연결 설계

### 필요한 변경 목록

#### F-1. diary.tsx에 추가할 코드

```typescript
// 1. import 추가 (파일 상단)
import type { DiaryInsertResult } from '@/components/ai/features/diary/useDiaryAI';

// 2. handleAIInsert 함수 추가 (handleSave 함수 근처)
const handleAIInsert = useCallback((result: DiaryInsertResult) => {
  // 공통 일지 교체
  setCommonContent(result.commonDiary);

  // 학생별 일지: 기존 studentNotes에 AI 결과 병합
  // StudentNote: { student_id, student_name, note_content }
  setStudentNotes(prev => {
    const next = [...prev];
    for (const s of result.students) {
      const idx = next.findIndex(n => n.student_id === s.studentId);
      if (idx >= 0) {
        // 기존 메모 교체
        next[idx] = { ...next[idx], note_content: s.note };
      } else {
        // 새 메모 추가
        next.push({ student_id: s.studentId, student_name: s.studentName, note_content: s.note });
      }
    }
    return next;
  });
}, [setCommonContent]);
```

> **주의**: `studentNotes`의 setter가 `diary.tsx` 내부 상태인지 확인 필요.  
> `diary.tsx` L63: `const [classStudents, setClassStudents] = useState<StudentOption[]>([])` — 학생 목록  
> StudentNote 상태 setter는 DiaryWriteView 내부에 있을 수 있음 → prop drilling 또는 상태 끌어올리기 필요.

#### F-2. DiaryWriteView props에 추가

```typescript
// DiaryWriteView.tsx 인터페이스에 추가
onAIInsert?: (result: DiaryInsertResult) => void;
```

#### F-3. DiaryWriteView 렌더에 DiaryAIButton 추가

```typescript
// DiaryWriteView.tsx L92~100 근처 "반 공통 일지" 카드 헤더에 추가
import DiaryAIButton from '@/components/ai/features/diary/DiaryAIButton';

// 카드 헤더 우측에 배치
<View style={s.cardHeader}>
  <View style={s.cardIcon} ... />
  <Text style={s.cardTitle}>반 공통 일지</Text>
  <Text style={s.cardSub}>...</Text>
  
  {/* AI 작성 버튼 — 헤더 우측 */}
  <DiaryAIButton
    token={token}
    teacherId={teacherId}       // ← props 추가 필요
    classId={group.id}
    date={targetDate}
    students={classStudents}    // StudentOption[] → StudentContext[] 타입 호환 ✅ (id, name 동일)
    poolId={poolId}             // ← props 추가 필요
    themeColor={themeColor}     // ← props 추가 필요
    existingContent={commonContent}
    onInsert={onAIInsert}       // ← prop 추가 필요
  />
</View>
```

#### F-4. diary.tsx DiaryWriteView 호출 시 props 추가

```typescript
<DiaryWriteView
  // 기존 props ...
  teacherId={user?.id ?? ''}
  poolId={user?.swimming_pool_id ?? ''}
  themeColor={themeColor}           // 이미 useBrand()에서 가져옴 L36
  onAIInsert={handleAIInsert}
/>
```

#### F-5. StudentContext 타입 호환 확인

```
StudentOption  { id: string; name: string; birth_year?: string | null }  (types.ts L18)
StudentContext { id: string; name: string }                               (useDiaryAI.ts L45)
```
→ `StudentOption`은 `StudentContext`의 superset. 타입 캐스팅 없이 직접 전달 가능 (`as StudentContext[]`).

---

## G. 최종 권장 파일 구조

### 복원 위치

```
artifacts/swim-app/
└── components/
    └── ai/                          ← git rm으로 삭제된 디렉토리 전체 복원
        ├── DESIGN.md
        ├── components/
        │   ├── AIActionBar.tsx
        │   ├── AIErrorView.tsx
        │   ├── AIHeader.tsx
        │   ├── AIInputArea.tsx
        │   ├── AILoading.tsx
        │   ├── AIPermissionView.tsx
        │   ├── AIResultArea.tsx
        │   └── AIVoiceWaveform.tsx
        ├── core/
        │   ├── AIContracts.ts
        │   ├── AIContext.tsx
        │   ├── AIStateMachine.ts
        │   └── BaseAIModal.tsx
        ├── features/
        │   └── diary/
        │       ├── DiaryAIActionBar.tsx
        │       ├── DiaryAIButton.tsx
        │       ├── DiaryAIContent.tsx
        │       └── useDiaryAI.ts
        ├── hooks/
        │   ├── useAIModal.ts
        │   ├── useAIMotion.ts
        │   ├── useAIReducedMotion.ts
        │   ├── useAIStateMachine.ts
        │   └── useVoiceRecorder.ts
        ├── motion/
        │   └── AIMotionPreset.ts
        └── theme/
            ├── AIPersonality.ts
            └── AITheme.ts
```

### 수정이 필요한 파일 (복원 후)

| 파일 | 수정 내용 |
|------|-----------|
| `components/ai/features/diary/useDiaryAI.ts` | `EXPO_PUBLIC_AI_ENGINE_URL` 값 확인 (swimnote.kr로 설정 필요) |
| `artifacts/swim-app/app/(teacher)/diary.tsx` | `handleAIInsert` 추가 + DiaryWriteView props 추가 |
| `components/teacher/diary/DiaryWriteView.tsx` | `DiaryAIButton` import + 렌더 + props 추가 |

### 신규 생성이 필요한 파일

없음. 기존 파일 복원 + 연결만으로 완성 가능.

---

## H. 구현 순서 (의존성 기준)

```
단계 1 (블로커 없음, 즉시 가능)
  ├─ [H1] AI 파일 25개 복원
  │      recovery-evidence/git-dfeddc1/components/ai/ → artifacts/swim-app/components/ai/
  │      주의: 파일 복사 전 recovery-evidence/git-dfeddc1/components/ai/components/ 등
  │           미확인 11개 파일 내용 검토 필요
  │
  └─ [H2] EXPO_PUBLIC_AI_ENGINE_URL 결정
         옵션 A: swimnote.kr에서 ai.ts 서비스 → URL 설정 + Render.com 재배포
         옵션 B: 별도 서버 구축 → 범위 외

단계 2 (H1 완료 후)
  └─ [H3] TypeScript 컴파일 검증
         pnpm --filter @workspace/swim-app tsc --noEmit
         오류: 누락된 dependencies, 변경된 API 등 확인

단계 3 (H1, H2 완료 후)
  └─ [H4] diary.tsx 연결
         - handleAIInsert 함수 추가
         - DiaryWriteView 호출 시 teacherId, poolId, themeColor, onAIInsert props 추가

단계 4 (H4 완료 후)
  └─ [H5] DiaryWriteView 연결
         - DiaryAIButton import
         - 카드 헤더에 DiaryAIButton 배치
         - props 인터페이스 확장

단계 5 (H3, H4, H5 완료 후)
  └─ [H6] 최종 TypeScript + 빌드 검증
         pnpm --filter @workspace/swim-app tsc --noEmit
         (Expo Go 실기기 테스트는 OTA 배포 후)

단계 6 (H6 완료 후, 별도 승인 필요)
  └─ [H7] OTA 배포 (production + preview 채널)
         eas update --channel production (115s 번들 단계 필요 — OTA 배포 패턴 참조)
```

**병렬 가능**: H1과 H2는 독립적. 동시 진행 가능.  
**순차 필수**: H3은 H1 완료 후. H4~H5는 H2 완료 후. H6는 H3~H5 모두 완료 후.

---

## I. 증거 (파일 경로 · 행 번호 · Git 명령)

### I-1. AI 25개 파일 삭제 증거

```bash
# 삭제 커밋 확인
git log --oneline --all -- "artifacts/swim-app/components/ai/core/AIContracts.ts"
# 출력: dfeddc1 ... (마지막 존재) → 376fa37 (삭제)

# 376fa37 커밋 내용 (삭제 커밋)
git show --stat 376fa37 | grep "delete mode"
# 25개 "delete mode 100644 artifacts/swim-app/components/ai/..." 출력

# 최종 존재 커밋
git show dfeddc1:artifacts/swim-app/components/ai/core/AIContracts.ts | head -5
```

### I-2. diary.tsx에 AI import 없음 증거

```bash
# diary.tsx에 AI 관련 import 없음
grep -n "DiaryAI\|useDiaryAI\|components/ai" artifacts/swim-app/app/\(teacher\)/diary.tsx
# 출력: (없음)
```

### I-3. AI Engine 대상 서버 (useDiaryAI.ts L183)

```
파일: recovery-evidence/git-dfeddc1/artifacts/swim-app/components/ai/features/diary/useDiaryAI.ts
행:  L183
내용: const AI_ENGINE_BASE = process.env.EXPO_PUBLIC_AI_ENGINE_URL ?? 'https://swimnote.ai.kr';
```

### I-4. poolId 출처 (AdminUser.swimming_pool_id)

```
파일: artifacts/swim-app/context/auth/SessionContext.tsx
행:  L45  swimming_pool_id?: string | null;  (AdminUser 인터페이스)
행:  L57  swimming_pool_id: string;          (Pool 인터페이스)
```

### I-5. StudentOption 타입 (diary.tsx의 classStudents 타입)

```
파일: artifacts/swim-app/components/teacher/diary/types.ts
행:  L18  export interface StudentOption  { id: string; name: string; birth_year?: string | null; }
```

### I-6. StudentContext 타입 (useDiaryAI.ts의 students 타입)

```
파일: recovery-evidence/git-dfeddc1/.../features/diary/useDiaryAI.ts
행:  L44~48  export interface StudentContext { id: string; name: string; }
```

→ `StudentOption`은 `StudentContext` superset → `classStudents as StudentContext[]` 타입 캐스팅 가능.

### I-7. 서버 API 라우트 등록 확인

```bash
# ai.ts 라우트
grep -n "router.post" artifacts/api-server/src/routes/ai.ts
# L134: router.post('/ai/whisper/transcribe', ...)
# L135: router.post('/ai/transcribe', ...)          ← 하위 호환 경로
# L138: router.post('/ai/diary/generate', ...)

# app.ts에서 마운트 경로 확인
grep -n "ai\|router" artifacts/api-server/src/app.ts | head -20
```

### I-8. 복원 대상 파일 전체 목록 Git 명령

```bash
# dfeddc1 커밋에서 AI 파일 목록 확인
git ls-tree -r dfeddc1 --name-only | grep "components/ai/"

# 단일 파일 복원 예시 (실행 전 승인 필요)
git show dfeddc1:artifacts/swim-app/components/ai/components/AIActionBar.tsx \
  > artifacts/swim-app/components/ai/components/AIActionBar.tsx
```

---

## 결론 및 다음 단계 권고

### 즉시 결정이 필요한 사항

1. **AI Engine 서버 위치**: `swimnote.kr`에서 서비스할지 별도 `swimnote.ai.kr` 서버를 구축할지  
2. **studentNotes 상태 관리**: `diary.tsx`에서 끌어올릴지 DiaryWriteView 내부 상태를 유지할지

### 미완성 확인 항목 (구현 전 필수)

- `components/ai/components/` 내 8개 파일 (AIInputArea, AIActionBar 등) 내용 검토
- `components/ai/hooks/useAIModal.ts` — 모달 제어 방식 확인
- `components/ai/motion/AIMotionPreset.ts` — BaseAIModal이 직접 import

### 구현 금지 사항 (현재 감사 단계)

- recovery-evidence 파일을 앱으로 직접 복사
- diary.tsx, DiaryWriteView.tsx 수정
- 서버 코드 수정
- OTA 배포

> 이 문서는 **읽기 전용 감사** 결과입니다. 구현은 위 H 단계 순서대로, 별도 승인을 받아 진행합니다.
