/**
 * GrowthReportCard — Web Mockup Preview
 * VISUAL REFINEMENT ROUND 2 + X COLOR CORRECTION
 *
 * COLOR SYSTEM: SWIMNOTE X 전용 팔레트만 사용
 *   X_NAVY       #0F172A  — 제목 / 구조 / 강한 정보
 *   X_MINT       #2EC4B6  — accent / active / progress fill / 강조선
 *   X_MINT_LIGHT #E6FAF8  — 핵심 영역 배경 / badge 배경
 *   WHITE        #FFFFFF  — 일반 분석 section
 *   GRAY 계열            — metadata / divider / inactive
 *
 * 일반 SWIMNOTE aqua/cyan 계열 전면 제거.
 * 구조/레이아웃/typography 크기 변경 없음.
 */

import React from "react";

// ─── SWIMNOTE X Color System ──────────────────────────────────────────────────
const C = {
  xNavy:         "#0F172A",   // 제목 / 구조 / 강한 정보
  xMint:         "#2EC4B6",   // accent / progress fill / 강조선
  xMintLight:    "#E6FAF8",   // 핵심 영역 배경 / badge 배경
  white:         "#FFFFFF",   // 일반 분석 section 배경
  // Neutral gray 계열 (보조)
  body:          "#1A2E44",   // body text
  meta:          "#526C78",   // metadata
  metaDark:      "#3D5566",   // action label
  muted:         "#7A90A8",   // icon / inactive
  divider:       "#E8EDEF",   // neutral gray divider
  dividerA:      "#C2EDE9",   // mint-tinted Type A 경계
  progressTrack: "#D0F0ED",   // progress bar track
  bgPage:        "#F4F7FA",
};

// ─── Typography — 4단계 고정 ──────────────────────────────────────────────────
const T = {
  t1: { fontSize: 15, fontWeight: "600", color: C.xNavy }         as React.CSSProperties,
  t2: { fontSize: 14, color: C.body, lineHeight: "22px" }         as React.CSSProperties,
  t3: { fontSize: 12, color: C.meta }                              as React.CSSProperties,
  t4: { fontSize: 12, color: C.metaDark }                          as React.CSSProperties,
};

// ─── 실제 데이터 (서태웅 2026-08) ─────────────────────────────────────────────
const REPORT = {
  student: "서태웅",
  pool:    "토이키즈스윔클럽",
  period:  "2026년 8월",
  pct:     49,
  summary: "이번 수업에서는 자유형 두 바퀴로 몸을 풀고 IM을 수행한 뒤 킥 연습을 이어갔습니다. 이어 접영 글라이딩을 길게 하는 연습과 킥을 짧게 차는 연습을 진행했으며, 1분간 측정값이 기록되었습니다. 지속적인 반복 훈련을 통해 서태웅 학생의 수영 기술이 단계적으로 발전하고 있음을 확인할 수 있었습니다.",
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

// ─── SVG icons ────────────────────────────────────────────────────────────────
function IconHeart() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
function IconComment() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────
// Type A: X_MINT accent bar (핵심 섹션)
// Type B: X_NAVY accent bar (분석 섹션)
function SectionTitle({ label, type }: { label: string; type: "A" | "B" }) {
  const barColor = type === "A" ? C.xMint : C.xNavy;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ width: 3, height: 17, borderRadius: 2, backgroundColor: barColor, flexShrink: 0 }} />
      <span style={T.t1}>{label}</span>
    </div>
  );
}

function Hairline({ color = C.divider }: { color?: string }) {
  return <div style={{ height: 1, backgroundColor: color }} />;
}

// ─── Single Post ──────────────────────────────────────────────────────────────
function Post({ width, showProgress }: { width: number; showProgress: boolean }) {
  const metaParts = [REPORT.student, REPORT.pool, REPORT.period];

  return (
    <div style={{
      width,
      backgroundColor: C.white,
      borderTop: `1px solid ${C.divider}`,
      borderBottom: `1px solid ${C.divider}`,
      fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
      WebkitFontSmoothing: "antialiased" as any,
    }}>

      {/* ── HEADER (4-row) ──────────────────────────────────────────── */}
      <div style={{
        backgroundColor: C.white,
        borderBottom: `1px solid ${C.divider}`,
        padding: "12px 16px 14px",
        boxSizing: "border-box" as any,
      }}>

        {/* Row 1: 로고 + badge */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <img
            src="/__mockup/swimnote-ai-report-logo.png"
            alt="SwimNote AI REPORT"
            style={{ height: 28, width: "auto", display: "block" }}
          />
          <div style={{ marginLeft: "auto" }}>
            <div style={{
              backgroundColor: C.xMintLight,
              border: `1px solid ${C.xMint}`,
              borderRadius: 4,
              padding: "3px 8px",
              display: "inline-block",
            }}>
              <span style={{ ...T.t3, color: C.xNavy, fontWeight: "600" }}>월간 리포트</span>
            </div>
          </div>
        </div>

        {/* Row 2: 월간 성장 리포트 */}
        <div style={{
          fontSize: 18, fontWeight: "600", color: C.xNavy,
          letterSpacing: "-0.3px", marginBottom: 6,
        }}>
          월간 성장 리포트
        </div>

        {/* Row 3: 학생 · 수영장 · 월 */}
        <div style={{ ...T.t3, marginBottom: showProgress ? 12 : 0 }}>
          {metaParts.join("  ·  ")}
        </div>

        {/* Row 4 (Type C): 커리큘럼 진도 */}
        {showProgress && (
          <div style={{
            backgroundColor: C.xMintLight,
            borderRadius: 8,
            padding: "9px 12px",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 6,
            }}>
              <span style={{ ...T.t3, color: C.xNavy, fontWeight: "600" }}>커리큘럼 진도</span>
              <span style={{ fontSize: 13, fontWeight: "600", color: C.xMint }}>
                {REPORT.pct}%
              </span>
            </div>
            <div style={{
              height: 4, backgroundColor: C.progressTrack, borderRadius: 3, overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${REPORT.pct}%`,
                backgroundColor: C.xMint, borderRadius: 3,
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ── TYPE A: 이번 달 한눈에 보기 ──────────────────────────────── */}
      <div style={{
        backgroundColor: C.xMintLight,
        borderBottom: `1px solid ${C.dividerA}`,
        padding: "18px 16px",
      }}>
        <SectionTitle label="이번 달 한눈에 보기" type="A" />
        <p style={{ ...T.t2, margin: "10px 0 0 0" }}>{REPORT.summary}</p>
      </div>

      {/* ── TYPE B: 분석 섹션들 ───────────────────────────────────────── */}
      {REPORT.sections.map((sec) => (
        <React.Fragment key={sec.key}>
          <Hairline />
          <div style={{ backgroundColor: C.white, padding: "18px 16px" }}>
            <SectionTitle label={sec.label} type="B" />
            <p style={{ ...T.t2, margin: "10px 0 0 0" }}>{sec.text}</p>
          </div>
        </React.Fragment>
      ))}

      {/* ── TYPE A: 가정에서 함께해요 ────────────────────────────────── */}
      <Hairline color={C.dividerA} />
      <div style={{
        backgroundColor: C.xMintLight,
        padding: "18px 16px 20px",
      }}>
        <SectionTitle label="가정에서 함께해요" type="A" />
        <p style={{ ...T.t2, margin: "10px 0 0 0" }}>{REPORT.parentSupport}</p>
      </div>

      {/* ── ACTION ROW ───────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "10px 12px",
        borderTop: `1px solid ${C.divider}`,
        backgroundColor: C.white,
      }}>
        <button style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, padding: 6,
        }}>
          <IconHeart />
          <span style={T.t4}>좋아요</span>
        </button>
        <button style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4, padding: 6, marginLeft: 4,
        }}>
          <IconComment />
          <span style={T.t4}>댓글</span>
        </button>
        <div style={{ flex: 1 }} />
        <button style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          padding: "6px 10px", borderRadius: 6,
        }}>
          <IconDownload />
          <span style={T.t4}>PDF·공유</span>
        </button>
      </div>

    </div>
  );
}

// ─── Page layout ──────────────────────────────────────────────────────────────
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
