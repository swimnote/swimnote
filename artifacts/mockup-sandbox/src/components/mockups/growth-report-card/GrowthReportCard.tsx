/**
 * GrowthReportCard Web Preview — Phase 3B
 * Instagram-inspired Full Report Feed UI
 * 실제 서태웅 2026-08 데이터
 */
import React from "react";

// ─── Colors ──────────────────────────────────────────────────────────────────
const NAVY       = "#0D2E5A";
const AQUA       = "#25B7CF";
const AQUA_DIM   = "#1a97af";
const AQUA_SOFT  = "#D9F2F6";
const AQUA_MIST  = "#EEF9FB";
const WHITE      = "#FFFFFF";
const BODY_TEXT  = "#1A2E44";
const META_TEXT  = "#526C78";
const MUTED_TEXT = "#7A90A8";
const BORDER_CLR = "#E8F0F7";
const BG         = "#F0F4F8";

const FONT = "'Pretendard Variable', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

// ─── Typography system (4 levels, spec §4) ────────────────────────────────────
const T = {
  sectionTitle: { fontSize: 15, fontWeight: "600", color: NAVY } as React.CSSProperties,
  body:         { fontSize: 14, color: BODY_TEXT, lineHeight: "22px" } as React.CSSProperties,
  meta:         { fontSize: 12, color: META_TEXT } as React.CSSProperties,
  action:       { fontSize: 12, color: MUTED_TEXT } as React.CSSProperties,
};

// ─── 실제 서태웅 2026-08 데이터 ─────────────────────────────────────────────
const REPORT = {
  period:  "2026년 8월",
  student: "서태웅",
  pool:    "토이키즈스윔클럽",
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
      key:   "parent_support",
      label: "가정에서 함께해요",
      text:  "오늘 수업에서는 자유형, IM, 킥, 접영 글라이딩을 차례로 연습하고 1분간 측정값을 기록했습니다. 가정에서는 수영 후 충분한 수분 보충과 스트레칭을 함께해 주시고, 아이가 즐겁게 수영을 이어갈 수 있도록 긍정적인 응원을 부탁드립니다.",
    },
  ],
};

export default function Preview() {
  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT }}>

      {/* ── 3 Viewports side-by-side ────────────────────────────── */}
      <SectionHeader title="Full Report Feed — 3 Viewports" sub="375 · 390 · 430  |  progress 없음 (서태웅)" />
      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", padding: "0 20px 32px" }}>
        <FeedPage width={375} label="iPhone SE 375" />
        <FeedPage width={390} label="iPhone 390" />
        <FeedPage width={430} label="iPhone Pro Max 430" />
      </div>

      {/* ── progress 있음 (48%) ──────────────────────────────────── */}
      <SectionHeader title="progress 있음 — 48%" sub="Local fixture · X mode 학생 시뮬레이션" />
      <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", padding: "0 20px 32px" }}>
        <FeedPage width={390} label="iPhone 390 + progress 48%" curriculumPct={48} />
        <FeedPage width={430} label="iPhone 430 + progress 48%" curriculumPct={48} />
      </div>

      {/* ── Feed context (일지 + 리포트 + 일지) ─────────────────── */}
      <SectionHeader title="Feed Context" sub="일지 카드 + 성장리포트 + 일지 카드" />
      <div style={{ display: "flex", justifyContent: "center", padding: "0 20px 32px" }}>
        <FeedContext />
      </div>

      {/* ── Typography spec table ────────────────────────────────── */}
      <SectionHeader title="Typography System (4 levels)" sub="spec §4 · §16" />
      <div style={{ padding: "0 24px 40px" }}>
        <TypographyTable />
      </div>

    </div>
  );
}

// ─── Feed Page (full card scroll simulation) ──────────────────────────────────
function FeedPage({ width, label, curriculumPct = 0 }: {
  width: number; label: string; curriculumPct?: number;
}) {
  const showProgress = curriculumPct > 0;

  const metaParts = [
    REPORT.period,
    REPORT.student,
    REPORT.pool,
    showProgress ? `진도 ${curriculumPct}%` : null,
  ].filter(Boolean) as string[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ textAlign: "center", ...T.action }}>{label}</div>
      {/* Phone frame */}
      <div style={{ width, background: BG, borderRadius: 4, overflow: "hidden" }}>
        {/* Feed card */}
        <div style={{
          background: WHITE,
          borderTop: `1px solid ${AQUA_SOFT}`,
          borderBottom: `1px solid ${AQUA_SOFT}`,
          marginBottom: 12,
        }}>
          {/* ── COMPACT HEADER ── */}
          <div style={{
            padding: "14px 16px 12px",
            borderBottom: `1px solid ${BORDER_CLR}`,
          }}>
            {/* ROW 1: logo + badge */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <img
                src="/__mockup/swimnote-ai-report-logo.png"
                alt="SwimNote AI REPORT"
                style={{ height: 22, width: "auto", objectFit: "contain" }}
              />
              <div style={{
                background: AQUA_MIST,
                border: `1px solid ${AQUA_SOFT}`,
                borderRadius: 20,
                padding: "3px 9px",
              }}>
                <span style={{ ...T.action, color: AQUA_DIM, fontWeight: 600, letterSpacing: "0.4px" }}>
                  월간 리포트
                </span>
              </div>
            </div>
            {/* ROW 2: metadata */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", marginTop: 7, gap: 0 }}>
              {metaParts.map((p, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center" }}>
                  {i > 0 && <span style={{ ...T.meta, color: AQUA_SOFT, margin: "0 5px" }}>·</span>}
                  <span style={{ ...T.meta }}>{p}</span>
                </span>
              ))}
            </div>
          </div>

          {/* ── SUMMARY (이번 달 한눈에 보기) ── */}
          <div style={{ background: AQUA_MIST, padding: "16px 20px" }}>
            <SectionTitle label="이번 달 한눈에 보기" />
            <p style={{ ...T.body, margin: "8px 0 0" }}>{REPORT.summary}</p>
          </div>

          {/* ── PROGRESS ── */}
          {showProgress && (
            <>
              <Hairline />
              <div style={{ padding: "14px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ ...T.meta }}>커리큘럼 진도</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: AQUA_DIM }}>{curriculumPct}%</span>
                </div>
                <div style={{ height: 2, background: AQUA_SOFT, borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${curriculumPct}%`, background: AQUA }} />
                </div>
              </div>
            </>
          )}

          {/* ── BODY SECTIONS ── */}
          {REPORT.sections.filter(s => s.key !== "parent_support").map((sec) => (
            <React.Fragment key={sec.key}>
              <Hairline />
              <div style={{ padding: "14px 20px" }}>
                <SectionTitle label={sec.label} />
                <p style={{ ...T.body, margin: "8px 0 0" }}>{sec.text}</p>
              </div>
            </React.Fragment>
          ))}

          {/* ── 가정에서 함께해요 ── */}
          {REPORT.sections.filter(s => s.key === "parent_support").map((sec) => (
            <React.Fragment key={sec.key}>
              <Hairline />
              <div style={{
                background: AQUA_MIST,
                borderTop: `1px solid ${AQUA_SOFT}`,
                padding: "16px 20px 18px",
              }}>
                <SectionTitle label={sec.label} />
                <p style={{ ...T.body, margin: "8px 0 0" }}>{sec.text}</p>
              </div>
            </React.Fragment>
          ))}

          {/* ── ACTION BAR ── */}
          <div style={{
            display: "flex", alignItems: "center",
            padding: "11px 16px",
            borderTop: `1px solid ${BORDER_CLR}`,
            background: WHITE,
          }}>
            <ActionIcon icon="♡" />
            <ActionIcon icon="○" />
            <div style={{ flex: 1 }} />
            <ActionIcon icon="↓" />
            <div style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "5px 10px", borderRadius: 8, cursor: "pointer",
            }}>
              <span style={{ ...T.action, color: AQUA_DIM, fontWeight: 600 }}>PDF·공유</span>
              <span style={{ color: AQUA_DIM, fontSize: 11 }}>›</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Feed Context ─────────────────────────────────────────────────────────────
function FeedContext() {
  return (
    <div style={{ width: 390, background: BG }}>
      <DiaryCard date="2026년 8월 6일 (목)" text="태웅이는 킥을 짧게 차는 것이 잘 안되어 박자 연습을 진행했습니다. 자유형 동작과의 연계를 위해 반복 훈련을 이어갔습니다." />
      {/* Growth Report — full card */}
      <div style={{ background: WHITE, borderTop: `1px solid ${AQUA_SOFT}`, borderBottom: `1px solid ${AQUA_SOFT}`, marginBottom: 12 }}>
        {/* header */}
        <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${BORDER_CLR}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <img src="/__mockup/swimnote-ai-report-logo.png" alt="SwimNote AI REPORT" style={{ height: 22, width: "auto" }} />
            <div style={{ background: AQUA_MIST, border: `1px solid ${AQUA_SOFT}`, borderRadius: 20, padding: "3px 9px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: AQUA_DIM, letterSpacing: "0.4px" }}>월간 리포트</span>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", marginTop: 7, gap: 0 }}>
            {[REPORT.period, REPORT.student, REPORT.pool].map((p, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && <span style={{ ...T.meta, color: AQUA_SOFT, margin: "0 5px" }}>·</span>}
                <span style={{ ...T.meta }}>{p}</span>
              </span>
            ))}
          </div>
        </div>
        <div style={{ background: AQUA_MIST, padding: "14px 20px" }}>
          <SectionTitle label="이번 달 한눈에 보기" />
          <p style={{ ...T.body, margin: "8px 0 0" }}>{REPORT.summary}</p>
        </div>
        {REPORT.sections.filter(s => s.key !== "parent_support").map(sec => (
          <React.Fragment key={sec.key}>
            <Hairline />
            <div style={{ padding: "14px 20px" }}>
              <SectionTitle label={sec.label} />
              <p style={{ ...T.body, margin: "8px 0 0" }}>{sec.text}</p>
            </div>
          </React.Fragment>
        ))}
        {REPORT.sections.filter(s => s.key === "parent_support").map(sec => (
          <React.Fragment key={sec.key}>
            <Hairline />
            <div style={{ background: AQUA_MIST, borderTop: `1px solid ${AQUA_SOFT}`, padding: "16px 20px 18px" }}>
              <SectionTitle label={sec.label} />
              <p style={{ ...T.body, margin: "8px 0 0" }}>{sec.text}</p>
            </div>
          </React.Fragment>
        ))}
        <div style={{ display: "flex", alignItems: "center", padding: "11px 16px", borderTop: `1px solid ${BORDER_CLR}` }}>
          <ActionIcon icon="♡" /><ActionIcon icon="○" />
          <div style={{ flex: 1 }} />
          <ActionIcon icon="↓" />
          <span style={{ fontSize: 12, fontWeight: 600, color: AQUA_DIM, padding: "5px 10px" }}>PDF·공유 ›</span>
        </div>
      </div>
      <DiaryCard date="2026년 8월 13일 (목)" text="킥 연습을 중심으로 진행하며 접영 동작 연계 훈련을 시작했습니다." />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function SectionTitle({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 3, height: 15, borderRadius: 2, background: AQUA, flexShrink: 0 }} />
      <span style={{ ...T.sectionTitle }}>{label}</span>
    </div>
  );
}

function Hairline() {
  return <div style={{ height: 1, background: BORDER_CLR }} />;
}

function ActionIcon({ icon }: { icon: string }) {
  return <span style={{ padding: 7, fontSize: 18, color: MUTED_TEXT, cursor: "pointer" }}>{icon}</span>;
}

function DiaryCard({ date, text }: { date: string; text: string }) {
  return (
    <div style={{ background: WHITE, borderRadius: 12, margin: "0 16px 12px", padding: "12px 14px", border: `1px solid ${BORDER_CLR}` }}>
      <div style={{ ...T.action, marginBottom: 5 }}>{date}</div>
      <p style={{ ...T.body, margin: 0 }}>{text}</p>
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 0 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, letterSpacing: "0.3px" }}>{title}</div>
      <div style={{ ...T.action, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function TypographyTable() {
  const rows = [
    ["T1", "Section Title", "15px", "SemiBold (600)", NAVY, "핵심 성장, 수영 교육과정 진행, …"],
    ["T2", "Body Text",     "14px", "Regular (400)",  BODY_TEXT, "리포트 본문 내용"],
    ["T3", "Metadata",      "12px", "Regular (400)",  META_TEXT, "월·학생·수영장·진도% 메타"],
    ["T4", "Action / Footer","12px","Regular / SemiBold", MUTED_TEXT, "액션바, PDF·공유"],
  ];
  return (
    <table style={{ width: "100%", maxWidth: 680, margin: "0 auto", borderCollapse: "collapse", fontSize: 12, color: BODY_TEXT }}>
      <thead>
        <tr style={{ background: AQUA_MIST }}>
          {["레벨","용도","Size","Weight","Color","예시"].map(h => (
            <th key={h} style={{ padding: "7px 12px", textAlign: "left", color: MUTED_TEXT, fontWeight: 600, borderBottom: `1px solid ${AQUA_SOFT}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([level, role, size, weight, color, ex], i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? WHITE : AQUA_MIST }}>
            <td style={{ padding: "6px 12px", fontWeight: 700, color: AQUA_DIM }}>{level}</td>
            <td style={{ padding: "6px 12px" }}>{role}</td>
            <td style={{ padding: "6px 12px", fontFamily: "monospace" }}>{size}</td>
            <td style={{ padding: "6px 12px", fontFamily: "monospace" }}>{weight}</td>
            <td style={{ padding: "6px 12px" }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color, marginRight: 5, verticalAlign: "middle" }} />
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>{color}</span>
            </td>
            <td style={{ padding: "6px 12px", color: META_TEXT }}>{ex}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
