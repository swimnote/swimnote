/**
 * GrowthReportFeedCard Phase 2 — Web Preview
 * 실제 서태웅 2026-08 데이터 사용
 */

// ─── Colors ──────────────────────────────────────────────────────────────────
const NAVY       = "#0F2742";
const AQUA       = "#25B7CF";
const AQUA_DIM   = "#1a97af";
const AQUA_SOFT  = "#D9F2F6";
const AQUA_MIST  = "#EEF9FB";
const WHITE      = "#FFFFFF";
const TEXT_NAVY  = "#0D2E5A";
const TEXT_BODY  = "#1A2E44";
const TEXT_SEC   = "#526C78";
const TEXT_MUTED = "#7A90A8";
const BG         = "#F5FAFB";

// ─── 실제 서태웅 2026-08 데이터 ─────────────────────────────────────────────
const REPORT = {
  dateLabel:   "2026년 8월",
  studentName: "서태웅",
  poolName:    "토이키즈스윔클럽",
  headline:    "자유형·IM·킥과 접영 글라이딩을 차례로 연습한 수업",
  keyPoints: [
    "자유형 두 바퀴와 IM을 진행했습니다.",
    "접영 글라이딩을 길게 하는 연습을 이어갔습니다.",
    "1분간 측정값이 기록되었습니다.",
  ],
  summaryText: "이번 수업에서는 자유형 두 바퀴로 몸을 풀고 IM을 수행한 뒤 킥 연습을 이어갔습니다. 이어 접영 글라이딩을 길게 하는 연습과 킥을 짧게 차는 연습을 진행했으며, 1분간 측정값이 기록되었습니다.",
  curriculumPct: 0,  // 서태웅 = X mode 없음, 진도 0
  hasEnoughData: false,
  // non-empty sections
  sections: [
    {
      key: "swimming_progress",
      label: "이번 달 수영에서 배운 것",
      text: "오늘 수업에서는 자유형 두 바퀴와 IM을 수행한 뒤 킥 연습을 진행했습니다. 이후 접영 글라이딩을 길게 하는 연습과 킥을 짧게 차는 연습을 이어갔고, 1분간 측정값이 기록되었습니다.",
    },
    {
      key: "longitudinal_comparison",
      label: "지난달보다 이렇게 이어졌어요",
      text: "이번 기록이 이후 수업에서의 변화를 비교할 때 기준점이 됩니다.",
    },
    {
      key: "parent_support",
      label: "집에서는 이렇게 함께해주세요",
      text: "오늘 수업에서는 자유형, IM, 킥, 접영 글라이딩을 차례로 연습하고 1분간 측정값을 기록했습니다.",
    },
  ],
};

// ─── Font ─────────────────────────────────────────────────────────────────────
const FONT = "'Pretendard Variable', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export default function Preview() {
  return (
    <div style={{
      minHeight: "100vh", background: BG, fontFamily: FONT,
      padding: "28px 0", display: "flex", flexDirection: "column", gap: 36,
    }}>
      <div style={{ textAlign: "center", color: TEXT_MUTED, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
        Growth Report Feed Card — Phase 2 — 서태웅 2026-08
      </div>

      {/* iPhone 390 뷰포트 */}
      <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", padding: "0 24px" }}>
        <div>
          <ViewportLabel label="iPhone 390 (Standard)" />
          <FeedCard width={358} showProgress={false} />
        </div>
        <div>
          <ViewportLabel label="iPhone 430 (Pro Max)" />
          <FeedCard width={398} showProgress={true} curriculumPct={48} />
        </div>
        <div>
          <ViewportLabel label="iPhone 375 (SE)" />
          <FeedCard width={343} showProgress={false} />
        </div>
      </div>

      {/* Feed context: 일지 카드와 함께 */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: 390 }}>
          <ViewportLabel label="Feed Context — 일지 + 성장리포트" />
          <div style={{ background: BG, padding: "12px 0", display: "flex", flexDirection: "column", gap: 0 }}>
            <DiaryCard />
            <FeedCard width={358} showProgress={false} />
            <DiaryCard alt />
          </div>
        </div>
      </div>

      {/* 스펙 테이블 */}
      <div style={{ display: "flex", justifyContent: "center", padding: "0 24px" }}>
        <SpecTable />
      </div>
    </div>
  );
}

// ─── Feed Card ────────────────────────────────────────────────────────────────
function FeedCard({ width, showProgress, curriculumPct = 0 }: { width: number; showProgress: boolean; curriculumPct?: number }) {
  const cardStyle: React.CSSProperties = {
    width, margin: "0 auto",
    borderRadius: 20,
    overflow: "hidden",
    background: WHITE,
    boxShadow: "0 2px 14px rgba(15,39,66,0.10), 0 1px 4px rgba(15,39,66,0.05)",
  };

  return (
    <div style={cardStyle}>
      {/* ZONE A: NAVY HEADER */}
      <div style={{ background: NAVY, padding: "18px 20px 16px" }}>
        {/* 브랜드 라인 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 3, height: 14, borderRadius: 2, background: AQUA }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#A8CEDE", letterSpacing: 0.5 }}>SwimNote AI</span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#7FA8C9", letterSpacing: 0.8 }}>MONTHLY 성장리포트</span>
        </div>
        {/* 월 + 학생 */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: "#E8F4FF", letterSpacing: -0.5, lineHeight: "32px" }}>
            {REPORT.dateLabel}
          </span>
          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#E8F4FF", lineHeight: "20px" }}>{REPORT.studentName}</span>
            <span style={{ fontSize: 11, color: "#7FA8C9", lineHeight: "16px" }}>{REPORT.poolName}</span>
          </div>
        </div>
      </div>

      {/* AQUA 구분선 */}
      <div style={{ height: 2, background: AQUA }} />

      {/* ZONE B: CONTENT */}
      <div style={{ background: AQUA_MIST, padding: "18px 20px 20px" }}>

        {/* B1: 이번 달 한눈에 보기 */}
        <SectionLabel text="이번 달 한눈에 보기" />
        <div style={{ height: 1, background: AQUA_SOFT, marginTop: 5, marginBottom: 10 }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: NAVY, lineHeight: "22px", margin: "0 0 7px", letterSpacing: -0.2 }}>
          {REPORT.headline}
        </p>
        <p style={{ fontSize: 13, color: TEXT_SEC, lineHeight: "20px", margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {REPORT.summaryText}
        </p>

        {/* B2: 커리큘럼 진도 */}
        {showProgress && curriculumPct > 0 && (
          <>
            <Divider />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: TEXT_MUTED }}>현재 커리큘럼 진도</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: AQUA_DIM }}>{curriculumPct}%</span>
            </div>
            <div style={{ height: 3, background: AQUA_SOFT, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${curriculumPct}%`, background: AQUA, borderRadius: 2 }} />
            </div>
          </>
        )}

        {/* B3: 이번 달 성장 포인트 */}
        {REPORT.sections.length > 0 && (
          <>
            <Divider />
            <SectionLabel text="이번 달 성장 포인트" />
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
              {REPORT.sections.map((sec, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 3, height: 3, borderRadius: "50%", background: AQUA, marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_NAVY, letterSpacing: 0.2 }}>{sec.label}</span>
                  </div>
                  <p style={{ fontSize: 12, color: TEXT_SEC, lineHeight: "19px", margin: 0, paddingLeft: 9, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {sec.text}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Action Bar */}
      <div style={{ background: WHITE, borderTop: `1px solid ${AQUA_SOFT}`, padding: "11px 16px", display: "flex", alignItems: "center" }}>
        <ActionBtn icon="♡" label="좋아요" />
        <ActionBtn icon="○" label="댓글" />
        <div style={{ flex: 1 }} />
        <ActionBtn icon="📷" label="Instagram" />
        <ActionBtn icon="↓" label="PDF" />
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED, letterSpacing: 0.4 }}>{text}</span>;
}

function Divider() {
  return <div style={{ height: 1, background: AQUA_SOFT, margin: "14px 0" }} />;
}

function ActionBtn({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", cursor: "pointer" }}>
      <span style={{ fontSize: 15, color: TEXT_MUTED }}>{icon}</span>
      <span style={{ fontSize: 12, color: TEXT_MUTED }}>{label}</span>
    </div>
  );
}

function ViewportLabel({ label }: { label: string }) {
  return <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 8, textAlign: "center", letterSpacing: 0.5 }}>{label}</div>;
}

// ─── Diary Card (for feed context) ────────────────────────────────────────────
function DiaryCard({ alt }: { alt?: boolean }) {
  return (
    <div style={{
      margin: "0 16px 14px",
      background: WHITE,
      borderRadius: 16,
      border: "1px solid #E8F4FF",
      padding: 14,
    }}>
      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 6 }}>
        {alt ? "2026년 8월 13일 (목)" : "2026년 8월 6일 (목)"}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: TEXT_BODY, lineHeight: "20px" }}>
        {alt
          ? "킥 연습을 중심으로 진행하며 접영 동작 연계 훈련을 시작했습니다."
          : "태웅이는 킥을 짧게 차는 것이 잘 안되어 박자 연습을 진행했습니다."}
      </div>
    </div>
  );
}

// ─── 스펙 테이블 ──────────────────────────────────────────────────────────────
function SpecTable() {
  const rows = [
    ["Output size (PNG)", "1080 × 1350 px"],
    ["Aspect ratio", "4:5 (portrait)"],
    ["Card width (390)", "358px (16px margin × 2)"],
    ["Card radius", "20px"],
    ["Shadow", "0 2px 14px rgba(15,39,66,0.10)"],
    ["NAVY header padding", "18px 20px 16px"],
    ["Date font", "26px Bold, #E8F4FF"],
    ["Student font", "15px SemiBold, #E8F4FF"],
    ["Brand line height", "3px × 14px, #25B7CF"],
    ["AQUA separator", "2px full-width, #25B7CF"],
    ["Body bg", "#EEF9FB (Clear Pool Mist)"],
    ["Body padding", "18px 20px 20px"],
    ["Headline", "14px SemiBold, NAVY"],
    ["Summary", "13px Regular, 3-line clamp"],
    ["Section label", "11px SemiBold, #7A90A8"],
    ["Section text", "12px Regular, 2-line clamp"],
    ["Progress bar", "3px height, #25B7CF fill"],
    ["Action bar", "1px AQUA_SOFT border-top"],
    ["Font count", "5종 (26/15/14/13/12/11px)"],
    ["Asset mimeType", "image/png"],
    ["Estimated file size", "~80–150KB (PNG, 1080×1350)"],
  ];
  return (
    <table style={{ fontSize: 12, color: TEXT_BODY, borderCollapse: "collapse", width: 520 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "6px 12px", color: TEXT_MUTED, borderBottom: `1px solid ${AQUA_SOFT}`, fontWeight: 500 }}>항목</th>
          <th style={{ textAlign: "left", padding: "6px 12px", color: TEXT_MUTED, borderBottom: `1px solid ${AQUA_SOFT}`, fontWeight: 500 }}>값</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? WHITE : AQUA_MIST }}>
            <td style={{ padding: "5px 12px", color: TEXT_MUTED, fontFamily: "monospace" }}>{k}</td>
            <td style={{ padding: "5px 12px", fontFamily: "monospace" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
