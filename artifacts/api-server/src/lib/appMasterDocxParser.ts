/**
 * appMasterDocxParser.ts
 *
 * SWIMNOTE X — Curriculum APP MASTER DOCX 결정론적 파서
 *
 * 문서 구조 (표준 APP MASTER V1):
 *
 *   Heading 1: "SWIMNOTE X Curriculum APP MASTER"
 *   [메타 테이블 2컬럼]
 *     문서 버전 | APP_MASTER_V1
 *     수영장 참조 | [pool_name]
 *     커리큘럼 릴리즈 | [release]
 *     커리큘럼 버전 | [version_name]
 *     총 레벨 수 | [N]
 *
 *   Heading 1: "LEVEL [N]: [level_name]"
 *   [레벨 설명 테이블]
 *     설명 | [desc]
 *
 *   Heading 2: "NODE [seq]: [display_no]"  (예: NODE 1: L1-001)
 *   [노드 테이블 2컬럼]
 *     표제 | ...
 *     영법 | ...
 *     영역 | ...
 *     기술 그룹 | ...
 *     원자 기술 | ...
 *     목표 | ...
 *     동작 순서 | ...
 *     관찰 성공 기준 | ...
 *     부분 성공 기준 | ...
 *     오류 신호 | ...
 *     코칭 포인트 | ...
 *     테스트 항목 | Y/N
 *     완료 기준 | ...
 *     출처 | ...
 *
 *   Heading 3: "DRILL [n]"  (optional, node 직후)
 *   [드릴 테이블 2컬럼]
 *     대상 노드 | [display_no]
 *     교정 측면 | ...
 *     동작 순서 | ...
 *     반복횟수 | ...
 *     즉각 피드백 | ...
 *     통합 | ...
 *     스프린트 검증 | ...
 *     실패 복귀 노드 | [display_no]
 *
 *   Heading 1: "RELATIONS"  (선택, 문서 마지막)
 *   [관계 테이블: 출발 노드 | 관계 유형 | 대상 노드]
 *
 * 원칙:
 *   - LLM 추론 금지. 명시적 heading/table 값만 사용.
 *   - UNKNOWN → undefined/null (NO_HALLUCINATION).
 *   - 오류는 errors[], 경고는 warnings[]로 수집.
 */

import { unzipSync } from "fflate";

// ─── 출력 타입 ─────────────────────────────────────────────────────────────────

export interface AppMasterMeta {
  schema_version: string;          // APP_MASTER_V1 등
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
  display_no: string;                // e.g. "L1-001"
  title: string;
  stroke: string | null;
  domain: string | null;
  skill_group: string | null;
  atomic_skill: string | null;
  is_test_item: boolean;
  source_trace: string | null;
  node_data: AppMasterNodeData;
  /** sort_order in curriculum_items = (level_order-1)*10000 + sequence_in_level */
  sort_order: number;
}

export interface AppMasterDrill {
  node_display_no: string;          // 대상 노드 display_no
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
  is_valid: boolean;                // true when errors.length === 0
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
  // Outline level fallback
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
type TableEl = { kind: "table"; rows: string[][]; };
type DocEl = Heading | TableEl;

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
      // Non-heading paragraphs skipped (content lives in tables)
    }
  }

  return elements;
}

// ─── 테이블 → map ─────────────────────────────────────────────────────────────

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

// ─── 파싱 패턴 ────────────────────────────────────────────────────────────────

// "LEVEL 3: 빨간색" 또는 "LEVEL 3 - 빨간색" 또는 "LEVEL 3 빨간색"
const LEVEL_HEADING = /^LEVEL\s+(\d+)\s*[:\-\s]\s*(.+)$/i;

// "NODE 12: L3-012" 또는 "NODE 12 - L3-012" 또는 "NODE 12 L3-012"
const NODE_HEADING = /^NODE\s+(\d+)\s*[:\-\s]\s*([A-Z0-9\-]+)$/i;

// "DRILL 1" 또는 "DRILL"
const DRILL_HEADING = /^DRILL(\s+\d+)?$/i;

// "RELATIONS" 또는 "RELATION"
const RELATIONS_HEADING = /^RELATIONS?$/i;

const RELATION_TYPE_MAP: Record<string, RelationType> = {
  "prerequisite":     "prerequisite",
  "선수조건":          "prerequisite",
  "next_skill":       "next_skill",
  "next":             "next_skill",
  "다음 기술":         "next_skill",
  "다음기술":          "next_skill",
  "related":          "related",
  "연관":             "related",
  "correction":       "correction",
  "교정":             "correction",
  "test":             "test",
  "테스트":            "test",
};

function parseRelationType(raw: string): RelationType | null {
  const key = raw.trim().toLowerCase();
  return RELATION_TYPE_MAP[key] ?? null;
}

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

  // ── State machine ──────────────────────────────────────────────────────────

  let meta: AppMasterMeta = {
    schema_version: "APP_MASTER_V1",
    pool_reference: null,
    curriculum_release: null,
    version_name: null,
    declared_level_count: null,
  };

  const levels: AppMasterLevel[] = [];
  const relations: AppMasterRelation[] = [];

  type State =
    | "DOCUMENT_HEADER"
    | "IN_LEVEL"
    | "IN_NODE"
    | "IN_DRILL"
    | "IN_RELATIONS";

  let state: State = "DOCUMENT_HEADER";
  let currentLevel: AppMasterLevel | null = null;
  let currentNode: AppMasterNode | null = null;
  let currentDrillNodeDisplayNo: string | null = null;
  let drillSortOffset = 0;

  for (const el of elements) {
    if (el.kind === "heading") {
      const text = el.text.trim();

      // RELATIONS 섹션
      if (RELATIONS_HEADING.test(text)) {
        state = "IN_RELATIONS";
        continue;
      }

      // LEVEL heading (H1)
      const levelMatch = LEVEL_HEADING.exec(text);
      if (levelMatch) {
        // push previous level
        if (currentLevel) {
          if (currentNode) { currentLevel.nodes.push(currentNode); currentNode = null; }
          levels.push(currentLevel);
        }
        const levelOrder = parseInt(levelMatch[1], 10);
        const levelName = levelMatch[2].trim();
        currentLevel = { level_order: levelOrder, level_name: levelName, description: null, nodes: [], drills: [] };
        state = "IN_LEVEL";
        currentNode = null;
        drillSortOffset = 0;
        continue;
      }

      // NODE heading (H2)
      const nodeMatch = NODE_HEADING.exec(text);
      if (nodeMatch && state !== "DOCUMENT_HEADER" && state !== "IN_RELATIONS") {
        if (currentNode && currentLevel) currentLevel.nodes.push(currentNode);
        if (!currentLevel) {
          errors.push(`NODE "${text}" 가 LEVEL 섹션 밖에 위치합니다.`);
          continue;
        }
        const seq = parseInt(nodeMatch[1], 10);
        const displayNo = nodeMatch[2].toUpperCase();
        currentNode = {
          level_order: currentLevel.level_order,
          sequence_in_level: seq,
          display_no: displayNo,
          title: "",
          stroke: null,
          domain: null,
          skill_group: null,
          atomic_skill: null,
          is_test_item: false,
          source_trace: null,
          node_data: {
            goal: null, movement_sequence: null, observable_success: null,
            partial_success: null, error_signals: null, coaching_point: null,
            completion_criteria: null,
          },
          sort_order: (currentLevel.level_order - 1) * 10000 + seq,
        };
        state = "IN_NODE";
        currentDrillNodeDisplayNo = displayNo;
        continue;
      }

      // DRILL heading (H3)
      if (DRILL_HEADING.test(text)) {
        state = "IN_DRILL";
        continue;
      }

      // Document title (H1 containing "APP MASTER") → stay in DOCUMENT_HEADER
      if (/APP\s*MASTER/i.test(text)) {
        state = "DOCUMENT_HEADER";
        continue;
      }

    } else {
      // Table element
      const table = el as TableEl;

      if (state === "DOCUMENT_HEADER") {
        const map = tableToMap(table.rows);
        meta = {
          schema_version: map["문서 버전"] ?? map["Schema Version"] ?? "APP_MASTER_V1",
          pool_reference: map["수영장 참조"] ?? map["Pool"] ?? null,
          curriculum_release: map["커리큘럼 릴리즈"] ?? map["Release"] ?? null,
          version_name: map["커리큘럼 버전"] ?? map["Version"] ?? null,
          declared_level_count: map["총 레벨 수"] ? parseInt(map["총 레벨 수"], 10) : null,
        };
      } else if (state === "IN_LEVEL" && !currentNode) {
        // Level description table
        const map = tableToMap(table.rows);
        if (currentLevel) {
          currentLevel.description = map["설명"] ?? map["Description"] ?? null;
        }
      } else if (state === "IN_NODE" && currentNode) {
        const map = tableToMap(table.rows);
        currentNode.title = map["표제"] ?? map["Title"] ?? "";
        currentNode.stroke = map["영법"] ?? map["Stroke"] ?? null;
        currentNode.domain = map["영역"] ?? map["Domain"] ?? null;
        currentNode.skill_group = map["기술 그룹"] ?? map["Skill Group"] ?? null;
        currentNode.atomic_skill = map["원자 기술"] ?? map["Atomic Skill"] ?? null;
        currentNode.source_trace = map["출처"] ?? map["Source Trace"] ?? null;
        const testVal = (map["테스트 항목"] ?? map["Test Item"] ?? "").toUpperCase();
        currentNode.is_test_item = testVal === "Y" || testVal === "YES" || testVal === "TRUE";
        currentNode.node_data = {
          goal: map["목표"] ?? map["Goal"] ?? null,
          movement_sequence: map["동작 순서"] ?? map["Movement Sequence"] ?? null,
          observable_success: map["관찰 성공 기준"] ?? map["Observable Success"] ?? null,
          partial_success: map["부분 성공 기준"] ?? map["Partial Success"] ?? null,
          error_signals: map["오류 신호"] ?? map["Error Signals"] ?? null,
          coaching_point: map["코칭 포인트"] ?? map["Coaching Point"] ?? null,
          completion_criteria: map["완료 기준"] ?? map["Completion"] ?? null,
        };
      } else if (state === "IN_DRILL" && currentLevel) {
        const map = tableToMap(table.rows);
        const drillTitle = map["드릴 표제"] ?? map["Title"] ?? map["표제"] ?? "DRILL";
        const targetNode = map["대상 노드"] ?? map["Target Node"] ?? currentDrillNodeDisplayNo ?? "";
        const drill: AppMasterDrill = {
          node_display_no: targetNode.toUpperCase(),
          title: drillTitle,
          target_aspect: map["교정 측면"] ?? map["Target Aspect"] ?? null,
          movement_sequence: map["동작 순서"] ?? map["Movement Sequence"] ?? null,
          repetitions: map["반복횟수"] ?? map["Repetitions"] ?? null,
          immediate_feedback: map["즉각 피드백"] ?? map["Immediate Feedback"] ?? null,
          integration: map["통합"] ?? map["Integration"] ?? null,
          sprint_validation: map["스프린트 검증"] ?? map["Sprint Validation"] ?? null,
          failure_return_display_no: (map["실패 복귀 노드"] ?? map["Failure Return"] ?? "").toUpperCase() || null,
        };
        currentLevel.drills.push(drill);
        drillSortOffset++;
        // After drill table, we may stay in IN_DRILL or go to next heading
      } else if (state === "IN_RELATIONS") {
        // Relation table: rows = [header?, [from, type, to], ...]
        for (const row of table.rows) {
          if (row.length < 3) continue;
          const from = row[0].trim().toUpperCase();
          const typeRaw = row[1].trim();
          const to = row[2].trim().toUpperCase();
          if (!from || !to || from === "출발 노드" || from === "FROM") continue;
          const relType = parseRelationType(typeRaw);
          if (!relType) {
            warnings.push(`알 수 없는 관계 유형 "${typeRaw}" (${from} → ${to})`);
            continue;
          }
          relations.push({ from_node_display_no: from, to_node_display_no: to, relation_type: relType });
        }
      }
    }
  }

  // Flush last level
  if (currentLevel) {
    if (currentNode) currentLevel.nodes.push(currentNode);
    levels.push(currentLevel);
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  // 1. 레벨 수 검증
  if (meta.declared_level_count !== null && levels.length !== meta.declared_level_count) {
    errors.push(
      `선언된 레벨 수(${meta.declared_level_count})와 실제 파싱된 레벨 수(${levels.length})가 다릅니다.`
    );
  }

  // 2. 레벨 order 중복
  const levelOrderSet = new Set<number>();
  for (const lv of levels) {
    if (levelOrderSet.has(lv.level_order)) {
      errors.push(`LEVEL order 중복: ${lv.level_order} (${lv.level_name})`);
    }
    levelOrderSet.add(lv.level_order);
  }

  // 3. 레벨 내 sequence 중복
  const allNodeDisplayNos = new Set<string>();
  for (const lv of levels) {
    const seqSet = new Set<number>();
    const dispSet = new Set<string>();

    for (const node of lv.nodes) {
      // empty atomic_skill 금지
      if (!node.atomic_skill) {
        errors.push(`[${node.display_no}] atomic_skill이 비어 있습니다.`);
      }
      // empty title 금지
      if (!node.title) {
        errors.push(`[${node.display_no}] 표제(title)가 비어 있습니다.`);
      }
      // sequence 중복
      if (seqSet.has(node.sequence_in_level)) {
        errors.push(`LEVEL ${lv.level_order}: sequence ${node.sequence_in_level} 중복 (${node.display_no})`);
      }
      seqSet.add(node.sequence_in_level);

      // display_no 중복 (전체 문서)
      if (dispSet.has(node.display_no) || allNodeDisplayNos.has(node.display_no)) {
        errors.push(`display_no 중복: ${node.display_no}`);
      }
      dispSet.add(node.display_no);
      allNodeDisplayNos.add(node.display_no);
    }
  }

  // 4. Drill target 확인
  for (const lv of levels) {
    for (const drill of lv.drills) {
      if (!drill.node_display_no || !allNodeDisplayNos.has(drill.node_display_no)) {
        errors.push(`Drill "${drill.title}" 의 대상 노드 "${drill.node_display_no}" 가 문서에 존재하지 않습니다.`);
      }
    }
  }

  // 5. Relation target 확인
  for (const rel of relations) {
    if (!allNodeDisplayNos.has(rel.from_node_display_no)) {
      errors.push(`Relation 출발 노드 "${rel.from_node_display_no}" 가 문서에 없습니다.`);
    }
    if (!allNodeDisplayNos.has(rel.to_node_display_no)) {
      errors.push(`Relation 대상 노드 "${rel.to_node_display_no}" 가 문서에 없습니다.`);
    }
  }

  // 6. version_name 누락
  if (!meta.version_name) {
    warnings.push("커리큘럼 버전(version_name)이 메타 테이블에 없습니다.");
  }

  // 7. 레벨이 0개
  if (levels.length === 0) {
    errors.push("파싱된 레벨이 없습니다. 문서 형식을 확인하세요.");
  }

  // 8. 노드가 0개인 레벨
  for (const lv of levels) {
    if (lv.nodes.length === 0) {
      warnings.push(`LEVEL ${lv.level_order} (${lv.level_name})에 노드가 없습니다.`);
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalNodes = levels.reduce((s, l) => s + l.nodes.length, 0);
  const totalDrills = levels.reduce((s, l) => s + l.drills.length, 0);
  const testNodes = levels.reduce(
    (s, l) => s + l.nodes.filter(n => n.is_test_item).length, 0
  );

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
