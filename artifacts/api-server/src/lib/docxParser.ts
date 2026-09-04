/**
 * WP-X04 DOCX Parser — Deterministic, version-aware, no hallucination
 *
 * ORIGINAL != STRUCTURED rule: 이 파서는 DOCX에서 읽기만 한다.
 * 존재하지 않는 정보를 생성하지 않는다 (NO_HALLUCINATION).
 * UNKNOWN은 undefined/null로 유지한다.
 *
 * v1.0 template 기준. version-aware dispatch 구조.
 *
 * PRE-WP-X 확장:
 *  - extractCellParagraphs(): <w:p> 경계 보존
 *  - SearchableItem 타입 + buildSearchableItems()
 *  - DocElement.rawCells: 셀 XML 원본 보존 (paragraph-aware 파싱용)
 *  - CurriculumStructured에 searchable_items[] 추가
 */
import { unzipSync } from "fflate";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CurriculumBasicInfo {
  pool_name?: string;
  branch_name?: string;
  director?: string;
  curriculum_manager?: string;
  contact?: string;
  main_students?: string;
  total_levels?: string;
  level_display?: string;
  notes?: string;
}

export interface CurriculumTeachingSummary {
  first_taught?: string;
  stroke_order?: string;
  key_criteria?: string;
  promotion_test?: string;
  test_period?: string;
  level_change_criteria?: string;
  common_drills?: string;
  philosophy?: string;
}

export interface CurriculumLevel {
  level_order: number;
  level_name?: string;
  level_color?: string;
  target_students?: string;
  learning_contents?: string;
  strokes?: string;
  skills?: string;
  objectives?: string;
  promotion_criteria?: string;
  test_method?: string;
  detailed_skills?: string;
  common_errors?: string;
  correction_methods?: string;
  drills?: string;
  age_notes?: string;
  teaching_focus?: string;
  notes?: string;
}

/**
 * curriculum_items에 저장될 검색 단위 항목.
 * PRE-WP-X: docxParser가 item 분리까지 담당.
 */
export interface SearchableItem {
  /** 검색 텍스트 (curriculum_items.title) */
  title: string;
  /**
   * 컨텍스트 (curriculum_items.description)
   * 형식: "{level_name} / {field_source}"
   */
  description: string;
  /** curriculum_items.sort_order */
  sort_order: number;
  /** 출처 필드 — 품질 감사/디버깅용 */
  field_source: string;
  /** 레벨 순서 */
  level_order: number;
}

export interface CurriculumStructured {
  template_version: string;
  basic_info: CurriculumBasicInfo;
  teaching_summary: CurriculumTeachingSummary;
  levels: CurriculumLevel[];
  total_declared_levels: number;
  parse_warnings: string[];
  /**
   * PRE-WP-X: curriculum_items INSERT용 항목 목록.
   * buildSearchableItems() 결과. DB write는 호출자(x04-structuring.ts)가 담당.
   */
  searchable_items: SearchableItem[];
}

export interface WebsiteStructured {
  template_version: string;
  basic_info: Record<string, string>;
  brand: Record<string, string>;
  strengths: string[];
  differentiation: Record<string, string>;
  philosophy: Record<string, string>;
  programs: string[];
  level_system: string[];
  education_process: Record<string, string>;
  facilities: Record<string, string>;
  safety: Record<string, string>;
  vehicle_location: Record<string, string>;
  usage_information: Record<string, string>;
  coaches: string[];
  trust_credentials: Record<string, string>;
  faq: Array<{ question: string; answer: string }>;
  website_preferences: Record<string, string>;
  restricted_information: string;
  free_notes: string;
  parse_warnings: string[];
}

// ── XML element types ─────────────────────────────────────────────────────────

type DocElement =
  | { kind: "paragraph"; text: string }
  | {
      kind: "table";
      rows: string[][];
      /** 셀 XML 원본 — paragraph-aware 파싱에 사용. rows와 1:1 대응. */
      rawCells: string[][];
    };

// ── Low-level XML helpers ─────────────────────────────────────────────────────

/**
 * 셀 XML 전체에서 <w:t> 런을 join하여 단일 문자열 반환.
 * 기존 방식 — backward compat 유지.
 */
function extractCellText(nodeXml: string): string {
  return (nodeXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join("")
    .trim();
}

/**
 * PRE-WP-X: 셀 XML에서 <w:p> 단락 경계를 보존하여 배열로 반환.
 * - 단락 내 <w:t> 런을 join
 * - 최소 4자 미만 파편은 제거
 * - bullet/기호 prefix 정규화
 *
 * 기존 extractCellText()는 유지 (basic_info, teaching_summary 등에서 계속 사용).
 */
export function extractCellParagraphs(cellXml: string): string[] {
  const results: string[] = [];
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(cellXml)) !== null) {
    const runs = m[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
    const text = runs
      .map(r => r.replace(/<[^>]+>/g, ""))
      .join("")
      .replace(/^[\s\-·•▪▸▶→●○◆◇★☆※]+/, "")  // 앞 bullet/기호
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 4) results.push(text);
  }
  return results;
}

function parseDocumentElements(bodyXml: string): DocElement[] {
  const elements: DocElement[] = [];
  let remaining = bodyXml;

  while (remaining.length > 0) {
    const tableIdx = remaining.indexOf("<w:tbl");
    const paraIdx  = remaining.search(/<w:p[ >]/);

    if (tableIdx === -1 && paraIdx === -1) break;

    const tableFirst =
      tableIdx !== -1 && (paraIdx === -1 || tableIdx < paraIdx);

    if (tableFirst) {
      remaining = remaining.slice(tableIdx);
      const tblEnd = remaining.indexOf("</w:tbl>") + 8;
      if (tblEnd < 8) break;
      const tableXml = remaining.slice(0, tblEnd);
      remaining = remaining.slice(tblEnd);

      const rows: string[][] = [];
      const rawCells: string[][] = [];
      for (const trMatch of tableXml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cells: string[] = [];
        const rawRow: string[] = [];
        for (const tcMatch of trMatch[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)) {
          cells.push(extractCellText(tcMatch[0]));
          rawRow.push(tcMatch[0]); // PRE-WP-X: 원본 XML 보존
        }
        if (cells.some(c => c)) {
          rows.push(cells);
          rawCells.push(rawRow);
        }
      }
      if (rows.length > 0) elements.push({ kind: "table", rows, rawCells });
    } else {
      remaining = remaining.slice(paraIdx);
      const pEnd = remaining.indexOf("</w:p>") + 6;
      if (pEnd < 6) break;
      const paraXml = remaining.slice(0, pEnd);
      remaining = remaining.slice(pEnd);

      const text = extractCellText(paraXml);
      if (text) elements.push({ kind: "paragraph", text });
    }
  }

  return elements;
}

/** Extract key→value map from a 2-column table (skip header row "항목" | "작성 내용") */
function tableToMap(rows: string[][]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.length < 2) continue;
    const key = row[0].trim();
    const val = row[1].trim();
    if (key === "항목" || key === "작성 내용" || key === "") continue;
    if (key) map[key] = val;
  }
  return map;
}

/**
 * PRE-WP-X: 2-column 테이블에서 key → rawCell XML 매핑 반환.
 * 레벨 섹션에서 paragraph-aware 파싱에 사용.
 */
function tableToRawCellMap(
  rows: string[][],
  rawCells: string[][]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const raw = rawCells[i] ?? [];
    if (row.length < 2) continue;
    const key = row[0].trim();
    if (key === "항목" || key === "작성 내용" || key === "") continue;
    if (key && raw[1]) map[key] = raw[1]; // value 셀의 원본 XML
  }
  return map;
}

/** Extract unzip and parse the document body XML from a DOCX buffer */
function extractDocxBody(buffer: Buffer): { bodyXml: string; templateVersion: string } {
  const files = unzipSync(new Uint8Array(buffer));
  const docXmlKey = Object.keys(files).find(k =>
    k === "word/document.xml" || k.endsWith("/document.xml")
  );
  if (!docXmlKey) throw new Error("word/document.xml not found in DOCX");
  const bodyXml = Buffer.from(files[docXmlKey]).toString("utf-8");

  let templateVersion = "1.0";
  const verMatch = bodyXml.match(/Version\s+(\d+\.\d+)/i);
  if (verMatch) templateVersion = verMatch[1];

  return { bodyXml, templateVersion };
}

// ── Section heading detection ─────────────────────────────────────────────────

const CURRICULUM_SECTION_PATTERNS: Record<string, RegExp> = {
  basic_info:       /^2\.\s/,
  teaching_summary: /^3\.\s/,
};

function detectLevelSection(text: string): number | null {
  const m = text.match(/^4-(\d+)\.\s/);
  return m ? parseInt(m[1], 10) : null;
}

// ── PRE-WP-X: SearchableItem 생성 ────────────────────────────────────────────

/** normalize: bullet/공백/마침표 제거 후 소문자 → 중복 비교 키 */
function normalizeForDedup(s: string): string {
  return s
    .replace(/^[\s\-·•▪▸▶→●○◆◇★☆※]+/, "")
    .replace(/[.。]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 레벨 1개의 raw 셀 XML에서 SearchableItem[] 생성.
 *
 * 우선순위:
 *   1. detailed_skills  (세부 기술)
 *   2. skills           (주요 기술)
 *   3. learning_contents (주요 교육내용)
 *   4. objectives       (교육목표) — 독립 검색 가치 있을 때만
 *   5. drills           (추천 드릴) — 독립 검색 가치 있을 때만
 *
 * 같은 normalize key 중복은 higher-priority field 우선으로 제거.
 * 300개 맞추기용 artificial expansion 금지 — 실제 단락만 사용.
 */
function buildSearchableItemsForLevel(
  levelOrder: number,
  levelName: string | undefined,
  rawCellMap: Record<string, string>,
  startOrder: number
): SearchableItem[] {
  const items: SearchableItem[] = [];
  const seen = new Set<string>();
  let order = startOrder;

  const addField = (fieldKey: string, fieldSource: string) => {
    const cellXml = rawCellMap[fieldKey];
    if (!cellXml) return;
    const paragraphs = extractCellParagraphs(cellXml);
    for (const text of paragraphs) {
      const key = normalizeForDedup(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push({
        title: text,
        description: `${levelName ?? `레벨 ${levelOrder}`} / ${fieldSource}`,
        sort_order: order++,
        field_source: fieldSource,
        level_order: levelOrder,
      });
    }
  };

  // 우선순위 순서로 추가 (중복은 higher-priority가 already seen에 있어 제거됨)
  addField("세부 기술",      "detailed_skills");
  addField("주요 기술",      "skills");
  addField("주요 교육내용",   "learning_contents");
  addField("교육목표",       "objectives");
  addField("추천 드릴",      "drills");

  return items;
}

// ── Curriculum DOCX parser v1.0 ───────────────────────────────────────────────

function parseCurriculumV1(elements: DocElement[]): CurriculumStructured {
  const warnings: string[] = [];
  let currentSection: string | null = null;
  let currentLevel: number | null = null;

  const sectionTables: Record<string, Record<string, string>> = {
    basic_info: {},
    teaching_summary: {},
  };
  const levelMaps: Map<number, Record<string, string>> = new Map();
  /** PRE-WP-X: level별 raw 셀 XML 보존 */
  const levelRawCellMaps: Map<number, Record<string, string>> = new Map();

  for (const el of elements) {
    if (el.kind === "paragraph") {
      const txt = el.text.trim();
      let matched = false;
      for (const [sec, pat] of Object.entries(CURRICULUM_SECTION_PATTERNS)) {
        if (pat.test(txt)) {
          currentSection = sec;
          currentLevel = null;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const lvl = detectLevelSection(txt);
        if (lvl !== null) {
          currentLevel = lvl;
          currentSection = null;
          if (!levelMaps.has(lvl)) levelMaps.set(lvl, {});
          if (!levelRawCellMaps.has(lvl)) levelRawCellMaps.set(lvl, {});
        }
      }
    } else {
      // Table
      const map = tableToMap(el.rows);
      if (currentSection && sectionTables[currentSection]) {
        Object.assign(sectionTables[currentSection], map);
      } else if (currentLevel !== null) {
        const existing = levelMaps.get(currentLevel) ?? {};
        levelMaps.set(currentLevel, { ...existing, ...map });

        // PRE-WP-X: raw 셀 XML도 병합
        const existingRaw = levelRawCellMaps.get(currentLevel) ?? {};
        const rawMap = tableToRawCellMap(el.rows, el.rawCells);
        levelRawCellMaps.set(currentLevel, { ...existingRaw, ...rawMap });
      }
    }
  }

  // Map section 2 → CurriculumBasicInfo
  const bi = sectionTables.basic_info;
  const basic_info: CurriculumBasicInfo = {
    pool_name:          bi["수영장명"]             || undefined,
    branch_name:        bi["지점명"]               || undefined,
    director:           bi["대표자/책임자"]         || undefined,
    curriculum_manager: bi["커리큘럼 담당자"]       || undefined,
    contact:            bi["연락처"]               || undefined,
    main_students:      bi["주요 교육 대상"]        || undefined,
    total_levels:       bi["현재 전체 단계 수"]     || undefined,
    level_display:      bi["현재 레벨 표시 방식"]   || undefined,
    notes:              bi["기타 설명"]             || undefined,
  };

  // Map section 3 → CurriculumTeachingSummary
  const ts = sectionTables.teaching_summary;
  const teaching_summary: CurriculumTeachingSummary = {
    first_taught:          ts["입문 단계에서 가장 먼저 가르치는 것"] || undefined,
    stroke_order:          ts["영법 학습 순서"]                      || undefined,
    key_criteria:          ts["수업에서 가장 중요하게 보는 기준"]     || undefined,
    promotion_test:        ts["승급 테스트 운영 여부"]                || undefined,
    test_period:           ts["정기 테스트 주기"]                     || undefined,
    level_change_criteria: ts["레벨 변경 기준"]                      || undefined,
    common_drills:         ts["수업 중 자주 사용하는 드릴"]           || undefined,
    philosophy:            ts["교육과정에서 특히 강조하는 철학"]      || undefined,
  };

  // Map level sections → CurriculumLevel[] + SearchableItem[]
  const levels: CurriculumLevel[] = [];
  const allSearchableItems: SearchableItem[] = [];
  let globalSortOrder = 0;

  for (const [levelOrder, lm] of [...levelMaps.entries()].sort(([a], [b]) => a - b)) {
    const declaredOrder = lm["단계 번호"] ? parseInt(lm["단계 번호"], 10) : levelOrder;
    const level: CurriculumLevel = {
      level_order:        isNaN(declaredOrder) ? levelOrder : declaredOrder,
      level_name:         lm["레벨명"]                     || undefined,
      level_color:        lm["레벨 색상/식별체계"]          || undefined,
      target_students:    lm["이 단계의 대상"]              || undefined,
      learning_contents:  lm["주요 교육내용"]              || undefined,
      strokes:            lm["배우는 영법"]                || undefined,
      skills:             lm["주요 기술"]                  || undefined,
      objectives:         lm["교육목표"]                   || undefined,
      promotion_criteria: lm["승급기준"]                   || undefined,
      test_method:        lm["테스트 방법"]                || undefined,
      detailed_skills:    lm["세부 기술"]                  || undefined,
      common_errors:      lm["자주 발생하는 오류"]          || undefined,
      correction_methods: lm["교정 방법"]                  || undefined,
      drills:             lm["추천 드릴"]                  || undefined,
      age_notes:          lm["연령별 차이"]                || undefined,
      teaching_focus:     lm["지도 시 중요하게 보는 부분"] || undefined,
      notes:              lm["기타 설명"]                   || undefined,
    };

    const hasContent = Object.values(level).some(
      (v, i) => i > 0 && v !== undefined && v !== ""
    );
    if (!hasContent) continue;
    levels.push(level);

    // PRE-WP-X: searchable_items 생성
    const rawCellMap = levelRawCellMaps.get(levelOrder) ?? {};
    const levelItems = buildSearchableItemsForLevel(
      level.level_order,
      level.level_name,
      rawCellMap,
      globalSortOrder
    );
    globalSortOrder += levelItems.length;
    allSearchableItems.push(...levelItems);
  }

  return {
    template_version: "1.0",
    basic_info,
    teaching_summary,
    levels,
    total_declared_levels: levels.length,
    parse_warnings: warnings,
    searchable_items: allSearchableItems,
  };
}

// ── Website DOCX parser v1.0 ──────────────────────────────────────────────────

const WEBSITE_SECTION_MAP: Record<string, string> = {
  "2.":  "basic_info",
  "3.":  "brand",
  "4.":  "strengths",
  "5.":  "differentiation",
  "6.":  "philosophy",
  "7.":  "programs",
  "8.":  "level_system",
  "9.":  "education_process",
  "10.": "facilities",
  "11.": "safety",
  "12.": "vehicle_location",
  "13.": "usage_information",
  "14.": "coaches",
  "15.": "trust_credentials",
  "16.": "website_preferences",
  "17.": "restricted_information",
  "20.": "free_notes",
};

function detectWebsiteSection(text: string): string | null {
  const m = text.match(/^(\d+)\.\s/);
  if (!m) return null;
  return WEBSITE_SECTION_MAP[m[1] + "."] ?? null;
}

function parseWebsiteV1(elements: DocElement[]): WebsiteStructured {
  const warnings: string[] = [];
  let currentSection: string | null = null;
  const sectionData: Record<string, Record<string, string>> = {};
  const faqRows: Array<{ question: string; answer: string }> = [];

  for (const el of elements) {
    if (el.kind === "paragraph") {
      const sec = detectWebsiteSection(el.text.trim());
      if (sec) currentSection = sec;
    } else if (currentSection) {
      const map = tableToMap(el.rows);
      if (!sectionData[currentSection]) sectionData[currentSection] = {};

      if (currentSection === "usage_information") {
        for (const row of el.rows) {
          if (row.length >= 2) {
            const q = row[0].trim();
            const a = row[1].trim();
            if (q && a && q !== "항목" && q !== "질문") {
              sectionData[currentSection][q] = a;
            }
          }
        }
      } else {
        Object.assign(sectionData[currentSection], map);
      }
    }
  }

  const sd = (key: string) => sectionData[key] ?? {};

  return {
    template_version: "1.0",
    basic_info:          sd("basic_info"),
    brand:               sd("brand"),
    strengths:           Object.values(sd("strengths")).filter(Boolean),
    differentiation:     sd("differentiation"),
    philosophy:          sd("philosophy"),
    programs:            Object.values(sd("programs")).filter(Boolean),
    level_system:        Object.values(sd("level_system")).filter(Boolean),
    education_process:   sd("education_process"),
    facilities:          sd("facilities"),
    safety:              sd("safety"),
    vehicle_location:    sd("vehicle_location"),
    usage_information:   sd("usage_information"),
    coaches:             Object.values(sd("coaches")).filter(Boolean),
    trust_credentials:   sd("trust_credentials"),
    faq:                 faqRows,
    website_preferences: sd("website_preferences"),
    restricted_information: Object.values(sd("restricted_information")).join("\n"),
    free_notes:          Object.values(sd("free_notes")).join("\n"),
    parse_warnings:      warnings,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseCurriculumDocx(buffer: Buffer): CurriculumStructured {
  const { bodyXml, templateVersion } = extractDocxBody(buffer);
  const elements = parseDocumentElements(bodyXml);
  if (templateVersion === "1.0") return parseCurriculumV1(elements);
  const result = parseCurriculumV1(elements);
  result.parse_warnings.push(`Unknown template version: ${templateVersion}, fell back to v1.0 parser`);
  return result;
}

export function parseWebsiteDocx(buffer: Buffer): WebsiteStructured {
  const { bodyXml, templateVersion } = extractDocxBody(buffer);
  const elements = parseDocumentElements(bodyXml);
  if (templateVersion === "1.0") return parseWebsiteV1(elements);
  const result = parseWebsiteV1(elements);
  result.parse_warnings.push(`Unknown template version: ${templateVersion}, fell back to v1.0 parser`);
  return result;
}
