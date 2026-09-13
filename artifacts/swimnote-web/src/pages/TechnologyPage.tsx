// /technology — 기술 및 개발
// 내부 구조/프레임워크 명칭/공식 공개 금지. 방향과 원칙 중심.

const PILLARS = [
  {
    title: "앱과 데이터의 직접 연결",
    desc: "수업에서 발생하는 출결, 일지, 커리큘럼 기록이 실시간으로 누적되고, 그 데이터가 AI와 성장 분석에 직접 활용됩니다. 외부 데이터셋에 의존하지 않고 실제 수영 교육 현장의 데이터를 사용합니다.",
  },
  {
    title: "수영 전문 AI 개발",
    desc: "범용 AI를 그대로 적용하지 않습니다. 수영 교육에 특화된 데이터와 구조를 바탕으로 수업일지 생성, 성장 분석, 커리큘럼 연동을 개발하고 있습니다.",
  },
  {
    title: "근거 기반 AI 제어",
    desc: "AI가 출력하는 내용은 실제 수업 기록을 근거로 제한됩니다. 역할 기반 접근 제어와 데이터 권한 구조가 AI 동작에도 동일하게 적용됩니다.",
  },
  {
    title: "지속적인 투자",
    desc: "SWIMNOTE는 앱 개발, 수영 전문 데이터베이스, AI 엔진, 커리큘럼 구조화, 특허/IP에 지속적으로 투자하고 있습니다.",
  },
];

export default function TechnologyPage() {
  return (
    <>
      <section
        style={{
          borderBottom: "1px solid var(--ds-border-light)",
          background: "var(--ds-n-000)",
        }}
      >
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "56px 24px 52px",
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
            기술 및 개발
          </p>
          <h1
            style={{
              fontSize: "clamp(26px, 4vw, 40px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.025em",
              color: "var(--ds-n-900)",
              marginBottom: 18,
              lineHeight: 1.18,
              maxWidth: 560,
            }}
          >
            앱, 데이터, AI를<br />
            직접 연결해 개발합니다.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.7,
              maxWidth: 500,
            }}
          >
            SWIMNOTE는 수영장 관리 앱만 만드는 회사가 아닙니다.
            교육 데이터와 AI를 하나의 시스템으로 연결하는 기술을 개발합니다.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--ds-n-050)", borderBottom: "1px solid var(--ds-border-light)" }}>
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "52px 24px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {PILLARS.map((p) => (
              <div
                key={p.title}
                style={{
                  background: "var(--ds-n-000)",
                  border: "1px solid var(--ds-border-light)",
                  borderRadius: "var(--ds-radius-md)",
                  padding: "24px",
                }}
              >
                <p
                  style={{
                    fontSize: "var(--ds-text-body)",
                    fontWeight: "var(--ds-fw-semibold)",
                    color: "var(--ds-n-900)",
                    marginBottom: 10,
                    lineHeight: 1.35,
                  }}
                >
                  {p.title}
                </p>
                <p
                  style={{
                    fontSize: "var(--ds-text-body-sm)",
                    color: "var(--ds-text-secondary)",
                    lineHeight: 1.7,
                  }}
                >
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI 투자 anchor target */}
      <section id="investment" style={{ background: "var(--ds-n-000)" }}>
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "52px 24px 72px",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(18px, 2.5vw, 24px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 14,
            }}
          >
            AI 및 기술 투자
          </h2>
          <p
            style={{
              fontSize: "var(--ds-text-body-sm)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.75,
              maxWidth: 600,
            }}
          >
            SWIMNOTE는 수영 전문 AI 엔진, 교육 데이터 인프라, 커리큘럼 구조화 기술,
            그리고 관련 지식재산권 확보에 지속적으로 투자하고 있습니다.
            수영 교육 현장에서의 실데이터 축적과 AI 품질 개선이 핵심 개발 방향입니다.
          </p>
        </div>
      </section>
    </>
  );
}
