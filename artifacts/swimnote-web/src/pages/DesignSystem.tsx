/**
 * SWIMNOTE Design System v1.0 — Preview Page
 * Route: /design-system
 *
 * PURPOSE: Verify all Design Tokens and primitive components in isolation.
 * This page is NOT part of the public site. Remove route before launch.
 */

import { Button } from "../components/site/Button";
import { SectionLabel } from "../components/site/SectionLabel";
import { SectionTitle } from "../components/site/SectionTitle";
import { Surface } from "../components/site/Surface";
import { FormField, Input, PasswordInput, PinInput } from "../components/site/FormField";

// ─── helpers ──────────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
      <span style={{ minWidth: 160, fontSize: 11, color: "var(--ds-n-400)", fontFamily: "var(--ds-font-mono)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "var(--ds-radius-md)",
          background: color,
          border: "1px solid var(--ds-border-med)",
          boxShadow: "var(--ds-shadow-sm)",
        }}
      />
      <span style={{ fontSize: 10, color: "var(--ds-n-400)", fontFamily: "var(--ds-font-mono)", textAlign: "center" }}>
        {label}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 64 }}>
      <h2 style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--ds-n-400)",
        borderBottom: "1px solid var(--ds-border-med)",
        paddingBottom: 8,
        marginBottom: 24,
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DesignSystemPage() {
  return (
    <div style={{
      fontFamily: "var(--ds-font-sans)",
      background: "var(--ds-n-050)",
      minHeight: "100vh",
      padding: "48px 24px 120px",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 56 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ds-n-400)", marginBottom: 10 }}>
            SWIMNOTE WEBSITE
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--ds-n-900)", marginBottom: 10, letterSpacing: "-0.02em" }}>
            Design System v1.0
          </h1>
          <p style={{ fontSize: 15, color: "var(--ds-n-500)" }}>
            Font: Pretendard (CDN) · Tokens: CSS custom properties · Build: TailwindCSS v4
          </p>
        </div>

        {/* ── COLORS: NEUTRAL ─────────────────────────────────── */}
        <Section title="COLOR — Neutral">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {[
              ["var(--ds-n-000)", "#ffffff · n-000"],
              ["var(--ds-n-050)", "#f5f5f7 · n-050"],
              ["var(--ds-n-100)", "#e8e8ed · n-100"],
              ["var(--ds-n-200)", "#d1d1d6 · n-200"],
              ["var(--ds-n-300)", "#aeaeb2 · n-300"],
              ["var(--ds-n-400)", "#8e8e93 · n-400"],
              ["var(--ds-n-500)", "#6e6e73 · n-500"],
              ["var(--ds-n-600)", "#48484a · n-600"],
              ["var(--ds-n-700)", "#3a3a3c · n-700"],
              ["var(--ds-n-800)", "#2c2c2e · n-800"],
              ["var(--ds-n-900)", "#1d1d1f · n-900"],
              ["var(--ds-n-950)", "#000000 · n-950"],
            ].map(([color, label]) => (
              <Swatch key={label} color={color} label={label} />
            ))}
          </div>
        </Section>

        {/* ── COLORS: BRAND ─────────────────────────────────────── */}
        <Section title="COLOR — Brand Accents (product pages only)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 24 }}>
            <div>
              <p style={{ fontSize: 11, color: "var(--ds-n-400)", marginBottom: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>SWIMNOTE</p>
              <div style={{ display: "flex", gap: 12 }}>
                <Swatch color="var(--ds-sn-navy)" label="#002F5F · sn-navy" />
                <Swatch color="var(--ds-sn-blue)" label="#01B2F1 · sn-blue" />
                <Swatch color="var(--ds-sn-teal)" label="#67F2F2 · sn-teal" />
              </div>
            </div>
            <div>
              <p style={{ fontSize: 11, color: "var(--ds-n-400)", marginBottom: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>SWIMNOTE X</p>
              <div style={{ display: "flex", gap: 12 }}>
                <Swatch color="var(--ds-x-bg)" label="#0A1628 · x-bg" />
                <Swatch color="var(--ds-x-blue)" label="#01B2F1 · x-blue" />
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--ds-n-400)", fontStyle: "italic" }}>
            ⚠ Brand accents must NOT be used as site-wide primary CTA or global theme. Restrict to product detail sections only.
          </p>
        </Section>

        {/* ── TYPOGRAPHY ───────────────────────────────────────── */}
        <Section title="TYPOGRAPHY">
          <div style={{ background: "var(--ds-n-000)", border: "1px solid var(--ds-border-med)", borderRadius: "var(--ds-radius-xl)", padding: "32px 28px" }}>
            <SectionLabel style={{ marginBottom: 20 }}>Section Label · ds-section-label · 11px 0.16em uppercase</SectionLabel>

            <div className="ds-display-xl" style={{ color: "var(--ds-n-900)", marginBottom: 6 }}>Display XL — clamp(40, 6vw, 56px)</div>
            <div className="ds-display-lg" style={{ color: "var(--ds-n-900)", marginBottom: 6 }}>Display LG — clamp(36, 5vw, 48px)</div>
            <div className="ds-display-md" style={{ color: "var(--ds-n-900)", marginBottom: 6 }}>Display MD — clamp(28, 4vw, 36px)</div>
            <div className="ds-display-sm" style={{ color: "var(--ds-n-900)", marginBottom: 18 }}>Display SM — clamp(20, 2.5vw, 24px)</div>

            <div className="ds-body-lg" style={{ color: "var(--ds-n-700)", marginBottom: 4 }}>Body LG — 18px / relaxed. 수영장 운영에 필요한 모든 것을 하나의 앱으로.</div>
            <div className="ds-body-md" style={{ color: "var(--ds-n-500)", marginBottom: 4 }}>Body MD — 16px / relaxed. AI 성장 리포트, 심층 운영 분석, 커리큘럼 관리까지.</div>
            <div className="ds-body-sm" style={{ color: "var(--ds-n-500)", marginBottom: 4 }}>Body SM — 15px / relaxed. 출결, 일지, 학부모 소통, 보강 배정까지 처리합니다.</div>
            <div className="ds-caption" style={{ marginBottom: 0 }}>Caption — 13px / secondary text. Font: Pretendard, Korean + Latin.</div>
          </div>
          <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--ds-n-000)", borderRadius: "var(--ds-radius-md)", border: "1px solid var(--ds-border-med)" }}>
            <p style={{ fontSize: 12, color: "var(--ds-n-500)", margin: 0 }}>
              <strong>Font:</strong> Pretendard via CDN (cdn.jsdelivr.net/gh/orioncactus/pretendard) — replaces Plus Jakarta Sans + Noto Sans KR.
              No package install. No repo file. Stable CDN + dynamic-subset (only glyphs used on page are loaded).
            </p>
          </div>
        </Section>

        {/* ── BUTTONS ──────────────────────────────────────────── */}
        <Section title="BUTTON SYSTEM">
          <div style={{ background: "var(--ds-n-000)", border: "1px solid var(--ds-border-med)", borderRadius: "var(--ds-radius-xl)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
            <Row label="Primary (dark neutral)">
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary" size="md">Standard</Button>
              <Button variant="primary" size="lg">Large</Button>
              <Button variant="primary" disabled>Disabled</Button>
            </Row>
            <Row label="Secondary (light bg)">
              <Button variant="secondary" size="sm">Small</Button>
              <Button variant="secondary" size="md">Standard</Button>
              <Button variant="secondary" size="lg">Large</Button>
            </Row>
            <Row label="Dashboard CTA">
              <Button variant="dashboard">PC 대시보드</Button>
            </Row>
            <Row label="Text Link (neutral)">
              <Button variant="text" as="span">
                더 알아보기
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </Button>
            </Row>
            <Row label="Text Link (accent — product only)">
              <Button variant="text-accent" as="span">
                SWIMNOTE X 알아보기
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke="var(--ds-sn-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </Button>
            </Row>
          </div>

          {/* Dark bg variant */}
          <div style={{
            marginTop: 16,
            background: "var(--ds-n-950)",
            borderRadius: "var(--ds-radius-xl)",
            padding: "28px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}>
            <Row label="Secondary Dark (on dark bg)">
              <Button variant="secondary-dark" size="md">Secondary Dark</Button>
              <Button variant="secondary-dark" size="lg">Large</Button>
            </Row>
            <Row label="Primary (on dark bg)">
              <Button variant="primary" size="md">Primary on Dark</Button>
            </Row>
            <Row label="Text Link (on dark)">
              <Button variant="text" as="span" style={{ color: "var(--ds-text-on-dark)" }}>
                더 알아보기
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </Button>
            </Row>
          </div>
        </Section>

        {/* ── FORM ─────────────────────────────────────────────── */}
        <Section title="FORM SYSTEM">
          <div style={{ background: "var(--ds-n-000)", border: "1px solid var(--ds-border-med)", borderRadius: "var(--ds-radius-xl)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 }}>
            <FormField label="이메일" htmlFor="demo-email">
              <Input id="demo-email" type="email" placeholder="admin@pool.com" />
            </FormField>

            <FormField label="비밀번호" htmlFor="demo-pw">
              <PasswordInput id="demo-pw" placeholder="••••••••" />
            </FormField>

            <FormField label="웹 접속 비밀번호 (PIN)" htmlFor="demo-pin">
              <PinInput id="demo-pin" placeholder="••••••" maxLength={6} />
            </FormField>

            <FormField label="오류 상태" htmlFor="demo-err" error="이메일 또는 비밀번호가 올바르지 않습니다.">
              <Input id="demo-err" type="email" defaultValue="wrong@" error />
            </FormField>

            <Button variant="primary" size="lg" style={{ width: "100%" }}>로그인</Button>
          </div>
        </Section>

        {/* ── SURFACES ─────────────────────────────────────────── */}
        <Section title="SURFACE / CARD SYSTEM">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Surface variant="default" padding="24px">
              <p style={{ fontSize: 12, color: "var(--ds-n-400)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>ds-surface</p>
              <p style={{ fontSize: 14, color: "var(--ds-n-700)" }}>Standard card surface. White background with neutral border.</p>
            </Surface>
            <Surface variant="subtle" padding="24px">
              <p style={{ fontSize: 12, color: "var(--ds-n-400)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>ds-surface-subtle</p>
              <p style={{ fontSize: 14, color: "var(--ds-n-700)" }}>Light tinted surface for secondary content.</p>
            </Surface>
            <Surface variant="faq" padding="20px 24px">
              <p style={{ fontSize: 12, color: "var(--ds-n-400)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>ds-surface-faq</p>
              <p style={{ fontSize: 14, color: "var(--ds-n-700)" }}>FAQ accordion container surface.</p>
            </Surface>
          </div>
          <div style={{ marginTop: 16 }}>
            <Surface variant="dark" padding="24px" style={{ background: "var(--ds-x-bg)" }}>
              <p style={{ fontSize: 12, color: "rgba(245,245,247,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>ds-surface-dark</p>
              <p style={{ fontSize: 14, color: "var(--ds-text-on-dark)" }}>Dark surface for SWIMNOTE X sections. No glow, no glassmorphism.</p>
            </Surface>
          </div>
        </Section>

        {/* ── SPACING / RADIUS ─────────────────────────────────── */}
        <Section title="SPACING & RADIUS SCALE">
          <div style={{ background: "var(--ds-n-000)", border: "1px solid var(--ds-border-med)", borderRadius: "var(--ds-radius-xl)", padding: "28px 24px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
              {[
                ["--ds-space-1",  "4px",  "#002F5F"],
                ["--ds-space-2",  "8px",  "#01B2F1"],
                ["--ds-space-3",  "12px", "#67F2F2"],
                ["--ds-space-4",  "16px", "#8e8e93"],
                ["--ds-space-5",  "20px", "#6e6e73"],
                ["--ds-space-6",  "24px", "#48484a"],
                ["--ds-space-8",  "32px", "#3a3a3c"],
                ["--ds-space-10", "40px", "#2c2c2e"],
                ["--ds-space-12", "48px", "#1d1d1f"],
                ["--ds-space-16", "64px", "#000"],
                ["--ds-space-20", "80px", "#000"],
                ["--ds-space-24", "96px", "#000"],
              ].map(([token, label, color]) => (
                <div key={token} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                  <div style={{ width: `var(${token})`, height: 10, background: color, borderRadius: 2, minWidth: 4 }} />
                  <span style={{ fontSize: 10, color: "var(--ds-n-400)", fontFamily: "var(--ds-font-mono)" }}>{label}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {[
                ["xs",  "var(--ds-radius-xs)",   "4px"],
                ["sm",  "var(--ds-radius-sm)",   "8px"],
                ["md",  "var(--ds-radius-md)",   "10px"],
                ["lg",  "var(--ds-radius-lg)",   "16px"],
                ["xl",  "var(--ds-radius-xl)",   "20px"],
                ["2xl", "var(--ds-radius-2xl)",  "24px"],
                ["pill","var(--ds-radius-pill)", "999px"],
              ].map(([name, token, px]) => (
                <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{
                    width: 52, height: 52,
                    background: "var(--ds-n-100)",
                    border: "1px solid var(--ds-border-med)",
                    borderRadius: token,
                  }} />
                  <span style={{ fontSize: 10, color: "var(--ds-n-400)", fontFamily: "var(--ds-font-mono)", textAlign: "center" }}>{name}<br/>{px}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ── SECTION COMPONENTS ────────────────────────────────── */}
        <Section title="SITE PRIMITIVE COMPONENTS">
          <div style={{ background: "var(--ds-n-000)", border: "1px solid var(--ds-border-med)", borderRadius: "var(--ds-radius-xl)", padding: "32px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <p style={{ fontSize: 11, color: "var(--ds-n-400)", marginBottom: 10, fontFamily: "var(--ds-font-mono)" }}>SectionLabel — tones: light / dark / accent-sn / accent-x</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <SectionLabel tone="light">Section Label · light tone</SectionLabel>
                <SectionLabel tone="accent-sn">SWIMNOTE · accent-sn</SectionLabel>
                <div style={{ background: "var(--ds-x-bg)", padding: "10px 12px", borderRadius: "var(--ds-radius-md)", display: "inline-block" }}>
                  <SectionLabel tone="accent-x">SWIMNOTE X · accent-x</SectionLabel>
                </div>
              </div>
            </div>

            <div>
              <p style={{ fontSize: 11, color: "var(--ds-n-400)", marginBottom: 10, fontFamily: "var(--ds-font-mono)" }}>SectionTitle — levels: display-xl / display-lg / display-md / display-sm</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <SectionTitle level="display-xl">Display XL · h1</SectionTitle>
                <SectionTitle level="display-lg" as="h2">Display LG · h2</SectionTitle>
                <SectionTitle level="display-md" as="h2">Display MD · h2</SectionTitle>
                <SectionTitle level="display-sm" as="h3">Display SM · h3</SectionTitle>
              </div>
            </div>
          </div>
        </Section>

        {/* Footer */}
        <div style={{ paddingTop: 32, borderTop: "1px solid var(--ds-border-med)", textAlign: "center" }}>
          <p style={{ fontSize: 12, color: "var(--ds-n-400)" }}>
            SWIMNOTE Design System v1.0 · WP1 · Internal preview only — remove route before launch
          </p>
        </div>

      </div>
    </div>
  );
}
