/**
 * support-lexicon.ts — Support AI 제품 개념 Lexicon (RT2)
 *
 * 특정 질문 문장 단위 alias 금지.
 * 제품 개념(concept) 단위로만 관리.
 *
 * 원칙:
 *   - 실제 SWIMNOTE 제품 용어만 포함.
 *   - 무한 synonym 사전 금지.
 *   - 문장 전체 alias 금지 (예: "학부모리포트는 어떤기능이야?" 자체는 등록 불가).
 *   - aliases는 복합어 원형(space-free)과 띄어쓰기 형태 모두 포함.
 *
 * 사용법:
 *   const concepts = detectConcepts(normalizedQuery);
 *   → ["GROWTH_REPORT", "NOTIFICATION_SETTINGS"] 등
 */

// ── Concept IDs ───────────────────────────────────────────────────────────────

export type SupportConcept =
  | "GROWTH_REPORT"
  | "NOTIFICATION_SETTINGS"
  | "CURRICULUM_SEARCH"
  | "X_MODE"
  | "SUBSCRIPTION"
  | "DIARY"
  | "SCHEDULE"
  | "STUDENT_MANAGEMENT"
  | "POOL_MANAGEMENT"
  | "LOGIN_SIGNUP"
  | "PHOTO_ALBUM";

// ── Lexicon entry ─────────────────────────────────────────────────────────────

interface LexiconEntry {
  concept: SupportConcept;
  /**
   * canonical 검색어.
   * KI title/category/feature 매칭에 사용.
   */
  searchTerms: string[];
  /**
   * 사용자 표현 aliases (소문자, 공백 정규화된 형태).
   * concept 감지에 사용.
   */
  aliases: string[];
}

// ── Lexicon ────────────────────────────────────────────────────────────────────

export const SUPPORT_LEXICON: ReadonlyArray<LexiconEntry> = [
  {
    concept: "GROWTH_REPORT",
    searchTerms: ["성장 리포트", "학부모 리포트", "리포트", "growth report"],
    aliases: [
      "학부모리포트", "학부모 리포트",
      "성장리포트",   "성장 리포트",
      "ai성장리포트",  "ai 성장 리포트",
      "리포트",
      "growth report",
    ],
  },
  {
    concept: "NOTIFICATION_SETTINGS",
    searchTerms: ["알림", "알림 설정", "푸시 알림"],
    aliases: [
      "알림",
      "알림설정",   "알림 설정",
      "알림끄기",   "알림 끄기",
      "알림끄는",   "알림 끄는",
      "푸시",
      "푸시알림",   "푸시 알림",
      "push",
      "push notification",
    ],
  },
  {
    concept: "CURRICULUM_SEARCH",
    searchTerms: ["커리큘럼 검색", "ai 커리큘럼", "진도 검색"],
    aliases: [
      "커리큘럼검색", "커리큘럼 검색",
      "ai커리큘럼검색", "ai 커리큘럼 검색",
      "커리큘럼ai검색", "커리큘럼 ai 검색",
      "진도검색",    "진도 검색",
      "커리큘럼",
    ],
  },
  {
    concept: "X_MODE",
    searchTerms: ["x모드", "x mode", "스윔노트x"],
    aliases: [
      "x모드", "x 모드",
      "xmode", "x mode",
      "스윔노트x", "스윔노트 x",
      "x기능", "x 기능",
    ],
  },
  {
    concept: "SUBSCRIPTION",
    searchTerms: ["구독", "결제", "플랜"],
    aliases: [
      "구독",
      "결제",
      "플랜",       "plan",
      "구독취소",   "구독 취소",
      "결제취소",   "결제 취소",
      "구독해지",   "구독 해지",
      "subscription",
    ],
  },
  {
    concept: "DIARY",
    searchTerms: ["수업 일지", "일지", "다이어리"],
    aliases: [
      "일지",
      "수업일지",   "수업 일지",
      "다이어리",
      "diary",
      "ai일지",     "ai 일지",
    ],
  },
  {
    concept: "SCHEDULE",
    searchTerms: ["스케줄", "시간표", "수업 시간"],
    aliases: [
      "스케줄",
      "시간표",
      "수업시간",   "수업 시간",
      "수업일정",   "수업 일정",
      "schedule",
    ],
  },
  {
    concept: "STUDENT_MANAGEMENT",
    searchTerms: ["학생 관리", "학생 등록", "학생 목록"],
    aliases: [
      "학생",
      "학생관리",   "학생 관리",
      "학생등록",   "학생 등록",
      "학생목록",   "학생 목록",
      "수강생",
    ],
  },
  {
    concept: "POOL_MANAGEMENT",
    searchTerms: ["수영장 관리", "수영장 설정", "풀 관리"],
    aliases: [
      "수영장",
      "수영장관리",   "수영장 관리",
      "수영장설정",   "수영장 설정",
      "pool",
    ],
  },
  {
    concept: "LOGIN_SIGNUP",
    searchTerms: ["로그인", "회원가입", "계정"],
    aliases: [
      "로그인",
      "회원가입",   "회원 가입",
      "계정",
      "비밀번호",
      "login",      "signup",
    ],
  },
  {
    concept: "PHOTO_ALBUM",
    searchTerms: ["앨범", "사진", "포토"],
    aliases: [
      "앨범",
      "사진",
      "포토",
      "photo",
      "album",
    ],
  },
];

// ── Korean compound splitter ──────────────────────────────────────────────────

/**
 * 조사·어미 제거 (개선된 버전).
 * 기존 stemKorean보다 더 많은 패턴 처리.
 */
export function stripJosa(token: string): string {
  return token.replace(
    /(에서|에게|이나|으로|에서|께서|에게서|에도|에서는|에서도|에서의|에서만|까지|부터|만큼|처럼|보다|마다|조차|이라|이야|이에요|예요|이란|이랑|이라도|이면)$|[가이는은를을에의로도만나와과은]$/,
    ""
  ) || token;
}

/**
 * 쿼리 텍스트를 토큰 배열로 분리 (개선된 버전).
 *
 * 기존 tokenize 대비 개선:
 *   - 조사 제거 후 토큰 추가 (overlap 기회 증가)
 *   - 복합어 분리 시도 (예: "알림끄는거" → ["알림", "끄는거", "알림끄는거"])
 *   - 영문/숫자 포함 토큰 보존
 */
export function tokenizeKorean(text: string): string[] {
  const base = text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);

  const result = new Set<string>(base);

  for (const t of base) {
    // 조사 제거 stem 추가
    const stemmed = stripJosa(t);
    if (stemmed !== t && stemmed.length >= 2) {
      result.add(stemmed);
    }
  }

  return Array.from(result);
}

// ── Concept detector ──────────────────────────────────────────────────────────

/**
 * 정규화된 쿼리에서 매칭되는 SupportConcept 목록을 반환.
 *
 * @param normalizedQuery - normalizeQuery() 처리 후 소문자 쿼리
 */
export function detectConcepts(normalizedQuery: string): SupportConcept[] {
  const q = normalizedQuery.toLowerCase().replace(/\s+/g, ""); // 공백 제거 버전도 병행
  const qOrig = normalizedQuery.toLowerCase();
  const matched: SupportConcept[] = [];

  for (const entry of SUPPORT_LEXICON) {
    for (const alias of entry.aliases) {
      const aliasNS = alias.replace(/\s+/g, ""); // 공백 제거 버전
      if (q.includes(aliasNS) || qOrig.includes(alias)) {
        matched.push(entry.concept);
        break;
      }
    }
  }

  return [...new Set(matched)]; // 중복 제거
}

/**
 * concept에 대응하는 searchTerms 반환.
 * ILIKE 검색에 사용할 키워드 목록.
 */
export function getSearchTermsForConcept(concept: SupportConcept): string[] {
  return SUPPORT_LEXICON.find(e => e.concept === concept)?.searchTerms ?? [];
}

/**
 * concept 목록에서 ILIKE 검색용 키워드 목록 생성.
 */
export function buildSearchKeywordsFromConcepts(concepts: SupportConcept[]): string[] {
  const terms = concepts.flatMap(c => getSearchTermsForConcept(c));
  return [...new Set(terms)];
}
