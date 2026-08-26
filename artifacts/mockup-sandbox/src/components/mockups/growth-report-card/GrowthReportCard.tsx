/**
 * GrowthReportFeedCard — Web Preview
 * Phase 3A: Before/After + 7 required screenshots
 * 실제 서태웅 2026-08 데이터
 */

// ─── Colors ──────────────────────────────────────────────────────────────────
const NAVY       = "#0F2742";
const AQUA       = "#25B7CF";
const AQUA_DIM   = "#1a97af";
const AQUA_SOFT  = "#D9F2F6";
const AQUA_MIST  = "#EEF9FB";
const WHITE      = "#FFFFFF";
const TEXT_NAVY  = "#0D2E5A";
const TEXT_SEC   = "#526C78";
const TEXT_MUTED = "#7A90A8";
const BG         = "#F0F5F8";

// ─── 실제 서태웅 2026-08 데이터 ─────────────────────────────────────────────
const D = {
  dateLabel:   "2026년 8월",
  student:     "서태웅",
  pool:        "토이키즈스윔클럽",
  headline:    "자유형·IM·킥과 접영 글라이딩을 차례로 연습한 수업",
  summary:     "이번 수업에서는 자유형 두 바퀴로 몸을 풀고 IM을 수행한 뒤 킥 연습을 이어갔습니다. 이어 접영 글라이딩을 길게 하는 연습과 킥을 짧게 차는 연습을 진행했으며, 1분간 측정값이 기록되었습니다.",
  keyPoints: [
    "자유형 두 바퀴와 IM을 진행했습니다.",
    "접영 글라이딩을 길게 하는 연습을 이어갔습니다.",
  ],
};
const FONT = "'Pretendard Variable', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export default function Preview() {
  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT }}>

      {/* ── SECTION 1: Before / After 비교 ──────────────────────── */}
      <Section title="Before (Phase 2) vs After (Phase 3A)" subtitle="side-by-side comparison">
        <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
          <Labeled label="Phase 2 — BEFORE">
            <BeforeCard width={358} />
          </Labeled>
          <Labeled label="Phase 3A — AFTER">
            <AfterCard width={358} showProgress={false} />
          </Labeled>
        </div>
      </Section>

      {/* ── SECTION 2: 3 Viewports — no progress ─────────────── */}
      <Section title="viewport × 3 — progress 없음 (서태웅)" subtitle="screenshots 1 · 2 · 3">
        <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", alignItems: "flex-start" }}>
          <Labeled label="iPhone SE 375">
            <AfterCard width={343} showProgress={false} />
          </Labeled>
          <Labeled label="iPhone 390">
            <AfterCard width={358} showProgress={false} />
          </Labeled>
          <Labeled label="iPhone Pro Max 430">
            <AfterCard width={398} showProgress={false} />
          </Labeled>
        </div>
      </Section>

      {/* ── SECTION 3: progress 있음 (Local fixture 48%) ────────── */}
      <Section title="progress 있음 상태 (Local fixture 48%)" subtitle="screenshot 7">
        <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", alignItems: "flex-start" }}>
          <Labeled label="iPhone 390 + progress">
            <AfterCard width={358} showProgress curriculumPct={48} />
          </Labeled>
          <Labeled label="iPhone Pro Max + progress">
            <AfterCard width={398} showProgress curriculumPct={48} />
          </Labeled>
        </div>
      </Section>

      {/* ── SECTION 4: Feed context — 일지 + 성장리포트 ──────────── */}
      <Section title="Feed context — 일지 카드 + 성장리포트 카드" subtitle="screenshot 5">
        <div style={{ display: "flex", justifyContent: "center" }}>
          <FeedContext />
        </div>
      </Section>

      {/* ── SECTION 5: Card 단독 crop ────────────────────────────── */}
      <Section title="Growth Report card 단독" subtitle="screenshot 4">
        <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", alignItems: "flex-start" }}>
          <Labeled label="without progress">
            <AfterCard width={358} showProgress={false} />
          </Labeled>
          <Labeled label="with progress (48%)">
            <AfterCard width={358} showProgress curriculumPct={48} />
          </Labeled>
        </div>
      </Section>

      {/* ── SECTION 6: 디자인 스펙 테이블 ───────────────────────── */}
      <Section title="Phase 3A Design Spec" subtitle="typography · spacing · structure">
        <SpecTable />
      </Section>

    </div>
  );
}

// ─── Phase 3A — AFTER Card ────────────────────────────────────────────────────
function AfterCard({ width, showProgress, curriculumPct = 0 }: {
  width: number; showProgress: boolean; curriculumPct?: number;
}) {
  const summary90 = D.summary.slice(0, 90);
  const hasTail   = D.summary.length > 90;

  return (
    <div style={{
      width,
      borderRadius: 20,
      overflow: "hidden",
      background: WHITE,
      boxShadow: "0 1px 10px rgba(15,39,66,0.08), 0 1px 3px rgba(15,39,66,0.04)",
    }}>
      {/* ZONE A: NAVY HEADER */}
      <div style={{ background: NAVY, padding: "16px 20px 14px" }}>
        {/* 브랜드 행 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 2, height: 12, borderRadius: 1, background: AQUA }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#A8CEDE", letterSpacing: 0.5 }}>SwimNote AI</span>
          </div>
          {/* 리포트 pill 배지 */}
          <div style={{
            background: "rgba(37,183,207,0.18)", borderRadius: 20,
            padding: "3px 9px",
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#6ED8EB", letterSpacing: 0.6 }}>
              월간 리포트
            </span>
          </div>
        </div>
        {/* 월 + 학생 */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: "#E8F4FF", letterSpacing: -0.5, lineHeight: "32px" }}>
            {D.dateLabel}
          </span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#E8F4FF", lineHeight: "20px" }}>{D.student}</div>
            <div style={{ fontSize: 10, color: "#7FA8C9", lineHeight: "15px", marginTop: 2 }}>{D.pool}</div>
          </div>
        </div>
      </div>

      {/* AQUA 구분선 */}
      <div style={{ height: 2, background: AQUA }} />

      {/* ZONE B: BODY */}
      <div style={{ background: AQUA_MIST, padding: "14px 20px 16px" }}>

        {/* B1: Headline (AQUA left-accent — 섹션 레이블 없음) */}
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          <div style={{ width: 3, background: AQUA, borderRadius: 2, flexShrink: 0 }} />
          <p style={{
            fontSize: 15, fontWeight: 600, color: NAVY,
            lineHeight: "22px", margin: 0, letterSpacing: -0.2,
          }}>
            {D.headline}
          </p>
        </div>

        {/* Summary: 2줄 clamp */}
        <p style={{
          fontSize: 13, color: TEXT_SEC, lineHeight: "20px", margin: 0,
          paddingLeft: 13,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {summary90}{hasTail ? "…" : ""}
        </p>

        {/* B2: progress */}
        {showProgress && curriculumPct > 0 && (
          <>
            <Hairline />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: TEXT_MUTED, letterSpacing: 0.3 }}>커리큘럼 진도</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: AQUA_DIM }}>{curriculumPct}%</span>
            </div>
            <div style={{ height: 2, background: AQUA_SOFT, borderRadius: 1, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${curriculumPct}%`, background: AQUA }} />
            </div>
          </>
        )}

        {/* B3: Growth excerpts (레이블 없음) */}
        {D.keyPoints.length > 0 && (
          <>
            <Hairline />
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {D.keyPoints.map((pt, i) => (
                <div key={i} style={{ display: "flex", gap: 7 }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: AQUA, marginTop: 8, flexShrink: 0 }} />
                  <p style={{
                    fontSize: 13, color: TEXT_SEC, lineHeight: "21px", margin: 0,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                    flex: 1,
                  }}>
                    {pt}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Action bar — 아이콘 전용 + 전체 보기 CTA */}
      <div style={{
        background: WHITE,
        borderTop: `1px solid ${AQUA_SOFT}`,
        padding: "10px 16px",
        display: "flex", alignItems: "center",
      }}>
        <IconBtn icon="♡" />
        <IconBtn icon="○" />
        <div style={{ flex: 1 }} />
        {/* 전체 보기 */}
        <span style={{ fontSize: 12, fontWeight: 600, color: AQUA, letterSpacing: 0.2, marginRight: 14, cursor: "pointer" }}>
          전체 보기 ›
        </span>
        <IconBtn icon="📷" />
        <IconBtn icon="↓" />
      </div>
    </div>
  );
}

// ─── Phase 2 BEFORE Card ──────────────────────────────────────────────────────
function BeforeCard({ width }: { width: number }) {
  return (
    <div style={{
      width, borderRadius: 20, overflow: "hidden", background: WHITE,
      boxShadow: "0 2px 16px rgba(15,39,66,0.12)",
    }}>
      {/* NAVY HEADER */}
      <div style={{ background: NAVY, padding: "18px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 3, height: 14, borderRadius: 2, background: AQUA }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#A8CEDE", letterSpacing: 0.5 }}>SwimNote AI</span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#7FA8C9", letterSpacing: 0.8 }}>MONTHLY 성장리포트</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: "#E8F4FF", letterSpacing: -0.5, lineHeight: "32px" }}>
            {D.dateLabel}
          </span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#E8F4FF", lineHeight: "20px" }}>{D.student}</div>
            <div style={{ fontSize: 11, color: "#7FA8C9", lineHeight: "16px" }}>{D.pool}</div>
          </div>
        </div>
      </div>
      <div style={{ height: 2, background: AQUA }} />
      {/* BODY */}
      <div style={{ background: AQUA_MIST, padding: "18px 20px 20px" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED, letterSpacing: 0.4 }}>이번 달 한눈에 보기</span>
        <div style={{ height: 1, background: AQUA_SOFT, margin: "5px 0 10px" }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: NAVY, lineHeight: "22px", margin: "0 0 7px", letterSpacing: -0.2 }}>
          {D.headline}
        </p>
        <p style={{ fontSize: 13, color: TEXT_SEC, lineHeight: "20px", margin: 0,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {D.summary}
        </p>
        <div style={{ height: 1, background: AQUA_SOFT, margin: "14px 0" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED, letterSpacing: 0.4 }}>이번 달 성장 포인트</span>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {D.keyPoints.concat(["접영 글라이딩을 길게 하는 연습을 이어갔습니다."]).map((pt, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: AQUA, marginTop: 8, flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: TEXT_SEC, lineHeight: "20px", margin: 0, flex: 1,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {pt}
              </p>
            </div>
          ))}
        </div>
      </div>
      {/* Action bar with text labels */}
      <div style={{ background: WHITE, borderTop: `1px solid ${AQUA_SOFT}`, padding: "11px 16px", display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: TEXT_MUTED, padding: "4px 9px", display: "flex", alignItems: "center", gap: 5 }}>♡ <span>좋아요</span></span>
        <span style={{ fontSize: 12, color: TEXT_MUTED, padding: "4px 9px", display: "flex", alignItems: "center", gap: 5 }}>○ <span>댓글</span></span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: TEXT_MUTED, padding: "4px 9px", display: "flex", alignItems: "center", gap: 5 }}>📷 <span>Instagram</span></span>
        <span style={{ fontSize: 12, color: TEXT_MUTED, padding: "4px 9px", display: "flex", alignItems: "center", gap: 5 }}>↓ <span>PDF</span></span>
      </div>
    </div>
  );
}

// ─── Feed Context ─────────────────────────────────────────────────────────────
function FeedContext() {
  return (
    <div style={{ width: 390, background: BG, paddingTop: 12, display: "flex", flexDirection: "column" }}>
      <DiaryCard date="2026년 8월 6일 (목)" text="태웅이는 킥을 짧게 차는 것이 잘 안되어 박자 연습을 진행했습니다." />
      <AfterCard width={358} showProgress={false} />
      <DiaryCard date="2026년 8월 13일 (목)" text="킥 연습을 중심으로 진행하며 접영 동작 연계 훈련을 시작했습니다." />
    </div>
  );
}

function DiaryCard({ date, text }: { date: string; text: string }) {
  return (
    <div style={{
      margin: "0 16px 14px",
      background: WHITE,
      borderRadius: 14,
      border: "1px solid #E8F4FF",
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 5 }}>{date}</div>
      <div style={{ fontSize: 13, fontWeight: 400, color: TEXT_SEC, lineHeight: "20px" }}>{text}</div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Hairline() {
  return <div style={{ height: 1, background: AQUA_SOFT, margin: "12px 0" }} />;
}

function IconBtn({ icon }: { icon: string }) {
  return <span style={{ fontSize: 16, color: TEXT_MUTED, padding: 7, cursor: "pointer" }}>{icon}</span>;
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "32px 24px 8px" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_NAVY, letterSpacing: 0.3 }}>{title}</div>
        <div style={{ fontSize: 11, color: TEXT_MUTED, letterSpacing: 0.5, marginTop: 4 }}>{subtitle}</div>
      </div>
      {children}
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ textAlign: "center", fontSize: 11, color: TEXT_MUTED, letterSpacing: 0.5 }}>{label}</div>
      {children}
    </div>
  );
}

function SpecTable() {
  const before: [string, string, string][] = [
    ["섹션 레이블",      '"이번 달 한눈에 보기" 명시',         '제거 → AQUA left-accent 라인으로 대체'],
    ["headline font",  "14px SemiBold",                     "15px SemiBold (가독성 향상)"],
    ["summary clamp",  "3줄",                                "2줄 (밀도 감소)"],
    ["growth points",  "섹션 레이블 + 3개 bullet",           "레이블 제거 + 최대 2개 excerpt"],
    ["divider 수",     "2개 (레이블 뒤 + growth 앞)",         "1개 (zone 당 1 hairline)"],
    ["padding top (NAVY)", "18px",                           "16px"],
    ["padding top (BODY)", "18px",                           "14px"],
    ["padding bottom (BODY)", "20px",                       "16px"],
    ["NAVY bar accent", "3×14px",                            "2×12px (더 가볍게)"],
    ["리포트 레이블",   '"MONTHLY 성장리포트" plain text',    '"월간 리포트" pill badge (AQUA 반투명)'],
    ["progress bar h", "3px",                                "2px (덜 두껍게)"],
    ["shadow",         "0 2px 16px rgba 0.12",              "0 1px 10px rgba 0.08 (더 가볍게)"],
    ["action bar",     "아이콘 + 텍스트 레이블",              "아이콘 전용 + 전체 보기 CTA"],
    ["action padding", "11px 16px",                         "10px 16px"],
  ];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ fontSize: 12, color: TEXT_SEC, borderCollapse: "collapse", width: "100%", maxWidth: 720, margin: "0 auto" }}>
        <thead>
          <tr style={{ background: AQUA_MIST }}>
            <th style={th}>항목</th>
            <th style={th}>Before (Phase 2)</th>
            <th style={th}>After (Phase 3A)</th>
          </tr>
        </thead>
        <tbody>
          {before.map(([k, b, a], i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? WHITE : AQUA_MIST }}>
              <td style={td}>{k}</td>
              <td style={{ ...td, color: "#c0392b", textDecoration: "line-through" }}>{b}</td>
              <td style={{ ...td, color: "#0D5C8C", fontWeight: 500 }}>{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px",
  color: TEXT_MUTED, borderBottom: `1px solid ${AQUA_SOFT}`, fontWeight: 600, fontSize: 11,
};
const td: React.CSSProperties = { padding: "5px 12px", fontFamily: "monospace" };
