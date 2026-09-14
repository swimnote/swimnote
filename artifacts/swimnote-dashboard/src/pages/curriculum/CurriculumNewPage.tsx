import { Link } from "wouter";

// ─── CurriculumNewPage ────────────────────────────────────────────────────────
// Pool admin cannot directly upload or create curriculum nodes.
// Curriculum DOCX upload is restricted to super_admin role only
// (POST /super/curriculum/pools/:poolId/upload requires super_admin).
// This page provides guidance on how to request curriculum registration.

export default function CurriculumNewPage() {
  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/admin/curriculum">
          <a style={{ fontSize: "13px", color: "#64748B", textDecoration: "none", cursor: "pointer" }}>← 커리큘럼 관리</a>
        </Link>
      </div>

      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: "0 0 4px" }}>커리큘럼 등록</h1>
      <p style={{ fontSize: "13px", color: "#64748B", margin: "0 0 28px" }}>수영장 커리큘럼을 등록하거나 업데이트합니다.</p>

      {/* Info card */}
      <div style={{
        background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px",
        padding: "28px", maxWidth: "560px",
      }}>
        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
          <div style={{ fontSize: "28px", lineHeight: 1 }}>📄</div>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#1E293B", marginBottom: "8px" }}>
              DOCX 커리큘럼 업로드
            </div>
            <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.7, marginBottom: "16px" }}>
              커리큘럼 DOCX 파일 업로드는 <strong>SWIMNOTE 운영팀</strong>에서 처리합니다.<br />
              수영장 고유 커리큘럼을 등록하거나 기존 커리큘럼을 변경하려면 아래 절차를 따라주세요.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              {[
                "SWIMNOTE 공식 DOCX 양식에 커리큘럼 내용을 작성합니다.",
                "운영팀 이메일 또는 인앱 지원 채널로 파일을 전송합니다.",
                "운영팀이 검토 후 수영장 커리큘럼을 업로드합니다.",
                "업로드 완료 후 커리큘럼 관리 화면에서 확인할 수 있습니다.",
              ].map((step, i) => (
                <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <div style={{
                    width: "20px", height: "20px", borderRadius: "50%",
                    background: "#1D4E8F", color: "#fff", fontSize: "11px",
                    fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, marginTop: "1px",
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>{step}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "16px", marginTop: "4px" }}>
          <div style={{ fontSize: "12px", color: "#94A3B8" }}>
            커리큘럼 양식이 필요하거나 문의사항이 있으면 앱 내 지원 채널 또는 운영팀으로 연락해주세요.
          </div>
        </div>
      </div>

      {/* Curriculum levels and templates CTA */}
      <div style={{ marginTop: "24px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <Link href="/admin/curriculum/levels">
          <a style={{
            padding: "10px 18px", background: "#fff", border: "1px solid #CBD5E1",
            borderRadius: "6px", fontSize: "13px", color: "#475569",
            textDecoration: "none", cursor: "pointer",
          }}>
            일지 레벨 관리 →
          </a>
        </Link>
        <Link href="/admin/curriculum/templates">
          <a style={{
            padding: "10px 18px", background: "#fff", border: "1px solid #CBD5E1",
            borderRadius: "6px", fontSize: "13px", color: "#475569",
            textDecoration: "none", cursor: "pointer",
          }}>
            일지 템플릿 관리 →
          </a>
        </Link>
      </div>
    </div>
  );
}
