// /company — 회사 소개. 짧게.

import { Link } from "wouter";

const PRODUCTS = [
  {
    name: "SWIMNOTE",
    href: "/swimnote",
    desc: "회원, 수업, 출결, 보강, 일지와 학부모 소통. 수영장 운영을 하나의 앱으로.",
  },
  {
    name: "SWIMNOTE X",
    href: "/swimnote-x",
    desc: "커리큘럼, 성장 기록, AI 리포트. 수영 교육을 시스템으로 연결합니다.",
  },
  {
    name: "SWIMNOTE OFFICE",
    href: "/swimnote-office",
    desc: "수영장 운영을 더 넓은 화면에서. PC 기반 관리 환경 (출시 예정).",
  },
];

export default function CompanyPage() {
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
            회사 소개
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
            수영장의 운영과 교육을<br />
            기술로 연결합니다.
          </h1>
          <p
            style={{
              fontSize: "var(--ds-text-body)",
              color: "var(--ds-text-secondary)",
              lineHeight: 1.7,
              maxWidth: 480,
            }}
          >
            SWIMNOTE는 수영장 관리 앱, 교육 데이터 시스템, AI를 직접 개발해
            수영장 운영자, 선생님, 학부모를 하나의 플랫폼으로 연결합니다.
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
              marginBottom: 20,
            }}
          >
            제품
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
            {PRODUCTS.map((p) => (
              <Link
                key={p.name}
                href={p.href}
                style={{
                  display: "block",
                  background: "var(--ds-n-000)",
                  border: "1px solid var(--ds-border-light)",
                  borderRadius: "var(--ds-radius-md)",
                  padding: "20px 24px",
                  textDecoration: "none",
                  transition: "var(--ds-transition-color)",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--ds-border-strong)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--ds-border-light)"; }}
              >
                <p
                  style={{
                    fontSize: "var(--ds-text-body)",
                    fontWeight: "var(--ds-fw-semibold)",
                    color: "var(--ds-n-900)",
                    marginBottom: 6,
                  }}
                  translate="no"
                >
                  {p.name}
                </p>
                <p
                  style={{
                    fontSize: "var(--ds-text-body-sm)",
                    color: "var(--ds-text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {p.desc}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
