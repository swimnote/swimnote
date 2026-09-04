/**
 * sintro-normalization.test.ts — WP-CS09-SWIMNOTE-INTRO-ACTIVATION
 *
 * Pure unit tests — no HTTP, no DB, no mocks.
 * Handler boundary tests (SINTRO-05~10) are covered by CTXH handler tests.
 *
 * SINTRO-01  ki_swimnote_intro role/content contract
 * SINTRO-02  primary intro query deterministic hit (score >= HIGH_CONFIDENCE)
 * SINTRO-03  Korean morpheme variation hits
 * SINTRO-04  deterministic score => no LLM path
 * SINTRO-11  X intro regression (ki_x_mode_intro not affected)
 * SINTRO-12  Frontend Map regression (navigation queries don't hit intro)
 * SINTRO-13  Creator hallucination guard (hasFollowupSignal §8)
 * SINTRO-14  Full score ordering regression
 *
 * + stemKorean unit tests (§2 morpheme-aware scoring)
 */

import { describe, it, expect } from 'vitest';
import {
  scoreText,
  tokenize,
  normalizeQuery,
  stemKorean,
  HIGH_CONFIDENCE,
  hasFollowupSignal,
} from '../support-resolver.js';

// ── Synthetic rows ─────────────────────────────────────────────────────────────

const KI_SWIMNOTE_INTRO = {
  id:             'ki_swimnote_intro',
  item_type:      'FAQ',
  title:          '스윔노트 소개',
  content:        '스윔노트는 수영장 운영을 위한 통합 관리 플랫폼입니다.\n\n주요 기능:\n- 관리자: 회원/반 관리, 수업 스케줄, 출결 관리, 공지사항\n- 강사: 학생 일지 작성, 사진/앨범 공유, 보강 관리\n- 학부모: 자녀 출결·일지·사진 확인, 강사 메시지\n\n스윔노트X는 AI 기반 성장 리포트, 커리큘럼 관리 등 심화 기능을 추가로 제공하는 서비스입니다.',
  question:       '스윔노트가 무엇인가요?',
  answer:         '스윔노트는 수영장 운영을 위한 통합 관리 플랫폼입니다.',
  status:         'active',
  feature:        'SWIMNOTE_INTRO',
  category:       'APP_COMMON',
  affected_roles: ['pool_admin', 'sub_admin', 'teacher', 'parent_account'],
  affected_modes: null,
  affected_role:  null,
  affected_mode:  null,
  scope:          'global',
  pool_id:        null,
  deep_link:      null,
  frontend_screen_id: null,
  solution_steps: null,
  conditions:     null,
  incident_id:    null,
  usage_count:    0,
};

const KI_X_MODE_INTRO = {
  id:             'ki_x_mode_intro',
  item_type:      'FAQ',
  title:          '스윔노트X 소개',
  content:        '스윔노트X는 AI 기반 심화 수영 관리 서비스입니다.',
  question:       '스윔노트X에 대해 알려줘',
  answer:         '스윔노트X는 AI 기반 성장 리포트 및 커리큘럼 관리 서비스입니다.',
  status:         'active',
  feature:        'X_MODE_INTRO',
  category:       'X_MODE',
  affected_roles: ['pool_admin', 'teacher', 'parent', 'parent_account'],
  affected_modes: null,
  affected_role:  null,
  affected_mode:  null,
  scope:          'global',
  pool_id:        null,
  deep_link:      null,
  frontend_screen_id: null,
  solution_steps: null,
  conditions:     null,
  incident_id:    null,
  usage_count:    0,
};

function sc(row: typeof KI_SWIMNOTE_INTRO, q: string): number {
  return scoreText(row, normalizeQuery(q), tokenize(q));
}

// ── stemKorean ─────────────────────────────────────────────────────────────────

describe('stemKorean — §2 Korean particle stripping', () => {
  it('strips 가 (주격): 스윔노트가 → 스윔노트', () => {
    expect(stemKorean('스윔노트가')).toBe('스윔노트');
  });
  it('strips 는 (topic): 스윔노트는 → 스윔노트', () => {
    expect(stemKorean('스윔노트는')).toBe('스윔노트');
  });
  it('strips 에 (location): 강사에 → 강사', () => {
    expect(stemKorean('강사에')).toBe('강사');
  });
  it('strips 를/을 (object)', () => {
    expect(stemKorean('기능를')).toBe('기능');
    expect(stemKorean('기능을')).toBe('기능');
  });
  it('strips 에서 (location-action): 수영장에서 → 수영장', () => {
    expect(stemKorean('수영장에서')).toBe('수영장');
  });
  it('does NOT strip non-particle suffixes', () => {
    expect(stemKorean('설명해줘')).toBe('설명해줘');
    expect(stemKorean('알려줘')).toBe('알려줘');
    expect(stemKorean('스윔노트')).toBe('스윔노트');
  });
  it('does NOT return empty string', () => {
    expect(stemKorean('가').length).toBeGreaterThan(0);
  });
  it('ASCII + Korean particle: swimnote가 → swimnote', () => {
    expect(stemKorean('swimnote가')).toBe('swimnote');
  });
});

// ── SINTRO-01 ─────────────────────────────────────────────────────────────────

describe('SINTRO-01 — ki_swimnote_intro contract', () => {
  it('status is active after manual approval', () => {
    expect(KI_SWIMNOTE_INTRO.status).toBe('active');
  });
  it('affected_roles covers pool_admin, sub_admin, teacher, parent_account', () => {
    for (const role of ['pool_admin', 'sub_admin', 'teacher', 'parent_account']) {
      expect(KI_SWIMNOTE_INTRO.affected_roles).toContain(role);
    }
  });
  it('answer contains no price (no 원/₩)', () => {
    expect(KI_SWIMNOTE_INTRO.answer).not.toMatch(/원|₩|달러|\$/);
  });
  it('content mentions core roles (관리자, 강사, 학부모)', () => {
    expect(KI_SWIMNOTE_INTRO.content).toContain('관리자');
    expect(KI_SWIMNOTE_INTRO.content).toContain('강사');
    expect(KI_SWIMNOTE_INTRO.content).toContain('학부모');
  });
});

// ── SINTRO-02 ─────────────────────────────────────────────────────────────────

describe('SINTRO-02 — 스윔노트 알려줘 deterministic hit', () => {
  it('scores >= HIGH_CONFIDENCE against ki_swimnote_intro', () => {
    expect(sc(KI_SWIMNOTE_INTRO, '스윔노트 알려줘')).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
  });
  it('scores < HIGH_CONFIDENCE against ki_x_mode_intro (no bleed)', () => {
    expect(sc(KI_X_MODE_INTRO, '스윔노트 알려줘')).toBeLessThan(HIGH_CONFIDENCE);
  });
  it('ki_swimnote_intro ranks higher than ki_x_mode_intro for intro query', () => {
    expect(sc(KI_SWIMNOTE_INTRO, '스윔노트 알려줘'))
      .toBeGreaterThan(sc(KI_X_MODE_INTRO, '스윔노트 알려줘'));
  });
});

// ── SINTRO-03 ─────────────────────────────────────────────────────────────────

describe('SINTRO-03 — variation hits (morpheme-aware)', () => {
  for (const q of ['스윔노트 알려줘', '스윔노트가 뭐야', '스윔노트 설명해줘']) {
    it(`"${q}" scores >= HIGH_CONFIDENCE`, () => {
      expect(sc(KI_SWIMNOTE_INTRO, q)).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
    });
  }
  it('SWIMNOTE가 뭐야 — known limitation: score < HIGH_CONFIDENCE (no cross-lang synonym)', () => {
    expect(sc(KI_SWIMNOTE_INTRO, 'SWIMNOTE가 뭐야')).toBeLessThan(HIGH_CONFIDENCE);
  });
});

// ── SINTRO-04 ─────────────────────────────────────────────────────────────────

describe('SINTRO-04 — LLM 0 when intro is deterministically resolved', () => {
  it('score >= HIGH_CONFIDENCE means resolver returns without LLM', () => {
    expect(sc(KI_SWIMNOTE_INTRO, '스윔노트 알려줘')).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
    expect(KI_SWIMNOTE_INTRO.item_type).toBe('FAQ');
  });
  it('stored question 스윔노트가 무엇인가요 scores >= HIGH_CONFIDENCE', () => {
    expect(sc(KI_SWIMNOTE_INTRO, '스윔노트가 무엇인가요')).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
  });
});

// ── SINTRO-11 ─────────────────────────────────────────────────────────────────

describe('SINTRO-11 — X intro regression', () => {
  it('스윔노트X에 대해 알려줘 scores 90 against ki_x_mode_intro', () => {
    expect(sc(KI_X_MODE_INTRO, '스윔노트X에 대해 알려줘')).toBe(90);
  });
  it('스윔노트X에 대해 알려줘 scores < HIGH_CONFIDENCE against ki_swimnote_intro', () => {
    expect(sc(KI_SWIMNOTE_INTRO, '스윔노트X에 대해 알려줘')).toBeLessThan(HIGH_CONFIDENCE);
  });
  it('ki_x_mode_intro ranks higher than ki_swimnote_intro for X queries', () => {
    const q = '스윔노트X에 대해 알려줘';
    expect(sc(KI_X_MODE_INTRO, q)).toBeGreaterThan(sc(KI_SWIMNOTE_INTRO, q));
  });
  it('X모드가 뭐야 does not match ki_swimnote_intro', () => {
    expect(sc(KI_SWIMNOTE_INTRO, 'X모드가 뭐야')).toBeLessThan(HIGH_CONFIDENCE);
  });
});

// ── SINTRO-12 ─────────────────────────────────────────────────────────────────

describe('SINTRO-12 — Frontend Map navigation regression', () => {
  for (const q of ['X모드 화면 어디야', '대시보드 어디야', '화면 찾아줘', '스케줄 화면 어디야']) {
    it(`"${q}" does NOT hit ki_swimnote_intro`, () => {
      expect(sc(KI_SWIMNOTE_INTRO, q)).toBeLessThan(HIGH_CONFIDENCE);
    });
  }
});

// ── SINTRO-13 ─────────────────────────────────────────────────────────────────

describe('SINTRO-13 — creator hallucination guard', () => {
  it('이거 만든사람 누구야 IS followup (이거 = referential pronoun)', () => {
    expect(hasFollowupSignal('이거 만든사람 누구야')).toBe(true);
  });
  it('그거 만든사람 누구야 IS followup (그거 = referential pronoun)', () => {
    expect(hasFollowupSignal('그거 만든사람 누구야')).toBe(true);
  });
  it('스윔노트 만든사람 누구야 is NOT followup (explicit entity, no pronoun)', () => {
    expect(hasFollowupSignal('스윔노트 만든사람 누구야')).toBe(false);
  });
  it('누가 만들었어 is NOT followup (removed from FOLLOWUP_SIGNALS per §8)', () => {
    expect(hasFollowupSignal('누가 만들었어')).toBe(false);
  });
  it('만든사람 누구야 is NOT followup', () => {
    expect(hasFollowupSignal('만든사람 누구야')).toBe(false);
  });
});

// ── SINTRO-14 ─────────────────────────────────────────────────────────────────

describe('SINTRO-14 — full score ordering regression', () => {
  type Case = [string, typeof KI_SWIMNOTE_INTRO, number, string];
  const CASES: Case[] = [
    ['스윔노트 알려줘',         KI_SWIMNOTE_INTRO, HIGH_CONFIDENCE, 'intro >= 60'],
    ['스윔노트가 뭐야',         KI_SWIMNOTE_INTRO, HIGH_CONFIDENCE, 'intro >= 60'],
    ['스윔노트 설명해줘',       KI_SWIMNOTE_INTRO, HIGH_CONFIDENCE, 'intro >= 60'],
    ['스윔노트X에 대해 알려줘', KI_X_MODE_INTRO,   HIGH_CONFIDENCE, 'X intro >= 60'],
    ['스윔노트X에 대해 알려줘', KI_SWIMNOTE_INTRO, -1,             'swimnote intro < 60'],
    ['X모드 화면 어디야',        KI_SWIMNOTE_INTRO, -1,             'swimnote intro < 60'],
    ['이거 만든사람 누구야',     KI_SWIMNOTE_INTRO, -1,             'creator query < 60'],
  ];
  for (const [q, row, minScore, desc] of CASES) {
    it(`"${q}" vs ${row.id} — ${desc}`, () => {
      const s = sc(row, q);
      if (minScore === -1) {
        expect(s).toBeLessThan(HIGH_CONFIDENCE);
      } else {
        expect(s).toBeGreaterThanOrEqual(minScore);
      }
    });
  }
});
