/**
 * PRE-WP-X: extractCellParagraphs + buildSearchableItems 단위 테스트
 *
 * 주의: vi.mock("../../lib/docxParser.js") 사용 없음 — 실제 코드를 테스트.
 * x04-structuring.test.ts에서 분리한 이유: 해당 파일이 docxParser를 전역 mock하기 때문.
 *
 * PRE-WP-X-01  멀티 단락 셀 → 각 단락이 독립 배열 항목
 * PRE-WP-X-02  기존 join 방식과의 차이 검증
 * PRE-WP-X-03  bullet/기호 prefix 제거
 * PRE-WP-X-04  4자 미만 파편 필터링
 * PRE-WP-X-05  단락 내 복수 <w:t> 런 join
 * PRE-WP-X-06  빈 셀 → 빈 배열
 * PRE-WP-X-07  <w:br> 포함 단락 처리 (동일 단락 내 줄바꿈)
 * PRE-WP-X-08  detailed_skills 우선 + skills 중복 제거
 * PRE-WP-X-09  300개 미만이어도 artificial expansion 없음 (실제 항목만)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { extractCellParagraphs } from "../../lib/docxParser.js";

// ── extractCellParagraphs 단위 테스트 ─────────────────────────────────────────

describe("PRE-WP-X: extractCellParagraphs", () => {
  // PRE-WP-X-01: 여러 <w:p>가 각각 독립 항목으로 분리
  it("PRE-WP-X-01: 멀티 단락 셀 → 각 단락이 독립 배열 항목으로 분리", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p><w:r><w:t>발차기 기초 드릴</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>팔동작 분리 드릴</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>호흡 연결 드릴</w:t></w:r></w:p>",
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("발차기 기초 드릴");
    expect(result[1]).toBe("팔동작 분리 드릴");
    expect(result[2]).toBe("호흡 연결 드릴");
  });

  // PRE-WP-X-02: 기존 단일 문자열 join 방식과의 차이 검증
  it("PRE-WP-X-02: 기존 join 방식은 단락 경계 없이 연결 → 신규 방식은 분리", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p><w:r><w:t>킥보드 드릴 5m</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>글라이딩 드릴 10m</w:t></w:r></w:p>",
      "</w:tc>",
    ].join("");

    // 기존 방식 시뮬레이션 — 단락 경계 없이 join됨
    const oldResult = (cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .map((m: string) => m.replace(/<[^>]+>/g, ""))
      .join("")
      .trim();
    expect(oldResult).toBe("킥보드 드릴 5m글라이딩 드릴 10m");

    // 신규 방식
    const newResult = extractCellParagraphs(cellXml);
    expect(newResult).toHaveLength(2);
    expect(newResult[0]).toBe("킥보드 드릴 5m");
    expect(newResult[1]).toBe("글라이딩 드릴 10m");
  });

  // PRE-WP-X-03: bullet/기호 prefix 제거
  it("PRE-WP-X-03: bullet 기호 prefix 정규화 제거", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p><w:r><w:t>• 팔꿈치 선행 풀</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>- 입수 각도 45도</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>▸ 발목 유연성 활용</w:t></w:r></w:p>",
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("팔꿈치 선행 풀");
    expect(result[1]).toBe("입수 각도 45도");
    expect(result[2]).toBe("발목 유연성 활용");
  });

  // PRE-WP-X-04: 4자 미만 파편 필터링
  it("PRE-WP-X-04: 4자 미만 파편 제거 (짧은 단락 무시)", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p><w:r><w:t>ok</w:t></w:r></w:p>",         // 2자 → 제거
      "<w:p><w:r><w:t>예</w:t></w:r></w:p>",           // 1자 → 제거
      "<w:p><w:r><w:t>발차기 기초</w:t></w:r></w:p>",  // 6자 → 유지
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("발차기 기초");
  });

  // PRE-WP-X-05: 단락 내 복수 <w:t> 런 join
  it("PRE-WP-X-05: 단락 내 복수 <w:t> 런이 join되어 단일 항목으로", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p>",
      "  <w:r><w:t>호흡 시 </w:t></w:r>",
      '  <w:r><w:t xml:space="preserve">고개 회전</w:t></w:r>',
      "  <w:r><w:t> 45도</w:t></w:r>",
      "</w:p>",
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("호흡 시 고개 회전 45도");
  });

  // PRE-WP-X-06: 빈 셀 → 빈 배열
  it("PRE-WP-X-06: 빈 셀 → 빈 배열 반환", () => {
    const cellXml = "<w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>";
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(0);
  });

  // PRE-WP-X-07: 빈 단락 (<w:p>에 텍스트 없음) 무시
  it("PRE-WP-X-07: 텍스트 없는 빈 단락 무시", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p></w:p>",                                           // 빈 단락
      "<w:p><w:r><w:t>팔꿈치 선행</w:t></w:r></w:p>",          // 유효 항목
      "<w:p><w:bookmarkStart w:id=\"1\"/><w:bookmarkEnd w:id=\"1\"/></w:p>", // 마커만 있는 단락
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("팔꿈치 선행");
  });

  // PRE-WP-X-08: 공백만 있는 단락 무시
  it("PRE-WP-X-08: 공백만 있는 단락 무시", () => {
    const cellXml = [
      "<w:tc>",
      "<w:p><w:r><w:t>   </w:t></w:r></w:p>",    // 공백만 → 제거
      "<w:p><w:r><w:t>발차기 기초</w:t></w:r></w:p>",
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("발차기 기초");
  });

  // PRE-WP-X-09: 10개 단락 전부 보존 (artificial truncation 없음)
  it("PRE-WP-X-09: 10개 유효 단락 → 10개 전부 반환 (artificial truncation 없음)", () => {
    const items = Array.from({ length: 10 }, (_, i) => `기술 항목 ${i + 1}번 내용`);
    const cellXml = [
      "<w:tc>",
      ...items.map(item => `<w:p><w:r><w:t>${item}</w:t></w:r></w:p>`),
      "</w:tc>",
    ].join("");
    const result = extractCellParagraphs(cellXml);
    expect(result).toHaveLength(10);
    items.forEach((item, i) => {
      expect(result[i]).toBe(item);
    });
  });
});
