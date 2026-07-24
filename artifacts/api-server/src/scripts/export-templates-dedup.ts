import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

async function main() {
  const r = await db.execute(sql`
    SELECT DISTINCT ON (template_text) template_text, category, level
    FROM diary_templates
    WHERE template_text NOT LIKE '%ㅗ%'
      AND LENGTH(template_text) > 10
    ORDER BY template_text, category
  `);

  const rows = r.rows as { template_text: string; category: string; level: string | null }[];
  console.log("고유 문장 수:", rows.length);

  // 키워드 기반 자동 분류
  const groups: Record<string, string[]> = {
    "🏊 물적응 / 입수": [],
    "🫁 호흡": [],
    "🦵 발차기 - 자유형": [],
    "🦵 발차기 - 배영": [],
    "🦵 발차기 - 평영": [],
    "🦵 발차기 - 접영": [],
    "💪 팔동작 - 자유형": [],
    "💪 팔동작 - 배영": [],
    "💪 팔동작 - 평영": [],
    "💪 팔동작 - 접영": [],
    "🔄 전신 영법 - 자유형": [],
    "🔄 전신 영법 - 배영": [],
    "🔄 전신 영법 - 평영": [],
    "🔄 전신 영법 - 접영": [],
    "🏁 턴 / 출발": [],
    "📏 거리 / 지구력": [],
    "⚡ 속도 / 인터벌": [],
    "🎯 자세 교정 / 복합": [],
    "🌊 물뜨기 / 균형": [],
    "📝 기타 / 일반": [],
  };

  for (const row of rows) {
    const t = row.template_text;
    let assigned = false;

    const assign = (key: string) => {
      if (!assigned) { groups[key].push(t); assigned = true; }
    };

    // 물적응
    if (/물 적응|물에 익|입수|잠수|물속|세수|눈 뜨|발 담|물 무서/.test(t)) assign("🏊 물적응 / 입수");
    // 호흡
    else if (/호흡|숨|내쉬|들이쉬|고개|얼굴 들|페이스/.test(t)) assign("🫁 호흡");
    // 접영 발
    else if (/접영.*발|발.*접영/.test(t)) assign("🦵 발차기 - 접영");
    // 평영 발
    else if (/평영.*발|발.*평영/.test(t)) assign("🦵 발차기 - 평영");
    // 배영 발
    else if (/배영.*발|발.*배영/.test(t)) assign("🦵 발차기 - 배영");
    // 자유형 발
    else if (/자유형.*발|발.*자유형|발차기.*자유|자유.*발차기/.test(t)) assign("🦵 발차기 - 자유형");
    // 발차기 일반 (영법 미특정)
    else if (/발차기|발 차기|킥/.test(t)) assign("🦵 발차기 - 자유형");
    // 접영 팔
    else if (/접영.*팔|팔.*접영|접영.*스트로크|스트로크.*접영/.test(t)) assign("💪 팔동작 - 접영");
    // 평영 팔
    else if (/평영.*팔|팔.*평영|평영.*스트로크|스트로크.*평영/.test(t)) assign("💪 팔동작 - 평영");
    // 배영 팔
    else if (/배영.*팔|팔.*배영/.test(t)) assign("💪 팔동작 - 배영");
    // 자유형 팔
    else if (/자유형.*팔|팔.*자유형/.test(t)) assign("💪 팔동작 - 자유형");
    // 팔 일반
    else if (/팔동작|팔 돌리|스트로크|팔 젓|풀링|엔트리/.test(t)) assign("💪 팔동작 - 자유형");
    // 턴/출발
    else if (/턴|출발|스타트|벽 차기|플립/.test(t)) assign("🏁 턴 / 출발");
    // 물뜨기/균형
    else if (/뜨기|부력|균형|보드|킥보드|떠있|뜨는|수면/.test(t)) assign("🌊 물뜨기 / 균형");
    // 접영 전신
    else if (/접영/.test(t)) assign("🔄 전신 영법 - 접영");
    // 평영 전신
    else if (/평영/.test(t)) assign("🔄 전신 영법 - 평영");
    // 배영 전신
    else if (/배영/.test(t)) assign("🔄 전신 영법 - 배영");
    // 자유형 전신
    else if (/자유형/.test(t)) assign("🔄 전신 영법 - 자유형");
    // 속도/인터벌
    else if (/속도|인터벌|빠르게|전력|타임|기록/.test(t)) assign("⚡ 속도 / 인터벌");
    // 거리/지구력
    else if (/거리|지구력|완주|바퀴|반환점|연속|m|미터/.test(t)) assign("📏 거리 / 지구력");
    // 자세교정
    else if (/자세|교정|체형|몸통|코어|허리|어깨|머리 위치/.test(t)) assign("🎯 자세 교정 / 복합");
    // 기타
    else assign("📝 기타 / 일반");
  }

  // 결과 출력
  let output = "# SWIMNOTE 일지 템플릿 전체 목록\n\n";
  output += `총 고유 문장: ${rows.length}개\n\n`;
  output += "---\n\n";

  let total = 0;
  for (const [groupName, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    output += `## ${groupName} (${items.length}개)\n\n`;
    items.forEach((t, i) => {
      output += `${i + 1}. ${t}\n`;
    });
    output += "\n";
    total += items.length;
  }

  output += `---\n합계: ${total}개\n`;

  fs.writeFileSync("/tmp/swim-templates.md", output, "utf-8");
  console.log("저장 완료: /tmp/swim-templates.md");
  console.log("총 고유 문장:", rows.length);

  // 그룹별 카운트 요약
  for (const [g, items] of Object.entries(groups)) {
    if (items.length > 0) console.log(`  ${g}: ${items.length}개`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
