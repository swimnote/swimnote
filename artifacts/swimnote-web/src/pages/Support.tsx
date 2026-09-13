// /support — 고객센터
// 전화번호/이메일 공개 금지. 앱 내 문의사항 중심.

export default function Support() {
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
            고객센터
          </p>
          <h1
            style={{
              fontSize: "clamp(24px, 3.5vw, 36px)",
              fontWeight: "var(--ds-fw-bold)",
              letterSpacing: "-0.025em",
              color: "var(--ds-n-900)",
              marginBottom: 16,
              lineHeight: 1.2,
            }}
          >
            앱에서 직접 문의해주세요.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.7,
              maxWidth: 460,
            }}
          >
            SWIMNOTE 이용 중 문의사항은
            앱 내 문의사항 기능을 이용해주세요.
            해당 계정과 수영장 기준으로 정확한 지원을 받을 수 있습니다.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--ds-n-050)" }}>
        <div
          style={{
            maxWidth: "var(--ds-content-max)",
            margin: "0 auto",
            padding: "48px 24px 72px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
            {[
              {
                step: "1",
                title: "앱 내 문의사항",
                desc: "앱 하단의 설정 또는 문의 메뉴에서 문의를 작성할 수 있습니다.",
              },
              {
                step: "2",
                title: "문의 기록 확인",
                desc: "작성한 문의와 답변 내역은 앱 내에서 확인할 수 있습니다.",
              },
              {
                step: "3",
                title: "계정 기준 지원",
                desc: "문의는 해당 계정과 수영장 기준으로 처리됩니다. 정확한 지원을 위해 앱 내 문의를 이용해주세요.",
              },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: "flex",
                  gap: 16,
                  background: "var(--ds-n-000)",
                  border: "1px solid var(--ds-border-light)",
                  borderRadius: "var(--ds-radius-md)",
                  padding: "20px 24px",
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "var(--ds-n-900)",
                    color: "var(--ds-n-000)",
                    fontSize: 11,
                    fontWeight: "var(--ds-fw-bold)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 2,
                  }}
                >
                  {item.step}
                </span>
                <div>
                  <p
                    style={{
                      fontSize: "var(--ds-text-body-sm)",
                      fontWeight: "var(--ds-fw-semibold)",
                      color: "var(--ds-n-900)",
                      marginBottom: 4,
                    }}
                  >
                    {item.title}
                  </p>
                  <p
                    style={{
                      fontSize: "var(--ds-text-body-sm)",
                      color: "var(--ds-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
