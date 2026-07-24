export interface MisconceptionClaim {
  id: string;
  core_claim: string;
  original_expression?: string;
  stroke?: string;
  technique?: string;
  claim_type: string;
  status: string;
  priority: string;
  confidence_score: number;
  repeat_count: number;
  review_needed: boolean;
  admin_memo?: string;
  tags?: string;
  sources_json?: any;
  verification_memo?: string;
  swimnote_position?: any;
  diagnosis_json?: any;
  dta_json?: any;
  final_verdict?: string;
  knowledge_db_synced?: boolean;
  created_at?: string;
  updated_at?: string;
}

export const SAMPLE_CLAIMS: MisconceptionClaim[] = [
  {
    id: "mc_seed_001",
    core_claim: "접영은 큰 웨이브를 만들어야 한다",
    original_expression: "접영할 때 몸을 크게 물결치듯 흔들어야 빠르게 수영할 수 있다",
    stroke: "butterfly", technique: "body_wave",
    claim_type: "MISCONCEPTION", status: "review_required",
    priority: "high", confidence_score: 85, repeat_count: 12, review_needed: true,
    admin_memo: "코칭 현장에서 매우 자주 등장하는 오개념. DTA Direction 손실 직결.",
    tags: "접영,웨이브,DTA,Direction",
    dta_json: { direction: "FAIL", timing: "CONDITIONAL", advance: "FAIL" },
    swimnote_position: { official_stance: "큰 웨이브는 Direction 손실을 유발한다. 엉덩이 주도의 작고 효율적인 킥이 핵심이다.", forbidden_expression: "몸 전체를 크게 흔들어라" },
    diagnosis_json: { expected_errors: ["상하 진폭 과다", "머리 복귀 지연", "킥 타이밍 분리"], corrections: ["웨이브 진폭 최소화", "머리 선행 복귀", "입수-킥 타이밍 연결"] },
    created_at: "2026-07-01T09:00:00Z",
  },
  {
    id: "mc_seed_002",
    core_claim: "자유형은 팔로 물을 세게 밀수록 빨라진다",
    original_expression: "자유형 속도는 팔 힘에 달려 있다",
    stroke: "freestyle", technique: "pull",
    claim_type: "CAUSALITY_ERROR", status: "review_required",
    priority: "high", confidence_score: 90, repeat_count: 23, review_needed: true,
    admin_memo: "인과관계 오류. 추진력은 캐치 각도와 타이밍에 달려 있음.",
    tags: "자유형,팔동작,DTA,캐치",
    dta_json: { direction: "FAIL", timing: "CONDITIONAL", advance: "CONDITIONAL" },
    swimnote_position: { official_stance: "추진력은 힘이 아닌 캐치 각도와 타이밍에서 발생한다.", forbidden_expression: "팔로 물을 강하게 밀어라" },
    diagnosis_json: { expected_errors: ["팔꿈치 드롭", "푸시 과장", "스트로크 불균형"], corrections: ["하이엘보 캐치", "팔꿈치 선행", "균형 잡힌 스트로크"] },
    created_at: "2026-07-02T10:00:00Z",
  },
  {
    id: "mc_seed_003",
    core_claim: "캐치는 물을 움켜쥐는 동작이다",
    original_expression: "캐치 동작은 물을 손으로 꽉 잡는 것",
    stroke: "freestyle", technique: "catch",
    claim_type: "TERMINOLOGY_ONLY", status: "conditional",
    priority: "medium", confidence_score: 65, repeat_count: 8, review_needed: false,
    admin_memo: "용어의 비유적 표현이 잘못된 기술 이해로 이어질 수 있음.",
    tags: "캐치,용어,자유형",
    swimnote_position: { official_stance: "캐치는 물을 잡는 자세(각도)를 만드는 것이지 힘으로 쥐는 동작이 아니다." },
    diagnosis_json: { expected_errors: ["손가락 과긴장", "팔꿈치 드롭", "캐치 타이밍 이른 풀링"] },
    created_at: "2026-07-03T11:00:00Z",
  },
  {
    id: "mc_seed_004",
    core_claim: "평영킥은 무릎을 최대한 벌려야 한다",
    original_expression: "평영 발차기는 양 무릎을 넓게 벌릴수록 추진력이 커진다",
    stroke: "breaststroke", technique: "kick",
    claim_type: "PHYSICS_CONFLICT", status: "rejected",
    priority: "high", confidence_score: 92, repeat_count: 17, review_needed: false,
    admin_memo: "물리적 충돌 확인. 무릎 과도한 외전은 저항 증가와 부상 위험.",
    tags: "평영,킥,저항,무릎",
    final_verdict: "REJECTED",
    dta_json: { direction: "FAIL", timing: "CONDITIONAL", advance: "FAIL" },
    swimnote_position: { official_stance: "무릎 너비는 어깨 너비 내외가 적절하다. 과도한 외전은 저항 증가와 부상을 유발한다.", forbidden_expression: "무릎을 최대한 벌려라" },
    created_at: "2026-07-04T09:30:00Z",
  },
  {
    id: "mc_seed_005",
    core_claim: "배영은 머리를 들면 물이 덜 들어온다",
    original_expression: "배영 시 귀에 물이 들어가면 머리를 더 들어올려야 한다",
    stroke: "backstroke", technique: "head_position",
    claim_type: "MISCONCEPTION", status: "review_required",
    priority: "medium", confidence_score: 78, repeat_count: 5, review_needed: true,
    admin_memo: "초보자에게 자주 등장. 머리를 들면 오히려 엉덩이 침하 발생.",
    tags: "배영,머리자세,DTA",
    dta_json: { direction: "FAIL", timing: "FAIL", advance: "FAIL" },
    swimnote_position: { official_stance: "배영에서 머리를 들면 엉덩이가 침하되어 저항이 급증한다. 귀가 수면에 닿는 자세가 올바르다." },
    created_at: "2026-07-05T10:00:00Z",
  },
  {
    id: "mc_seed_006",
    core_claim: "호흡할 때 머리를 높이 들수록 공기를 많이 마신다",
    original_expression: "숨을 많이 쉬려면 머리를 높이 들어야 한다",
    stroke: "freestyle", technique: "breathing",
    claim_type: "OVERGENERALIZATION", status: "review_required",
    priority: "high", confidence_score: 88, repeat_count: 19, review_needed: true,
    admin_memo: "매우 흔한 오개념. 호흡 효율은 타이밍이지 머리 높이가 아님.",
    tags: "호흡,자유형,머리자세,타이밍",
    dta_json: { direction: "FAIL", timing: "FAIL", advance: "FAIL" },
    swimnote_position: { official_stance: "머리는 몸 회전과 함께 낮게 돌리며 호흡한다." },
    created_at: "2026-07-06T08:00:00Z",
  },
  {
    id: "mc_seed_007",
    core_claim: "스트로크 수가 적을수록 무조건 효율적이다",
    original_expression: "25m를 적은 스트로크로 완성할수록 잘하는 것이다",
    stroke: "freestyle", technique: "stroke_rate",
    claim_type: "OVERGENERALIZATION", status: "conditional",
    priority: "medium", confidence_score: 72, repeat_count: 11, review_needed: false,
    admin_memo: "선수 레벨에서는 스트로크 수와 속도의 균형이 핵심. 단순화된 주장.",
    tags: "스트로크,효율,속도",
    swimnote_position: { official_stance: "효율은 스트로크 수와 속도의 곱(SWOLF)으로 평가해야 한다.", conditional: "초보자 학습 목적으로는 제한적으로 활용 가능" },
    created_at: "2026-07-07T09:00:00Z",
  },
  {
    id: "mc_seed_008",
    core_claim: "입수킥과 출수킥은 국제 공식 기술용어다",
    original_expression: "접영의 입수킥, 출수킥은 FINA 공인 기술 용어다",
    stroke: "butterfly", technique: "kick_terminology",
    claim_type: "LOCAL_TERM", status: "verified",
    priority: "low", confidence_score: 95, repeat_count: 4, review_needed: false,
    admin_memo: "한국 코칭 현장 용어. 국제 표준 용어는 downbeat/upbeat kick.",
    final_verdict: "VERIFIED",
    tags: "접영,킥,용어,한국",
    swimnote_position: { official_stance: "입수킥·출수킥은 한국 현장 용어이며 국제 공식 용어가 아니다. 국제 표준: downbeat kick, upbeat kick." },
    created_at: "2026-07-08T10:00:00Z",
  },
  {
    id: "mc_seed_009",
    core_claim: "어린이는 무조건 발차기부터 많이 시켜야 한다",
    original_expression: "수영 입문 시 발차기를 충분히 익혀야 다른 것을 배울 수 있다",
    stroke: "general", technique: "pedagogy",
    claim_type: "COACHING_FOLKLORE", status: "review_required",
    priority: "medium", confidence_score: 60, repeat_count: 7, review_needed: true,
    admin_memo: "지도법 민속학. 통합 접근이 더 효과적이라는 근거 존재.",
    tags: "어린이,지도법,발차기",
    swimnote_position: { official_stance: "물 적응, 발차기, 호흡, 팔 동작을 병행하는 통합 지도법이 발달단계상 더 효과적이다." },
    created_at: "2026-07-09T11:00:00Z",
  },
  {
    id: "mc_seed_010",
    core_claim: "선수 자세를 그대로 따라 하면 가장 빠르게 배운다",
    original_expression: "올림픽 선수 영상을 보고 따라 하면 된다",
    stroke: "general", technique: "pedagogy",
    claim_type: "DRILL_CONFUSION", status: "review_required",
    priority: "medium", confidence_score: 75, repeat_count: 6, review_needed: true,
    admin_memo: "선수 자세는 고도의 신체 조건과 훈련량을 전제함.",
    tags: "지도법,선수,따라하기",
    swimnote_position: { official_stance: "선수 자세는 해당 선수의 신체·기술 수준에 최적화되어 있다. 학습자의 발달 단계에 맞는 단계별 지도가 필요하다." },
    created_at: "2026-07-10T09:00:00Z",
  },
  {
    id: "mc_seed_011",
    core_claim: "물을 오래 미는 것이 항상 좋다",
    original_expression: "팔로 물을 최대한 오래 끝까지 밀어야 한다",
    stroke: "freestyle", technique: "pull",
    claim_type: "OVERGENERALIZATION", status: "new",
    priority: "medium", confidence_score: 68, repeat_count: 3, review_needed: false,
    admin_memo: "Early vertical forearm 연구와 충돌할 수 있는 주장.",
    tags: "자유형,팔동작,푸시",
    created_at: "2026-07-11T08:00:00Z",
  },
  {
    id: "mc_seed_012",
    core_claim: "접영의 핵심은 머리부터 발끝까지 파동을 전달하는 것이다",
    original_expression: "접영은 머리에서 시작된 파동이 발끝까지 전해지는 영법이다",
    stroke: "butterfly", technique: "body_wave",
    claim_type: "EXAGGERATED_CUE", status: "new",
    priority: "medium", confidence_score: 55, repeat_count: 2, review_needed: false,
    admin_memo: "머리 주도 파동 개념은 DTA와 충돌. 엉덩이 주도 킥이 올바른 메커니즘.",
    tags: "접영,파동,DTA,머리",
    created_at: "2026-07-12T09:00:00Z",
  },
];

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  UNSUPPORTED_CLAIM: "근거 없는 주장",
  MISCONCEPTION: "오개념",
  MYTH: "미신",
  TERMINOLOGY_ONLY: "용어 혼용",
  OVERGENERALIZATION: "과일반화",
  CAUSALITY_ERROR: "인과 오류",
  PHYSICS_CONFLICT: "물리법칙 충돌",
  DTA_CONFLICT: "DTA 충돌",
  EXAGGERATED_CUE: "과장된 큐",
  DRILL_CONFUSION: "드릴 혼동",
  COACHING_FOLKLORE: "코칭 민속학",
  LOCAL_TERM: "지역 용어",
  FAILED_SOLUTION: "효과 없는 방법",
  HARMFUL_INSTRUCTION: "유해 지도법",
};

export const STROKE_LABELS: Record<string, string> = {
  freestyle: "자유형", backstroke: "배영", breaststroke: "평영",
  butterfly: "접영", general: "종합", start: "출발", turn: "턴",
  underwater: "수중", fitness: "체력훈련", pedagogy: "지도법", safety: "안전",
};

export const STATUS_KO: Record<string, string> = {
  new: "신규", review_required: "검토 필요", verified: "검증 완료",
  supported: "지지됨", conditional: "조건부", rejected: "반려",
  harmful: "위험", pending: "보류", disputed: "논쟁중",
  terminology_only: "용어만",
};
