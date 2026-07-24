/**
 * defaultTemplates.ts
 * SWIMNOTE 기본 수업일지 템플릿
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface DefaultTemplate {
  title: string;
  template_text: string;
  level_label: string;
  sort_order: number;
}

export const SWIMNOTE_DEFAULT_TEMPLATES: DefaultTemplate[] = [
  // 자유형
  { level_label: "자유형 기초", title: "자유형 기초 수업", template_text: "오늘 수업에서는 자유형 기초 동작을 연습했습니다.\n\n✅ 주요 활동\n- 킥보드 자유형 킥 연습\n- 팔 동작 기초 연습\n- 호흡 타이밍 연습\n\n📝 관찰 사항\n{observation}\n\n🎯 다음 목표\n{next_goal}", sort_order: 0 },
  { level_label: "자유형 중급", title: "자유형 중급 수업", template_text: "오늘 수업에서는 자유형 기술 향상을 위한 훈련을 진행했습니다.\n\n✅ 주요 활동\n- 스트로크 효율화 드릴\n- 호흡 리듬 개선\n- 턴 동작 연습\n\n📝 관찰 사항\n{observation}\n\n🎯 다음 목표\n{next_goal}", sort_order: 1 },
  // 배영
  { level_label: "배영 기초", title: "배영 기초 수업", template_text: "오늘 수업에서는 배영 기초를 연습했습니다.\n\n✅ 주요 활동\n- 등 뜨기 자세 연습\n- 배영 킥 연습\n- 팔 동작 기초\n\n📝 관찰 사항\n{observation}\n\n🎯 다음 목표\n{next_goal}", sort_order: 2 },
  // 평영
  { level_label: "평영 기초", title: "평영 기초 수업", template_text: "오늘 수업에서는 평영 기초를 훈련했습니다.\n\n✅ 주요 활동\n- 개구리 발차기 연습\n- 팔 동작과 호흡 타이밍\n- 글라이드 자세 연습\n\n📝 관찰 사항\n{observation}\n\n🎯 다음 목표\n{next_goal}", sort_order: 3 },
  // 접영
  { level_label: "접영 기초", title: "접영 기초 수업", template_text: "오늘 수업에서는 접영 기초를 학습했습니다.\n\n✅ 주요 활동\n- 돌핀킥 연습\n- 팔 동작 기초\n- 입수 자세 연습\n\n📝 관찰 사항\n{observation}\n\n🎯 다음 목표\n{next_goal}", sort_order: 4 },
  // 종합
  { level_label: "종합", title: "종합 수업", template_text: "오늘 수업을 진행했습니다.\n\n✅ 수업 내용\n{content}\n\n📝 학생 반응 및 관찰\n{observation}\n\n⚠️ 개선 필요 사항\n{improvement}\n\n🎯 다음 수업 목표\n{next_goal}", sort_order: 5 },
];

/**
 * 수영장에 기본 템플릿을 삽입합니다.
 * diary_template_levels를 생성하고 각 레벨에 기본 템플릿을 추가합니다.
 */
export async function insertDefaultTemplates(poolId: string, createdBy: string): Promise<void> {
  for (let i = 0; i < SWIMNOTE_DEFAULT_TEMPLATES.length; i++) {
    const tpl = SWIMNOTE_DEFAULT_TEMPLATES[i];
    // 레벨 생성
    const levelResult = await db.execute(sql`
      INSERT INTO diary_template_levels (swimming_pool_id, level_name, sort_order)
      VALUES (${poolId}, ${tpl.level_label}, ${i})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    let levelId: string | null = null;
    if (levelResult.rows && levelResult.rows.length > 0) {
      levelId = (levelResult.rows[0] as any).id as string;
    } else {
      // 이미 존재하는 경우 조회
      const existing = await db.execute(sql`
        SELECT id FROM diary_template_levels
        WHERE swimming_pool_id = ${poolId} AND level_name = ${tpl.level_label}
        LIMIT 1
      `);
      if (existing.rows && existing.rows.length > 0) {
        levelId = (existing.rows[0] as any).id as string;
      }
    }
    // 템플릿 삽입
    const tplId = `dt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
    await db.execute(sql`
      INSERT INTO diary_templates (id, swimming_pool_id, template_text, title, level_id, sort_order, scope, created_by)
      VALUES (${tplId}, ${poolId}, ${tpl.template_text}, ${tpl.title}, ${levelId}, ${tpl.sort_order}, 'global', ${createdBy})
      ON CONFLICT DO NOTHING
    `);
  }
}
