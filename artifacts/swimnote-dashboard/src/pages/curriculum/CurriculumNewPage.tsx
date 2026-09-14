/**
 * CurriculumNewPage — /admin/curriculum/new
 * Pool Local Curriculum DOCX 업로드
 * API: POST /x-setup/upload/curriculum (pool_admin + X entitlement 필요)
 * Response: { ok, file_id, version, curriculum: { status, canonical_node_count,
 *              soft_review_count, hard_error_count, idempotent, version_id, block_message } }
 *
 * 업로드 성공 후 /admin/curriculum invalidate → 수영장 전용 커리큘럼 반영
 */
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Link } from "wouter";

interface UploadResult {
  ok: boolean;
  file_id: string;
  version: number;
  r2_key: string;
  curriculum: {
    status: string;
    canonical_node_count?: number;
    soft_review_count?: number;
    hard_error_count?: number;
    idempotent?: boolean;
    version_id?: string;
    block_message?: string;
  };
}

export default function CurriculumNewPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [versionName, setVersionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");

  function handleSelect(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx") { setError(".docx 파일만 지원합니다."); setFile(null); return; }
    if (f.size > 20 * 1024 * 1024) { setError("파일 크기는 최대 20MB입니다."); setFile(null); return; }
    setFile(f);
    setError("");
    setResult(null);
  }

  async function handleUpload(e: Event) {
    e.preventDefault();
    if (!file) { setError("파일을 선택하세요."); return; }
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (versionName.trim()) form.append("version_name", versionName.trim());

      // POST /x-setup/upload/curriculum — pool_admin + X entitlement
      const r = await api.axiosInstance.post<UploadResult>("/x-setup/upload/curriculum", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(r.data);
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ["curriculum-levels"] });
        qc.invalidateQueries({ queryKey: ["curriculum-versions"] });
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || "업로드 실패";
      const code = e?.response?.data?.code;
      if (code === "XMODE_REQUIRED") {
        setError("SWIMNOTE X 구독이 필요합니다. 앱에서 X 플랜을 구독하면 사용 가능합니다.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError("");
    setVersionName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const STATUS_LABEL: Record<string, string> = {
    APPROVED: "승인됨",
    PENDING_REVIEW: "검토 대기",
    NEEDS_REVISION: "수정 필요",
    DRAFT: "초안",
    ORCHESTRATION_ERROR: "처리 오류",
  };

  return (
    <div style={{ padding: "24px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/admin/curriculum" style={{ color: "#6b7280", fontSize: 14, textDecoration: "none" }}>← 커리큘럼</Link>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>커리큘럼 등록</h2>
      </div>

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 13, color: "#1e40af", lineHeight: 1.6 }}>
          <strong>Pool Local Curriculum</strong>: 이 수영장 전용 커리큘럼을 DOCX 파일로 등록합니다.<br />
          업로드 후 SWIMNOTE 운영팀이 내용을 검토합니다. 승인 완료 후 커리큘럼 탭에서 활성화됩니다.<br />
          SWIMNOTE X 구독이 필요합니다.
        </p>
      </div>

      {!result && (
        <form onSubmit={handleUpload} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 28 }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>DOCX 파일 *</label>
            <input ref={fileRef} type="file" accept=".docx" onChange={handleSelect} style={{ display: "none" }} id="curriculum-file" />
            <label htmlFor="curriculum-file" style={{ display: "inline-block", padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontSize: 14 }}>
              파일 선택
            </label>
            {file && (
              <div style={{ marginTop: 10, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 13 }}>
                <strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "6px 0 0" }}>
              .docx 형식만 지원 · 최대 20MB
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>버전 이름 (선택)</label>
            <input value={versionName} onInput={(e: any) => setVersionName(e.target.value)}
              placeholder="예: 2026년 여름 커리큘럼" style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <p style={{ margin: 0, color: "#dc2626", fontSize: 13 }}>{error}</p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="submit" disabled={loading || !file}
              style={{ padding: "10px 24px", borderRadius: 6, border: "none", background: loading ? "#9ca3af" : "#111827", color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 500 }}>
              {loading ? "업로드 중…" : "업로드 및 분석"}
            </button>
          </div>
        </form>
      )}

      {/* Result */}
      {result && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <span style={{ fontSize: 28 }}>{result.curriculum.hard_error_count ? "⚠️" : "✅"}</span>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {result.curriculum.hard_error_count ? "오류 발견" : "업로드 완료"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6b7280" }}>
                상태: {STATUS_LABEL[result.curriculum.status] ?? result.curriculum.status}
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              ["분석 항목 수", result.curriculum.canonical_node_count ?? "—"],
              ["소프트 경고", result.curriculum.soft_review_count ?? 0],
              ["하드 오류", result.curriculum.hard_error_count ?? 0],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "#f9fafb", borderRadius: 8, padding: 14, textAlign: "center" }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>{label}</p>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: (value as number) > 0 && label !== "분석 항목 수" ? "#dc2626" : "#111827" }}>{value}</p>
              </div>
            ))}
          </div>

          {result.curriculum.idempotent && (
            <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, padding: 12, marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#92400e" }}>이전에 업로드한 동일한 파일입니다.</p>
            </div>
          )}

          {result.curriculum.block_message && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 12, marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>{result.curriculum.block_message}</p>
            </div>
          )}

          {!result.curriculum.hard_error_count && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#166534" }}>
                파일이 성공적으로 업로드되었습니다. SWIMNOTE 운영팀이 검토 후 승인하면 커리큘럼 탭에서 활성화됩니다.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 14 }}>
              다시 업로드
            </button>
            <Link href="/admin/curriculum">
              <a style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14, textDecoration: "none", display: "inline-block" }}>
                커리큘럼 보기
              </a>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
