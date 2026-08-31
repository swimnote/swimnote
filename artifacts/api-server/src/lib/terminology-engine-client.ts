/**
 * terminology-engine-client.ts
 *
 * APP → Professional AI ENGINE HTTP client (Terminology feature).
 *
 * ENV (server-side only):
 *   PROFESSIONAL_ENGINE_BASE_URL    — reuses existing engine base URL
 *   PROFESSIONAL_ENGINE_API_SECRET  — reuses existing bearer secret
 *
 * MOCK MODE: If PROFESSIONAL_ENGINE_BASE_URL is not configured,
 * returns built-in sample fixture data (development phase only).
 * When ENGINE sample API is ready, set the env var and mock is bypassed automatically.
 *
 * RESPONSIBILITY BOUNDARY:
 *   - HTTP transport only
 *   - No ranking, no alias matching, no link detection
 *   - Segments contract: ENGINE pre-splits text → APP just renders
 */

import { getProfessionalEngineBaseUrl } from "./professional-engine-client.js";

// ─── Contract types ────────────────────────────────────────────────────────────

/** A segment is either plain text or a linkable term span. */
export interface TermSegment {
  text: string;
  link?: { term_id: string };
}

export interface TermSection {
  type:
    | "detail"
    | "why_it_matters"
    | "how_it_is_used"
    | "common_confusions"
    | "examples"
    | "cautions";
  label: string;
  /** Pre-split segments; APP renders as-is without string slicing. */
  segments: TermSegment[];
}

export interface TermRelated {
  term_id: string;
  canonical_name_ko: string;
}

/** Search result item (summary only, no sections). */
export interface TermSearchResult {
  term_id: string;
  canonical_name_ko: string;
  canonical_name_en: string;
  aliases: string[];
  summary: string;
}

/** Full term detail. */
export interface TermDetail {
  term_id: string;
  canonical_name_ko: string;
  canonical_name_en: string;
  aliases: string[];
  summary: string;
  sections: TermSection[];
  related_terms: TermRelated[];
  terminology_version: string;
}

export interface TermSearchResponse {
  results: TermSearchResult[];
  terminology_version: string;
  total: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type TerminologyEngineErrorCode =
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_TIMEOUT"
  | "ENGINE_URL_NOT_CONFIGURED"
  | "TERM_NOT_FOUND";

export class TerminologyEngineError extends Error {
  constructor(
    public readonly errorCode: TerminologyEngineErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "TerminologyEngineError";
  }
}

// ─── Mock fixture (sample data — ENGINE 연결 전까지 사용) ─────────────────────

const MOCK_TERMS: TermDetail[] = [
  {
    term_id: "TERM-000001",
    canonical_name_ko: "스트림라인",
    canonical_name_en: "Streamline",
    aliases: ["유선형 자세", "스트림"],
    summary: "물속에서 저항을 최소화하기 위해 팔을 머리 위로 뻗고 몸을 일직선으로 유지하는 기본 자세.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "벽을 차고 나온 후 " },
          { text: "글라이드", link: { term_id: "TERM-000002" } },
          { text: " 구간에서 취하는 자세입니다. 팔을 귀 뒤로 붙이고, 손을 포개어 머리 위로 뻗습니다. 복부에 힘을 주어 " },
          { text: "코어", link: { term_id: "TERM-000010" } },
          { text: "를 잡아야 효과적입니다." },
        ],
      },
      {
        type: "why_it_matters",
        label: "왜 중요한가",
        segments: [
          { text: "수영에서 가장 큰 저항은 물의 정면 저항입니다. 스트림라인 자세를 잘 유지하면 " },
          { text: "턴", link: { term_id: "TERM-000005" } },
          { text: " 직후 최대 추진력을 보존할 수 있습니다." },
        ],
      },
      {
        type: "how_it_is_used",
        label: "수업·훈련에서는",
        segments: [
          { text: "출발 스타트, 턴 후 잠영, 메들리 전환 구간 등에서 반복 훈련합니다. 초보자는 벽 잡고 자세 교정부터 시작합니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000002", canonical_name_ko: "글라이드" },
      { term_id: "TERM-000005", canonical_name_ko: "턴" },
      { term_id: "TERM-000010", canonical_name_ko: "코어" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000002",
    canonical_name_ko: "글라이드",
    canonical_name_en: "Glide",
    aliases: [],
    summary: "출발·턴 후 킥과 팔 동작 없이 추진력만으로 미끄러지듯 나아가는 구간 또는 동작.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "글라이드 구간에서는 " },
          { text: "스트림라인", link: { term_id: "TERM-000001" } },
          { text: " 자세를 유지하며 최대한 저항을 줄입니다. 수면 아래 0.4~0.6m 깊이가 저항이 가장 적습니다." },
        ],
      },
      {
        type: "why_it_matters",
        label: "왜 중요한가",
        segments: [
          { text: "불필요한 킥이나 당김을 줄여 에너지를 아낄 수 있습니다. 유소년 선수에게 글라이드 타이밍 훈련은 " },
          { text: "페이스", link: { term_id: "TERM-000007" } },
          { text: " 조절 능력의 기초가 됩니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000001", canonical_name_ko: "스트림라인" },
      { term_id: "TERM-000007", canonical_name_ko: "페이스" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000003",
    canonical_name_ko: "돌핀킥",
    canonical_name_en: "Dolphin Kick",
    aliases: ["버터플라이킥", "웨이브킥"],
    summary: "양 다리를 모아 파도 모양으로 위아래로 움직이는 킥. 접영과 잠영에서 핵심 추진력.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "엉덩이→무릎→발목 순으로 힘이 전달되는 웨이브 동작입니다. " },
          { text: "스트림라인", link: { term_id: "TERM-000001" } },
          { text: " 상태에서 잠영 돌핀킥은 " },
          { text: "브레이크아웃", link: { term_id: "TERM-000004" } },
          { text: " 직전까지 사용됩니다." },
        ],
      },
      {
        type: "how_it_is_used",
        label: "수업·훈련에서는",
        segments: [
          { text: "접영 전용 킥이라고 오해하기 쉽지만, 자유형·배영 출발 후 잠영 구간에서도 사용합니다. 15m 잠영킥 드릴이 대표적입니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000001", canonical_name_ko: "스트림라인" },
      { term_id: "TERM-000004", canonical_name_ko: "브레이크아웃" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000004",
    canonical_name_ko: "브레이크아웃",
    canonical_name_en: "Breakout",
    aliases: ["수면 복귀"],
    summary: "잠영 구간을 마치고 수면 위로 올라와 첫 스트로크를 시작하는 동작.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "출발 또는 " },
          { text: "턴", link: { term_id: "TERM-000005" } },
          { text: " 후 " },
          { text: "돌핀킥", link: { term_id: "TERM-000003" } },
          { text: "으로 수면에 가까워지면 첫 팔 동작으로 자연스럽게 수면 위로 나옵니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000003", canonical_name_ko: "돌핀킥" },
      { term_id: "TERM-000005", canonical_name_ko: "턴" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000005",
    canonical_name_ko: "턴",
    canonical_name_en: "Turn",
    aliases: ["반환점"],
    summary: "레인 끝 벽에서 방향을 전환하는 기술. 종목에 따라 플립턴, 터치턴 등이 있음.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "자유형·배영 = 플립턴, 평영·접영 = 터치턴(양손 동시 터치 필수). 턴 후 " },
          { text: "스트림라인", link: { term_id: "TERM-000001" } },
          { text: " → " },
          { text: "글라이드", link: { term_id: "TERM-000002" } },
          { text: " → " },
          { text: "브레이크아웃", link: { term_id: "TERM-000004" } },
          { text: " 순서로 이어집니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000001", canonical_name_ko: "스트림라인" },
      { term_id: "TERM-000002", canonical_name_ko: "글라이드" },
      { term_id: "TERM-000004", canonical_name_ko: "브레이크아웃" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000006",
    canonical_name_ko: "스트로크",
    canonical_name_en: "Stroke",
    aliases: ["팔 동작"],
    summary: "팔로 물을 밀어 앞으로 나아가는 주요 추진 동작. 수영 4대 종목(자유형·배영·평영·접영) 각각 다름.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "일반적으로 입수(Entry)→캐치(Catch)→풀(Pull)→피니시(Finish)→리커버리(Recovery) 5단계로 분류합니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000008", canonical_name_ko: "킥" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000007",
    canonical_name_ko: "페이스",
    canonical_name_en: "Pace",
    aliases: ["배분", "페이싱"],
    summary: "레이스 또는 훈련 중 속도를 어떻게 배분하는지. 일정한 속도 유지가 기본.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "전반 무리 → 후반 급격한 감속이 발생하는 것을 '페이스 아웃'이라 합니다. " },
          { text: "스플릿", link: { term_id: "TERM-000012" } },
          { text: " 타임을 기록하여 페이스를 분석합니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000012", canonical_name_ko: "스플릿" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000008",
    canonical_name_ko: "킥",
    canonical_name_en: "Kick",
    aliases: ["발 동작"],
    summary: "다리를 사용해 추진력을 만드는 동작. 종목별로 2비트·4비트·6비트 킥 등이 있음.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "자유형에서 6비트 킥(팔 사이클 1회에 발 킥 6번)이 가장 빠르나 에너지 소모가 큽니다. 장거리는 2비트 킥으로 에너지를 아낍니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
      { term_id: "TERM-000003", canonical_name_ko: "돌핀킥" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000009",
    canonical_name_ko: "드릴",
    canonical_name_en: "Drill",
    aliases: ["분리 훈련"],
    summary: "특정 기술 요소만 집중 연습하는 훈련 방법. 팔 동작·킥 동작을 분리하거나 변형해서 반복.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "예: 한팔 수영, 핑거팁 드래그, " },
          { text: "돌핀킥", link: { term_id: "TERM-000003" } },
          { text: " 잠영 15m 등. 드릴은 기술 체화를 목적으로 하며, 속도보다 정확성에 집중합니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000003", canonical_name_ko: "돌핀킥" },
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000010",
    canonical_name_ko: "코어",
    canonical_name_en: "Core",
    aliases: ["중심근육"],
    summary: "복부·허리·골반 주변 근육군. 수영에서 몸통 안정성과 회전의 기반.",
    sections: [
      {
        type: "why_it_matters",
        label: "왜 중요한가",
        segments: [
          { text: "코어가 약하면 " },
          { text: "스트림라인", link: { term_id: "TERM-000001" } },
          { text: " 자세가 무너지고 저항이 증가합니다. 효율적인 " },
          { text: "스트로크", link: { term_id: "TERM-000006" } },
          { text: "와 " },
          { text: "킥", link: { term_id: "TERM-000008" } },
          { text: "의 연결도 코어 안정성에 달려 있습니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000001", canonical_name_ko: "스트림라인" },
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000011",
    canonical_name_ko: "개인혼영",
    canonical_name_en: "Individual Medley (IM)",
    aliases: ["IM", "개혼"],
    summary: "한 선수가 접영→배영→평영→자유형 순서로 4가지 종목을 연속 수영하는 경기.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "100m IM = 각 25m, 200m IM = 각 50m, 400m IM = 각 100m. " },
          { text: "메들리", link: { term_id: "TERM-000013" } },
          { text: " 릴레이와 달리 한 명이 전 종목을 수영합니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000013", canonical_name_ko: "메들리" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000012",
    canonical_name_ko: "스플릿",
    canonical_name_en: "Split",
    aliases: ["구간 기록"],
    summary: "레이스를 구간별로 나누어 측정한 시간. 50m 단위 또는 턴마다 기록.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "전반과 후반 스플릿을 비교하여 " },
          { text: "페이스", link: { term_id: "TERM-000007" } },
          { text: " 전략을 분석합니다. 네거티브 스플릿 = 후반이 더 빠름(이상적)." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000007", canonical_name_ko: "페이스" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000013",
    canonical_name_ko: "메들리",
    canonical_name_en: "Medley",
    aliases: ["혼영"],
    summary: "접영·배영·평영·자유형을 조합하는 경기 방식. 개인혼영과 메들리 릴레이가 있음.",
    sections: [],
    related_terms: [
      { term_id: "TERM-000011", canonical_name_ko: "개인혼영" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000014",
    canonical_name_ko: "플립턴",
    canonical_name_en: "Flip Turn",
    aliases: ["텀블턴", "앞구르기 턴"],
    summary: "자유형·배영에서 사용하는 빠른 반전 기술. 벽에 발로 차며 회전.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "약 1.5m 앞에서 앞구르기하듯 회전하여 두 발로 벽을 차고 " },
          { text: "스트림라인", link: { term_id: "TERM-000001" } },
          { text: "으로 이어집니다. 배영은 플립턴 전 한 팔을 당기는 변형 동작이 추가됩니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000001", canonical_name_ko: "스트림라인" },
      { term_id: "TERM-000005", canonical_name_ko: "턴" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000015",
    canonical_name_ko: "터치턴",
    canonical_name_en: "Touch Turn",
    aliases: ["오픈턴"],
    summary: "평영·접영에서 양손을 동시에 벽에 터치한 후 몸을 돌려 차는 기술.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "규정상 양손이 동시에 터치해야 하며, 한 손만 닿으면 실격 처리됩니다. " },
          { text: "플립턴", link: { term_id: "TERM-000014" } },
          { text: "보다 느리지만 평영·접영 규정상 이 방식만 허용됩니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000005", canonical_name_ko: "턴" },
      { term_id: "TERM-000014", canonical_name_ko: "플립턴" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000016",
    canonical_name_ko: "입수",
    canonical_name_en: "Entry",
    aliases: ["엔트리"],
    summary: "손·발 또는 몸이 수면에 들어가는 동작. 스트로크 사이클의 첫 단계.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "자유형 입수 시 팔꿈치가 손보다 높아야 하며, 검지 또는 새끼손가락 쪽으로 수면에 진입합니다. 입수 각도가 " },
          { text: "스트로크", link: { term_id: "TERM-000006" } },
          { text: " 효율에 직결됩니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000017",
    canonical_name_ko: "캐치",
    canonical_name_en: "Catch",
    aliases: ["얼리버티컬포어암", "EVF"],
    summary: "팔이 입수 후 물을 잡는 단계. 전완부를 수직으로 세워 최대 수압을 확보.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "고효율 수영의 핵심. '얼리 버티컬 포어암(EVF)'은 손목부터 팔꿈치까지를 빠르게 수직으로 세워 " },
          { text: "풀", link: { term_id: "TERM-000018" } },
          { text: " 단계로 연결하는 기술입니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
      { term_id: "TERM-000018", canonical_name_ko: "풀" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000018",
    canonical_name_ko: "풀",
    canonical_name_en: "Pull",
    aliases: ["당김"],
    summary: "캐치 후 팔로 물을 몸 뒤쪽으로 밀어내는 추진 단계. 스트로크의 핵심 추진력 생성 구간.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "" },
          { text: "캐치", link: { term_id: "TERM-000017" } },
          { text: " 후 허리 라인까지 일직선으로 당기는 것이 기본입니다. S자 풀은 현대 수영에서는 권장하지 않으며, 직선에 가까운 당김이 효율적입니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000017", canonical_name_ko: "캐치" },
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000019",
    canonical_name_ko: "피치",
    canonical_name_en: "Stroke Rate / Pitch",
    aliases: ["스트로크 레이트", "팔 회전수"],
    summary: "단위 시간당 팔 동작(스트로크) 횟수. 속도 = 스트로크 길이 × 피치.",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "" },
          { text: "페이스", link: { term_id: "TERM-000007" } },
          { text: " 조절 시 피치와 " },
          { text: "스트로크", link: { term_id: "TERM-000006" } },
          { text: " 길이의 균형이 중요합니다. 피치만 높이면 쉽게 지칩니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000007", canonical_name_ko: "페이스" },
      { term_id: "TERM-000006", canonical_name_ko: "스트로크" },
    ],
    terminology_version: "mock-v1",
  },
  {
    term_id: "TERM-000020",
    canonical_name_ko: "잠영",
    canonical_name_en: "Underwater Swimming",
    aliases: ["언더워터"],
    summary: "수면 아래를 이동하는 구간. 출발·턴 후 최대 15m까지 허용(규정).",
    sections: [
      {
        type: "detail",
        label: "자세히 알아보기",
        segments: [
          { text: "규정상 출발 또는 " },
          { text: "턴", link: { term_id: "TERM-000005" } },
          { text: " 후 15m 내에 머리가 수면 위로 나와야 합니다. " },
          { text: "돌핀킥", link: { term_id: "TERM-000003" } },
          { text: "으로 이동하며 " },
          { text: "스트림라인", link: { term_id: "TERM-000001" } },
          { text: " 자세를 유지합니다." },
        ],
      },
    ],
    related_terms: [
      { term_id: "TERM-000003", canonical_name_ko: "돌핀킥" },
      { term_id: "TERM-000005", canonical_name_ko: "턴" },
      { term_id: "TERM-000001", canonical_name_ko: "스트림라인" },
    ],
    terminology_version: "mock-v1",
  },
];

// Build a search-friendly index from mock terms
const MOCK_SEARCH_INDEX: TermSearchResult[] = MOCK_TERMS.map((t) => ({
  term_id: t.term_id,
  canonical_name_ko: t.canonical_name_ko,
  canonical_name_en: t.canonical_name_en,
  aliases: t.aliases,
  summary: t.summary,
}));

function mockSearch(query: string, limit: number): TermSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = MOCK_SEARCH_INDEX.map((t) => {
    let score = 0;
    if (t.canonical_name_ko.toLowerCase().includes(q)) score += 10;
    if (t.canonical_name_en.toLowerCase().includes(q)) score += 8;
    if (t.aliases.some((a) => a.toLowerCase().includes(q))) score += 6;
    if (t.summary.toLowerCase().includes(q)) score += 2;
    return { t, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
  return scored;
}

function mockDetail(termId: string): TermDetail | null {
  return MOCK_TERMS.find((t) => t.term_id === termId) ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEngineSecret(): string {
  return (process.env["PROFESSIONAL_ENGINE_API_SECRET"] ?? "").trim();
}

const TERM_TIMEOUT_MS = 15_000;

async function engineFetch(path: string): Promise<Response> {
  const baseUrl = getProfessionalEngineBaseUrl();
  const url = `${baseUrl.replace(/\/$/, "")}/api/terminology${path}`;

  // Retry once on 502 (Render cold-start) with 5s backoff
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TERM_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${getEngineSecret()}`,
          "Content-Type": "application/json",
        },
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.status === 502 && attempt < 2) {
        console.warn(`[terminology] ENGINE 502 on attempt ${attempt}, retrying in 5s...`);
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
  // unreachable — TypeScript needs explicit return
  throw new TerminologyEngineError("ENGINE_UNAVAILABLE", 503, "engineFetch exhausted retries");
}

// ─── Engine ping (diagnostic) ─────────────────────────────────────────────────

/**
 * Lightweight ENGINE health check from Gateway's network perspective.
 * Used by /terminology/status to expose actual ENGINE HTTP status.
 * Never throws — always returns a status object.
 */
export async function pingEngine(): Promise<{ status: number; error?: string }> {
  const baseUrl = getProfessionalEngineBaseUrl();
  if (!baseUrl) return { status: 0, error: "ENGINE_URL_NOT_CONFIGURED" };
  const url = `${baseUrl.replace(/\/$/, "")}/api/terminology/status`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${getEngineSecret()}` },
      signal: ac.signal,
    });
    clearTimeout(timer);
    return { status: res.status };
  } catch (err: any) {
    clearTimeout(timer);
    return { status: 0, error: err?.name === "AbortError" ? "TIMEOUT" : String(err?.message ?? err) };
  }
}

// ─── Mock gate ────────────────────────────────────────────────────────────────

/**
 * Mock mode is allowed ONLY when:
 *   1. TERMINOLOGY_USE_MOCK=true is explicitly set, AND
 *   2. NODE_ENV !== "production"
 *
 * "URL 없으니 자동 mock" 방식은 허용하지 않는다.
 * Production에서는 mock flag가 설정되어 있어도 차단한다.
 */
function isMockAllowed(): boolean {
  const flag = (process.env["TERMINOLOGY_USE_MOCK"] ?? "").trim().toLowerCase();
  if (flag !== "true") return false;
  if (process.env["NODE_ENV"] === "production") return false;
  return true;
}

/** Whether the client is currently operating in mock mode. */
export function isTerminologyMockMode(): boolean {
  return isMockAllowed();
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Search terminology.
 *
 * Mock mode: explicit TERMINOLOGY_USE_MOCK=true + non-production only.
 * Production without ENGINE URL → ENGINE_URL_NOT_CONFIGURED error (never mock).
 */
export async function searchTerminology(
  query: string,
  limit = 30,
): Promise<TermSearchResponse> {
  // MOCK PATH — explicit + non-production only
  if (isMockAllowed()) {
    const results = mockSearch(query, limit);
    return { results, terminology_version: "mock-v1", total: results.length };
  }

  // LIVE PATH — ENGINE URL required
  const baseUrl = getProfessionalEngineBaseUrl();
  if (!baseUrl) {
    throw new TerminologyEngineError(
      "ENGINE_URL_NOT_CONFIGURED",
      503,
      "Terminology engine URL is not configured",
    );
  }

  let res: Response;
  try {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    res = await engineFetch(`/search?${qs}`);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new TerminologyEngineError(
        "ENGINE_TIMEOUT",
        504,
        "Terminology engine timed out",
      );
    }
    throw new TerminologyEngineError(
      "ENGINE_UNAVAILABLE",
      503,
      "Terminology engine unreachable",
    );
  }

  if (!res.ok) {
    throw new TerminologyEngineError(
      "ENGINE_UNAVAILABLE",
      res.status,
      `Engine returned ${res.status}`,
    );
  }

  return res.json() as Promise<TermSearchResponse>;
}

/**
 * Fetch term detail.
 * Returns null when ENGINE returns 404.
 *
 * Mock mode: explicit TERMINOLOGY_USE_MOCK=true + non-production only.
 * Production without ENGINE URL → ENGINE_URL_NOT_CONFIGURED error (never mock).
 */
export async function getTermDetail(termId: string): Promise<TermDetail | null> {
  // MOCK PATH — explicit + non-production only
  if (isMockAllowed()) {
    return mockDetail(termId);
  }

  // LIVE PATH — ENGINE URL required
  const baseUrl = getProfessionalEngineBaseUrl();
  if (!baseUrl) {
    throw new TerminologyEngineError(
      "ENGINE_URL_NOT_CONFIGURED",
      503,
      "Terminology engine URL is not configured",
    );
  }

  let res: Response;
  try {
    res = await engineFetch(`/terms/${encodeURIComponent(termId)}`);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new TerminologyEngineError(
        "ENGINE_TIMEOUT",
        504,
        "Terminology engine timed out",
      );
    }
    throw new TerminologyEngineError(
      "ENGINE_UNAVAILABLE",
      503,
      "Terminology engine unreachable",
    );
  }

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new TerminologyEngineError(
      "ENGINE_UNAVAILABLE",
      res.status,
      `Engine returned ${res.status}`,
    );
  }

  return res.json() as Promise<TermDetail>;
}
