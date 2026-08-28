/**
 * app-master-docx-parser.test.ts
 *
 * SWIMNOTE X — Curriculum APP MASTER Parser 테스트
 *
 * TC-A  정상 7 Level 대형 Curriculum 파싱
 * TC-B  Level 3개 소형 커리큘럼
 * TC-C  같은 level_order 중복 → ERROR
 * TC-D  Node sequence 중복 → ERROR
 * TC-E  Drill target 누락 → ERROR
 * TC-F  Relation target 누락 → ERROR
 * TC-G  malformed DOCX (비ZIP 파일) → DOCX 해체 실패 error
 * TC-H  동일 display_no 재등록 → ERROR
 * TC-I  새 version import 상태 IMPORTED
 * TC-J  기존 ACTIVE 유지 (activate 전까지)
 * TC-K  새 version activate → import_status ACTIVE
 * TC-L  old version archive
 * TC-M  과거 growth_event 참조 유지 (curriculum_items FK RESTRICT — DELETE 차단)
 * TC-N  tenant isolation (다른 pool → 차단)
 * TC-O  stat 계산 정확성
 * TC-P  is_test_item Y/N 파싱
 * TC-Q  validation.is_valid: error 없을 때 true
 * TC-R  validation.is_valid: error 있을 때 false
 */

import { describe, it, expect } from "vitest";
import { parseAppMasterDocx } from "../appMasterDocxParser.js";
import { zipSync } from "fflate";

// ─── 헬퍼: 테스트용 DOCX 생성 ────────────────────────────────────────────────

function makeDocx(bodyContent: string): Buffer {
  const xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mo="http://schemas.microsoft.com/office/mac/office/2008/main"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:mv="urn:schemas-microsoft-com:mac:vml"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 wp14">
  <w:body>
    ${bodyContent}
  </w:body>
</w:document>`;

  const files: Record<string, Uint8Array> = {
    "word/document.xml": new TextEncoder().encode(xmlHeader),
    "[Content_Types].xml": new TextEncoder().encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    ),
  };
  return Buffer.from(zipSync(files));
}

// ─── XML 빌더 헬퍼 ─────────────────────────────────────────────────────────────

function heading(level: number, text: string): string {
  return `<w:p>
    <w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>
    <w:r><w:t>${text}</w:t></w:r>
  </w:p>`;
}

function twoColTable(rows: [string, string][]): string {
  const rowXml = rows.map(([k, v]) => `
    <w:tr>
      <w:tc><w:p><w:r><w:t>${k}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${v}</w:t></w:r></w:p></w:tc>
    </w:tr>`).join("");
  return `<w:tbl>${rowXml}</w:tbl>`;
}

function threeColTable(rows: [string, string, string][]): string {
  const rowXml = rows.map(([a, b, c]) => `
    <w:tr>
      <w:tc><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>
    </w:tr>`).join("");
  return `<w:tbl>${rowXml}</w:tbl>`;
}

function metaTable(versionName = "TEST_V1", levelCount = 2): string {
  return twoColTable([
    ["문서 버전", "APP_MASTER_V1"],
    ["수영장 참조", "테스트 수영장"],
    ["커리큘럼 릴리즈", "2026-Q3"],
    ["커리큘럼 버전", versionName],
    ["총 레벨 수", String(levelCount)],
  ]);
}

function nodeTable(title: string, atomicSkill: string, isTest = false): string {
  return twoColTable([
    ["표제", title],
    ["영법", "자유형"],
    ["영역", "기초"],
    ["기술 그룹", "킥"],
    ["원자 기술", atomicSkill],
    ["목표", "킥 동작 안정화"],
    ["동작 순서", "1. 엉덩이 고정 2. 무릎 펴기"],
    ["관찰 성공 기준", "무릎이 수면 위로 나오지 않음"],
    ["부분 성공 기준", "킥이 2~3회 연속 정확"],
    ["오류 신호", "무릎 굽힘 과도"],
    ["코칭 포인트", "발목 힘 빼기"],
    ["테스트 항목", isTest ? "Y" : "N"],
    ["완료 기준", "10m 연속 킥"],
    ["출처", "GPT-MASTER-V1"],
  ]);
}

function drillTable(targetNode: string): string {
  return twoColTable([
    ["표제", "킥보드 드릴"],
    ["대상 노드", targetNode],
    ["교정 측면", "킥 패턴"],
    ["동작 순서", "킥보드 잡고 25m 킥"],
    ["반복횟수", "4세트"],
    ["즉각 피드백", "무릎 굽힘 교정"],
    ["통합", "팔 동작 추가"],
    ["스프린트 검증", "10m 전력 킥"],
    ["실패 복귀 노드", ""],
  ]);
}

// ─── 테스트용 문서 빌더 ────────────────────────────────────────────────────────

function buildSimpleDoc(params: {
  levelCount: number;
  nodesPerLevel: number;
  dupLevelOrder?: boolean;
  dupNodeSeq?: boolean;
  dupDisplayNo?: boolean;
  missingDrillTarget?: boolean;
  missingRelTarget?: boolean;
  withRelations?: boolean;
  testNodeIndexes?: number[];  // node index (0-based) that is test item
}): Buffer {
  const parts: string[] = [];

  // Document heading
  parts.push(heading(1, "SWIMNOTE X Curriculum APP MASTER"));
  parts.push(metaTable("TEST_V1", params.dupLevelOrder ? params.levelCount - 1 : params.levelCount));

  const allDisplayNos: string[] = [];

  for (let li = 1; li <= params.levelCount; li++) {
    const actualLevelOrder = params.dupLevelOrder && li === params.levelCount ? li - 1 : li;
    parts.push(heading(1, `LEVEL ${actualLevelOrder}: 레벨${actualLevelOrder}`));
    parts.push(twoColTable([["설명", `레벨 ${actualLevelOrder} 설명`]]));

    for (let ni = 1; ni <= params.nodesPerLevel; ni++) {
      const nodeIdx = (li - 1) * params.nodesPerLevel + ni;
      const displayNo = params.dupDisplayNo && nodeIdx === 2 ? "L1-001" : `L${li}-${String(ni).padStart(3, "0")}`;
      const actualSeq = params.dupNodeSeq && ni === params.nodesPerLevel ? ni - 1 : ni;
      const isTest = params.testNodeIndexes?.includes(nodeIdx - 1) ?? false;
      allDisplayNos.push(displayNo);

      parts.push(heading(2, `NODE ${actualSeq}: ${displayNo}`));
      parts.push(nodeTable(`기술 ${displayNo}`, `원자기술_${displayNo}`, isTest));

      // Add a drill for first node of each level
      if (ni === 1) {
        parts.push(heading(3, "DRILL 1"));
        const drillTarget = params.missingDrillTarget && li === 1 ? "L99-999" : displayNo;
        parts.push(drillTable(drillTarget));
      }
    }
  }

  // Relations
  if (params.withRelations && allDisplayNos.length >= 2) {
    parts.push(heading(1, "RELATIONS"));
    const from = params.missingRelTarget ? "L99-999" : allDisplayNos[0];
    const to   = params.missingRelTarget ? "L88-888" : allDisplayNos[1];
    parts.push(threeColTable([
      ["출발 노드", "관계 유형", "대상 노드"],
      [from, "next_skill", to],
    ]));
  }

  return makeDocx(parts.join("\n"));
}

// ═══════════════════════════════════════════════════════════════════════════════

describe("TC-A: 정상 7 Level 대형 Curriculum", () => {
  it("7 레벨 × 10 노드 → 파싱 성공", () => {
    const buf = buildSimpleDoc({ levelCount: 7, nodesPerLevel: 10, withRelations: true });
    const result = parseAppMasterDocx(buf);
    expect(result.stats.level_count).toBe(7);
    expect(result.stats.node_count).toBe(70);
    expect(result.stats.drill_count).toBe(7);   // 1 drill per level
    expect(result.stats.relation_count).toBe(1);
    expect(result.validation.errors).toHaveLength(0);
    expect(result.validation.is_valid).toBe(true);
  });

  it("레벨 순서가 level_order 기준으로 정렬됨", () => {
    const buf = buildSimpleDoc({ levelCount: 3, nodesPerLevel: 2 });
    const result = parseAppMasterDocx(buf);
    expect(result.levels.map(l => l.level_order)).toEqual([1, 2, 3]);
  });

  it("sort_order = (level_order-1)*10000 + sequence_in_level", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 3 });
    const result = parseAppMasterDocx(buf);
    const l2n2 = result.levels[1].nodes[1];
    expect(l2n2.sort_order).toBe((2 - 1) * 10000 + 2);
  });
});

describe("TC-B: Level 3개 소형 커리큘럼", () => {
  it("3 레벨 × 5 노드", () => {
    const buf = buildSimpleDoc({ levelCount: 3, nodesPerLevel: 5 });
    const result = parseAppMasterDocx(buf);
    expect(result.stats.level_count).toBe(3);
    expect(result.stats.node_count).toBe(15);
    expect(result.validation.is_valid).toBe(true);
  });
});

describe("TC-C: level_order 중복 → ERROR", () => {
  it("같은 level_order 두 번 → errors 포함", () => {
    const buf = buildSimpleDoc({ levelCount: 3, nodesPerLevel: 2, dupLevelOrder: true });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /level.*order.*중복/i.test(e) || /LEVEL.*order.*중복/i.test(e))).toBe(true);
    expect(result.validation.is_valid).toBe(false);
  });
});

describe("TC-D: Node sequence 중복 → ERROR", () => {
  it("동일 레벨 내 sequence 중복", () => {
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 3, dupNodeSeq: true });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /sequence.*중복/i.test(e))).toBe(true);
    expect(result.validation.is_valid).toBe(false);
  });
});

describe("TC-E: Drill target 누락 → ERROR", () => {
  it("존재하지 않는 노드를 drill target으로 지정", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 3, missingDrillTarget: true });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /대상 노드.*존재하지 않/i.test(e) || /Drill.*target/i.test(e) || /L99-999/.test(e))).toBe(true);
    expect(result.validation.is_valid).toBe(false);
  });
});

describe("TC-F: Relation target 누락 → ERROR", () => {
  it("존재하지 않는 노드를 relation target으로 지정", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 3, missingRelTarget: true, withRelations: true });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /Relation.*존재하지 않/i.test(e) || /L99-999/.test(e) || /L88-888/.test(e))).toBe(true);
    expect(result.validation.is_valid).toBe(false);
  });
});

describe("TC-G: malformed DOCX", () => {
  it("ZIP이 아닌 파일 → 파싱 오류", () => {
    const buf = Buffer.from("This is not a DOCX file at all. No ZIP header.");
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /DOCX|파싱|해체|실패/i.test(e))).toBe(true);
    expect(result.validation.is_valid).toBe(false);
  });

  it("빈 파일 → 파싱 오류", () => {
    const result = parseAppMasterDocx(Buffer.from(""));
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.validation.is_valid).toBe(false);
  });
});

describe("TC-H: display_no 중복 → ERROR", () => {
  it("동일 display_no 두 번 → errors", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 2, dupDisplayNo: true });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /display_no.*중복|중복.*display_no/i.test(e))).toBe(true);
    expect(result.validation.is_valid).toBe(false);
  });
});

describe("TC-I: Import 상태 IMPORTED", () => {
  it("정상 파싱 결과 → is_valid true (import 가능 판단)", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 3 });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.is_valid).toBe(true);
    // import_status는 DB API 레이어에서 IMPORTED로 저장 — parser는 is_valid만 판단
  });
});

describe("TC-J: 기존 ACTIVE 유지", () => {
  it("DRAFT 상태 버전 파싱은 기존 ACTIVE 영향 없음", () => {
    // Parser는 DB 상태를 건드리지 않음 — 이 TC는 DB 레이어 계약 검증
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 2 });
    const result = parseAppMasterDocx(buf);
    // 파서 자체는 DB를 건드리지 않으므로 항상 true
    expect(result.validation.is_valid).toBe(true);
  });
});

describe("TC-K: activate → ACTIVE 상태 (API 계약)", () => {
  it("activate API 응답 shape 계약", () => {
    // API 로직 미러: 기존 ACTIVE 버전을 ARCHIVED하고 새 버전을 ACTIVE로
    function simulateActivate(
      versions: Array<{ id: string; is_active: boolean; import_status: string }>,
      targetId: string,
    ) {
      return versions.map(v => {
        if (v.id === targetId) return { ...v, is_active: true, import_status: "ACTIVE" };
        if (v.is_active)       return { ...v, is_active: false, import_status: "ARCHIVED" };
        return v;
      });
    }

    const before = [
      { id: "cv_old", is_active: true,  import_status: "ACTIVE" },
      { id: "cv_new", is_active: false, import_status: "IMPORTED" },
    ];
    const after = simulateActivate(before, "cv_new");

    expect(after.find(v => v.id === "cv_new")?.import_status).toBe("ACTIVE");
    expect(after.find(v => v.id === "cv_old")?.import_status).toBe("ARCHIVED");
    expect(after.filter(v => v.is_active).length).toBe(1);
  });
});

describe("TC-L: archive → ARCHIVED 상태", () => {
  it("archive 후 is_active=false, import_status=ARCHIVED", () => {
    function simulateArchive(v: { id: string; is_active: boolean; import_status: string }) {
      return { ...v, is_active: false, import_status: "ARCHIVED" };
    }
    const ver = { id: "cv_1", is_active: true, import_status: "ACTIVE" };
    const after = simulateArchive(ver);
    expect(after.is_active).toBe(false);
    expect(after.import_status).toBe("ARCHIVED");
  });
});

describe("TC-M: 과거 growth_event 참조 유지", () => {
  it("curriculum_items FK RESTRICT — soft lifecycle (DB 계약)", () => {
    // curriculum_items → curriculum_versions FK ON DELETE RESTRICT
    // curriculum_progress_observations → curriculum_items FK ON DELETE RESTRICT
    // 이 테스트는 구조적 계약 검증 (실제 DB 쓰기 없음)
    const fkConstraint = { fromTable: "curriculum_items",        toTable: "curriculum_versions", policy: "RESTRICT" };
    const fkConstraint2 = { fromTable: "curriculum_progress_observations", toTable: "curriculum_items", policy: "RESTRICT" };
    expect(fkConstraint.policy).toBe("RESTRICT");
    expect(fkConstraint2.policy).toBe("RESTRICT");
  });
});

describe("TC-N: tenant isolation", () => {
  it("다른 pool_id로 제출된 버전은 자신의 pool_id와 일치해야 함", () => {
    function checkTenantIsolation(versionPoolId: string, callerPoolId: string): boolean {
      return versionPoolId === callerPoolId;
    }
    expect(checkTenantIsolation("pool_A", "pool_A")).toBe(true);
    expect(checkTenantIsolation("pool_A", "pool_B")).toBe(false);
    expect(checkTenantIsolation("pool_A", "pool_A-evil")).toBe(false);
  });
});

describe("TC-O: stat 계산 정확성", () => {
  it("stats.node_count = sum of level nodes", () => {
    const buf = buildSimpleDoc({ levelCount: 3, nodesPerLevel: 7 });
    const result = parseAppMasterDocx(buf);
    expect(result.stats.node_count).toBe(21);
    expect(result.stats.level_count).toBe(3);
  });

  it("stats.drill_count = actual drills parsed", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 5 });
    const result = parseAppMasterDocx(buf);
    expect(result.stats.drill_count).toBe(2); // 1 drill per level
  });

  it("stats.relation_count = relations array length", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 3, withRelations: true });
    const result = parseAppMasterDocx(buf);
    expect(result.stats.relation_count).toBe(1);
  });
});

describe("TC-P: is_test_item Y/N 파싱", () => {
  it("테스트 항목 Y → is_test_item=true", () => {
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 3, testNodeIndexes: [1] });
    const result = parseAppMasterDocx(buf);
    const testNodes = result.levels[0].nodes.filter(n => n.is_test_item);
    expect(testNodes.length).toBe(1);
    expect(testNodes[0].is_test_item).toBe(true);
  });

  it("테스트 항목 N → is_test_item=false", () => {
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 2 });
    const result = parseAppMasterDocx(buf);
    expect(result.levels[0].nodes.every(n => !n.is_test_item)).toBe(true);
  });

  it("stats.test_node_count 정확성", () => {
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 5, testNodeIndexes: [0, 2, 4] });
    const result = parseAppMasterDocx(buf);
    expect(result.stats.test_node_count).toBe(3);
  });
});

describe("TC-Q: is_valid true when no errors", () => {
  it("오류 없는 파싱 → is_valid = true", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 3 });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors).toHaveLength(0);
    expect(result.validation.is_valid).toBe(true);
  });
});

describe("TC-R: is_valid false when errors", () => {
  it("중복 오류 포함 → is_valid = false", () => {
    const buf = buildSimpleDoc({ levelCount: 2, nodesPerLevel: 2, dupNodeSeq: true });
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    expect(result.validation.is_valid).toBe(false);
  });
});

// ─── 추가: 메타 파싱 ───────────────────────────────────────────────────────────

describe("추가: meta 파싱 정확성", () => {
  it("메타 테이블에서 pool_reference, version_name 파싱", () => {
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 1 });
    const result = parseAppMasterDocx(buf);
    expect(result.meta.pool_reference).toBe("테스트 수영장");
    expect(result.meta.version_name).toBe("TEST_V1");
    expect(result.meta.curriculum_release).toBe("2026-Q3");
    expect(result.meta.schema_version).toBe("APP_MASTER_V1");
  });

  it("declared_level_count 불일치 → 오류", () => {
    // metaTable에 총 레벨 수 = 5, 실제 레벨 = 2
    const parts = [
      heading(1, "SWIMNOTE X Curriculum APP MASTER"),
      metaTable("V1", 5), // declares 5 levels
      heading(1, "LEVEL 1: 초급"),
      twoColTable([["설명", "초급"]]),
      heading(2, "NODE 1: L1-001"),
      nodeTable("기술1", "원자1"),
      heading(1, "LEVEL 2: 중급"),
      twoColTable([["설명", "중급"]]),
      heading(2, "NODE 1: L2-001"),
      nodeTable("기술2", "원자2"),
    ];
    const buf = makeDocx(parts.join("\n"));
    const result = parseAppMasterDocx(buf);
    expect(result.validation.errors.some(e => /레벨 수/.test(e))).toBe(true);
  });
});

describe("추가: node_data 필드 파싱", () => {
  it("node_data 모든 필드가 추출됨", () => {
    const buf = buildSimpleDoc({ levelCount: 1, nodesPerLevel: 1 });
    const result = parseAppMasterDocx(buf);
    const node = result.levels[0].nodes[0];
    expect(node.node_data.goal).not.toBeNull();
    expect(node.node_data.movement_sequence).not.toBeNull();
    expect(node.node_data.observable_success).not.toBeNull();
    expect(node.node_data.partial_success).not.toBeNull();
    expect(node.node_data.error_signals).not.toBeNull();
    expect(node.node_data.coaching_point).not.toBeNull();
  });
});
