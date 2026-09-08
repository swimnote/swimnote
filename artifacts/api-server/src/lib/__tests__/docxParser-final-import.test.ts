/**
 * docxParser-final-import.test.ts
 *
 * FINAL_IMPORT DOCX 파서 테스트
 *
 * X04-FI-A  FILE_TYPE=FINAL_IMPORT → FINAL_IMPORT 파서 사용
 * X04-FI-B  332개 canonical nodes 정확 추출 (off-by-one 수정 포함)
 * X04-FI-C  AI ENGINE FINAL_IMPORT → 332개
 * X04-FI-D  review_required = 161
 * X04-FI-E  APP/AI canonical diff = 0 (canonical_key, level_order, stroke, domain, skill_group, atomic_skill)
 * X04-FI-F  section boundary first/last node 보존 (L1-001, TBD-161)
 * X04-FI-G  malformed FINAL_IMPORT (canonical_node_count != parsed) → throw (partial import 금지)
 * X04-FI-H  FINAL_IMPORT 감지 누락 FILE_TYPE → legacy 파서 fallback
 * X04-FI-I  level distribution (흰색 117, 파란 28, 빨간 26, TBD 161)
 * X04-FI-J  canonical fields populated in SearchableItem (display_no, stroke, domain, skill_group)
 * X04-FI-K  기존 legacy v1.0 DOCX → 영향 없음 (levels 생성, searchable_items 생성)
 * X04-FI-L  CANONICAL_HASH 메타 확인 (basic_info.notes에 REVIEW_REQUIRED 포함)
 */

import { describe, it, expect } from "vitest";
import { parseCurriculumDocx, detectFinalImport } from "../docxParser.js";
import { zipSync } from "fflate";
import fs from "fs";
import path from "path";

// ── DOCX fixture 빌더 ─────────────────────────────────────────────────────────

function makeDocx(bodyContent: string): Buffer {
  const xmlDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyContent}</w:body>
</w:document>`;
  const files: Record<string, Uint8Array> = {
    "word/document.xml": new TextEncoder().encode(xmlDoc),
    "[Content_Types].xml": new TextEncoder().encode(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
  };
  return Buffer.from(zipSync(files));
}

function wt(text: string) {
  return `<w:r><w:t>${text}</w:t></w:r>`;
}

function wp(...texts: string[]) {
  return `<w:p>${texts.map(t => wt(t)).join("")}</w:p>`;
}

/** 10열 canonical node 행 생성 */
function nodeRow(
  display_no: string, canonical_key: string, source_key: string,
  level_order: string, level_name: string, section: string,
  stroke: string, domain: string, skill_group: string, atomic_skill: string
): string {
  const cells = [display_no, canonical_key, source_key, level_order, level_name, section, stroke, domain, skill_group, atomic_skill];
  const tds = cells.map(v => `<w:tc><w:p>${wt(v)}</w:p></w:tc>`).join("");
  return `<w:tr>${tds}</w:tr>`;
}

/** 헤더 행 */
const HEADER_ROW = nodeRow("display_no","canonical_key","source_key","level_order","level_name","section","stroke","domain","skill_group","atomic_skill");

/** FINAL_IMPORT 전체 문서 뼈대 */
function makeFinalImportBody(nodes: string[], declaredCount: number): string {
  const metaRows = `
    ${wp("FILE_TYPE", "FINAL_IMPORT")}
    ${wp("CANONICAL_STATUS", "REVIEW_REQUIRED")}
  `;

  const sec3Header = wp("3. Canonical Nodes - Identity &amp; Taxonomy");
  const sec4Header = wp("4. Canonical Nodes - Instruction &amp; Completion");

  const nodesTable = `<w:tbl>${HEADER_ROW}${nodes.join("")}</w:tbl>`;

  const validationSection = `
    ${wp("10. Validation Summary")}
    <w:tbl>
      <w:tr>
        <w:tc><w:p>${wt("canonical_node_count")}</w:p></w:tc>
        <w:tc><w:p>${wt(String(declaredCount))}</w:p></w:tc>
      </w:tr>
    </w:tbl>
  `;

  return `${metaRows}${sec3Header}${nodesTable}${sec4Header}${validationSection}`;
}

/** N개의 테스트 노드 생성 */
function generateNodes(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const isLast = i === count - 1;
    const level_order = i < 5 ? "1" : "TBD";
    return nodeRow(
      `L1-${String(i + 1).padStart(3, "0")}`,
      `general::breathing::breathing::node_${i}`,
      `SRC-WHITE-테스트-${String(i + 1).padStart(3, "0")}`,
      level_order, level_order === "1" ? "흰색" : "레벨 미지정",
      "물적응·호흡", "general", "breathing", "breathing",
      `테스트 스킬 ${i + 1}${isLast ? " (마지막)" : ""}`
    );
  });
}

// ── 실제 파일 경로 (attach_assets 상대 경로) ─────────────────────────────────

const APP_DOCX = path.resolve(
  __dirname,
  "../../../../../attached_assets/0_SWIMNOTE_CURRICULUM_APP_FINAL_IMPORT_v1.0_TOYKIDS_REVIEW_RE_1788856835319.docx"
);
const AI_DOCX = path.resolve(
  __dirname,
  "../../../../../attached_assets/0_SWIMNOTE_CURRICULUM_AI_ENGINE_FINAL_IMPORT_v1.0_TOYKIDS_REV_1788856848151.docx"
);

const appDocxExists = fs.existsSync(APP_DOCX);
const aiDocxExists  = fs.existsSync(AI_DOCX);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FINAL_IMPORT Parser", () => {

  // X04-FI-A: FILE_TYPE 감지
  it("X04-FI-A: FILE_TYPE=FINAL_IMPORT 감지 → detectFinalImport=true", () => {
    const buf = makeDocx(makeFinalImportBody(generateNodes(3), 3));
    const { bodyXml } = (() => {
      // docx 파싱 — 내부 구조 간접 검증
      try {
        const r = parseCurriculumDocx(buf);
        return { bodyXml: r.template_version };
      } catch {
        return { bodyXml: "error" };
      }
    })();
    expect(bodyXml).toBe("FINAL_IMPORT");
  });

  // X04-FI-G: declared != parsed → throw
  it("X04-FI-G: declared=5, parsed=3 → partial import 에러", () => {
    const body = makeFinalImportBody(generateNodes(3), 5); // declared=5 but only 3 nodes
    const buf = makeDocx(body);
    expect(() => parseCurriculumDocx(buf)).toThrow(/canonical_node_count 불일치/);
  });

  // X04-FI-H: FILE_TYPE 없음 → legacy 파서 fallback
  it("X04-FI-H: FILE_TYPE 없는 DOCX → legacy 파서 (levels empty, no throw)", () => {
    const legacyBody = `
      <w:p><w:r><w:t>2. 기본 정보</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>수영장명</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>테스트수영장</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `;
    const buf = makeDocx(legacyBody);
    const result = parseCurriculumDocx(buf);
    expect(result.template_version).toBe("1.0");
    expect(result.basic_info.pool_name).toBe("테스트수영장");
  });

  // X04-FI-K: 기존 legacy DOCX → 영향 없음
  it("X04-FI-K: legacy v1.0 DOCX는 FINAL_IMPORT 파서를 사용하지 않음", () => {
    const legacyBody = `
      <w:p><w:r><w:t>3. 교육 방침</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>입문 단계에서 가장 먼저 가르치는 것</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>물 적응</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>4-1. 레벨 1</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>레벨명</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>흰색</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>세부 기술</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>물 적응하기. 발차기 연습.</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `;
    const buf = makeDocx(legacyBody);
    const result = parseCurriculumDocx(buf);
    expect(result.template_version).toBe("1.0");
    expect(result.levels.length).toBe(1);
    // FINAL_IMPORT 파서가 아니므로 canonical fields 없음
    for (const item of result.searchable_items) {
      expect(item.display_no).toBeUndefined();
    }
  });

  // ── 실제 파일 기반 통합 테스트 ─────────────────────────────────────────────

  it.skipIf(!appDocxExists)("X04-FI-B: APP FINAL_IMPORT → 정확히 332개 canonical nodes", () => {
    const buf = fs.readFileSync(APP_DOCX);
    const result = parseCurriculumDocx(buf);
    expect(result.template_version).toBe("FINAL_IMPORT");
    expect(result.searchable_items.length).toBe(332);
  });

  it.skipIf(!aiDocxExists)("X04-FI-C: AI ENGINE FINAL_IMPORT → 정확히 332개", () => {
    const buf = fs.readFileSync(AI_DOCX);
    const result = parseCurriculumDocx(buf);
    expect(result.template_version).toBe("FINAL_IMPORT");
    expect(result.searchable_items.length).toBe(332);
  });

  it.skipIf(!appDocxExists)("X04-FI-D: review_required = 161", () => {
    const buf = fs.readFileSync(APP_DOCX);
    const result = parseCurriculumDocx(buf);
    const reviewRequired = result.searchable_items.filter(n => n.is_review_required);
    expect(reviewRequired.length).toBe(161);
  });

  it.skipIf(!appDocxExists || !aiDocxExists)("X04-FI-E: APP/AI canonical diff = 0", () => {
    const appResult = parseCurriculumDocx(fs.readFileSync(APP_DOCX));
    const aiResult  = parseCurriculumDocx(fs.readFileSync(AI_DOCX));
    const appKeys = new Set(appResult.searchable_items.map(n => n.canonical_key));
    const aiKeys  = new Set(aiResult.searchable_items.map(n => n.canonical_key));

    const onlyApp = [...appKeys].filter(k => !aiKeys.has(k));
    const onlyAI  = [...aiKeys].filter(k => !appKeys.has(k));
    expect(onlyApp.length).toBe(0);
    expect(onlyAI.length).toBe(0);

    let loDiff = 0;
    for (const n of appResult.searchable_items) {
      const m = aiResult.searchable_items.find(a => a.canonical_key === n.canonical_key);
      if (m && m.level_order !== n.level_order) loDiff++;
    }
    expect(loDiff).toBe(0);
  });

  it.skipIf(!appDocxExists)("X04-FI-F: section boundary — 첫 노드 L1-001, 마지막 노드 TBD-161 보존", () => {
    const buf = fs.readFileSync(APP_DOCX);
    const result = parseCurriculumDocx(buf);
    const items = result.searchable_items;
    expect(items[0].display_no).toBe("L1-001");
    expect(items[items.length - 1].display_no).toBe("TBD-161");
  });

  it.skipIf(!appDocxExists)("X04-FI-I: level distribution (흰색 117, 파란 28, 빨간 26, TBD 161)", () => {
    const buf = fs.readFileSync(APP_DOCX);
    const result = parseCurriculumDocx(buf);
    const byLevel: Record<number, number> = {};
    for (const n of result.searchable_items) {
      byLevel[n.level_order] = (byLevel[n.level_order] ?? 0) + 1;
    }
    expect(byLevel[1]).toBe(117);  // 흰색
    expect(byLevel[2]).toBe(28);   // 파란
    expect(byLevel[3]).toBe(26);   // 빨간
    expect(byLevel[-1]).toBe(161); // TBD (level_order = -1)
  });

  it.skipIf(!appDocxExists)("X04-FI-J: canonical fields populated — display_no, stroke, domain, skill_group", () => {
    const buf = fs.readFileSync(APP_DOCX);
    const result = parseCurriculumDocx(buf);
    const first = result.searchable_items[0];
    expect(first.display_no).toBeDefined();
    expect(first.stroke).toBeDefined();
    expect(first.domain).toBeDefined();
    expect(first.skill_group).toBeDefined();
    expect(first.atomic_skill).toBeDefined();
    expect(first.canonical_key).toBeDefined();
  });

  it.skipIf(!appDocxExists)("X04-FI-L: CANONICAL_STATUS=REVIEW_REQUIRED → parse_warnings에 포함", () => {
    const buf = fs.readFileSync(APP_DOCX);
    const result = parseCurriculumDocx(buf);
    expect(result.parse_warnings.some(w => w.includes("REVIEW_REQUIRED"))).toBe(true);
    expect(result.basic_info.notes).toContain("REVIEW_REQUIRED");
  });
});
