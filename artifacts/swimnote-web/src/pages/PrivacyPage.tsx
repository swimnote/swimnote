// /privacy — 개인정보처리방침
// 앱(swim-app/app/privacy.tsx) 원문 재사용. 시행일 2025년 1월 1일.

const SECTIONS = [
  {
    title: "1. 수집 항목",
    body: "이름, 전화번호, 자녀 정보, 수업 기록",
    note: "※ 사진 및 영상은 장기 저장하지 않습니다.",
  },
  {
    title: "2. 이용 목적",
    body: "수업 관리, 출결 확인, 학부모 안내, 서비스 운영",
  },
  {
    title: "3. 보관 기간",
    body: "회원 정보: 탈퇴 후 3개월 보관 후 삭제\n사진 및 영상: 장기 보관하지 않으며 시스템 정책에 따라 삭제",
  },
  {
    title: "4. 제3자 제공",
    body: "원칙적으로 외부 제공하지 않습니다.\n법적 요청이 있는 경우에만 제공될 수 있습니다.",
  },
  {
    title: "5. 보안",
    body: "인증 기반 접근 제어\n역할 기반 데이터 접근 제한",
  },
];

export default function PrivacyPage() {
  return (
    <>
      <section
        style={{
          borderBottom: "1px solid var(--ds-border-light)",
          background: "var(--ds-n-000)",
          padding: "48px 24px 40px",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <p
            style={{
              fontSize: "var(--ds-text-label)",
              fontWeight: "var(--ds-fw-semibold)",
              letterSpacing: "var(--ds-ls-wider)",
              textTransform: "uppercase",
              color: "var(--ds-n-400)",
              marginBottom: 10,
            }}
          >
            개인정보처리방침
          </p>
          <h1
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.02em",
              color: "var(--ds-n-900)",
              marginBottom: 10,
            }}
          >
            개인정보 처리방침
          </h1>
          <p style={{ fontSize: 12, color: "var(--ds-n-300)" }}>
            시행일: 2025년 1월 1일
          </p>
        </div>
      </section>

      <section style={{ background: "var(--ds-n-000)" }}>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "40px 24px 80px",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {SECTIONS.map((section, i) => (
            <div
              key={i}
              style={{
                padding: "24px 0",
                borderBottom: i < SECTIONS.length - 1 ? "1px solid var(--ds-border-light)" : "none",
              }}
            >
              <p
                style={{
                  fontSize: "var(--ds-text-body)",
                  fontWeight: "var(--ds-fw-semibold)",
                  color: "var(--ds-n-900)",
                  marginBottom: 10,
                }}
              >
                {section.title}
              </p>
              <p
                style={{
                  fontSize: "var(--ds-text-body-sm)",
                  color: "var(--ds-text-secondary)",
                  lineHeight: 1.75,
                  whiteSpace: "pre-line",
                }}
              >
                {section.body}
              </p>
              {section.note && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--ds-n-400)",
                    fontStyle: "italic",
                  }}
                >
                  {section.note}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
