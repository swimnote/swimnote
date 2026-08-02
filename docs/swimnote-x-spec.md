# SWIMNOTE X 구현 명세서 (검수용)
> 작성일: 2026-08-02 | 버전: 1.0 | 상태: 확정

---

## 1. 제품 정의

### 1.1 핵심 컨셉
- **일반 SWIMNOTE**: 수영장 운영 관리 앱 (출결, 일정, 공지, 일지)
- **SWIMNOTE X**: 수영장 교육 시스템을 데이터화하는 AI 기반 수영 교육 플랫폼

### 1.2 X모드 활성화 조건
- 슈퍼어드민이 해당 수영장에 수동으로 X모드 ON
- `swimming_pools.xmode_enabled = true` 설정
- X모드 결제 완료 후 슈퍼어드민 승인 구조

---

## 2. 기능 경계 (일반 플랜 vs X모드)

| 기능 | 일반 플랜 | X모드 |
|------|-----------|-------|
| 음성 일지 (STT) | ✅ 말한 내용 그대로 입력 | ✅ 동일 |
| AI 일지 | ✅ 직접 템플릿 등록 시만 가능 | ✅ 기본 2,000개(히든) + 수영장 전용 자동 제공 |
| AI 일지 품질 | 템플릿 없으면 INPUT_ONLY (빈약) | 항상 TEMPLATE_ASSISTED (풍부) |
| 학부모 AI 검색 | ❌ "커리큘럼 미등록" 안내 | ✅ 커리큘럼 기반 GPT 검색 |
| 수영 성장판 | ❌ "커리큘럼 등록 필요" 안내 | ✅ 수영장 등록 커리큘럼 기준 게이지 |
| 기본 성장 리포트 | ❌ | ✅ 무료 월 1회 (50항목) |
| 심층 성장 리포트 | ❌ | ✅ 유료 29,000원 (130항목) |
| 수영장 홈페이지 | ❌ | ✅ swimnote.kr/[slug] 제공 |
| SwimNote X 브랜딩 | 일반 로고/테마 | X 전용 로고/색상 |

---

## 3. 템플릿 구조

### 3.1 히든 기본 템플릿
- **수량**: 2,000개
- **pool_id**: null
- **is_hidden**: true
- **용도**: AI 일지 품질 향상 전용
- **게이지 영향**: 없음 (게이지에 사용 금지)
- **접근**: 모든 X모드 수영장 공통 사용, 수영장에 노출 안 됨

### 3.2 수영장 전용 템플릿
- **pool_id**: 해당 수영장 ID
- **is_hidden**: false
- **용도**: AI 일지 + 수영 성장판(게이지) 기준
- **생성 방식**: 수영장 커리큘럼 의뢰 → GPT 생성 → DB 삽입

### 3.3 템플릿 검색 로직 (파이프라인 분기)
```
X모드 ON:
  → 히든 2,000개 + 수영장 전용 템플릿 합쳐서 검색
  → TEMPLATE_ASSISTED 모드 (풍부한 일지)

X모드 OFF:
  → 수영장이 직접 등록한 템플릿만 검색
  → 없으면 INPUT_ONLY 모드 (빈약한 일지)
```

**중요**: 기존 ai-v1.ts 파이프라인 코드 최소 변경. 분기점만 앞에 추가.

---

## 4. 수영 성장판 (게이지)

### 4.1 이름
- 정식 명칭: **수영 성장판** (게이지 아님)

### 4.2 계산 기준
- **기준**: 수영장이 등록한 커리큘럼 템플릿만 사용 (히든 템플릿 제외)
- **완료 조건**: 동일 커리큘럼 번호가 일지에서 2회 이상 등장 시 해당 항목 완료
- **% 계산**: 완료 항목 수 / 전체 커리큘럼 항목 수 × 100
- **조정 없음**: 수영장별 임계값 조정 기능 없음 (2회 통일)

### 4.3 자연 조절 원리
- 템플릿 50개 수영장 → 항목 완료 1개 = 2%
- 템플릿 100개 수영장 → 항목 완료 1개 = 1%
- 꼼꼼한 수영장은 자연스럽게 더 촘촘한 게이지

### 4.4 미등록 시 메시지
```
커리큘럼이 등록되어야
수업 완료 퍼센트를 확인할 수 있어요.

수영장에 문의해 보세요.
```

---

## 5. 학부모 AI 검색

### 5.1 X모드 ON
- 수영장 커리큘럼 + 히든 기본 DB 기반 검색
- GPT 문장으로 결과 반환

### 5.2 X모드 OFF (또는 커리큘럼 미등록)
```
스윔노트에 커리큘럼이 등록되어 있지 않아
AI 검색을 이용할 수 없어요.

수영장에 커리큘럼 등록을 문의해 보세요.
```

---

## 6. 성장 리포트

### 6.1 기본 성장 리포트 (X모드 무료)
- 제공 주기: 월 1회
- 항목 수: 50개
- 사용 데이터: 교사 피드, 성장 이벤트, 출결, 커리큘럼 진도

### 6.2 심층 성장 리포트 (유료)
- 가격: 29,000원/건
- 항목 수: 130개
- 추가 입력: 학부모 설문 + 음성 인터뷰 (약 2분)
- 대상: X모드 수영장만 제공

---

## 7. 커리큘럼 의뢰 시스템 (온보딩)

### 7.1 흐름
```
X모드 결제 완료
→ 앱 설정 → X모드 탭 → [커리큘럼 제작 의뢰] 버튼
→ 수영장이 입력:
   ① 레벨 구분 (몇 단계인지)
   ② 영법별 핵심 포인트 (2~3가지)
→ 슈퍼어드민에 의뢰 도착
→ 파일 확인 후 저한테 전달 (또는 슈퍼어드민 업로드)
→ GPT로 전용 템플릿 생성 → DB 삽입
→ 수영장에 "완료" 알림
→ 게이지 + AI 일지 풀가동
```

### 7.2 의뢰 상태
- 미제출 / 대기중 / 생성중 / 완료

### 7.3 커리큘럼 없이 X모드 사용 시
- AI 일지: 히든 2,000개만 사용 (정확도 낮음)
- 게이지: 비활성
- AI 검색: 비활성

---

## 8. 슈퍼어드민 X모드 관리

### 8.1 X모드 수영장 탭
| 정보 | 설명 |
|------|------|
| 수영장명 | 클릭 시 상세 |
| 플랜 결제일 | 기본 구독 갱신일 |
| X모드 결제일 | AI모드 추가 결제일 |
| 템플릿 의뢰 상태 | 미제출/대기중/생성중/완료 |
| 학부모 리포트 현황 | 구매 건수/금액 |

### 8.2 수영장 상세
- X모드 ON/OFF 토글
- 업로드 파일 보기/다운로드
- 수영장 관리자에게 보충 요청 메시지 발송
- 수영장 홈페이지 바로가기 (swimnote.kr/[slug])

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

### 9.2 X모드 추가 (Coach/Premier 공통)
- **+150,000원/월** (인앱결제, RevenueCat)
- 앱스토어 30% 수수료 포함 가격
- Coach, Premier 구분 없이 동일 가격
- 홈페이지 포함이므로 단일 가격 유지

### 9.3 심층 리포트
- **29,000원/건** (학부모가 직접 구매)
- X모드 수영장에서만 구매 가능

---

## 10. 압박 구조 (늪)

```
선생님
  └ X모드 없음 → INPUT_ONLY → 보충 직접 작성 불편
  └ X모드 있음 → 말하면 완성 → 편함
  └ 선생님 → 원장에게 "X모드 해주세요" 요청

학부모
  └ AI 검색 막힘 → "커리큘럼 미등록" 안내
  └ 게이지 없음 → "커리큘럼 등록 필요" 안내
  └ 리포트 없음 → 옆 수영장 학부모와 비교
  └ 학부모 → 원장에게 "왜 안 돼요?" 문의

원장
  └ 선생님 + 학부모 양쪽 압박
  └ 경쟁 수영장 X모드 도입 시 차별화 필요
  └ 원장 → X모드 결제
```

---

## 11. DB 스키마 변경 사항

### 신규 컬럼
```sql
-- swimming_pools
ALTER TABLE swimming_pools ADD COLUMN xmode_enabled BOOLEAN DEFAULT FALSE;

-- diary_templates
ALTER TABLE diary_templates ADD COLUMN pool_id TEXT REFERENCES swimming_pools(id);
ALTER TABLE diary_templates ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE diary_templates ADD COLUMN curriculum_item_id TEXT;
```

### 신규 테이블
```sql
-- curriculum_items: 수영장 커리큘럼 항목
CREATE TABLE curriculum_items (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  level_number INTEGER NOT NULL,       -- 레벨 번호
  item_number INTEGER NOT NULL,        -- 항목 번호 (게이지 기준)
  stroke_code TEXT,                    -- 영법 코드 (freestyle, backstroke, etc.)
  skill_name TEXT NOT NULL,            -- 기술명
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
  completion_count INTEGER DEFAULT 0,  -- 2 이상이면 완료
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
  observation_type TEXT,               -- 성공/부분성공/오류/유지/변동
  observation_text TEXT,
  change_direction TEXT,               -- 향상/유지/변동/악화/판단불가
  confidence NUMERIC,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 12. 실행 순서 (단계별)

| Phase | 작업 | 완료 기준 |
|-------|------|----------|
| 1 | DB 스키마 변경 | 마이그레이션 완료 |
| 2 | RevenueCat X모드 상품 추가 | 인앱 구매 테스트 성공 |
| 3 | 슈퍼어드민 X모드 관리 화면 | ON/OFF, 파일 업로드, 메시지 발송 동작 |
| 4 | 샘플 수영장 생성 + X모드 ON | 슈퍼어드민에서 확인 |
| 5 | 기본 히든 템플릿 2,000개 생성 | DB에 is_hidden=true로 삽입 완료 |
| 6 | AI 일지 파이프라인 분기 | X모드/비X모드 템플릿 검색 분기 동작 |
| 7 | 앱 X모드 UI/UX | 선생님/학부모 분기, 메시지, 성장판 |
| 8 | 수영장 커리큘럼 의뢰 폼 | 설정 탭에서 의뢰 → 슈퍼어드민 수신 |
| 9 | 토이키즈 커리큘럼 생성 + 적용 | 실사용 검증 |
| 10 | 심층 리포트 (추후) | 별도 Phase |

---

## 13. 검수 체크리스트

### 반드시 확인할 것
- [ ] 히든 템플릿이 게이지 계산에 사용되지 않는다
- [ ] 게이지는 수영장 등록 커리큘럼 기준으로만 동작한다
- [ ] 동일 커리큘럼 번호 2회 미만이면 완료 처리 안 된다
- [ ] X모드 OFF 수영장 학부모에게 정확한 안내 메시지가 표시된다
- [ ] 일반 플랜도 AI 일지 버튼은 보인다 (단 템플릿 없으면 INPUT_ONLY)
- [ ] Coach와 Premier 모두 X모드 추가 가능하다
- [ ] X모드 가격은 150,000원으로 통일이다
- [ ] 슈퍼어드민에서만 X모드 ON/OFF 가능하다 (수영장 자체 설정 불가)
- [ ] 수영장 홈페이지 slug 없으면 바로가기 링크 비활성화된다
- [ ] 심층 리포트(29,000원)는 X모드 수영장에서만 구매 가능하다
