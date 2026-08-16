/**
 * xSetupTemplates — WP-X03 DOCX 양식 생성 + R2 업로드
 *
 * 템플릿 업로드 경로: x-setup/templates/{type}_v{version}.docx
 * 버전은 DB x_setup_template_versions 테이블 대신 config 상수로 관리.
 * 업데이트 시 TEMPLATE_VERSIONS 값 변경 → 서버 재시작 → 자동 재업로드.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, TableRow, TableCell, Table,
  WidthType, convertInchesToTwip, PageBreak,
} from "docx";
import { uploadToR2, downloadFromR2 } from "./objectStorage.js";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export const TEMPLATE_VERSIONS = {
  curriculum: "1.0.0",
  website:    "1.0.0",
} as const;

export type TemplateType = keyof typeof TEMPLATE_VERSIONS;

export function getTemplateR2Key(type: TemplateType): string {
  return `x-setup/templates/${type}_v${TEMPLATE_VERSIONS[type]}.docx`;
}

// ── Curriculum DOCX 생성 ────────────────────────────────────────────────────
function buildCurriculumDoc(): Document {
  const levelRows = Array.from({ length: 10 }, (_, i) => {
    const lvl = i + 1;
    return [
      new Paragraph({ text: `== ${lvl}단계 ==`, heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 100 } }),
      new Paragraph({ text: "레벨명 (예: 기초, 중급, 초급 3반 등):", spacing: { after: 80 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "레벨 색상 / 모자색 등 식별체계:", spacing: { after: 80 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "주요 교육내용 (이 단계에서 실제로 가르치는 것):", spacing: { after: 80 } }),
      new Paragraph({ text: "", spacing: { after: 100 } }),
      new Paragraph({ text: "", spacing: { after: 100 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "배우는 영법:", spacing: { after: 80 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "주요 기술:", spacing: { after: 80 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "교육목표:", spacing: { after: 80 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "승급기준 / 다음 단계로 가는 기준:", spacing: { after: 80 } }),
      new Paragraph({ text: "", spacing: { after: 100 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
      new Paragraph({ text: "【선택 항목】 세부 기술 / 테스트 방법 / 거리 기준 / 시간 기준 / 자주 발생하는 오류 / 교정 방법 / 추천 드릴 / 연령별 차이 / 기타:", spacing: { after: 80 } }),
      new Paragraph({ text: "", spacing: { after: 100 } }),
      new Paragraph({ text: "", spacing: { after: 100 } }),
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 400 } }),
    ];
  }).flat();

  return new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "SWIMNOTE X 커리큘럼 작성양식",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `양식 버전: ${TEMPLATE_VERSIONS.curriculum}`, color: "888888", size: 18 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),

        // 작성 안내
        new Paragraph({ text: "■ 작성 안내", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 160 } }),
        new Paragraph({ text: "• 현재 체계적인 커리큘럼이 없어도 괜찮습니다.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 현재 수영장에서 실제로 가르치는 순서와 각 단계에서 배우는 내용을 기준으로 작성해주세요.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 최대 10단계까지 작성할 수 있습니다. 10단계를 반드시 모두 채울 필요는 없습니다.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 현재 교육과정이 7단계라면 1단계부터 7단계까지만 작성하면 됩니다.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 정확한 문장이나 전문적인 표현으로 작성할 필요는 없습니다.", spacing: { after: 100 } }),
        new Paragraph({ text: "• '이 단계에서는 무엇을 가르치는지'를 중심으로 자연스럽게 작성해주세요.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 작성 내용이 구체적이고 상세할수록 SWIMNOTE가 더 체계적으로 정리할 수 있습니다.", spacing: { after: 400 } }),

        // 기본 정보
        new Paragraph({ text: "■ 수영장 기본 정보", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 160 } }),
        new Paragraph({ text: "수영장명:", spacing: { after: 80 } }),
        new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 200 } }),
        new Paragraph({ text: "총 레벨 수 (몇 단계로 운영하시나요?):", spacing: { after: 80 } }),
        new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 400 } }),

        // 단계별
        new Paragraph({ text: "■ 단계별 커리큘럼", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 160 } }),
        new Paragraph({ text: "작성하시는 단계(레벨)만 채워주세요. 나머지 빈칸은 무시하셔도 됩니다.", spacing: { after: 400 }, children: [new TextRun({ text: "작성하시는 단계(레벨)만 채워주세요. 나머지 빈칸은 무시하셔도 됩니다.", italics: true, color: "666666" })] }),
        ...levelRows,
      ],
    }],
  });
}

// ── Website Profile DOCX 생성 ──────────────────────────────────────────────
function buildWebsiteDoc(): Document {
  const field = (label: string, lines: number = 1): Paragraph[] => {
    const spacerLines = Array.from({ length: lines }, () =>
      new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: lines > 1 ? 100 : 200 } }),
    );
    spacerLines[spacerLines.length - 1] = new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 240 } });
    return [new Paragraph({ text: label + ":", spacing: { after: 80 } }), ...spacerLines];
  };

  return new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ text: "SWIMNOTE X 홈페이지 제작자료 양식", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
        new Paragraph({ children: [new TextRun({ text: `양식 버전: ${TEMPLATE_VERSIONS.website}`, color: "888888", size: 18 })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

        // 안내
        new Paragraph({ text: "■ 작성 안내", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 160 } }),
        new Paragraph({ text: "• 모든 항목을 반드시 작성할 필요는 없습니다. 빈칸이 있어도 제출할 수 있습니다.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 입력해주신 정보가 구체적이고 풍부할수록 더 풍성한 홈페이지를 제작할 수 있습니다.", spacing: { after: 100 } }),
        new Paragraph({ text: "• 단순 키워드보다는 실제 운영 경험과 특징이 드러나도록 가능한 범위에서 자세히 작성해주세요.", spacing: { after: 400 } }),

        // A. 기본 정보
        new Paragraph({ text: "A. 기본 정보", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 200 } }),
        ...field("수영장명"), ...field("지점명 (있는 경우)"),
        ...field("대표자명"), ...field("대표전화"), ...field("상담전화"),
        ...field("홈페이지 표시 연락처"), ...field("이메일"), ...field("주소"), ...field("상세주소"),
        ...field("위치 설명 (예: 3번 출구에서 도보 5분)"),
        ...field("운영시간"), ...field("휴무일"), ...field("SNS (인스타그램, 네이버 블로그 등)"), ...field("기타 연락처"),

        // B. 브랜드/소개
        new Paragraph({ text: "B. 브랜드 / 소개", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("대표 슬로건"), ...field("한 줄 소개"),
        ...field("메인 Hero에 강조하고 싶은 문구"),
        ...field("수영장 상세 소개", 4), ...field("설립 배경", 3),
        ...field("주요 교육 대상 (어린이/성인/선수 등)"),
        ...field("운영 특징", 3), ...field("홈페이지에서 가장 강조하고 싶은 내용", 3),

        // C. 특장점
        new Paragraph({ text: "C. 특장점", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        new Paragraph({ text: "특장점 1:", spacing: { after: 80 } }),
        ...field("  제목"), ...field("  상세 설명", 2), ...field("  실제 운영 사례 (선택)", 2),
        new Paragraph({ text: "특장점 2:", spacing: { after: 80, before: 200 } }),
        ...field("  제목"), ...field("  상세 설명", 2), ...field("  실제 운영 사례 (선택)", 2),
        new Paragraph({ text: "특장점 3:", spacing: { after: 80, before: 200 } }),
        ...field("  제목"), ...field("  상세 설명", 2), ...field("  실제 운영 사례 (선택)", 2),

        // D. 차별화
        new Paragraph({ text: "D. 차별화", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("다른 수영장과 다른 점", 2),
        ...field("교육 차별점", 2), ...field("시설 차별점", 2),
        ...field("관리 차별점", 2), ...field("학부모 서비스 차별점", 2),
        ...field("가장 자신 있는 강점", 2),

        // E. 대표/원장 운영철학
        new Paragraph({ text: "E. 대표 / 원장 운영철학", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("수영장을 운영하게 된 이유", 2),
        ...field("교육철학", 2),
        ...field("학생을 지도할 때 가장 중요하게 생각하는 것", 2),
        ...field("학부모에게 전달하고 싶은 말", 2),
        ...field("장기적인 교육 목표", 2),
        ...field("운영하면서 지키고 있는 원칙", 2),

        // F. 프로그램
        new Paragraph({ text: "F. 프로그램", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        new Paragraph({ text: "운영 중인 프로그램을 각각 작성해주세요 (어린이/성인/선수/마스터즈/개인레슨/기타):", spacing: { after: 200 } }),
        ...[1, 2, 3].flatMap(n => [
          new Paragraph({ text: `프로그램 ${n}:`, spacing: { after: 80, before: 200 } }),
          ...field("  프로그램명"), ...field("  교육대상"), ...field("  교육내용", 2),
          ...field("  특징", 2), ...field("  추천 대상"),
          ...field("  정원"), ...field("  운영요일/시간"), ...field("  기타 (선택)"),
        ]),

        // G. 레벨체계
        new Paragraph({ text: "G. 레벨 체계", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...Array.from({ length: 5 }, (_, i) => [
          new Paragraph({ text: `레벨 ${i + 1}:`, spacing: { after: 80, before: 200 } }),
          ...field("  레벨명"), ...field("  레벨 색상"),
          ...field("  주요 학습내용", 2), ...field("  교육목표"),
          ...field("  승급기준"), ...field("  테스트 방식"), ...field("  기타 (선택)"),
        ]).flat(),

        // H. 시설
        new Paragraph({ text: "H. 시설 / 부대시설", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("수영장 규모 (레인수/길이/수심/수온 등)", 2),
        ...field("수질관리 방법"), ...field("해수풀 여부"),
        ...field("샤워실/탈의실"), ...field("드라이 공간"),
        ...field("학부모 대기공간"), ...field("주차"),
        ...field("차량운행 여부"), ...field("CCTV/안전설비"),
        ...field("편의시설/기타 부대시설", 2),

        // I. 안전관리
        new Paragraph({ text: "I. 안전관리", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("지도자 배치 방식"), ...field("안전교육 방법"),
        ...field("사고대응 절차"), ...field("보험 가입 여부"),
        ...field("안전 관련 자격/수상 (선택)"),

        // J. 차량/위치
        new Paragraph({ text: "J. 차량 / 위치", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("차량운행 여부 및 운행지역"),
        ...field("승하차 방식 / 인솔 방식"),
        ...field("주차방법"), ...field("대중교통"),
        ...field("주변 랜드마크"), ...field("찾아오는 방법", 2),

        // K. 이용안내
        new Paragraph({ text: "K. 이용안내", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("수업 운영요일 및 수업시간"),
        ...field("반 정원"), ...field("수강료 공개 여부 및 안내"),
        ...field("체험수업 여부"), ...field("상담방식 및 등록방법"),
        ...field("준비물"), ...field("기타"),

        // L. FAQ
        new Paragraph({ text: "L. FAQ (최대 20개, 선택)", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...Array.from({ length: 5 }, (_, i) => [
          new Paragraph({ text: `Q${i + 1}. 질문:`, spacing: { after: 80, before: 200 } }),
          new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 120 } }),
          new Paragraph({ text: `A${i + 1}. 답변:`, spacing: { after: 80 } }),
          new Paragraph({ text: "", spacing: { after: 80 } }),
          new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { after: 120 } }),
        ]).flat(),
        new Paragraph({ text: "（추가 FAQ가 있으시면 계속 작성해주세요. 최대 20개 가능합니다.）", spacing: { after: 400 }, children: [new TextRun({ text: "（추가 FAQ가 있으시면 계속 작성해주세요. 최대 20개 가능합니다.）", italics: true, color: "888888" })] }),

        // M. 자유작성
        new Paragraph({ text: "M. 자유 작성", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } }),
        ...field("홈페이지에 꼭 넣고 싶은 내용", 3),
        ...field("특별히 강조하고 싶은 이야기", 3),
        ...field("홈페이지에 넣고 싶지 않은 정보 (선택)"),
        ...field("기타 제작자에게 전달하고 싶은 내용", 3),
      ],
    }],
  });
}

// ── R2에 템플릿 업로드 (이미 있으면 skip) ─────────────────────────────────
async function ensureTemplateInR2(type: TemplateType): Promise<void> {
  const key = getTemplateR2Key(type);
  // 이미 존재하면 skip
  const existing = await downloadFromR2(key, "photo");
  if (existing.ok && existing.data && existing.data.length > 0) {
    console.log(`[x-setup-template] ${type} v${TEMPLATE_VERSIONS[type]} 이미 R2에 존재 — skip`);
    return;
  }
  // 생성 + 업로드
  const doc = type === "curriculum" ? buildCurriculumDoc() : buildWebsiteDoc();
  const buffer = await Packer.toBuffer(doc);
  const { ok, error } = await uploadToR2(
    key,
    buffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "photo",
  );
  if (!ok) {
    console.error(`[x-setup-template] ${type} 업로드 실패:`, error);
  } else {
    console.log(`[x-setup-template] ${type} v${TEMPLATE_VERSIONS[type]} 업로드 완료 (${buffer.length} bytes)`);
  }
}

export async function ensureXSetupTemplates(): Promise<void> {
  await Promise.all([
    ensureTemplateInR2("curriculum"),
    ensureTemplateInR2("website"),
  ]);
}
