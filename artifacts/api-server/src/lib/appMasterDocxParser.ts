/**
 * appMasterDocxParser.ts  —  SWIMNOTE X Curriculum APP MASTER DOCX Parser
 *
 * 지원 포맷 A (표준 신규 포맷):
 *   Heading1: "META"            → 2-column table (key | value)
 *   Heading1: "LEVELS"
 *     Heading2: "LEVEL N"      → 2-column table (key | value)
 *   Heading1: "NODES"
 *     Heading2: "NODE {code}"  → 2-column table (key | value)
 *     Heading3: "DRILL {id}"   → 2-column table (key | value)
 *   Heading1: "RELATIONS"
 *     Heading2: "RELATION {id}" → 2-column table (key | value)
 *
 * 지원 포맷 B (기존 레거시 포맷 — backward compat):
 *   Heading1: "LEVEL N: level_name"  → 2-column table
 *   Heading2: "NODE N: display_no"   → 2-column table
 *   Heading3: "DRILL" / "DRILL N"    → 2-column table
 *   Heading1: "RELATIONS"            → 다열 relation table
 *
 * 원칙:
 *   - LLM 추론 금지. 명시적 heading/table 값만 사용.
 *   - 자동 의미 보정 금지.
 *   - UNKNOWN → undefined/null.
 */

import { unzipSync } from "fflate";

// ─── 출력 타입 (변경 없음) ─────────────────────────────────────────────────────

export interface AppMasterMeta {
  schema_version: string;
  pool_reference: string | null;
  curriculum_release: string | null;
  version_name: string | null;
  declared_level_count: number | null;
}

export interface AppMasterNodeData {
  goal: string | null;
  movement_sequence: string | null;
  observable_success: string | null;
  partial_success: string | null;
  error_signals: string | null;
  coaching_point: string | null;
  completion_criteria: string | null;
}

export interface AppMasterNode {
  level_order: number;
  sequence_in_level: number;
  display_no: string;
  title: string;
  stroke: string | null;
  domain: string | null;
  skill_group: string | null;
  atomic_skill: string | null;
  is_test_item: boolean;
  source_trace: string | null;
  node_data: AppMasterNodeData;
  sort_order: number;
}

export interface AppMasterDrill {
  node_display_no: string;
  title: string;
  target_aspect: string | null;
  movement_sequence: string | null;
  repetitions: string | null;
  immediate_feedback: string | null;
  integration: string | null;
  sprint_validation: string | null;
  failure_return_display_no: string | null;
}

export type RelationType = "prerequisite" | "next_skill" | "related" | "correction" | "test";

export interface AppMasterRelation {
  from_node_display_no: string;
  to_node_display_no: string;
  relation_type: RelationType;
}

export interface AppMasterLevel {
  level_order: number;
  level_name: string;
  description: string | null;
  nodes: AppMasterNode[];
  drills: AppMasterDrill[];
}

export interface AppMasterValidationResult {
  errors: string[];
  warnings: string[];
  is_valid: boolean;
}

export interface AppMasterParsed {
  meta: AppMasterMeta;
  levels: AppMasterLevel[];
  relations: AppMasterRelation[];
  validation: AppMasterValidationResult;
  stats: {
    level_count: number;
    node_count: number;
    drill_count: number;
    relation_count: number;
    test_node_count: number;
  };
}

// ─── XML 헬퍼 ─────────────────────────────────────────────────────────────────

function extractCellText(cellXml: string): string {
  return (cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join("")
    .trim();
}

function getHeadingLevel(paraXml: string): number | null {
  const m = paraXml.match(/<w:pStyle[^>]*w:val="Heading(\d+)"/i)
            ?? paraXml.match(/<w:pStyle[^>]*w:val="heading(\d+)"/i)
            ?? paraXml.match(/<w:pStyle[^>]*w:val="[^"]*[Hh]eading\s*(\d+)[^"]*"/i);
  if (m) return parseInt(m[1], 10);
  const ol = paraXml.match(/<w:outlineLvl[^>]*w:val="(\d+)"/i);
  if (ol) return parseInt(ol[1], 10) + 1;
  return null;
}

function getParagraphText(paraXml: string): string {
  return (paraXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join("")
    .trim();
}

function extractDocxBody(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const docKey = Object.keys(files).find(k =>
    k === "word/document.xml" || k.endsWith("/document.xml")
  );
  if (!docKey) throw new Error("word/document.xml not found in DOCX archive");
  return Buffer.from(files[docKey]).toString("utf-8");
}

// ─── DOM 요소 타입 ─────────────────────────────────────────────────────────────

type Heading = { kind: "heading"; level: number; text: string };
type TableEl = { kind: "table";   rows: string[][] };
type DocEl   = Heading | TableEl;

function parseElements(bodyXml: string): DocEl[] {
  const elements: DocEl[] = [];
  let remaining = bodyXml;

  while (remaining.length > 0) {
    const tableIdx = remaining.indexOf("<w:tbl");
    const paraIdx  = remaining.search(/<w:p[ >]/);
    if (tableIdx === -1 && paraIdx === -1) break;

    const tableFirst = tableIdx !== -1 && (paraIdx === -1 || tableIdx < paraIdx);

    if (tableFirst) {
      remaining = remaining.slice(tableIdx);
      const tblEnd = remaining.indexOf("</w:tbl>") + 8;
      if (tblEnd < 8) break;
      const tableXml = remaining.slice(0, tblEnd);
      remaining = remaining.slice(tblEnd);

      const rows: string[][] = [];
      for (const trMatch of tableXml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cells: string[] = [];
        for (const tcMatch of trMatch[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)) {
          cells.push(extractCellText(tcMatch[0]));
        }
        if (cells.some(c => c.trim())) rows.push(cells);
      }
      if (rows.length > 0) elements.push({ kind: "table", rows });
    } else {
      remaining = remaining.slice(paraIdx);
      const pEnd = remaining.indexOf("</w:p>") + 6;
      if (pEnd < 6) break;
      const paraXml = remaining.slice(0, pEnd);
      remaining = remaining.slice(pEnd);

      const text = getParagraphText(paraXml);
      if (!text) continue;

      const hLvl = getHeadingLevel(paraXml);
      if (hLvl !== null) {
        elements.push({ kind: "heading", level: hLvl, text });
      }
      // Non-heading paragraphs outside tables are skipped — data lives in tables
    }
  }

  return elements;
}

// ─── 테이블 → map (2-column key | value) ──────────────────────────────────────

function tableToMap(rows: string[][]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.length < 2) continue;
    const key = row[0].trim();
    const val = row.slice(1).join(" ").trim();
    if (!key || key === "항목" || key === "필드") continue;
    map[key] = val;
  }
  return map;
}

// ─── 관계 유형 정규화 ─────────────────────────────────────────────────────────

const RELATION_TYPE_MAP: Record<string, RelationType> = {
  // 신 포맷 uppercase
  "PREREQUISITE":    "prerequisite",
  "NEXT_SKILL":      "next_skill",
  "NEXT":            "next_skill",
  "RELATED_SKILL":   "related",
  "RELATED":         "related",
  "CORRECTION_FOR":  "correction",
  "CORRECTION":      "correction",
  "TEST_FOR":        "test",
  "TEST":            "test",
  // 구 포맷 lowercase
  "prerequisite":    "prerequisite",
  "next_skill":      "next_skill",
  "related":         "related",
  "correction":      "correction",
  "test":            "test",
  // 구 포맷 한글
  "선수조건":         "prerequisite",
  "다음 기술":        "next_skill",
  "다음기술":         "next_skill",
  "연관":             "related",
  "교정":             "correction",
  "테스트":           "test",
};

function parseRelationType(raw: string): RelationType | null {
  return RELATION_TYPE_MAP[raw.trim()] ?? null;
}

// ─── 파싱 패턴 ────────────────────────────────────────────────────────────────

// 신 포맷
const NEW_LEVEL_HEADING    = /^LEVEL\s+(\d+)$/i;
const NEW_NODE_HEADING     = /^NODE\s+([A-Z0-9\-]+)$/i;
const NEW_DRILL_HEADING    = /^DRILL\s+([A-Z0-9\-]+)$/i;
const NEW_RELATION_HEADING = /^RELATION\s+([A-Z0-9\-]+)$/i;

// 구 포맷 (backward compat)
const OLD_LEVEL_HEADING = /^LEVEL\s+(\d+)\s*[:\-]\s*(.+)$/i;
const OLD_NODE_HEADING  = /^NODE\s+(\d+)\s*[:\-\s]\s*([A-Z0-9\-]+)$/i;
const OLD_DRILL_HEADING = /^DRILL(\s+\d+)?$/i;

// 섹션 헤딩
const META_HEADING      = /^META$/i;
const LEVELS_HEADING    = /^LEVELS?$/i;
const NODES_HEADING     = /^NODES?$/i;
const RELATIONS_HEADING = /^RELATIONS?$/i;

// 구 포맷 title
const APP_MASTER_HEADING = /APP\s*MASTER/i;

// ─── 메인 파서 ────────────────────────────────────────────────────────────────

export function parseAppMasterDocx(buffer: Buffer): AppMasterParsed {
  const errors: string[] = [];
  const warnings: string[] = [];

  let bodyXml: string;
  try {
    bodyXml = extractDocxBody(buffer);
  } catch (e: any) {
    return {
      meta: { schema_version: "UNKNOWN", pool_reference: null, curriculum_release: null, version_name: null, declared_level_count: null },
      levels: [],
      relations: [],
      validation: { errors: [`DOCX 해체 실패: ${e?.message ?? e}`], warnings: [], is_valid: false },
      stats: { level_count: 0, node_count: 0, drill_count: 0, relation_count: 0, test_node_count: 0 },
    };
  }

  const elements = parseElements(bodyXml);

  // ── 포맷 감지 ────────────────────────────────────────────────────────────
  const hasNewFormatMarker = elements.some(
    el => el.kind === "heading" && el.level === 1 &&
      (META_HEADING.test(el.text) || LEVELS_HEADING.test(el.text) || NODES_HEADING.test(el.text))
  );

  if (hasNewFormatMarker) {
    return parseNewFormat(elements, errors, warnings);
  } else {
    return parseLegacyFormat(elements, errors, warnings);
  }
}

// ─── 신 포맷 파서 ─────────────────────────────────────────────────────────────
// 구조: H1 섹션 → H2/H3 항목 → 즉시 다음 TableEl (2-column key|value)

function parseNewFormat(
  elements: DocEl[],
  errors: string[],
  warnings: string[],
): AppMasterParsed {
  let meta: AppMasterMeta = {
    schema_version: "APP_MASTER_V1",
    pool_reference: null,
    curriculum_release: null,
    version_name: null,
    declared_level_count: null,
  };

  // Level master: level_order → {level_name, description}
  const levelMaster = new Map<number, { level_name: string; description: string | null }>();

  const nodes: AppMasterNode[] = [];
  const drills: AppMasterDrill[] = [];
  const relations: AppMasterRelation[] = [];

  // node_code → display_no (relation 검증용)
  const nodeCodeToDisplayNo = new Map<string, string>();
  const allDisplayNos = new Set<string>();
  const allNodeCodes  = new Set<string>();

  // 중복 추적
  const seenLevelOrders  = new Set<number>();
  const seenDisplayNos   = new Set<string>();
  const seenNodeCodes    = new Set<string>();
  const seenDrillIds     = new Set<string>();
  const seenRelationIds  = new Set<string>();

  type Section = "INIT" | "META" | "LEVELS" | "NODES" | "RELATIONS";
  let section: Section = "INIT";

  /** elements[i] 가 TableEl이면 map을 반환하고 i+1, 아니면 빈 map과 i 유지 */
  function peekTable(i: number): [Record<string, string>, number] {
    if (i < elements.length && elements[i].kind === "table") {
      return [tableToMap((elements[i] as TableEl).rows), i + 1];
    }
    return [{}, i];
  }

  let i = 0;
  while (i < elements.length) {
    const el = elements[i];

    if (el.kind === "table") {
      // 섹션 헤딩 직후 META 테이블 처리 (H1 META → Table)
      if (section === "META") {
        const kv = tableToMap(el.rows);
        meta = metaFromKv(kv);
        section = "INIT"; // META 테이블 소비 후 다음 섹션 대기
      }
      // 그 외 테이블은 이미 heading 처리 시 소비됨
      i++;
      continue;
    }

    // el.kind === "heading"
    const text = el.text.trim();

    // ── H1 섹션 분기 ────────────────────────────────────────────────────
    if (el.level === 1) {
      if (META_HEADING.test(text)) {
        section = "META";
        i++;
        // 즉시 다음 테이블 소비
        if (i < elements.length && elements[i].kind === "table") {
          const kv = tableToMap((elements[i] as TableEl).rows);
          meta = metaFromKv(kv);
          i++;
          section = "INIT";
        }
        continue;
      }
      if (LEVELS_HEADING.test(text))    { section = "LEVELS";    i++; continue; }
      if (NODES_HEADING.test(text))     { section = "NODES";     i++; continue; }
      if (RELATIONS_HEADING.test(text)) { section = "RELATIONS"; i++; continue; }
      i++; continue; // 기타 H1 (title 등)
    }

    // ── H2: LEVEL N  (in LEVELS section) ────────────────────────────────
    if (el.level === 2 && section === "LEVELS") {
      const m = NEW_LEVEL_HEADING.exec(text);
      if (m) {
        const headingOrder = parseInt(m[1], 10);
        i++;
        const [kv, nextI] = peekTable(i);
        i = nextI;

        const bodyOrder = kv["level_order"] ? parseInt(kv["level_order"], 10) : headingOrder;
        if (kv["level_order"] && bodyOrder !== headingOrder) {
          errors.push(`LEVEL ${headingOrder}: heading 번호와 본문 level_order(${bodyOrder}) 불일치.`);
        }
        const levelName = kv["level_name"] ?? `LEVEL ${bodyOrder}`;
        const desc      = kv["level_description"] ?? kv["설명"] ?? null;

        if (seenLevelOrders.has(bodyOrder)) {
          errors.push(`level_order 중복: ${bodyOrder} (${levelName})`);
        }
        seenLevelOrders.add(bodyOrder);
        levelMaster.set(bodyOrder, { level_name: levelName, description: desc });
        continue;
      }
    }

    // ── H2: NODE {code}  (in NODES or LEVELS section) ───────────────────
    if (el.level === 2 && (section === "NODES" || section === "LEVELS")) {
      const m = NEW_NODE_HEADING.exec(text);
      if (m) {
        const headingCode = m[1].toUpperCase();
        i++;
        const [kv, nextI] = peekTable(i);
        i = nextI;

        // node_code 검증
        const bodyCode = (kv["node_code"] ?? kv["node_id"] ?? "").toUpperCase();
        if (bodyCode && bodyCode !== headingCode) {
          errors.push(`NODE heading ID(${headingCode})와 본문 node_code(${bodyCode}) 불일치.`);
        }
        const nodeCode = headingCode;

        const displayNo = (kv["display_no"] ?? "").toUpperCase();
        if (!displayNo) {
          errors.push(`NODE ${nodeCode}: display_no 누락.`);
        }

        const seq = kv["sequence_in_level"] ? parseInt(kv["sequence_in_level"], 10) : NaN;
        if (isNaN(seq)) {
          errors.push(`NODE ${nodeCode}: sequence_in_level 누락 또는 비정수.`);
        }

        const nodeLevelOrder = kv["level_order"] ? parseInt(kv["level_order"], 10) : NaN;
        if (isNaN(nodeLevelOrder)) {
          errors.push(`NODE ${nodeCode}: level_order 누락.`);
        }

        // level_name 일치 확인
        const nodeLevelName = kv["level_name"] ?? null;
        if (nodeLevelName && !isNaN(nodeLevelOrder)) {
          const master = levelMaster.get(nodeLevelOrder);
          if (master && master.level_name !== nodeLevelName) {
            warnings.push(`NODE ${nodeCode}: level_name "${nodeLevelName}"이 LEVEL ${nodeLevelOrder}의 "${master.level_name}"과 다릅니다.`);
          }
        }

        // 중복
        if (displayNo && seenDisplayNos.has(displayNo)) {
          errors.push(`display_no 중복: ${displayNo}`);
        }
        if (seenNodeCodes.has(nodeCode)) {
          errors.push(`node_code 중복: ${nodeCode}`);
        }
        if (displayNo) {
          seenDisplayNos.add(displayNo);
          allDisplayNos.add(displayNo);
        }
        seenNodeCodes.add(nodeCode);
        allNodeCodes.add(nodeCode);
        if (displayNo) nodeCodeToDisplayNo.set(nodeCode, displayNo);

        const isTestItem = ["Y","YES","TRUE","1"].includes((kv["is_test_item"] ?? "").toUpperCase());
        const actualSeq  = isNaN(seq) ? 0 : seq;
        const actualLo   = isNaN(nodeLevelOrder) ? 0 : nodeLevelOrder;

        nodes.push({
          level_order: actualLo,
          sequence_in_level: actualSeq,
          display_no: displayNo || nodeCode,
          title: kv["title"] ?? kv["atomic_skill"] ?? "",
          stroke: kv["stroke"] ?? null,
          domain: kv["domain"] ?? null,
          skill_group: kv["skill_group"] ?? null,
          atomic_skill: kv["atomic_skill"] ?? null,
          is_test_item: isTestItem,
          source_trace: kv["source_text"] ?? kv["source_no"] ?? null,
          node_data: {
            goal: kv["goal"] ?? null,
            movement_sequence: kv["movement_sequence"] ?? null,
            observable_success: kv["observable_success"] ?? null,
            partial_success: kv["partial_success"] ?? null,
            error_signals: kv["error_signals"] ?? null,
            coaching_point: kv["coaching_point"] ?? null,
            completion_criteria: kv["completion_rule"] ?? null,
          },
          sort_order: actualLo * 10000 + actualSeq,
        });
        section = "NODES";
        continue;
      }
    }

    // ── H3: DRILL {id}  (in NODES or LEVELS section) ────────────────────
    if (el.level === 3 && (section === "NODES" || section === "LEVELS")) {
      const mNew = NEW_DRILL_HEADING.exec(text);
      const mOld = !mNew ? OLD_DRILL_HEADING.exec(text) : null;
      if (mNew || mOld) {
        const headingDrillId = mNew ? mNew[1].toUpperCase() : "";
        i++;
        const [kv, nextI] = peekTable(i);
        i = nextI;

        const bodyDrillId = (kv["drill_id"] ?? "").toUpperCase();
        if (headingDrillId && bodyDrillId && headingDrillId !== bodyDrillId) {
          errors.push(`DRILL heading ID(${headingDrillId})와 본문 drill_id(${bodyDrillId}) 불일치.`);
        }
        const drillId = headingDrillId || bodyDrillId;

        if (drillId && seenDrillIds.has(drillId)) {
          errors.push(`drill_id 중복: ${drillId}`);
        }
        if (drillId) seenDrillIds.add(drillId);

        // target_node_id → display_no로 resolve
        const rawTarget = (
          kv["target_node_id"] ?? kv["대상 노드"] ?? kv["Target Node"] ?? ""
        ).toUpperCase();
        const targetDisplayNo = nodeCodeToDisplayNo.get(rawTarget) ?? rawTarget;

        // failure_return_node → display_no로 resolve
        const rawReturn = (
          kv["failure_return_node"] ?? kv["실패 복귀 노드"] ?? kv["Failure Return"] ?? ""
        ).toUpperCase();
        const failureReturn = rawReturn
          ? (nodeCodeToDisplayNo.get(rawReturn) ?? rawReturn)
          : null;

        drills.push({
          node_display_no: targetDisplayNo,
          title: kv["drill_title"] ?? kv["드릴 표제"] ?? kv["표제"] ?? kv["Title"] ?? "DRILL",
          target_aspect: kv["target_aspect"] ?? kv["교정 측면"] ?? null,
          movement_sequence: kv["movement_sequence"] ?? kv["동작 순서"] ?? null,
          repetitions: kv["repetitions"] ?? kv["반복횟수"] ?? null,
          immediate_feedback: kv["immediate_feedback"] ?? kv["즉각 피드백"] ?? null,
          integration: kv["integration"] ?? kv["통합"] ?? null,
          sprint_validation: kv["sprint_validation"] ?? kv["스프린트 검증"] ?? null,
          failure_return_display_no: failureReturn,
        });
        continue;
      }
    }

    // ── H2: RELATION {id}  (in RELATIONS section) ────────────────────────
    if (el.level === 2 && section === "RELATIONS") {
      const m = NEW_RELATION_HEADING.exec(text);
      if (m) {
        const headingRelId = m[1].toUpperCase();
        i++;
        const [kv, nextI] = peekTable(i);
        i = nextI;

        const bodyRelId = (kv["relation_id"] ?? "").toUpperCase();
        if (bodyRelId && headingRelId !== bodyRelId) {
          errors.push(`RELATION heading ID(${headingRelId})와 본문 relation_id(${bodyRelId}) 불일치.`);
        }
        const relId = headingRelId || bodyRelId;

        if (relId && seenRelationIds.has(relId)) {
          errors.push(`relation_id 중복: ${relId}`);
        }
        if (relId) seenRelationIds.add(relId);

        const fromNodeId    = (kv["from_node_id"] ?? "").toUpperCase();
        const toNodeId      = (kv["to_node_id"]   ?? "").toUpperCase();
        const fromDisplayNo = nodeCodeToDisplayNo.get(fromNodeId) ?? fromNodeId;
        const toDisplayNo   = nodeCodeToDisplayNo.get(toNodeId)   ?? toNodeId;

        const relTypeRaw = kv["relation_type"] ?? "";
        const relType    = parseRelationType(relTypeRaw);
        if (!relType) {
          warnings.push(`알 수 없는 관계 유형 "${relTypeRaw}" (${relId})`);
        } else if (fromDisplayNo && toDisplayNo) {
          relations.push({
            from_node_display_no: fromDisplayNo,
            to_node_display_no: toDisplayNo,
            relation_type: relType,
          });
        }
        continue;
      }

      // RELATIONS section 내 구 포맷 다열 테이블 (바로 다음 루프에서 처리됨)
      i++;
      continue;
    }

    // 기타 heading → skip
    i++;
  }

  // ── 레벨 재조합 ────────────────────────────────────────────────────────────
  const levelMap = new Map<number, AppMasterLevel>();
  for (const [order, info] of levelMaster.entries()) {
    levelMap.set(order, {
      level_order: order,
      level_name: info.level_name,
      description: info.description,
      nodes: [],
      drills: [],
    });
  }

  for (const node of nodes) {
    let lv = levelMap.get(node.level_order);
    if (!lv) {
      lv = {
        level_order: node.level_order,
        level_name: `LEVEL ${node.level_order}`,
        description: null,
        nodes: [],
        drills: [],
      };
      levelMap.set(node.level_order, lv);
      warnings.push(`NODE ${node.display_no}의 level_order ${node.level_order}가 LEVEL 섹션에 없습니다.`);
    }
    lv.nodes.push(node);
  }

  // drill → level (target display_no 기준)
  const displayNoToLevelOrder = new Map<string, number>();
  for (const node of nodes) {
    if (node.display_no) displayNoToLevelOrder.set(node.display_no, node.level_order);
  }
  for (const drill of drills) {
    const lo = displayNoToLevelOrder.get(drill.node_display_no);
    const lv = lo !== undefined ? levelMap.get(lo) : undefined;
    if (lv) {
      lv.drills.push(drill);
    } else {
      const fallback = levelMap.values().next().value;
      if (fallback) (fallback as AppMasterLevel).drills.push(drill);
    }
  }

  const levels = Array.from(levelMap.values()).sort((a, b) => a.level_order - b.level_order);

  return runValidation({ meta, levels, relations, nodes, drills, errors, warnings, allDisplayNos });
}

// ─── META 키 추출 헬퍼 ────────────────────────────────────────────────────────

function metaFromKv(kv: Record<string, string>): AppMasterMeta {
  return {
    schema_version: kv["문서 버전"] ?? kv["curriculum_version"] ?? "APP_MASTER_V1",
    pool_reference: kv["수영장 참조"] ?? kv["pool_name"] ?? kv["pool_id"] ?? null,
    curriculum_release: kv["커리큘럼 릴리즈"] ?? kv["curriculum_version"] ?? null,
    version_name: kv["커리큘럼 버전"] ?? kv["curriculum_version"] ?? null,
    declared_level_count: kv["총 레벨 수"] ? parseInt(kv["총 레벨 수"], 10) : null,
  };
}

// ─── 레거시 포맷 파서 (기존 코드 유지) ────────────────────────────────────────

function parseLegacyFormat(
  elements: DocEl[],
  errors: string[],
  warnings: string[],
): AppMasterParsed {
  let meta: AppMasterMeta = {
    schema_version: "APP_MASTER_V1",
    pool_reference: null,
    curriculum_release: null,
    version_name: null,
    declared_level_count: null,
  };

  const levels: AppMasterLevel[] = [];
  const relations: AppMasterRelation[] = [];
  const allDisplayNos   = new Set<string>();
  const seenDisplayNos  = new Set<string>(); // 중복 display_no 감지
  const seenSeqsPerLevel = new Map<number, Set<number>>(); // 레벨별 sequence 중복 감지

  type State = "DOCUMENT_HEADER" | "IN_LEVEL" | "IN_NODE" | "IN_DRILL" | "IN_RELATIONS";
  let state: State = "DOCUMENT_HEADER";
  let currentLevel: AppMasterLevel | null = null;
  let currentNode:  AppMasterNode  | null = null;
  let currentDrillNodeDisplayNo: string | null = null;

  for (const el of elements) {
    if (el.kind === "heading") {
      const text = el.text.trim();
      if (RELATIONS_HEADING.test(text)) { state = "IN_RELATIONS"; continue; }

      const levelMatch = OLD_LEVEL_HEADING.exec(text);
      if (levelMatch) {
        if (currentLevel) {
          if (currentNode) { currentLevel.nodes.push(currentNode); currentNode = null; }
          levels.push(currentLevel);
        }
        const lo = parseInt(levelMatch[1], 10);
        const ln = levelMatch[2].trim();
        currentLevel = { level_order: lo, level_name: ln, description: null, nodes: [], drills: [] };
        state = "IN_LEVEL";
        currentNode = null;
        continue;
      }

      const nodeMatch = OLD_NODE_HEADING.exec(text);
      if (nodeMatch && state !== "DOCUMENT_HEADER" && state !== "IN_RELATIONS") {
        if (currentNode && currentLevel) currentLevel.nodes.push(currentNode);
        if (!currentLevel) { errors.push(`NODE "${text}" 가 LEVEL 섹션 밖.`); continue; }
        const seq = parseInt(nodeMatch[1], 10);
        const dn  = nodeMatch[2].toUpperCase();

        // display_no 중복 감지
        if (seenDisplayNos.has(dn)) {
          errors.push(`display_no 중복: ${dn}`);
        }
        seenDisplayNos.add(dn);

        // sequence 중복 감지 (레벨별)
        const lo = currentLevel.level_order;
        if (!seenSeqsPerLevel.has(lo)) seenSeqsPerLevel.set(lo, new Set());
        const seenSeqs = seenSeqsPerLevel.get(lo)!;
        if (seenSeqs.has(seq)) {
          errors.push(`LEVEL ${lo} 내 sequence 중복: ${seq}`);
        }
        seenSeqs.add(seq);

        currentNode = {
          level_order: currentLevel.level_order,
          sequence_in_level: seq,
          display_no: dn,
          title: "",
          stroke: null, domain: null, skill_group: null, atomic_skill: null,
          is_test_item: false, source_trace: null,
          node_data: { goal: null, movement_sequence: null, observable_success: null, partial_success: null, error_signals: null, coaching_point: null, completion_criteria: null },
          sort_order: (currentLevel.level_order - 1) * 10000 + seq,
        };
        state = "IN_NODE";
        currentDrillNodeDisplayNo = dn;
        continue;
      }

      if (OLD_DRILL_HEADING.test(text)) { state = "IN_DRILL"; continue; }
      if (APP_MASTER_HEADING.test(text)) { state = "DOCUMENT_HEADER"; continue; }

    } else {
      // TableEl
      const map = tableToMap(el.rows);

      if (state === "DOCUMENT_HEADER") {
        meta = metaFromKv(map);
        // Also try legacy keys
        if (!meta.version_name) meta.version_name = map["커리큘럼 버전"] ?? null;
      } else if (state === "IN_LEVEL" && !currentNode && currentLevel) {
        currentLevel.description = map["설명"] ?? map["Description"] ?? null;
      } else if (state === "IN_NODE" && currentNode) {
        currentNode.title = map["표제"] ?? "";
        currentNode.stroke = map["영법"] ?? null;
        currentNode.domain = map["영역"] ?? null;
        currentNode.skill_group = map["기술 그룹"] ?? null;
        currentNode.atomic_skill = map["원자 기술"] ?? null;
        currentNode.source_trace = map["출처"] ?? null;
        const tv = (map["테스트 항목"] ?? "").toUpperCase();
        currentNode.is_test_item = tv === "Y" || tv === "YES" || tv === "TRUE";
        currentNode.node_data = {
          goal: map["목표"] ?? null,
          movement_sequence: map["동작 순서"] ?? null,
          observable_success: map["관찰 성공 기준"] ?? null,
          partial_success: map["부분 성공 기준"] ?? null,
          error_signals: map["오류 신호"] ?? null,
          coaching_point: map["코칭 포인트"] ?? null,
          completion_criteria: map["완료 기준"] ?? null,
        };
      } else if (state === "IN_DRILL" && currentLevel) {
        const targetNode = (map["대상 노드"] ?? map["Target Node"] ?? currentDrillNodeDisplayNo ?? "").toUpperCase();
        currentLevel.drills.push({
          node_display_no: targetNode,
          title: map["드릴 표제"] ?? map["표제"] ?? map["Title"] ?? "DRILL",
          target_aspect: map["교정 측면"] ?? null,
          movement_sequence: map["동작 순서"] ?? null,
          repetitions: map["반복횟수"] ?? null,
          immediate_feedback: map["즉각 피드백"] ?? null,
          integration: map["통합"] ?? null,
          sprint_validation: map["스프린트 검증"] ?? null,
          failure_return_display_no: (map["실패 복귀 노드"] ?? "").toUpperCase() || null,
        });
      } else if (state === "IN_RELATIONS") {
        for (const row of el.rows) {
          if (row.length < 3) continue;
          const from = row[0].trim().toUpperCase();
          const typeRaw = row[1].trim();
          const to = row[2].trim().toUpperCase();
          if (!from || !to || from === "출발 노드" || from === "FROM") continue;
          const relType = parseRelationType(typeRaw);
          if (!relType) { warnings.push(`알 수 없는 관계 유형 "${typeRaw}"`); continue; }
          relations.push({ from_node_display_no: from, to_node_display_no: to, relation_type: relType });
        }
      }
    }
  }

  if (currentLevel) {
    if (currentNode) currentLevel.nodes.push(currentNode);
    levels.push(currentLevel);
  }

  for (const lv of levels) {
    for (const n of lv.nodes) allDisplayNos.add(n.display_no);
  }
  const allNodes  = levels.flatMap(l => l.nodes);
  const allDrills = levels.flatMap(l => l.drills);

  return runValidation({ meta, levels, relations, nodes: allNodes, drills: allDrills, errors, warnings, allDisplayNos });
}

// ─── 공통 Validation + Stats ───────────────────────────────────────────────────

function runValidation(params: {
  meta: AppMasterMeta;
  levels: AppMasterLevel[];
  relations: AppMasterRelation[];
  nodes: AppMasterNode[];
  drills: AppMasterDrill[];
  errors: string[];
  warnings: string[];
  allDisplayNos: Set<string>;
}): AppMasterParsed {
  const { meta, levels, relations, nodes, drills, errors, warnings, allDisplayNos } = params;

  // 1. 레벨 수 검증 (선언값과 실제값 불일치 → 오류)
  if (meta.declared_level_count !== null && levels.length !== meta.declared_level_count) {
    errors.push(`선언된 레벨 수(${meta.declared_level_count})와 실제 파싱된 레벨 수(${levels.length})가 다릅니다.`);
  }

  // 2. level_order ASC
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].level_order <= levels[i - 1].level_order) {
      errors.push(`LEVEL order가 오름차순이 아닙니다: ${levels[i-1].level_order} → ${levels[i].level_order}`);
    }
  }

  // 3. 빈 레벨
  for (const lv of levels) {
    if (lv.nodes.length === 0) {
      warnings.push(`LEVEL ${lv.level_order} (${lv.level_name})에 노드가 없습니다.`);
    }
  }

  // 4. Drill target 검증 (존재하지 않는 노드 → 오류)
  for (const drill of drills) {
    if (drill.node_display_no && !allDisplayNos.has(drill.node_display_no)) {
      errors.push(`Drill "${drill.title}" 의 대상 노드 "${drill.node_display_no}" 가 문서에 존재하지 않습니다.`);
    }
  }

  // 5. Relation node 검증 (존재하지 않는 노드 → 오류)
  for (const rel of relations) {
    if (rel.from_node_display_no && !allDisplayNos.has(rel.from_node_display_no)) {
      errors.push(`Relation 출발 노드 "${rel.from_node_display_no}" 가 문서에 없습니다.`);
    }
    if (rel.to_node_display_no && !allDisplayNos.has(rel.to_node_display_no)) {
      errors.push(`Relation 대상 노드 "${rel.to_node_display_no}" 가 문서에 없습니다.`);
    }
  }

  // 6. version_name 경고
  if (!meta.version_name) {
    warnings.push("커리큘럼 버전(version_name)이 메타 테이블에 없습니다.");
  }

  // 7. 레벨 0개
  if (levels.length === 0) {
    errors.push("파싱된 레벨이 없습니다. 문서 형식을 확인하세요.");
  }

  const totalNodes  = nodes.length;
  const totalDrills = drills.length;
  const testNodes   = nodes.filter(n => n.is_test_item).length;

  return {
    meta,
    levels,
    relations,
    validation: {
      errors,
      warnings,
      is_valid: errors.length === 0,
    },
    stats: {
      level_count: levels.length,
      node_count: totalNodes,
      drill_count: totalDrills,
      relation_count: relations.length,
      test_node_count: testNodes,
    },
  };
}
