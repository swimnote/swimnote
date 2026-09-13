// /patents — 특허 / IP
// 확인 가능한 분야 수준으로만 일반화. 특허번호/개수 임의 생성 금지.

const AREAS = [
  {
    area: "생성형 AI 제어 기술",
    desc: "AI 출력을 교육 데이터와 역할 권한 기준으로 제한·검증하는 기술 관련 IP를 확보하고 있습니다.",
  },
  {
    area: "수업기록 · 교육시스템 연계 기술",
    desc: "수업일지, 출결, 커리큘럼, 성장 데이터를 교육 시스템으로 구조화·연계하는 기술 관련 IP를 확보하고 있습니다.",
  },
  {
    area: "수영 정보 처리 · 분석 기술",
    desc: "수영 교육 데이터의 수집, 분류, 분석에 관한 기술 관련 IP를 확보하고 있습니다.",
  },
];

export default function PatentsPage() {
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
            특허 / IP
          </p>
          <h1
            style={{
              fontSize: "clamp(26px, 4vw, 40px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.025em",
              color: "var(--ds-n-900)",
              marginBottom: 18,
              lineHeight: 1.18,
              maxWidth: 500,
            }}
          >
            기술 자산을<br />
            체계적으로 확보합니다.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.7,
              maxWidth: 480,
            }}
          >
            SWIMNOTE는 수영 교육 AI와 데이터 연계 기술에 관한
            지식재산권을 출원·등록하고 있습니다.
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
              fontSize: "clamp(17px, 2vw, 20px)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "-0.015em",
              color: "var(--ds-n-900)",
              marginBottom: 24,
            }}
          >
            IP 확보 분야
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
            {AREAS.map((a) => (
              <div
                key={a.area}
                style={{
                  background: "var(--ds-n-000)",
                  border: "1px solid var(--ds-border-light)",
                  borderRadius: "var(--ds-radius-md)",
                  padding: "20px 24px",
                }}
              >
                <p
                  style={{
                    fontSize: "var(--ds-text-body)",
                    fontWeight: "var(--ds-fw-semibold)",
                    color: "var(--ds-n-900)",
                    marginBottom: 8,
                  }}
                >
                  {a.area}
                </p>
                <p
                  style={{
                    fontSize: "var(--ds-text-body-sm)",
                    color: "var(--ds-text-secondary)",
                    lineHeight: 1.65,
                  }}
                >
                  {a.desc}
                </p>
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
            padding: "40px 24px 64px",
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: "var(--ds-n-300)",
              lineHeight: 1.6,
              maxWidth: 520,
            }}
          >
            * 특허 출원·등록 현황의 구체적인 번호 및 세부 내용은 별도 문의를 통해 확인하실 수 있습니다.
            세부 청구항 및 기술 구현 방식은 공개하지 않습니다.
          </p>
        </div>
      </section>
    </>
  );
}
