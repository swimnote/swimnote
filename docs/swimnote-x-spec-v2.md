# SWIMNOTE X 구현 명세서 (최종 완전판)
> 작성일: 2026-08-02 | 버전: 2.1 | 상태: GPT 2차 검수 반영

---

## 목차
1. 제품 정의
2. 기능 경계 (일반 플랜 vs X모드)
3. X모드 상태값 및 전환 정책
4. 템플릿 구조
5. 수영 성장판
6. 학부모 AI 검색
7. 성장 리포트
8. 커리큘럼 의뢰 시스템
9. 가격 정책
10. 슈퍼어드민 관리 시스템
11. 수영장별 이벤트 알림함
12. 압박 구조 (늪)
13. X모드 활성화/비활성화 정책
14. DB 스키마 변경 사항
15. AI 일지 파이프라인 분기
16. 실행 순서 (Phase별)
17. 절대 변경 금지 사항
18. 검수 체크리스트

---

## 1. 제품 정의

### 1.1 핵심 컨셉
| 구분 | 정의 |
|------|------|
| **SWIMNOTE (일반)** | 수영장 운영 관리 앱 — 출결, 일정, 공지, 일지 |
| **SWIMNOTE X** | 수영장 교육 시스템을 데이터화하는 AI 기반 수영 교육 플랫폼 |

X모드는 기존 SWIMNOTE 위에 올라가는 **독립 모듈** 형태로 구현한다.
기존 구조, 기존 파이프라인, 기존 일반 플랜 기능을 건드리지 않는다.

---

## 2. 기능 경계 (일반 플랜 vs X모드)

| 기능 | 일반 플랜 | X모드 |
|------|-----------|-------|
| 음성 일지 (STT) | ✅ 말한 내용 그대로 입력 | ✅ 동일 |
| AI 일지 | ✅ 수영장이 직접 템플릿 등록 시만 가능. 없으면 INPUT_ONLY | ✅ 기본 히든 2,000개 + 수영장 전용 자동 제공 → 항상 풍부 |
| AI 일지 버튼 노출 | ✅ 노출됨 (단 템플릿 없으면 결과 빈약) | ✅ 노출됨 |
| 학부모 AI 검색 | ❌ "커리큘럼 미등록" 안내 메시지 | ✅ 커리큘럼 기반 GPT 검색 |
| 수영 성장판 | ❌ "커리큘럼 등록 필요" 안내 메시지 | ✅ 수영장 등록 커리큘럼 기준 게이지 |
| 기본 성장 리포트 | ❌ | ✅ 무료 월 1회 (50항목) |
| 심층 성장 리포트 | ❌ | ✅ 유료 29,000원/건 (130항목) |
| 수영장 홈페이지 | ❌ | ✅ swimnote.kr/[slug] 제공 |
| SWIMNOTE X 브랜딩 | 일반 로고/테마 | X 전용 로고/색상 |

---

## 3. X모드 상태값 및 전환 정책

### 3.1 상태값 (xmode_status)
`xmode_enabled boolean` 사용 금지. 반드시 4단계 상태값으로 구현.

| 상태 | 의미 | 활성 기능 |
|------|------|----------|
| `OFF` | X모드 미사용 | 없음 |
| `PURCHASED` | 결제 완료, 슈퍼어드민 승인 완료 | 설정 탭에 커리큘럼 의뢰 메뉴 노출 |
| `CURRICULUM_PENDING` | 커리큘럼 의뢰 대기 중 | AI 일지(히든 템플릿만), 게이지·AI 검색 비활성 |
| `ACTIVE` | 커리큘럼 생성 완료 | 전체 기능 활성 |

### 3.2 상태 전환 규칙 (명확화)
중복/모호한 전환 금지. 아래 규칙만 허용.

```
결제 성공
  → OFF → PURCHASED

커리큘럼 의뢰 제출 완료
  → PURCHASED → CURRICULUM_PENDING

전용 커리큘럼 생성 및 검수 완료 (슈퍼어드민 처리)
  → CURRICULUM_PENDING → ACTIVE

의뢰 반려 또는 취소
  → CURRICULUM_PENDING → PURCHASED (복귀)

결제 만료
  → 모든 상태 → OFF
```

### 3.3 활성화 시
- 결제 완료 즉시 → `PURCHASED`
- 슈퍼어드민 승인 후 커리큘럼 의뢰 가능
- 커리큘럼 생성 완료 후 슈퍼어드민이 `ACTIVE` 처리
- 해당 수영장에 등록된 **선생님·학부모 전원** 즉시 X모드 전환
- 앱 재시작 없이 세션 내 즉시 반영

### 3.5 비활성화 시
- 결제 만료 즉시 → `OFF`
- 선생님·학부모 전원 **즉시** 일반 플랜으로 전환
- 충돌 금지: X모드 기능이 켜진 채로 일반 화면과 공존하면 안 됨

### 3.4 데이터 보존 정책 (비활성화 후)
| 데이터 | 처리 |
|--------|------|
| 기존 X모드 일지 | **유지** (조회 가능) |
| 기존 성장 이벤트 | **유지** |
| 기존 리포트 | **유지** (조회 가능) |
| 수영 성장판 기존 진도 | **유지** (단 갱신 불가) |
| 앞으로 생성되는 일지 | 일반 플랜 방식으로 생성 |
| 앞으로 생성되는 리포트 | X모드 전용이므로 비활성 |

**원칙**: 이미 저장된 데이터는 건드리지 않는다. 앞으로 생성되는 것만 일반 플랜 기준이다.

### 3.5 홈페이지 도메인 처리
- `xmode_status = OFF` 전환 시 홈페이지 자동 중지 가능 여부 확인
- 자동 중지 불가 시: 슈퍼어드민에 즉시 알림 발송
  ```
  [수영장명] X모드 종료 — 홈페이지 도메인 해제 필요
  ```
- 슈퍼어드민이 수동으로 slug 비활성화 처리

---

## 4. 템플릿 구조

### 4.1 히든 기본 템플릿
- **수량**: 2,000개
- **pool_id**: null
- **is_hidden**: true
- **용도**: AI 일지 품질 향상 (보완용)
- **게이지 영향**: 없음 (게이지 계산에 사용 금지)
- **노출**: 수영장에 노출 안 됨, X모드 수영장 공통 사용

### 4.2 수영장 전용 템플릿
- **pool_id**: 해당 수영장 ID
- **is_hidden**: false
- **용도**: AI 일지 + 수영 성장판(게이지) 기준
- **생성**: 수영장 커리큘럼 의뢰 → GPT 생성 → DB 삽입

### 4.3 템플릿 검색 우선순위
```
① 수영장 전용 템플릿 (pool_id = 해당수영장) ← 최우선
② 히든 기본 템플릿 (pool_id = null, is_hidden = true) ← 보완용
```
- **히든 템플릿이 수영장 전용 템플릿을 덮어쓰면 안 됨**
- 히든 템플릿은 수영장 전용이 없는 영역만 보완

### 4.4 xmode_status별 검색 범위
| 상태 | 검색 대상 | 결과 |
|------|----------|------|
| ACTIVE | 수영장 전용 + 히든 | TEMPLATE_ASSISTED (풍부) |
| CURRICULUM_PENDING | 히든만 | TEMPLATE_ASSISTED (정확도 낮음) |
| PURCHASED / OFF | 수영장이 직접 등록한 템플릿만 | 없으면 INPUT_ONLY (빈약) |

### 4.5 AI 일지 검색 DB와 학부모 AI 검색 DB 완전 분리

**절대 같은 검색 구조를 사용하지 않는다.**

| 구분 | 검색 소스 | 목적 |
|------|----------|------|
| **AI 일지 생성** | ① 수영장 전용 Template → ② Hidden Template | 일지 문장 생성 전용 |
| **학부모 AI 검색** | ① 수영장 Curriculum → ② SWIMNOTE Knowledge DB → GPT | 질문 답변 전용 |

- Hidden Template를 학부모 AI 검색의 Knowledge DB처럼 사용하면 안 됨
- AI 일지용 Template과 AI 검색용 Curriculum은 완전히 다른 경로

### 4.6 AI 검색 모듈 확장 구조
- 향후 SWIMNOTE AI Engine 검색 레이어 추가 예정
- 검색 모듈을 확장 가능한 인터페이스(Provider 패턴)로 추상화
- 현재 기능 변경 없음, 인터페이스만 확장 가능하게 설계

---

## 5. 수영 성장판

### 5.1 정식 명칭
**수영 성장판** (게이지·로드맵 등의 명칭 사용 금지)

### 5.2 계산 기준 (명확화)
- **기준**: `curriculum_item_id` 기준 (일지 문장 파싱 기준 아님)
- **완료 조건**: 동일 `curriculum_item_id`의 `curriculum_progress.completion_count ≥ 2`
- **% 계산**: 완료 항목 수 ÷ 전체 커리큘럼 항목 수 × 100
- **수영장 설정 없음**: 임계값 조정 기능 없음, 전체 2회 통일

### 5.2-A 완료 인정 흐름
```
AI가 curriculum_item_id 추천
  ↓
교사가 최종 저장 (일지 저장 확정 시점)
  ↓
growth_event 생성
  ↓
curriculum_progress.completion_count + 1
  ↓
count ≥ 2 → 해당 항목 완료 처리
```

**중요 규칙**:
- 한 일지를 여러 번 수정해도 `completion_count`는 **1회만** 증가
- 같은 `diary_id`로 이미 `growth_event`가 존재하면 중복 생성 금지
- 일지 삭제 시 해당 `growth_event` 제거 + `completion_count` 감소

### 5.3 자연 조절 원리
- 템플릿 50개 → 1항목 완료 = 2% / 템플릿 100개 → 1항목 완료 = 1%
- 꼼꼼한 커리큘럼일수록 게이지가 촘촘해짐 (자동 조절)

### 5.4 미등록 안내 메시지
```
커리큘럼이 등록되어야
수업 완료 퍼센트를 확인할 수 있어요.

수영장에 문의해 보세요.
```

---

## 6. 학부모 AI 검색

### 6.1 xmode_status = ACTIVE
- **검색 소스**: 수영장 전용 Curriculum → SWIMNOTE Knowledge DB → GPT
- Hidden Template 사용 금지 (AI 일지 전용)
- GPT 문장으로 결과 반환

### 6.2 X모드 OFF 또는 커리큘럼 미등록
```
스윔노트에 커리큘럼이 등록되어 있지 않아
AI 검색을 이용할 수 없어요.

수영장에 커리큘럼 등록을 문의해 보세요.
```

---

## 7. 성장 리포트

### 7.1 기본 성장 리포트 (X모드 무료 제공)
- 제공 주기: **학생 1명당 월 1회** (수영장 기준 아님, 학부모 계정 기준 아님)
- 항목 수: 50개
- 제공 대상: xmode_status = ACTIVE 수영장의 학생만
- **데이터 부족 시**: 억지로 생성하지 않고 아래 안내 표시
  ```
  분석 가능한 데이터가 부족합니다.
  일지가 더 쌓이면 리포트를 확인할 수 있어요.
  ```

### 7.2 심층 성장 리포트 (유료)
- 가격: **29,000원/건** (학부모가 직접 인앱 결제)
- 항목 수: 130개
- 추가 입력: 학부모 설문 + 음성 인터뷰 (약 2분)
- 제공 대상: xmode_status = ACTIVE 수영장만

---

## 8. 커리큘럼 의뢰 시스템

### 8.1 온보딩 흐름
```
X모드 결제 완료 (PURCHASED)
  ↓
앱 설정 → X모드 탭 → [커리큘럼 제작 의뢰] 버튼 활성화
  ↓
수영장 입력:
  ① 레벨 구분 (몇 단계인지)
  ② 영법별 핵심 포인트 (2~3가지)
  ③ 관련 자료 파일 업로드 (선택)
  ↓
슈퍼어드민에 의뢰 도착 (즉시 알림)
  ↓
슈퍼어드민이 자료 확인 → GPT로 전용 템플릿 생성 → DB 삽입
  ↓
슈퍼어드민이 ACTIVE 처리 → 수영장에 "완료" 알림
  ↓
게이지 + AI 일지 + AI 검색 풀가동
```

### 8.2 의뢰 상태 표시
| 상태 | 의미 |
|------|------|
| 미제출 | 의뢰 폼 작성 안 함 |
| 대기중 | 의뢰 제출 완료, 검토 전 |
| 생성중 | 템플릿 제작 중 |
| 완료 | 전용 템플릿 DB 삽입 완료 |

### 8.3 커리큘럼 없이 X모드 사용 시 (CURRICULUM_PENDING)
- AI 일지: 히든 2,000개만 사용 (정확도 낮음)
- 수영 성장판: 비활성
- AI 검색: 비활성

---

## 9. 가격 정책

### 9.1 기본 플랜 (변경 없음)
| 플랜 | 가격 | 회원 | 스토리지 |
|------|------|------|---------|
| Free | 무료 | 10명 | 100MB |
| Coach30 | 1,900원/월 | 30명 | 300MB |
| Coach50 | 2,900원/월 | 50명 | 500MB |
| Coach100 | 5,900원/월 | 100명 | 1GB |
| Premier200 | 19,000원/월 | 200명 | 5GB |
| Premier300 | 27,000원/월 | 300명 | 10GB |
| Premier500 | 43,000원/월 | 500명 | 20GB |
| Premier1000 | 79,000원/월 | 1,000명 | 50GB |

### 9.2 X모드 추가 요금
- **+150,000원/월** (인앱결제, RevenueCat)
- Coach / Premier 구분 없이 동일 가격
- 홈페이지 제작 포함이므로 단일 가격 유지
- 앱스토어 30% 수수료 포함 금액 → 실수령 105,000원

### 9.3 심층 리포트
- **29,000원/건** (학부모 직접 인앱 결제)
- xmode_status = ACTIVE 수영장에서만 구매 가능

---

## 10. 슈퍼어드민 관리 시스템

### 10.1 X모드 수영장 탭
각 수영장마다 다음 정보를 한눈에 확인:
| 항목 | 내용 |
|------|------|
| 수영장명 | 클릭 시 상세 모달/페이지 진입 |
| xmode_status | OFF / PURCHASED / CURRICULUM_PENDING / ACTIVE |
| 플랜 결제일 | 기본 구독 갱신일 |
| X모드 결제일 | X모드 추가 결제일 |
| 템플릿 의뢰 상태 | 미제출 / 대기중 / 생성중 / 완료 |
| 학부모 리포트 결제 현황 | 구매 건수 / 금액 |
| 홈페이지 | swimnote.kr/[slug] 바로가기 (미등록 시 비활성) |

### 10.2 수영장 상세 (모달 또는 전용 페이지)
**수영장 작업 중 홈/목록으로 이탈 금지. 기존 모달/뒤로가기 규칙 동일하게 적용.**

포함 기능:
- xmode_status 변경 (ON/OFF/단계 전환)
- 업로드 파일 보기 / 다운로드
- 수영장 관리자에게 메시지 발송 + 파일 첨부
- 수영장 홈페이지 바로가기
- 템플릿 생성 완료 처리 → 수영장에 알림 발송

---

## 11. 수영장별 이벤트 알림함

### 11.1 구조
- 수영장마다 **독립된 이벤트 알림함** 존재
- **대화창 형식**: 이벤트가 위로 쌓임 (최신이 위)
- 첨부파일이 있는 경우 메시지 옆에 파일 아이콘 + 다운로드 버튼 표시
- 슈퍼어드민과 수영장 관리자 **양방향** 메시지/파일 발송 가능

### 11.2 이벤트 유형별 알림 정책
| 이벤트 | 알림 | 비고 |
|--------|------|------|
| 신규가입 | ✅ 즉시 푸시 | 새 수영장 플랜 최초 결제 |
| X모드 가입 | ✅ 즉시 푸시 | X모드 신규 결제 |
| 가입 해지 | ✅ 즉시 푸시 | 구독 해지 |
| 문의사항 | ✅ 즉시 푸시 | 사진/파일 첨부 가능 |
| 자료 제출 | ✅ 즉시 푸시 | 커리큘럼 의뢰 파일 등 |
| X모드 홈페이지 해제 필요 | ✅ 즉시 푸시 | X모드 종료 시 자동 발송 |
| 재결제 / 재등록 | ❌ 알림 없음 | 별도 리스트에서 확인 |
| 구독 변경 (플랜 업다운) | ❌ 알림 없음 | 별도 리스트에서 확인 |

### 11.3 파일 업로드/다운로드 규칙
**최대한 유연하게 허용. 불필요한 확장자 차단 금지.**

허용 확장자:
- 이미지: jpg, jpeg, png, gif, webp, heic, bmp
- 문서: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, hwp
- 영상: mp4, mov, avi
- 기타: zip

업로드 모달 규칙:
- 내용 자유 입력 + 다중 파일 첨부 동시 가능
- 수영장 관리자 앱 설정 탭에서도 동일하게 가능
- 업로드/다운로드 모두 양방향 지원

### 11.4 수영장 관리자 앱 (설정 → X모드 탭)
- 커리큘럼 제작 의뢰 폼 (텍스트 + 파일)
- 의뢰 상태 확인 (미제출/대기중/생성중/완료)
- 문의사항 작성 + 사진/파일 첨부
- 슈퍼어드민 답장 확인

---

## 12. 압박 구조 (늪)

```
선생님
  └ X모드 없음 → INPUT_ONLY → 보충 직접 작성 (수십 분 소요)
  └ X모드 있음 → 말하면 완성 (편함)
  └ 선생님 → 원장에게 "X모드 해주세요" 역방향 요청

학부모
  └ AI 검색 탭 → "커리큘럼이 등록되어 있지 않아요"
  └ 수영 성장판 → "커리큘럼 등록 필요"
  └ 리포트 없음 → 옆 수영장 학부모와 비교
  └ 학부모 → 원장에게 문의

원장
  └ 선생님 + 학부모 양쪽에서 압박
  └ 경쟁 수영장 X모드 도입 시 차별화 필요
  └ 원장 → X모드 결제
```

---

## 13. X모드 활성화/비활성화 정책

### 검수 포인트
- [ ] 결제 완료 시 선생님/학부모 앱에서 즉시 X모드 UI로 전환되는가
- [ ] 결제 만료 시 즉시 일반 플랜 UI로 전환되는가 (충돌 없이)
- [ ] 만료 후 기존 X모드 데이터가 삭제되지 않고 조회만 되는가
- [ ] 만료 후 새 일지 생성 시 일반 플랜 파이프라인으로 동작하는가
- [ ] 홈페이지 도메인 해제 알림이 슈퍼어드민에 즉시 발송되는가

---

## 14. DB 스키마 변경 사항

### 14.1 기존 테이블 변경
```sql
-- swimming_pools: xmode_enabled 대신 xmode_status 사용
ALTER TABLE swimming_pools
  ADD COLUMN xmode_status TEXT DEFAULT 'OFF'
  CHECK (xmode_status IN ('OFF', 'PURCHASED', 'CURRICULUM_PENDING', 'ACTIVE'));

-- diary_templates: X모드 분기용 컬럼 추가
ALTER TABLE diary_templates ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE diary_templates ADD COLUMN curriculum_item_id TEXT;
-- pool_id는 기존에 있는 경우 활용, 없으면 추가
```

### 14.2 신규 테이블
```sql
-- curriculum_items: 수영장 커리큘럼 항목
CREATE TABLE curriculum_items (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  level_number INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  stroke_code TEXT,           -- freestyle, backstroke, breaststroke, butterfly, etc.
  skill_name TEXT NOT NULL,
  description TEXT,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- curriculum_progress: 학생별 완료 횟수
CREATE TABLE curriculum_progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  curriculum_item_id TEXT NOT NULL REFERENCES curriculum_items(id),
  completion_count INTEGER DEFAULT 0,   -- 2 이상이면 완료 처리
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, curriculum_item_id)
);

-- growth_events: 피드 생성 시 구조화 저장
CREATE TABLE growth_events (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  diary_id TEXT,
  curriculum_item_id TEXT,
  stroke_code TEXT,
  observation_type TEXT,            -- 성공/부분성공/오류/유지/변동
  observation_text TEXT,
  change_direction TEXT,            -- 향상/유지/변동/악화/판단불가
  confidence NUMERIC,
  source TEXT DEFAULT 'teacher_ai', -- teacher_ai | teacher_manual | parent_ai | video_ai
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- source 컬럼: 현재는 teacher_ai만 사용. 향후 영상분석/AI리포트 데이터 출처 구분용.

-- pool_events: 수영장별 이벤트 알림함
CREATE TABLE pool_events (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  event_type TEXT NOT NULL,  -- new_signup | xmode_signup | cancel | inquiry | file_submit | domain_release | reply
  sender TEXT NOT NULL,      -- super_admin | pool_admin
  message TEXT,
  file_urls JSONB,           -- 첨부파일 URL 배열
  is_read BOOLEAN DEFAULT FALSE,
  requires_action BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 15. AI 일지 파이프라인 분기

### 핵심 원칙
- 기존 `ai-v1.ts` 핵심 로직 변경 금지
- `diary-template-search.ts` 쿼리 조건에 분기점만 추가

### 분기 로직
```typescript
// xmode_status에 따른 템플릿 검색 파라미터 결정
function getTemplateSearchParams(pool_id: string, xmode_status: string) {
  if (xmode_status === 'ACTIVE') {
    return { pool_id, include_hidden: true, priority: 'pool_first' };
  } else if (xmode_status === 'CURRICULUM_PENDING') {
    return { pool_id: null, include_hidden: true, priority: 'hidden_only' };
  } else {
    return { pool_id, include_hidden: false, priority: 'pool_only' };
  }
}
```

- **ACTIVE**: 수영장 전용 ①우선, 히든 ②보완
- **CURRICULUM_PENDING**: 히든만
- **PURCHASED / OFF**: 수영장 직접 등록만 (없으면 INPUT_ONLY)

---

## 16. 실행 순서 (Phase별)

| Phase | 작업 내용 | 완료 기준 |
|-------|----------|----------|
| 1 | DB 스키마 변경 (xmode_status, curriculum_items, curriculum_progress, growth_events, pool_events) | 마이그레이션 완료 |
| 2 | RevenueCat X모드 150,000원 인앱 상품 추가 | 인앱 구매 테스트 성공 |
| 3 | 슈퍼어드민 X모드 관리 화면 (상태 관리, 의뢰 파일 업다운, 이벤트 알림함, 메시지 발송) | 전 기능 동작 확인 |
| 4 | 샘플 수영장 생성 + xmode_status = PURCHASED | 슈퍼어드민에서 확인 |
| 5 | 기본 히든 템플릿 2,000개 GPT 배치 생성 → DB 삽입 | is_hidden=true, pool_id=null 확인 |
| 6 | AI 일지 파이프라인 분기 (xmode_status별 템플릿 검색) | 3가지 상태 각각 동작 확인 |
| 7 | 앱 X모드 UI/UX (선생님 일지 분기, 학부모 성장판/AI검색/리포트, X 브랜딩) | 샘플 수영장에서 전체 흐름 확인 |
| 8 | 수영장 커리큘럼 의뢰 폼 (설정 탭 X모드 섹션) | 의뢰 제출 → 슈퍼어드민 알림 수신 |
| 9 | 샘플 수영장 E2E 검증 (전체 기능 흐름) | 이슈 없음 확인 |
| 10 | 심층 리포트 (추후 별도) | — |
| 11 | 토이키즈 커리큘럼 의뢰 → GPT 생성 → ACTIVE 전환 → 실사용 검증 → 전국 배포 | 토이키즈 ACTIVE 상태 + 실사용 이상 없음 |

**토이키즈는 최초 개발 대상이 아니라 최종 검증 수영장이다.**

---

## 17. 절대 변경 금지 사항

| 금지 항목 | 이유 |
|----------|------|
| 기존 SWIMNOTE 구조 변경 | 운영 중인 수영장 영향 |
| 기존 AI 일지 파이프라인 핵심 로직 변경 | 기존 동작 보장 |
| 기존 일반 플랜 기능 변경 | 비X모드 수영장 영향 |
| xmode_enabled boolean 사용 | xmode_status 4단계 enum 사용 |
| 히든 템플릿을 게이지에 사용 | 성장판은 전용 커리큘럼 기준만 |

---

## 18. 검수 체크리스트

### DB
- [ ] `xmode_status` enum 4단계로 구현되었는가 (boolean 아님)
- [ ] `growth_events.source` 컬럼이 존재하는가
- [ ] `pool_events` 테이블이 수영장별로 독립적으로 동작하는가

### 템플릿 / 검색 DB 분리
- [ ] 히든 템플릿이 게이지 계산에 사용되지 않는가
- [ ] 수영장 전용 템플릿이 히든 템플릿보다 우선순위가 높은가
- [ ] ACTIVE 상태에서만 전체 기능이 활성화되는가
- [ ] AI 일지 검색과 학부모 AI 검색이 완전히 다른 소스를 사용하는가
- [ ] 학부모 AI 검색에 Hidden Template이 사용되지 않는가

### 수영 성장판
- [ ] 성장판 계산이 일지 문장 파싱이 아닌 `curriculum_item_id` 기준인가
- [ ] 같은 일지(diary_id)를 여러 번 수정해도 completion_count가 1회만 증가하는가
- [ ] 일지 저장 확정 시점에만 growth_event가 생성되는가
- [ ] 미등록 시 정확한 안내 메시지가 표시되는가

### X모드 상태 전환
- [ ] 결제 성공 → PURCHASED만 가능한가 (다른 경로로 PURCHASED 직행 금지)
- [ ] 의뢰 제출 → CURRICULUM_PENDING 전환이 정확한가
- [ ] 의뢰 반려/취소 → PURCHASED 복귀가 되는가
- [ ] 슈퍼어드민만 ACTIVE 처리 가능한가

### 활성화/비활성화
- [ ] 결제 즉시 전원에게 X모드 UI가 적용되는가
- [ ] 만료 즉시 전원이 일반 플랜으로 전환되는가 (충돌 없이)
- [ ] 만료 후 기존 데이터 유지, 신규 생성은 일반 방식인가
- [ ] X모드 종료 시 홈페이지 해제 알림이 슈퍼어드민에 도착하는가

### 슈퍼어드민
- [ ] 수영장 작업 중 홈/목록으로 이탈이 발생하지 않는가
- [ ] 신규가입/X모드가입/해지/문의/자료제출 시 즉시 푸시 알림이 오는가
- [ ] 재결제/재등록은 알림 없이 리스트에만 표시되는가
- [ ] HEIC, DOCX, XLSX 등 주요 확장자 업로드가 차단되지 않는가
- [ ] 이벤트 알림함이 대화창 형식(최신 위)으로 쌓이는가
- [ ] 첨부파일 메시지에 다운로드 버튼이 표시되는가

### 파이프라인
- [ ] 기존 ai-v1.ts 핵심 로직이 변경되지 않았는가
- [ ] xmode_status별 분기가 템플릿 검색 파라미터로만 처리되는가
