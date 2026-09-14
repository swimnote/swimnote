import { Accordion, type AccordionItem } from "@/components/site/Accordion";

const BASE = import.meta.env.BASE_URL;

// X brand accent (used sparingly)
const X_NAVY = "#0A1628";
const X_BLUE = "#01B2F1";

// ── X Features ────────────────────────────────────────────────────────────────
const X_FEATURES = [
  {
    title: "커리큘럼",
    desc: "수영장만의 교육과정을 등록하고 수업에 연결합니다. 선생님은 커리큘럼 기반으로 수업을 진행하고 진도를 기록합니다.",
  },
  {
    title: "성장 기록 & 데이터",
    desc: "수업일지, 출결, 커리큘럼 진도가 학생별 성장 데이터로 누적됩니다. 교육 히스토리를 체계적으로 관리할 수 있습니다.",
  },
  {
    title: "AI 성장리포트",
    desc: "누적된 수업 데이터를 바탕으로 AI가 학생별 성장 리포트를 생성합니다. 관리자가 검수 후 학부모에게 발송합니다.",
  },
  {
    title: "월간 운영 KPI",
    desc: "수영장의 월간 주요 지표를 대시보드에서 확인합니다. 재적 현황, 수업 완료율 등 운영 현황을 한눈에 파악할 수 있습니다.",
  },
];

// ── FAQ (코드 기반 확인 항목만) ───────────────────────────────────────────────
const FAQ_ITEMS: AccordionItem[] = [
  {
    q: "SWIMNOTE X는 어떤 서비스인가요?",
    a: "SWIMNOTE X는 SWIMNOTE에 커리큘럼, 성장 기록, AI 성장리포트 기능을 추가한 교육 시스템입니다. 수영장 운영 기능은 동일하게 사용하면서 교육 데이터를 체계적으로 관리할 수 있습니다.",
  },
  {
    q: "SWIMNOTE와 X의 차이는 무엇인가요?",
    a: "SWIMNOTE는 수영장 운영(회원, 수업, 출결, 일지, 학부모 소통)에 집중합니다. SWIMNOTE X는 여기에 커리큘럼 등록, 성장 데이터 관리, AI 성장리포트 기능이 추가됩니다. 두 제품은 별개의 특성을 가지며, 수영장 운영 방식에 따라 선택할 수 있습니다.",
  },
  {
    q: "SWIMNOTE X는 어떻게 시작하나요?",
    a: "앱 내 구독 메뉴에서 SWIMNOTE X를 구독한 뒤, X 설정(커리큘럼 등록 등)을 완료하면 사용할 수 있습니다. 자세한 안내는 앱 내 가이드를 참고하거나 고객센터에 문의해주세요.",
  },
  {
    q: "커리큘럼은 어떻게 등록하나요?",
    a: "PC 대시보드의 커리큘럼 설정에서 수영장에서 사용하는 교육과정을 등록합니다. 등록된 커리큘럼은 수업일지 작성 시 선생님이 참고할 수 있습니다.",
  },
  {
    q: "커리큘럼 게이지는 어떻게 확인하나요?",
    a: "학생의 수업 기록이 누적되면 커리큘럼 진행률을 게이지로 확인할 수 있습니다. 게이지는 수업일지 기록을 기반으로 자동으로 계산됩니다.",
  },
  {
    q: "AI 성장리포트 발급 조건은 무엇인가요?",
    a: "AI 성장리포트는 SWIMNOTE X를 이용하는 어린이수영장의 재등록 회원을 대상으로 지난달 실제 수업 데이터를 분석해 매월 5일 발급됩니다.\n\n리포트는 실제 출석해서 수업을 받은 기록을 바탕으로 만들어지기 때문에, 결석이 많거나 수업을 자주 연기한 경우 분석 데이터가 부족해 발급 대상에서 제외될 수 있습니다. 재등록하지 않은 회원도 해당 월 발급 대상에서 제외됩니다.\n\n아이가 꾸준히 출석할수록 더 풍부한 성장 기록을 받아볼 수 있습니다.",
  },
  {
    q: "성장리포트를 발송하려면 어떻게 하나요?",
    a: "AI가 생성한 리포트는 관리자 검수 대기 상태로 등록됩니다. 관리자가 내용을 확인하고 승인하면 해당 학부모에게 발송됩니다.",
  },
  {
    q: "학부모는 성장리포트를 어디서 확인하나요?",
    a: "관리자가 리포트를 발송하면 학부모 앱에 알림이 전달됩니다. 앱 내 성장 리포트 메뉴에서 발급된 리포트를 확인할 수 있습니다.",
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SwimnoteXPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section
        style={{
          background: X_NAVY,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px 0",
          }}
        >
          {/* Tag */}
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: X_BLUE,
              marginBottom: 16,
            }}
            translate="no"
          >
            SWIMNOTE X
          </p>

          {/* Headline */}
          <h1
            style={{
              fontSize: "clamp(30px, 4.5vw, 48px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.03em",
              color: "#F0F4FF",
              marginBottom: 18,
              lineHeight: 1.15,
              maxWidth: 600,
            }}
          >
            수영 교육을 AI 시스템으로.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "rgba(240,244,255,0.65)",
              lineHeight: 1.7,
              maxWidth: 460,
              marginBottom: 40,
            }}
          >
            강력한 AI 수영교육 시스템. 커리큘럼, 수업 기록과 성장 데이터를
            하나의 교육 시스템으로 연결합니다.
          </p>

          {/* Hero image */}
          <img
            src={`${BASE}app-home-x.png`}
            alt="SWIMNOTE X 관리자 홈 화면"
            style={{
              width: "100%",
              maxWidth: 780,
              height: "auto",
              borderRadius: "var(--ds-radius-lg) var(--ds-radius-lg) 0 0",
              objectFit: "cover",
              display: "block",
              opacity: 0.92,
            }}
            loading="eager"
          />
        </div>
      </section>

      {/* ── What is X ─────────────────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-000)",
          borderBottom: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px",
          }}
        >
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "var(--ds-n-400)",
              marginBottom: 12,
            }}
          >
            X란 무엇인가
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "24px 56px",
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: "1 1 300px" }}>
              {/* Official SWIMNOTE X logo */}
              <img
                src={`${BASE}swimnote-x-logo.png`}
                alt="SWIMNOTE X"
                style={{
                  height: 40,
                  width: "auto",
                  objectFit: "contain",
                  display: "block",
                  marginBottom: 20,
                }}
              />
              <h2
                style={{
                  fontSize: "clamp(22px, 3vw, 30px)",
                  fontWeight: "var(--ds-fw-bold)",
                  letterSpacing: "-0.02em",
                  color: "var(--ds-n-900)",
                  marginBottom: 16,
                  lineHeight: 1.25,
                }}
              >
                수영 교육의 흐름을<br />
                기록하고 분석합니다.
              </h2>
              <p
                style={{
                  fontSize: "var(--ds-text-body-sm)",
                  color: "var(--ds-text-secondary)",
                  lineHeight: 1.7,
                }}
              >
                SWIMNOTE X는 커리큘럼 기반 수업 진행,
                학생별 성장 데이터 누적, AI 성장리포트 생성까지
                교육 과정을 하나의 흐름으로 관리합니다.
                수영장 운영 기능은 SWIMNOTE와 동일하게 사용합니다.
              </p>
            </div>
            <div style={{ flex: "1 1 300px" }}>
              <img
                src={`${BASE}app-ai-diary.png`}
                alt="AI 일지 작성 화면"
                style={{
                  width: "100%",
                  maxWidth: 400,
                  height: "auto",
                  borderRadius: "var(--ds-radius-md)",
                  border: "1px solid var(--ds-border-light)",
                  display: "block",
                }}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── X Features ────────────────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-050)",
          borderBottom: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px",
          }}
        >
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "var(--ds-n-400)",
              marginBottom: 12,
            }}
          >
            주요 기능
          </p>
          <h2
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 36,
            }}
          >
            현재 제공 기능
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {X_FEATURES.map((f) => (
              <div
                key={f.title}
                style={{
                  background: "var(--ds-n-000)",
                  borderRadius: "var(--ds-radius-md)",
                  border: "1px solid var(--ds-border-light)",
                  padding: "24px",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: X_BLUE,
                    marginBottom: 14,
                  }}
                />
                <p
                  style={{
                    fontSize: "var(--ds-text-body)",
                    fontWeight: "var(--ds-fw-semibold)",
                    color: "var(--ds-n-900)",
                    marginBottom: 10,
                  }}
                >
                  {f.title}
                </p>
                <p
                  style={{
                    fontSize: "var(--ds-text-body-sm)",
                    color: "var(--ds-text-secondary)",
                    lineHeight: 1.65,
                  }}
                >
                  {f.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Not implemented notice */}
          <p
            style={{
              marginTop: 24,
              fontSize: 12,
              color: "var(--ds-n-300)",
              paddingLeft: 2,
            }}
          >
            * AI 인사이트 전략 리포트는 현재 개발 중으로 아직 제공되지 않습니다.
          </p>
        </div>
      </section>

      {/* ── Growth Report visual ──────────────────────────────────────────── */}
      <section
        style={{
          background: "var(--ds-n-000)",
          borderBottom: "1px solid var(--ds-border-light)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "24px 56px",
              alignItems: "center",
            }}
          >
            <div style={{ flex: "1 1 300px" }}>
              <img
                src={`${BASE}app-report-pdf.png`}
                alt="AI 성장 리포트 실제 문서"
                style={{
                  width: "100%",
                  maxWidth: 420,
                  height: "auto",
                  borderRadius: "var(--ds-radius-md)",
                  border: "1px solid var(--ds-border-light)",
                  display: "block",
                }}
                loading="lazy"
              />
            </div>
            <div style={{ flex: "1 1 280px" }}>
              <p
                style={{
                  fontSize: "var(--ds-text-label)",
                  fontWeight: "var(--ds-fw-semibold)",
                  letterSpacing: "var(--ds-ls-wider)",
                  textTransform: "uppercase",
                  color: "var(--ds-n-400)",
                  marginBottom: 12,
                }}
              >
                AI 성장리포트
              </p>
              <h2
                style={{
                  fontSize: "clamp(20px, 2.5vw, 26px)",
                  fontWeight: "var(--ds-fw-bold)",
                  letterSpacing: "-0.02em",
                  color: "var(--ds-n-900)",
                  marginBottom: 14,
                  lineHeight: 1.25,
                }}
              >
                누적된 수업 기록으로<br />
                AI가 리포트를 작성합니다.
              </h2>
              <p
                style={{
                  fontSize: "var(--ds-text-body-sm)",
                  color: "var(--ds-text-secondary)",
                  lineHeight: 1.7,
                }}
              >
                선생님이 기록한 수업일지와 커리큘럼 데이터를 바탕으로
                AI가 학생별 성장 리포트 초안을 생성합니다.
                관리자가 검수하고 학부모에게 발송합니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section style={{ background: "var(--ds-n-000)" }}>
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px 72px",
          }}
        >
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "var(--ds-n-400)",
              marginBottom: 12,
            }}
          >
            자주 묻는 질문
          </p>
          <h2
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 36,
            }}
          >
            SWIMNOTE X FAQ
          </h2>

          <div style={{ maxWidth: 720 }}>
            <Accordion items={FAQ_ITEMS} />
          </div>
        </div>
      </section>
    </>
  );
}
