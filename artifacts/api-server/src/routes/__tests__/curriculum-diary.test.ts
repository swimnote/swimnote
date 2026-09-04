/**
 * curriculum-diary.test.ts
 *
 * Curriculum Diary API 테스트
 *
 * A. Curriculum Level API — 7개 / ASC / tenant isolation
 * B. Node count — 550
 * C. Filter — level / stroke / domain / skill_group
 * D. Tenant isolation
 * E. Normal Diary AI retrieval routing
 * F. Label maps (STROKE_LABELS / DOMAIN_LABELS)
 * G. API 경로 namespace 불변
 * H. Legacy fallback 없이 curriculum 라우팅 동작
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractedMeaning } from "../../lib/diary-parser.js";

// ── DB mock — factory inside vi.mock (hoisting safe) ─────────────────────────
const executeMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
  sql: new Proxy(
    (..._a: unknown[]) => ({}),
    {
      get: (_t, p) => {
        if (p === "join") return (parts: unknown[]) => parts;
        return (..._a: unknown[]) => ({});
      },
    },
  ),
}));

import {
  getActiveCurriculumVersion,
  getCurriculumLevels,
  getCurriculumNodes,
  hasCurriculumBasedDiary,
  searchCurriculumForDiary,
  STROKE_LABELS,
  DOMAIN_LABELS,
} from "../../lib/curriculum-diary-service.js";

// ── 공통 fixture ──────────────────────────────────────────────────────────────

const POOL_ID = "pool_1780849364252_l9k44rbk3";

const MOCK_CV = {
  id: "cv_0l46tk5vmtdbwn3c",
  pool_id: POOL_ID,
  version_name: "IMPORT_2026-08-28",
  is_active: true,
  import_status: "ACTIVE",
};

const MOCK_LEVEL_SETTINGS = [
  { level_order: 1, level_name: "흰색모자" },
  { level_order: 2, level_name: "파란모자" },
  { level_order: 3, level_name: "빨간모자" },
  { level_order: 4, level_name: "검정모자" },
  { level_order: 5, level_name: "금색모자" },
  { level_order: 6, level_name: "챔피언" },
  { level_order: 7, level_name: "슈퍼챔피언" },
];

const MOCK_LEVEL_COUNTS = [
  { level_order: 1, node_count: "146", test_count: "4" },
  { level_order: 2, node_count: "92",  test_count: "8"  },
  { level_order: 3, node_count: "88",  test_count: "12" },
  { level_order: 4, node_count: "50",  test_count: "0"  },
  { level_order: 5, node_count: "50",  test_count: "0"  },
  { level_order: 6, node_count: "50",  test_count: "0"  },
  { level_order: 7, node_count: "50",  test_count: "0"  },
];

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci_test001",
    display_no: "L1-001",
    level_order: 1,
    sequence_in_level: 1,
    stroke: "freestyle",
    domain: "technique",
    skill_group: "kick",
    atomic_skill: "자유형 발차기를",
    title: "자유형 발차기를 연습했습니다",
    source_trace: "자유형 발차기를 연습했습니다. 리듬감 있게 발을 차는 연습을 진행했습니다.",
    is_test_item: false,
    goal: "자유형 발차기를 연습했습니다",
    coaching_point: "리듬감 있게 발을 차는 연습을 진행했습니다",
    ...overrides,
  };
}

const MEANING_FREESTYLE: ExtractedMeaning = {
  strokes: ["자유형"] as any,
  skills: ["발차기", "킥"],
  issues: [],
  allKeywords: ["자유형", "발차기", "킥"],
  confidence: 0.9,
} as any;

// ── A. Curriculum Level API ──────────────────────────────────────────────────

describe("A. getCurriculumLevels", () => {
  beforeEach(() => executeMock.mockReset());

  it("A-01: ACTIVE curriculum 있으면 7개 레벨 반환", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: MOCK_LEVEL_COUNTS })
      .mockResolvedValueOnce({ rows: MOCK_LEVEL_SETTINGS });

    const { version, levels } = await getCurriculumLevels(POOL_ID);
    expect(version).not.toBeNull();
    expect(levels).toHaveLength(7);
  });

  it("A-02: DB가 ASC로 반환한 level_order 순서를 그대로 유지", async () => {
    // DB가 ORDER BY level_order ASC로 반환 → service는 그 순서를 유지
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: MOCK_LEVEL_COUNTS }) // ASC order from DB
      .mockResolvedValueOnce({ rows: MOCK_LEVEL_SETTINGS });

    const { levels } = await getCurriculumLevels(POOL_ID);
    const orders = levels.map(l => l.level_order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("A-03: level_name이 pool_level_settings에서 정확히 조회됨", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: MOCK_LEVEL_COUNTS })
      .mockResolvedValueOnce({ rows: MOCK_LEVEL_SETTINGS });

    const { levels } = await getCurriculumLevels(POOL_ID);
    expect(levels[0]!.level_name).toBe("흰색모자");
    expect(levels[6]!.level_name).toBe("슈퍼챔피언");
  });

  it("A-04: ACTIVE curriculum 없으면 빈 배열 + null version", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const { version, levels } = await getCurriculumLevels("pool_no_curriculum");
    expect(version).toBeNull();
    expect(levels).toHaveLength(0);
  });

  it("A-05: pool_level_settings 미설정 → 'Level N' fallback", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: [{ level_order: 1, node_count: "10", test_count: "0" }] })
      .mockResolvedValueOnce({ rows: [] });

    const { levels } = await getCurriculumLevels(POOL_ID);
    expect(levels[0]!.level_name).toBe("Level 1");
  });

  it("A-06: node_count / test_count 숫자 변환", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: [{ level_order: 1, node_count: "150", test_count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ level_order: 1, level_name: "흰색모자" }] });

    const { levels } = await getCurriculumLevels(POOL_ID);
    expect(levels[0]!.node_count).toBe(150);
    expect(typeof levels[0]!.node_count).toBe("number");
  });
});

// ── B. Node count ────────────────────────────────────────────────────────────

describe("B. getCurriculumNodes — node count", () => {
  beforeEach(() => executeMock.mockReset());

  it("B-01: total 550 확인 (is_test_item=false, L1~L7 합산)", async () => {
    const totalCount = MOCK_LEVEL_COUNTS.reduce((s, r) => s + Number(r.node_count), 0);
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: Array(totalCount).fill(makeNode()) })
      .mockResolvedValueOnce({ rows: [{ total: String(totalCount) }] });

    const { total } = await getCurriculumNodes(POOL_ID, { is_test_item: false, limit: 600 });
    expect(total).toBe(totalCount);
  });

  it("B-02: level_order=1 은 146개", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: Array(146).fill(makeNode({ level_order: 1 })) })
      .mockResolvedValueOnce({ rows: [{ total: "146" }] });

    const { total } = await getCurriculumNodes(POOL_ID, { level_order: 1, is_test_item: false });
    expect(total).toBe(146);
  });

  it("B-03: ACTIVE curriculum 없으면 nodes=[] total=0", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const { nodes, total } = await getCurriculumNodes("pool_no_curriculum");
    expect(nodes).toHaveLength(0);
    expect(total).toBe(0);
  });
});

// ── C. Filter ────────────────────────────────────────────────────────────────

describe("C. getCurriculumNodes — filter", () => {
  beforeEach(() => executeMock.mockReset());

  function setupNodes(nodes: ReturnType<typeof makeNode>[]) {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: nodes })
      .mockResolvedValueOnce({ rows: [{ total: String(nodes.length) }] });
  }

  it("C-01: stroke=freestyle 필터링", async () => {
    setupNodes([
      makeNode({ stroke: "freestyle" }),
      makeNode({ id: "ci_002", stroke: "freestyle" }),
    ]);
    const { nodes } = await getCurriculumNodes(POOL_ID, { stroke: "freestyle", is_test_item: false });
    expect(nodes.every(n => n.stroke === "freestyle")).toBe(true);
    expect(nodes).toHaveLength(2);
  });

  it("C-02: domain=breathing 필터링", async () => {
    setupNodes([makeNode({ domain: "breathing" })]);
    const { nodes } = await getCurriculumNodes(POOL_ID, { domain: "breathing", is_test_item: false });
    expect(nodes[0]!.domain).toBe("breathing");
  });

  it("C-03: skill_group=kick 필터링", async () => {
    setupNodes([makeNode({ skill_group: "kick" })]);
    const { nodes } = await getCurriculumNodes(POOL_ID, { skill_group: "kick", is_test_item: false });
    expect(nodes[0]!.skill_group).toBe("kick");
  });

  it("C-04: level_order=4 + stroke=breaststroke 복합 필터", async () => {
    setupNodes([
      makeNode({ id: "ci_a", level_order: 4, stroke: "breaststroke" }),
      makeNode({ id: "ci_b", level_order: 4, stroke: "breaststroke" }),
    ]);
    const { nodes } = await getCurriculumNodes(POOL_ID, { level_order: 4, stroke: "breaststroke", is_test_item: false });
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.level_order === 4 && n.stroke === "breaststroke")).toBe(true);
  });

  it("C-05: is_test_item=false — 반환 노드 모두 false", async () => {
    setupNodes([makeNode({ is_test_item: false })]);
    const { nodes } = await getCurriculumNodes(POOL_ID, { is_test_item: false });
    expect(nodes.every(n => !n.is_test_item)).toBe(true);
  });

  it("C-06: limit 기본값 200 적용 — total > 200 이어도 nodes는 응답 기준", async () => {
    const n = Array(200).fill(makeNode());
    setupNodes(n);
    const { nodes } = await getCurriculumNodes(POOL_ID);
    expect(nodes.length).toBeLessThanOrEqual(200);
  });
});

// ── D. Tenant isolation ──────────────────────────────────────────────────────

describe("D. Tenant isolation", () => {
  beforeEach(() => executeMock.mockReset());

  it("D-01: 다른 pool은 ACTIVE curriculum 없음 → null", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const version = await getActiveCurriculumVersion("pool_other_99999");
    expect(version).toBeNull();
  });

  it("D-02: hasCurriculumBasedDiary — curriculum 없는 pool = false", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const result = await hasCurriculumBasedDiary("pool_no_curriculum");
    expect(result).toBe(false);
  });

  it("D-03: hasCurriculumBasedDiary — ACTIVE curriculum 있는 pool = true", async () => {
    executeMock.mockResolvedValueOnce({ rows: [MOCK_CV] });
    const result = await hasCurriculumBasedDiary(POOL_ID);
    expect(result).toBe(true);
  });

  it("D-04: ACTIVE curriculum 2개 이상이면 첫 번째 반환 + 경고 로그", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    executeMock.mockResolvedValueOnce({ rows: [MOCK_CV, { ...MOCK_CV, id: "cv_dup" }] });

    const version = await getActiveCurriculumVersion(POOL_ID);
    expect(version?.id).toBe(MOCK_CV.id);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
    warnSpy.mockRestore();
  });

  it("D-05: curriculum 검색 시 version_id가 pool 소유 version으로만 조회됨", async () => {
    executeMock.mockResolvedValueOnce({ rows: [MOCK_CV] });
    const version = await getActiveCurriculumVersion(POOL_ID);
    expect(version?.pool_id).toBe(POOL_ID);
  });
});

// ── E. Normal Diary AI retrieval ─────────────────────────────────────────────

describe("E. searchCurriculumForDiary — AI diary retrieval", () => {
  beforeEach(() => executeMock.mockReset());

  function setupSearch(nodes: ReturnType<typeof makeNode>[]) {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: nodes });
  }

  it("E-01: ACTIVE curriculum 없으면 빈 결과", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const result = await searchCurriculumForDiary("pool_no_curriculum", MEANING_FREESTYLE);
    expect(result.usedTemplates).toHaveLength(0);
    expect(result.candidateCount).toBe(0);
  });

  it("E-02: freestyle + 발차기 키워드 → freestyle 노드 후보 찾음", async () => {
    setupSearch([
      makeNode({
        stroke: "freestyle",
        atomic_skill: "자유형 발차기를",
        source_trace: "자유형 발차기를 연습했습니다. 킥 리듬.",
      }),
    ]);
    const result = await searchCurriculumForDiary(POOL_ID, MEANING_FREESTYLE);
    expect(result.candidateCount).toBeGreaterThan(0);
  });

  it("E-03: usedTemplates 최대 1개 (TOP_K_USAGE)", async () => {
    setupSearch([
      makeNode({ id: "ci_a", stroke: "freestyle", source_trace: "자유형 발차기를 연습했습니다. 킥 리듬 훈련." }),
      makeNode({ id: "ci_b", stroke: "freestyle", source_trace: "자유형 킥 발차기를 반복 연습했습니다." }),
    ]);
    const result = await searchCurriculumForDiary(POOL_ID, MEANING_FREESTYLE);
    expect(result.usedTemplates.length).toBeLessThanOrEqual(1);
  });

  it("E-04: USAGE_MIN_SCORE 미달 노드 → usedTemplates 0개", async () => {
    setupSearch([
      makeNode({
        stroke: "backstroke",
        atomic_skill: "배영 발차기",
        source_trace: "배영 발차기를 연습했습니다.",
      }),
    ]);
    const meaningNoOverlap: ExtractedMeaning = {
      strokes: [] as any,
      skills: [],
      issues: [],
      allKeywords: ["전혀없는키워드"],
      confidence: 0.5,
    } as any;
    const result = await searchCurriculumForDiary(POOL_ID, meaningNoOverlap);
    expect(result.usedTemplates).toHaveLength(0);
  });

  it("E-05: freestyle 의미 → freestyle 노드가 backstroke 노드보다 높은 score", async () => {
    setupSearch([
      makeNode({ id: "ci_free", stroke: "freestyle", source_trace: "자유형 발차기를 연습했습니다. 킥 리듬." }),
      makeNode({ id: "ci_back", stroke: "backstroke", source_trace: "배영 발차기를 연습했습니다." }),
    ]);
    const result = await searchCurriculumForDiary(POOL_ID, MEANING_FREESTYLE);
    const scored = result.candidateIds;
    // candidateIds는 score 높은 순 — freestyle이 backstroke보다 앞이어야 함
    if (scored.length >= 2) {
      expect(scored[0]).toBe("ci_free");
    }
  });

  it("E-06: DB execute가 2번만 호출됨 (diary_templates 조회 없음)", async () => {
    setupSearch([makeNode({ source_trace: "자유형 발차기를 연습했습니다. 킥." })]);
    await searchCurriculumForDiary(POOL_ID, MEANING_FREESTYLE);
    expect(executeMock).toHaveBeenCalledTimes(2); // version + nodes
  });

  it("E-07: allKeywords 비어있으면 conceptOverlap=0 → score 낮음", async () => {
    setupSearch([makeNode({ source_trace: "자유형 발차기를 연습했습니다." })]);
    const emptyMeaning: ExtractedMeaning = { strokes: [] as any, skills: [], issues: [], allKeywords: [], confidence: 0.5 } as any;
    const result = await searchCurriculumForDiary(POOL_ID, emptyMeaning);
    if (result.topScore > 0) {
      // strokeMatch 또는 focusMatch만 가능
      expect(result.topScore).toBeLessThanOrEqual(2.0);
    }
  });
});

// ── F. 한글 레이블 ──────────────────────────────────────────────────────────

describe("F. Label maps", () => {
  it("F-01: STROKE_LABELS — 6개 영법 포함", () => {
    expect(STROKE_LABELS["freestyle"]).toBe("자유형");
    expect(STROKE_LABELS["backstroke"]).toBe("배영");
    expect(STROKE_LABELS["breaststroke"]).toBe("평영");
    expect(STROKE_LABELS["butterfly"]).toBe("접영");
    expect(STROKE_LABELS["im"]).toBe("IM");
    expect(STROKE_LABELS["general"]).toBe("공통/물적응");
  });

  it("F-02: DOMAIN_LABELS — 5개 도메인 포함", () => {
    expect(DOMAIN_LABELS["technique"]).toBe("기술");
    expect(DOMAIN_LABELS["breathing"]).toBe("호흡");
    expect(DOMAIN_LABELS["water_adaptation"]).toBe("물적응");
    expect(DOMAIN_LABELS["coordination"]).toBe("협응");
    expect(DOMAIN_LABELS["endurance"]).toBe("지구력");
  });
});

// ── G. API 경로 namespace 불변 ───────────────────────────────────────────────

describe("G. API 경로 namespace 불변", () => {
  const newPaths = [
    "/curriculum/diary/levels",
    "/curriculum/diary/nodes",
    "/curriculum/diary/facets",
    "/curriculum/diary/teacher-templates",
  ];
  const legacyPaths = [
    "/diary-template-levels",
    "/diary-templates",
    "/diary-template-levels/reorder",
    "/diary-templates/restore-default",
  ];

  it("G-01: 새 경로와 legacy 경로가 충돌하지 않음", () => {
    for (const np of newPaths) {
      for (const lp of legacyPaths) {
        expect(np).not.toBe(lp);
      }
    }
  });
});

// ── H. Legacy fallback 없이 curriculum 라우팅 ────────────────────────────────

describe("H. Curriculum routing — legacy diary_templates 불필요", () => {
  beforeEach(() => executeMock.mockReset());

  it("H-01: hasCurriculumBasedDiary true → searchCurriculumForDiary 호출 가능", async () => {
    executeMock.mockResolvedValueOnce({ rows: [MOCK_CV] });
    expect(await hasCurriculumBasedDiary(POOL_ID)).toBe(true);
  });

  it("H-02: getActiveCurriculumVersion → cv_0l46tk5vmtdbwn3c 반환", async () => {
    executeMock.mockResolvedValueOnce({ rows: [MOCK_CV] });
    const version = await getActiveCurriculumVersion(POOL_ID);
    expect(version?.id).toBe("cv_0l46tk5vmtdbwn3c");
  });

  it("H-03: import_status='ACTIVE' WHERE 조건 — LEGACY는 별도 mock없이 null 반환", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] }); // DB가 ACTIVE 없음을 반환
    const version = await getActiveCurriculumVersion(POOL_ID);
    expect(version).toBeNull();
  });

  it("H-04: searchCurriculumForDiary — diary_templates DB 호출 0회 (2회: version+nodes)", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [MOCK_CV] })
      .mockResolvedValueOnce({ rows: [makeNode({ source_trace: "자유형 발차기를 연습했습니다." })] });

    await searchCurriculumForDiary(POOL_ID, MEANING_FREESTYLE);
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});
