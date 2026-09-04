# SWIMNOTE AI 앱 개발 자산 전수 회수 — 조사 보고서

**조사일**: 2026-07-29  
**기준 HEAD**: `f3b1436` (deploy-photo-clone, origin/main 91 커밋 ahead)  
**조사 범위**: git 전체 이력, reflog, dangling 객체, Expo 실행 설정, 파일시스템  
**코드 변경**: 없음 (읽기 전용 조사 + recovery-evidence/ 추출 + 백업 브랜치 생성만)

---

## 1. 현재 상태 동결 — 원문 출력

### git status --short --branch
```
## deploy-photo-clone...origin/main [ahead 91]
?? attached_assets/Pasted-SWIMNOTE-AI-Expo-Go-AI-UI--1785307978267_1785307978267.txt
```

### git rev-parse HEAD
```
f3b1436eb0cfcdf5abfb1ca69165c0c792422dd2
```

### git branch -a -vv
```
* deploy-photo-clone          f3b1436 [origin/main: ahead 91] Update api-server application logic
  master                      d56cef3 [origin/master] feat: AI Engine E1 Contract
  replit-agent                b800285 Update api-server application logic
  remotes/gitsafe-backup/main ef3b00a Update memory documentation and add production server rules
  remotes/origin/HEAD         -> origin/main
  remotes/origin/main         55a7cf2 chore: bump version to v2.5-2026-07-24 (Photo Clone 배포 추적용)
  remotes/origin/master       d56cef3 feat: AI Engine E1 Contract
  remotes/origin/with-billing ddb3ceb Update database schema and fix user role logic
```

### git remote -v
```
gitsafe-backup  git://gitsafe:5418/backup.git (fetch/push)
origin          https://github.com/swimnote/swimnote.git (fetch/push)
```

### git stash list
```
(없음)
```

### git worktree list
```
/home/runner/workspace  f3b1436 [deploy-photo-clone]
```

### git tag --list
```
backup-before-onboarding
v1.0
```

### 생성한 백업 브랜치
```
backup/pre-ai-recovery-376fa37 → 376fa37
```

---

## 2. 삭제·누락 원인 특정 (가장 중요한 발견)

### ■ 마지막 존재 커밋
- **SHA**: `dfeddc1ddf58e01b5aa578160bdc39dc02cdaf6a`
- **시각**: 2026-07-28 17:51:34 UTC
- **메시지**: "Implement diary AI logic updates and add supporting data asset"
- **작성자**: Replit Agent <agent@replit.com>
- **포함 파일**: components/ai/ 전체 25개

### ■ 최초 누락 커밋
- **SHA**: `376fa3782086e5c74f210d26096bdc9984c435bf`
- **시각**: 2026-07-29 06:07:23 UTC
- **메시지**: "feat: AI diary safety guards — pipeline mode, GPT timeout, MODEL_TIMEOUT 504..."
- **작성자**: SwimNote <swimnote.admin@gmail.com>
- **삭제된 파일 수**: 25개

### ■ 삭제 diff (git diff --name-status dfeddc1..376fa37 -- artifacts/swim-app/components/ai)
```
D  artifacts/swim-app/components/ai/DESIGN.md
D  artifacts/swim-app/components/ai/components/AIActionBar.tsx
D  artifacts/swim-app/components/ai/components/AIErrorView.tsx
D  artifacts/swim-app/components/ai/components/AIHeader.tsx
D  artifacts/swim-app/components/ai/components/AIInputArea.tsx
D  artifacts/swim-app/components/ai/components/AILoading.tsx
D  artifacts/swim-app/components/ai/components/AIPermissionView.tsx
D  artifacts/swim-app/components/ai/components/AIResultArea.tsx
D  artifacts/swim-app/components/ai/components/AIVoiceWaveform.tsx
D  artifacts/swim-app/components/ai/core/AIContext.tsx
D  artifacts/swim-app/components/ai/core/AIContracts.ts
D  artifacts/swim-app/components/ai/core/AIStateMachine.ts
D  artifacts/swim-app/components/ai/core/BaseAIModal.tsx
D  artifacts/swim-app/components/ai/features/diary/DiaryAIActionBar.tsx
D  artifacts/swim-app/components/ai/features/diary/DiaryAIButton.tsx
D  artifacts/swim-app/components/ai/features/diary/DiaryAIContent.tsx
D  artifacts/swim-app/components/ai/features/diary/useDiaryAI.ts
D  artifacts/swim-app/components/ai/hooks/useAIModal.ts
D  artifacts/swim-app/components/ai/hooks/useAIMotion.ts
D  artifacts/swim-app/components/ai/hooks/useAIReducedMotion.ts
D  artifacts/swim-app/components/ai/hooks/useAIStateMachine.ts
D  artifacts/swim-app/components/ai/hooks/useVoiceRecorder.ts
D  artifacts/swim-app/components/ai/motion/AIMotionPreset.ts
D  artifacts/swim-app/components/ai/theme/AIPersonality.ts
D  artifacts/swim-app/components/ai/theme/AITheme.ts
```

### ■ 삭제 메커니즘 분석 (사실/추측 분리)

**사실**:
- `376fa37`의 git log `--diff-filter=D`에 위 25개 파일이 "delete mode 100644"로 기록됨
- `git merge-base dfeddc1 376fa37` = `dfeddc1` → 376fa37은 dfeddc1을 직접 부모로 갖지 않음
- `git rev-list --parents -n 1 f99819f` = `71ac2433 dfeddc1` → f99819f는 merge commit (부모 2개)
- 376fa37의 부모는 f99819f이고, f99819f는 `71ac243`과 `dfeddc1`를 부모로 갖는 merge commit

**추측** (확인 불가):
- 376fa37을 만든 SwimNote 계정(사람 또는 Agent)이 작업 트리에서 components/ai/ 디렉토리를 직접 삭제 후 커밋했을 가능성이 높음
- dfeddc1 이후 별도 브랜치(71ac243 계열)로 작업하면서 merge 시 components/ai/ 파일들이 해당 브랜치에 없었을 가능성

**결론**: 직접 삭제 (delete mode) 또는 merge parent에서 components/ai/ 없는 쪽을 우선 선택한 결과. 브랜치 병합 누락 가능성 있으나 직접 삭제로 표시됨.

---

## 3. Git 전체 이력 조사

### components/ai/ 존재 이력 요약

| 커밋 | 날짜/시간 (UTC) | 상태 | 비고 |
|------|----------------|------|------|
| `376fa37` | 2026-07-29 06:07 | **DELETE 25개** | ← 현재 HEAD의 이전 커밋 |
| `dfeddc1` | 2026-07-28 17:51 | M useDiaryAI.ts | 최후 존재 커밋 |
| `a3843cc` | 2026-07-28 17:08 | merge | |
| `b244c1f` | 2026-07-28 17:08 | M useDiaryAI.ts | |
| `ac721cb` | 2026-07-28 16:53 | merge | |
| `7fce518` | 2026-07-28 16:53 | M useDiaryAI.ts | |
| `58e5d19` | 2026-07-28 16:28 | merge | |
| `790dafa` | 2026-07-28 16:28 | M useDiaryAI.ts | |
| `62b2aae` | 2026-07-28 16:19 | merge | |
| `32424f6` | 2026-07-28 16:18 | M useDiaryAI.ts | |
| `e6a4336` | 2026-07-28 10:36 | merge | |
| `e2f9cfe` | 2026-07-28 10:36 | M useDiaryAI.ts | |
| `12598a4` | 2026-07-28 08:46 | merge | |
| `f0993a0` | 2026-07-28 08:46 | M useDiaryAI.ts | |
| `f3b5bf3` | 2026-07-28 05:56 | merge | |
| `f438d85` | 2026-07-28 05:56 | M useDiaryAI.ts | |
| `5f0be03` | 2026-07-28 03:37 | 대규모 리팩터 | useDiaryAI.ts +416/-126 |
| `a63c7ee` | 2026-07-27 20:10 | M useDiaryAI.ts | |
| `6c0ea18` | 2026-07-27 15:22 | merge | useVoiceRecorder.ts 최초 추가 |
| `034756b` | 2026-07-27 15:22 | **A useVoiceRecorder.ts** | 음성인식 최초 추가 |

### 브랜치 포함 여부

| 커밋 | 브랜치 |
|------|--------|
| dfeddc1 | deploy-photo-clone, replit-agent |
| 6c0ea18 | replit-agent |
| a63c7ee | replit-agent |
| 5f0be03 | replit-agent |
| d56cef3 | master, origin/master |

### dangling 객체 AI 연관성
git fsck 결과 dangling commit 10개+ 발견. 내용 확인: AI 관련 파일 없음 (일반 코드 커밋들).

---

## 4. Expo Go 실행본 출처 조사

### 확인된 설정

| 항목 | 값 |
|------|-----|
| Expo project ID | `7d0e0faa-32d8-4f40-88c4-2c99e0613afc` |
| OTA 채널 | `production` |
| OTA URL | `https://u.expo.dev/7d0e0faa-32d8-4f40-88c4-2c99e0613afc` |
| runtimeVersion | `{ policy: "appVersion" }` (현재 1.6.0) |
| eas.json preview channel | `production` |
| EXPO_PUBLIC_AI_ENGINE_URL | eas.json에 **없음** |
| AI_ENGINE_BASE fallback | `https://swimnote.ai.kr` (useDiaryAI.ts 183행) |
| Expo dev server workflow | `artifacts/swim-app: expo` (현재 FAILED 상태) |

### Expo Go 실행본 가장 유력한 출처 (사실 기반)

**유력**: Replit dev server에서 Metro가 `dfeddc1` 이전 커밋의 작업 트리를 번들링하여 QR코드 제공.  
당시 `deploy-photo-clone` 브랜치 체크아웃 상태에서 `pnpm expo start` 실행 → Metro가 components/ai/ 포함 번들을 생성했을 가능성.

**확인 불가 항목**:
- Replit 내부 체크포인트/스냅샷 → **Replit 지원팀 확인 필요**
- 당시 QR 코드 URL/세션 → **Replit 지원팀 확인 필요**
- 기기 Expo Go 앱 캐시 → **기기 직접 확인 필요**

---

## 5. 회수된 후보 코드 목록

| 후보 디렉토리 | 기준 커밋 | 파일 수 | 비고 |
|-------------|----------|---------|------|
| `recovery-evidence/git-dfeddc1/` | dfeddc1 (2026-07-28 17:51) | 25 | **최신·완성본 권장** |
| `recovery-evidence/git-6c0ea18/` | 6c0ea18 (2026-07-27 15:22) | 25 | git tree가 dfeddc1과 동일 |
| `recovery-evidence/git-a63c7ee/` | a63c7ee (2026-07-27 20:10) | 25 | useDiaryAI.ts만 이전 버전 |
| `recovery-evidence/git-5f0be03/` | 5f0be03 (2026-07-28 03:37) | 25 | useDiaryAI.ts만 중간 버전 |

---

## 6. AI 기능 정적 분석 — dfeddc1 기준

| 기능 | 파일·함수 | 존재 여부 | 완성도 | 현재 API 호환 |
|------|----------|----------|--------|--------------|
| AI 버튼 | DiaryAIButton.tsx | ✅ | 구현됨 | 미확인 (wired-in 없음) |
| AI Modal | BaseAIModal.tsx (317줄) | ✅ | 구현됨 | 미확인 |
| 입력 상태 | AIInputArea.tsx, AIStateMachine.ts | ✅ | 구현됨 | - |
| 처리 상태 | AILoading.tsx | ✅ | 구현됨 | - |
| 결과 상태 | AIResultArea.tsx | ✅ | 구현됨 | - |
| 오류 상태 | AIErrorView.tsx | ✅ | 구현됨 | - |
| 음성 권한 요청 | useVoiceRecorder.ts:109 `Audio.requestPermissionsAsync()` | ✅ | 구현됨 | expo-av 필요 |
| 녹음 시작 | useVoiceRecorder.ts:106 `startRecording()` | ✅ | 구현됨 | expo-av |
| 녹음 종료 | useVoiceRecorder.ts:142 `stopRecording()` | ✅ | 구현됨 | expo-av |
| 녹음 취소/삭제 | useVoiceRecorder.ts `deleteRecording()` | ✅ | 구현됨 | expo-av |
| Whisper multipart 업로드 | useDiaryAI.ts:530 FormData + POST /api/ai/whisper/transcribe | ✅ | 구현됨 | ✅ 서버 라우트 존재 |
| STT 텍스트 표시 | useDiaryAI.ts processVoice → inputText 설정 | ✅ | 구현됨 | ✅ |
| /api/ai/diary/generate 호출 | useDiaryAI.ts:660 `generateDiary()` | ✅ | 구현됨 | ✅ 서버 라우트 존재 |
| JWT 첨부 | useDiaryAI.ts:535 `Authorization: Bearer` | ✅ | 구현됨 | ✅ |
| 학생 목록 전달 | useDiaryAI.ts:663 `students.map(s => ({ref:s.id, name:s.name}))` | ✅ | 구현됨 | ✅ E1 Contract 호환 |
| student_ref 결과 매핑 | useDiaryAI.ts:334~380 `normalizeStudents()` | ✅ | 구현됨 | ✅ |
| 기존 일지 필드 적용 | useDiaryAI.ts `handleInsert()` | ✅ | 구현됨 | ⚠️ API 연결 검증 필요 |
| 기존 일지 저장 흐름 유지 | diary.tsx에서 DiaryAIButton import **없음** | ❌ | **미연결** | - |
| 화면 종료 시 recorder cleanup | useVoiceRecorder.ts `deleteRecording` 외부 호출 필요 | ⚠️ | 부분 구현 | - |

### 핵심 미연결 사항
- `artifacts/swim-app/views/diary.tsx`에 `DiaryAIButton`, `useDiaryAI`, `BaseAIModal` import가 **전혀 없음**
- AI 컴포넌트들이 독립적으로 존재하지만 실제 일지 화면에 mount된 적이 없음 (Expo Go에서 동작을 확인했다면 별도 테스트 화면이나 임시 mount 방식이었을 가능성)

---

## 7. 복구 가능 파일 vs 재구현 필요 파일

### 복구 가능 (Git 객체 완전히 보존됨)
모든 25개 파일이 `recovery-evidence/git-dfeddc1/`에 원본 그대로 추출 완료.

| 파일 | 복구 상태 |
|------|----------|
| useDiaryAI.ts (967줄) | ✅ 완전 보존 |
| useVoiceRecorder.ts (177줄) | ✅ 완전 보존 |
| BaseAIModal.tsx (317줄) | ✅ 완전 보존 |
| AIStateMachine.ts (173줄) | ✅ 완전 보존 |
| AIContracts.ts | ✅ 완전 보존 |
| DiaryAIButton.tsx | ✅ 완전 보존 |
| DiaryAIContent.tsx | ✅ 완전 보존 |
| + 나머지 18개 파일 | ✅ 완전 보존 |

### 재구현 필요 (처음부터 없었거나 코드 연결 미완)
| 항목 | 이유 |
|------|------|
| diary.tsx ↔ DiaryAIButton 연결 | 이전 세션에서 구현된 적 없음 |
| EXPO_PUBLIC_AI_ENGINE_URL 환경변수 | eas.json에 없음, 추가 필요 |
| Knowledge Engine (embedding/vector) | 처음부터 미구현 |
| diary.tsx 저장 흐름 ↔ handleInsert 연결 | 미확인 |

---

## 8. 조사하지 못한 Replit 내부 자산

| 자산 종류 | 상태 |
|----------|------|
| Replit 체크포인트/스냅샷 | **Replit 지원팀 확인 필요** — https://replit.com/support |
| rollback snapshot 목록 | **Replit 지원팀 확인 필요** |
| 이전 development deployment 기록 | **Replit 지원팀 확인 필요** |
| Expo Go 앱 캐시 (기기 내) | **기기 직접 확인 필요** |
| 당시 QR 코드 세션/URL | **Replit 지원팀 확인 필요** |
| autosave snapshot | 접근 방법 없음 — Replit 지원팀 확인 필요 |

---

## 9. 현재 코드 변경 여부 확인

```
이번 조사에서 변경한 파일:
  - recovery-evidence/ (신규 디렉토리 — 추출 전용, 현재 프로젝트 코드에 영향 없음)
  - recovery-evidence/manifest.json (신규)
  - recovery-evidence/INVESTIGATION_REPORT.md (이 파일)
  
변경하지 않은 파일:
  - artifacts/swim-app/ 내 모든 파일 (현재 HEAD 코드 일체 불변)
  - artifacts/api-server/ 내 모든 파일 (불변)
  - .agents/memory/ (불변)
  
생성한 브랜치:
  - backup/pre-ai-recovery-376fa37 (376fa37 포인터만 생성, 파일시스템 변경 없음)
```

---

## 10. 완료 판정 기준

이번 작업지시의 완료 기준 ("자산을 찾고 원본 그대로 보존한 것까지만"):

| 항목 | 상태 |
|------|------|
| git 전체 이력 조사 | ✅ |
| 마지막 존재 커밋 특정 | ✅ dfeddc1 (2026-07-28 17:51) |
| 최초 누락 커밋 특정 | ✅ 376fa37 (2026-07-29 06:07) |
| 삭제 diff 기록 | ✅ 25개 파일 delete mode |
| 후보 코드 추출 (원본 경로 유지) | ✅ 4개 커밋 버전 추출 |
| SHA-256 계산 | ✅ 전체 25파일 |
| manifest.json 생성 | ✅ |
| 백업 브랜치 생성 | ✅ backup/pre-ai-recovery-376fa37 |
| AI 기능 정적 분석 표 | ✅ |
| Expo Go 출처 조사 | ✅ (Replit 내부 자산은 지원팀 확인 필요로 표시) |
| 현재 코드 변경 없음 확인 | ✅ |
