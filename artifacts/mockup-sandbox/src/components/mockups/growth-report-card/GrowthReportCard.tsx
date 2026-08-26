/**
 * GrowthReportFeedCard — Web Preview
 * 실제 서태웅 2026-08 데이터 사용
 */

// ─── Colors (Clear Pool / SWIMNOTE theme) ─────────────────────────────────
const NAVY       = "#0F2742";
const AQUA       = "#25B7CF";
const AQUA_SOFT  = "#D9F2F6";
const AQUA_MIST  = "#EEF9FB";
const WHITE      = "#FFFFFF";
const TEXT_ON_NAVY = "#E8F4FF";
const C_TEXT      = "#243D47";
const C_TEXT_SEC  = "#526C78";
const C_TEXT_MUT  = "#6D8898";

// ─── 실제 서태웅 2026-08 데이터 ────────────────────────────────────────────
const REPORT_DATA = {
  dateLabel: "2026년 8월",
  studentName: "서태웅",
  poolName: "토이키즈스윔클럽",
  monthLabel: "8월 성장리포트",
  headline: "자유형·IM·킥과 접영 글라이딩을 차례로 연습한 수업",
  keyPoints: [
    "자유형 두 바퀴와 IM을 진행했습니다.",
    "접영 글라이딩을 길게 하는 연습을 이어갔습니다.",
    "1분간 측정값이 기록되었습니다.",
  ],
};

// ─── Card ─────────────────────────────────────────────────────────────────
export default function Preview() {
  const { dateLabel, studentName, poolName, monthLabel, headline, keyPoints } = REPORT_DATA;

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#F5FAFB",
      display: "flex",
      flexDirection: "column",
      gap: 32,
      padding: "32px 0",
      fontFamily: "'Pretendard Variable', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
    }}>
      {/* ── 레이블 ── */}
      <div style={{ textAlign: "center", color: C_TEXT_MUT, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>
        GROWTH REPORT FEED CARD — 서태웅 2026-08
      </div>

      {/* ── iPhone 376px 뷰포트 시뮬레이션 ── */}
      <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", padding: "0 16px" }}>
        {/* NEW CARD */}
        <div>
          <div style={{ fontSize: 11, color: C_TEXT_MUT, marginBottom: 8, textAlign: "center", letterSpacing: 0.5 }}>
            AFTER — Premium Card
          </div>
          <GrowthReportCard
            dateLabel={dateLabel}
            studentName={studentName}
            poolName={poolName}
            monthLabel={monthLabel}
            headline={headline}
            keyPoints={keyPoints}
          />
        </div>

        {/* OLD CARD (Before) */}
        <div>
          <div style={{ fontSize: 11, color: C_TEXT_MUT, marginBottom: 8, textAlign: "center", letterSpacing: 0.5 }}>
            BEFORE — Original Card
          </div>
          <OldCard monthLabel={monthLabel} dateLabel={dateLabel} headline={headline} />
        </div>
      </div>

      {/* ── 디자인 스펙 테이블 ── */}
      <SpecTable />
    </div>
  );
}

// ─── NEW: GrowthReportCard ────────────────────────────────────────────────
function GrowthReportCard({
  dateLabel, studentName, poolName, monthLabel, headline, keyPoints
}: {
  dateLabel: string; studentName: string; poolName: string;
  monthLabel: string; headline: string; keyPoints: string[];
}) {
  return (
    <div style={{
      width: 340,
      borderRadius: 20,
      overflow: "hidden",
      backgroundColor: WHITE,
      boxShadow: `0 2px 16px rgba(15,39,66,0.12), 0 1px 4px rgba(15,39,66,0.06)`,
      cursor: "pointer",
    }}>
      {/* 1. Header Band */}
      <div style={{
        backgroundColor: NAVY,
        padding: "11px 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        {/* 좌: SwimNote AI */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            backgroundColor: AQUA, marginTop: 1,
          }} />
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: TEXT_ON_NAVY, letterSpacing: 0.8,
          }}>
            SwimNote AI
          </span>
        </div>
        {/* 우: 수영장명 + 리포트 타입 배지 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#7FA8C9", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {poolName}
          </span>
          <div style={{
            backgroundColor: "#1A3F6A",
            borderRadius: 5, padding: "3px 8px",
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: AQUA, letterSpacing: 0.5 }}>
              {monthLabel}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Report Preview */}
      <div style={{
        backgroundColor: AQUA_MIST,
        padding: "18px 18px 16px",
      }}>
        {/* 날짜 + 학생 이름 */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{
            fontSize: 22, fontWeight: 700,
            color: NAVY, letterSpacing: -0.3, lineHeight: "27px",
          }}>
            {dateLabel}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 500,
            color: C_TEXT_SEC, lineHeight: "27px",
          }}>
            {studentName}
          </span>
        </div>

        {/* 액센트 라인 */}
        <div style={{
          height: 2, width: 36,
          backgroundColor: AQUA, borderRadius: 1, marginBottom: 14,
        }} />

        {/* 핵심 성장 헤드라인 */}
        <p style={{
          fontSize: 15, fontWeight: 600,
          color: NAVY, lineHeight: "23px",
          margin: "0 0 12px", letterSpacing: -0.2,
        }}>
          {headline}
        </p>

        {/* Key Points */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {keyPoints.map((pt, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{
                width: 4, height: 4, borderRadius: "50%",
                backgroundColor: AQUA, marginTop: 7, flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, color: C_TEXT_SEC, lineHeight: "20px" }}>
                {pt}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Action Bar */}
      <div style={{
        backgroundColor: WHITE,
        borderTop: `1px solid ${AQUA_SOFT}`,
        padding: "11px 18px",
        display: "flex",
        alignItems: "center",
        gap: 0,
      }}>
        <ActionBtn icon="♡" label="좋아요" />
        <ActionBtn icon="○" label="댓글" />
        <div style={{ flex: 1 }} />
        <ActionBtn icon="📷" label="Instagram" isIcon />
        <ActionBtn icon="↓" label="PDF" isIcon />
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, isIcon }: { icon: string; label: string; isIcon?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "4px 10px", cursor: "pointer",
    }}>
      <span style={{ fontSize: isIcon ? 15 : 15, color: C_TEXT_MUT }}>{icon}</span>
      <span style={{ fontSize: 12, color: C_TEXT_MUT }}>{label}</span>
    </div>
  );
}

// ─── OLD: Original Card (Before) ─────────────────────────────────────────
function OldCard({ monthLabel, dateLabel, headline }: { monthLabel: string; dateLabel: string; headline: string }) {
  return (
    <div style={{
      width: 340,
      borderRadius: 16,
      overflow: "hidden",
      backgroundColor: WHITE,
      border: "1px solid #E0EEF9",
    }}>
      {/* 기존 헤더 배지 */}
      <div style={{
        backgroundColor: "#EAF4FF",
        padding: "10px 14px",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ fontSize: 14, color: "#1B3A70" }}>📊</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1B3A70", letterSpacing: 0.3 }}>
          성장리포트
        </span>
      </div>
      {/* 기존 본문 */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C_TEXT }}>{monthLabel}</span>
        <span style={{ fontSize: 12, color: C_TEXT_MUT }}>{dateLabel}</span>
        <p style={{ fontSize: 13, color: C_TEXT_SEC, lineHeight: "20px", margin: "4px 0 0" }}>
          {headline}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
          <span style={{ fontSize: 12, color: "#1B3A70" }}>자세히 보기</span>
          <span style={{ fontSize: 12, color: "#1B3A70" }}>›</span>
        </div>
      </div>
    </div>
  );
}

// ─── 디자인 스펙 테이블 ───────────────────────────────────────────────────
function SpecTable() {
  const specs = [
    ["Card radius", "20px (기존 16px)"],
    ["Shadow", "0 2px 16px rgba(15,39,66,0.12)"],
    ["Header bg", "#0F2742 (Deep Navy)"],
    ["Header height", "~38px"],
    ["Preview bg", "#EEF9FB (Clear Pool Mist)"],
    ["Accent line", "2px × 36px, #25B7CF"],
    ["Date font size", "22px Bold"],
    ["Headline size", "15px SemiBold"],
    ["Key point size", "13px Regular, lineHeight 20"],
    ["Bullet color", "#25B7CF (AQUA)"],
    ["Action bar bg", "#FFFFFF"],
    ["Action bar border", "1px #D9F2F6 (AQUA_SOFT)"],
    ["Action icon color", "#6D8898 (textMuted)"],
    ["Action font size", "12px Regular"],
    ["Font count in card", "4종: 22/15/13/12px"],
    ["Colors in card", "Navy / Aqua / AQUA_MIST / AQUA_SOFT / White / 4 text tiers"],
  ];
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0 16px" }}>
      <table style={{
        fontSize: 12, color: C_TEXT, borderCollapse: "collapse",
        width: 480,
      }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 12px", color: C_TEXT_MUT, borderBottom: `1px solid ${AQUA_SOFT}`, fontWeight: 500 }}>항목</th>
            <th style={{ textAlign: "left", padding: "6px 12px", color: C_TEXT_MUT, borderBottom: `1px solid ${AQUA_SOFT}`, fontWeight: 500 }}>값</th>
          </tr>
        </thead>
        <tbody>
          {specs.map(([k, v], i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? WHITE : AQUA_MIST }}>
              <td style={{ padding: "5px 12px", color: C_TEXT_MUT, fontFamily: "monospace" }}>{k}</td>
              <td style={{ padding: "5px 12px", color: C_TEXT, fontFamily: "monospace" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
