/**
 * GrowthReportCard — Web Mockup Preview (REDESIGN FROM ZERO)
 * spec §1~§19
 *
 * 하나의 긴 Instagram 게시물 구조:
 *   1. TOP IDENTITY HEADER
 *   2. REPORT META STRIP
 *   3. SUMMARY
 *   4. REPORT SECTIONS
 *   5. PARENT SUPPORT
 *   6. ACTION ROW
 *
 * 3 viewport: 375 · 390 · 430
 * progress 없음 / 있음(48%) 두 케이스
 */

import React from "react";

// ─── Color system (spec §5) ─────────────────────────────────────────────
const C = {
  deepNavy:  "#0D2E5A",
  aqua:      "#25B7CF",
  aquaSoft:  "#D9F2F6",
  aquaMist:  "#F0FAFC",
  aquaText:  "#1899B5",
  body:      "#1A2E44",
  meta:      "#526C78",
  muted:     "#7A90A8",
  divider:   "#EBF1F7",
  white:     "#FFFFFF",
  bgPage:    "#F4F7FA",
};

// ─── Typography (spec §6) — 4단계 고정 ─────────────────────────────────
const T = {
  t1: { fontSize: 15, fontWeight: "600", color: C.deepNavy } as React.CSSProperties,
  t2: { fontSize: 14, color: C.body, lineHeight: "22px" }    as React.CSSProperties,
  t3: { fontSize: 12, color: C.meta }                         as React.CSSProperties,
  t4: { fontSize: 12, color: C.muted }                        as React.CSSProperties,
};

// ─── 실제 데이터 (서태웅 2026-08) ──────────────────────────────────────
const REPORT = {
  student:  "서태웅",
  pool:     "토이키즈스윔클럽",
  period:   "2026년 8월",
  pct:      49,
  summary:  "이번 수업에서는 자유형 두 바퀴로 몸을 풀고 IM을 수행한 뒤 킥 연습을 이어갔습니다. 이어 접영 글라이딩을 길게 하는 연습과 킥을 짧게 차는 연습을 진행했으며, 1분간 측정값이 기록되었습니다. 지속적인 반복 훈련을 통해 서태웅 학생의 수영 기술이 단계적으로 발전하고 있음을 확인할 수 있었습니다.",
  sections: [
    {
      key:   "swimming_progress",
      label: "수영 교육과정 진행",
      text:  "오늘 수업에서는 자유형 두 바퀴와 IM을 수행한 뒤 킥 연습을 진행했습니다. 이후 접영 글라이딩을 길게 하는 연습과 킥을 짧게 차는 연습을 이어갔고, 1분간 측정값이 기록되었습니다. 자유형과 접영을 연계한 훈련 구성이 서태웅 학생의 전체 수영 능력 향상에 도움이 되고 있습니다.",
    },
    {
      key:   "longitudinal_comparison",
      label: "이전 기간 비교",
      text:  "이번 기록이 이후 수업에서의 변화를 비교할 때 기준점이 됩니다. 지속적인 킥 연습과 글라이딩 동작이 이전 기간의 기초 체력 훈련과 자연스럽게 연계되고 있으며, 수업별 기록 데이터가 쌓이면서 보다 정확한 비교 분석이 가능해질 것입니다.",
    },
    {
      key:   "next_growth_direction",
      label: "다음 수업 방향",
      text:  "다음 수업에서는 IM 연계 구성을 유지하면서 접영 킥의 리듬감을 더욱 발전시키는 것을 목표로 합니다. 자유형 지구력 향상을 위한 반복 훈련도 병행할 예정입니다.",
    },
  ],
  parentSupport: "오늘 수업에서는 자유형, IM, 킥, 접영 글라이딩을 차례로 연습하고 1분간 측정값을 기록했습니다. 가정에서는 수영 후 충분한 수분 보충과 스트레칭을 함께해 주시고, 아이가 즐겁게 수영을 이어갈 수 있도록 긍정적인 응원을 부탁드립니다.",
};

// ─── Sub-components ─────────────────────────────────────────────────────

function SectionTitle({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 3, height: 16, borderRadius: 2,
        backgroundColor: C.aqua, flexShrink: 0,
      }} />
      <span style={T.t1}>{label}</span>
    </div>
  );
}

function Hairline() {
  return <div style={{ height: 1, backgroundColor: C.divider }} />;
}

// Heart icon (간단한 SVG)
function IconHeart() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ─── Single Post (하나의 게시물) ────────────────────────────────────────
function Post({ width, showProgress }: { width: number; showProgress: boolean }) {
  return (
    <div style={{
      width,
      backgroundColor: C.white,
      borderTop: `1px solid ${C.divider}`,
      borderBottom: `1px solid ${C.divider}`,
      fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
      WebkitFontSmoothing: "antialiased" as any,
    }}>

      {/* 1. TOP IDENTITY HEADER (spec §3) */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: `1px solid ${C.divider}`,
        minHeight: 52,
        boxSizing: "border-box" as any,
      }}>
        {/* LEFT: 실제 로고 — height 28px (+27%), width auto, ratio 유지 */}
        <img
          src="/__mockup/swimnote-ai-report-logo.png"
          alt="SwimNote AI REPORT"
          style={{ height: 28, width: "auto", display: "block" }}
        />

        {/* RIGHT: 월간 리포트 + 학생/수영장 */}
        <div style={{ marginLeft: "auto", textAlign: "right" as any, paddingRight: 2 }}>
          <div style={{ ...T.t3, color: C.aquaText, fontWeight: "600" }}>
            월간 리포트
          </div>
          <div style={{ ...T.t3, marginTop: 2 }}>
            {REPORT.student}  {REPORT.pool}
          </div>
        </div>
      </div>

      {/* 2. REPORT META STRIP (spec §4) */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 16px",
        borderBottom: `1px solid ${C.divider}`,
        flexWrap: "wrap" as any,
      }}>
        <span style={T.t3}>{REPORT.period}</span>
        {showProgress && (
          <>
            <span style={{ ...T.t3, color: C.aquaSoft }}>·</span>
            <span style={{ ...T.t3, color: C.aquaText }}>현재 진도 {REPORT.pct}%</span>
          </>
        )}
      </div>

      {/* 3. SUMMARY (spec §7) */}
      <div style={{
        backgroundColor: C.aquaMist,
        padding: "16px 16px",
      }}>
        <SectionTitle label="이번 달 한눈에 보기" />
        <p style={{ ...T.t2, margin: "8px 0 0 0" }}>
          {REPORT.summary}
        </p>
      </div>

      {/* 커리큘럼 진도 바 */}
      {showProgress && (
        <>
          <Hairline />
          <div style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={T.t3}>커리큘럼 진도</span>
              <span style={{ ...T.t3, color: C.aquaText, fontWeight: "600" }}>{REPORT.pct}%</span>
            </div>
            <div style={{ height: 3, backgroundColor: C.aquaSoft, borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${REPORT.pct}%`,
                backgroundColor: C.aqua,
                borderRadius: 2,
              }} />
            </div>
          </div>
        </>
      )}

      {/* 4. REPORT SECTIONS (spec §8) */}
      {REPORT.sections.map((sec) => (
        <React.Fragment key={sec.key}>
          <Hairline />
          <div style={{ padding: "16px 16px" }}>
            <SectionTitle label={sec.label} />
            <p style={{ ...T.t2, margin: "8px 0 0 0" }}>{sec.text}</p>
          </div>
        </React.Fragment>
      ))}

      {/* 5. PARENT SUPPORT (spec §11) */}
      <Hairline />
      <div style={{
        backgroundColor: C.aquaMist,
        borderTop: `1px solid ${C.aquaSoft}`,
        padding: "16px 16px 20px",
      }}>
        <SectionTitle label="가정에서 함께해요" />
        <p style={{ ...T.t2, margin: "8px 0 0 0" }}>
          {REPORT.parentSupport}
        </p>
      </div>

      {/* 6. ACTION ROW (spec §12) */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 14px",
        borderTop: `1px solid ${C.divider}`,
        backgroundColor: C.white,
      }}>
        <button style={{ background: "none", border: "none", padding: 6, cursor: "pointer", lineHeight: 0 }}>
          <IconHeart />
        </button>
        <button style={{ background: "none", border: "none", padding: 6, cursor: "pointer", lineHeight: 0 }}>
          <IconComment />
        </button>
        <div style={{ flex: 1 }} />
        <button style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
          borderRadius: 6,
        }}>
          <IconDownload />
          <span style={T.t4}>PDF·공유</span>
        </button>
      </div>

    </div>
  );
}

// ─── Page layout ─────────────────────────────────────────────────────────
// ?p=1 → progress 있음(49%), 없으면 progress 없음
// 전체 페이지 너비 = viewport 너비 (단일 포스트)
export default function GrowthReportCard() {
  const showProgress = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("p") === "1";

  return (
    <div style={{
      backgroundColor: C.bgPage,
      minHeight: "100vh",
      fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
    }}>
      <Post width={window?.innerWidth ?? 390} showProgress={showProgress} />
    </div>
  );
}
