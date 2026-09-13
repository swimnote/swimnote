// /ai — SWIMNOTE AI 소개
// 공개 가능 범위만 설명. 내부 엔진 구조/프롬프트/스코어링 공개 금지.

const BASE = import.meta.env.BASE_URL;

const FEATURES = [
  {
    status: "현재 제공",
    items: [
      "AI 수업일지 — 선생님이 수업 내용을 간단히 입력하면 AI가 일지 초안을 생성합니다.",
      "AI 성장리포트 — 학생별 수업기록을 분석해 매월 성장 리포트를 생성합니다. (SWIMNOTE X)",
    ],
  },
  {
    status: "개발 중",
    items: [
      "커리큘럼 기반 AI — 수영장별 교육과정과 수업 기록을 결합한 맞춤형 분석.",
    ],
  },
  {
    status: "향후 확장",
    items: [
      "영상 기반 수영 동작 분석 — 수업 영상을 활용한 기술 피드백.",
      "운영 데이터 기반 AI 인사이트 — 수영장 운영 패턴 분석 및 제안.",
    ],
  },
];

const STATUS_COLOR: Record<string, string> = {
  "현재 제공": "#1a7f4b",
  "개발 중":   "#b45309",
  "향후 확장": "var(--ds-n-500)",
};

export default function AIPage() {
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
          {/* Official SwimNote AI REPORT logo */}
          <img
            src={`${BASE}swimnote-ai-report-logo.png`}
            alt="SwimNote AI REPORT"
            style={{
              height: 52,
              width: "auto",
              objectFit: "contain",
              display: "block",
              marginBottom: 28,
            }}
          />
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
            수영 교육 현장에 특화된 AI.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.7,
              maxWidth: 520,
            }}
          >
            SWIMNOTE AI는 실제 수업 기록과 교육 데이터를 기반으로
            선생님의 일지 작성을 지원하고, 학생별 성장 리포트를 생성합니다.
            수영 전문 데이터를 기반으로 개발된 특화 AI입니다.
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
          <h2
            style={{
              fontSize: "clamp(18px, 2.5vw, 24px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 32,
            }}
          >
            AI 기능 현황
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 680 }}>
            {FEATURES.map((group) => (
              <div key={group.status}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: "var(--ds-fw-semibold)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: STATUS_COLOR[group.status],
                    marginBottom: 10,
                  }}
                >
                  {group.status}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.items.map((item) => (
                    <div
                      key={item}
                      style={{
                        background: "var(--ds-n-000)",
                        border: "1px solid var(--ds-border-light)",
                        borderRadius: "var(--ds-radius-md)",
                        padding: "16px 20px",
                        fontSize: "var(--ds-text-body-sm)",
                        color: "var(--ds-text-primary)",
                        lineHeight: 1.6,
                      }}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "var(--ds-n-000)" }}>
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "52px 24px 72px",
            maxWidth: 680,
          }}
        >
          <h2
            style={{
              fontSize: "clamp(18px, 2vw, 22px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 14,
            }}
          >
            AI 개발 원칙
          </h2>
          <p
            style={{
              fontSize: "var(--ds-text-body-sm)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.75,
            }}
          >
            SWIMNOTE AI는 실제 교육 현장의 수업 기록을 근거로 동작합니다.
            근거 없는 추론을 제한하고, 역할 기반 데이터 접근 제어를 적용하며,
            선생님과 관리자가 AI 결과를 검토·확인할 수 있는 구조로 설계됩니다.
            수영 전문 지식 데이터베이스를 지속적으로 확장해 정확도를 높여가고 있습니다.
          </p>
        </div>
      </section>
    </>
  );
}
