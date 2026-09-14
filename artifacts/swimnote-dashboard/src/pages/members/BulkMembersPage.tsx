/**
 * BulkMembersPage — /admin/members/bulk
 * Excel/CSV 대량 회원 등록
 * Flow: 파일선택 → Parse(client) → Preview/Validation → 사용자확인 → Commit(server)
 *
 * Backend:
 *   GET  /admin/members/bulk/template  — xlsx 양식 다운로드
 *   POST /admin/members/bulk/validate  — 행 검증 (실제 business rule)
 *   POST /admin/members/bulk/commit    — 최종 등록
 */
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import * as XLSX from "xlsx";

interface ParsedRow {
  _row: number;
  name: string;
  phone?: string;
  birth_year?: string;
  parent_name?: string;
  parent_phone?: string;
  class_name?: string;
  memo?: string;
}

interface ValidatedRow extends ParsedRow {
  valid: boolean;
  errors: string[];
  duplicate?: boolean;
  class_group_id?: string;
}

const COLUMNS = [
  { key: "name",         label: "이름 *" },
  { key: "phone",        label: "연락처" },
  { key: "birth_year",   label: "생년(YYYY)" },
  { key: "parent_name",  label: "보호자 이름" },
  { key: "parent_phone", label: "보호자 연락처" },
  { key: "class_name",   label: "반 이름" },
  { key: "memo",         label: "메모" },
];

type Stage = "idle" | "preview" | "validated" | "done";

export default function BulkMembersPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [validated, setValidated] = useState<ValidatedRow[]>([]);
  const [commitResult, setCommitResult] = useState<{ created: number; failed: number; errors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [parseErr, setParseErr] = useState("");

  // ── Template Download ──────────────────────────────────────────────────────
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS.map(c => c.label)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "회원목록");
    XLSX.writeFile(wb, "SWIMNOTE_회원등록_양식.xlsx");
  }

  // ── File Parse (client-side) ───────────────────────────────────────────────
  async function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setParseErr("");
    setStage("idle");
    setParsed([]);
    setValidated([]);

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      setParseErr("xlsx, xls, csv 파일만 지원합니다.");
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (rows.length < 2) { setParseErr("데이터 행이 없습니다. 양식을 확인하세요."); return; }

      // Header mapping (flexible: matches by label or key)
      const header = (rows[0] as string[]).map(h => String(h).trim());
      const keyMap: Record<string, number> = {};
      COLUMNS.forEach(col => {
        const idx = header.findIndex(h =>
          h === col.label || h === col.key || h.startsWith(col.key.split("_")[0])
        );
        if (idx >= 0) keyMap[col.key] = idx;
      });

      const items: ParsedRow[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as any[];
        const name = String(row[keyMap["name"] ?? 0] ?? "").trim();
        if (!name) continue; // skip empty rows
        items.push({
          _row: i + 1,
          name,
          phone:        keyMap["phone"]        != null ? String(row[keyMap["phone"]] ?? "").trim()        : undefined,
          birth_year:   keyMap["birth_year"]    != null ? String(row[keyMap["birth_year"]] ?? "").trim()   : undefined,
          parent_name:  keyMap["parent_name"]   != null ? String(row[keyMap["parent_name"]] ?? "").trim()  : undefined,
          parent_phone: keyMap["parent_phone"]  != null ? String(row[keyMap["parent_phone"]] ?? "").trim() : undefined,
          class_name:   keyMap["class_name"]    != null ? String(row[keyMap["class_name"]] ?? "").trim()   : undefined,
          memo:         keyMap["memo"]          != null ? String(row[keyMap["memo"]] ?? "").trim()          : undefined,
        });
      }

      if (items.length === 0) { setParseErr("유효한 데이터 행이 없습니다."); return; }
      setParsed(items);
      setStage("preview");
    } catch {
      setParseErr("파일 파싱에 실패했습니다. 형식을 확인하세요.");
    }
  }

  // ── Server Validation ─────────────────────────────────────────────────────
  async function handleValidate() {
    setLoading(true);
    try {
      const r = await api.post<{ rows: ValidatedRow[] }>("/admin/members/bulk/validate", { rows: parsed });
      setValidated(r.data.rows);
      setStage("validated");
    } catch (e: any) {
      setParseErr(e?.response?.data?.message || "서버 검증 실패");
    } finally {
      setLoading(false);
    }
  }

  // ── Commit (ALL-OR-NOTHING) ───────────────────────────────────────────────
  // 오류 행이 하나라도 있으면 서버가 거부합니다 (validated.every(r => r.valid) 보장)
  async function handleCommit() {
    if (!allValid) return; // 버튼이 disabled 상태라도 방어
    if (!confirm(`${validated.length}명을 모두 등록하시겠습니까?`)) return;
    setLoading(true);
    try {
      const r = await api.post<{ created: number; failed: number; errors: string[] }>("/admin/members/bulk/commit", { rows: validated });
      setCommitResult(r.data);
      setStage("done");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e: any) {
      setParseErr(e?.message || "등록 실패");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStage("idle");
    setParsed([]);
    setValidated([]);
    setCommitResult(null);
    setParseErr("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const allValid = validated.length > 0 && validated.every(r => r.valid);
  const hasErrors = validated.some(r => !r.valid);
  const displayRows = stage === "validated" ? validated : parsed;

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>회원 엑셀 일괄등록</h2>
        <button onClick={downloadTemplate} style={{ padding: "7px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 14 }}>
          📥 등록 양식 다운로드
        </button>
      </div>

      {/* Upload area */}
      {stage === "idle" && (
        <div style={{ background: "#fff", border: "2px dashed #d1d5db", borderRadius: 10, padding: "40px 24px", textAlign: "center", marginBottom: 20 }}>
          <p style={{ fontSize: 15, color: "#6b7280", margin: "0 0 16px" }}>
            Excel(.xlsx, .xls) 또는 CSV 파일을 선택하세요.<br />
            <span style={{ fontSize: 13 }}>헤더: 이름 *, 연락처, 생년(YYYY), 보호자 이름, 보호자 연락처, 반 이름, 메모</span>
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}
            style={{ display: "none" }} id="bulk-file-input" />
          <label htmlFor="bulk-file-input" style={{ padding: "10px 24px", borderRadius: 6, background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14 }}>
            파일 선택
          </label>
          {parseErr && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 12 }}>{parseErr}</p>}
        </div>
      )}

      {/* Preview/Validated table */}
      {(stage === "preview" || stage === "validated") && (
        <>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {stage === "validated"
                  ? `검증 완료 — 유효 ${validated.filter(r => r.valid).length}명 / 오류 ${validated.filter(r => !r.valid).length}명`
                  : `파싱 완료 — ${parsed.length}명`}
              </span>
              <button onClick={reset} style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}>다시 선택</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>#</th>
                    {COLUMNS.map(c => (
                      <th key={c.key} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>{c.label.replace(" *", "")}</th>
                    ))}
                    {stage === "validated" && <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>검증</th>}
                  </tr>
                </thead>
                <tbody>
                  {(displayRows as any[]).map((row: any, i) => {
                    const isInvalid = stage === "validated" && !(row as ValidatedRow).valid;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: isInvalid ? "#fef2f2" : undefined }}>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{row._row}</td>
                        {COLUMNS.map(c => (
                          <td key={c.key} style={{ padding: "8px 12px" }}>{(row as any)[c.key] || "—"}</td>
                        ))}
                        {stage === "validated" && (
                          <td style={{ padding: "8px 12px" }}>
                            {(row as ValidatedRow).valid
                              ? <span style={{ color: "#16a34a", fontSize: 12 }}>✓ 유효</span>
                              : <span style={{ color: "#dc2626", fontSize: 12 }}>{(row as ValidatedRow).errors.join(", ")}</span>
                            }
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {parseErr && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{parseErr}</p>}

          {hasErrors && stage === "validated" && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 12, marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#991b1b", fontWeight: 500 }}>
                ✗ 오류가 있는 행이 있습니다.
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#991b1b" }}>
                기본 정책: 전체 등록이 아니면 등록 불가 (ALL OR NOTHING).<br/>
                오류 행을 수정한 후 파일을 다시 업로드하세요.
              </p>
            </div>
          )}
          {allValid && stage === "validated" && (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#166534" }}>✓ 모든 행이 유효합니다. 아래 등록 버튼을 눌러 전체 등록하세요.</p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {stage === "preview" && (
              <button onClick={handleValidate} disabled={loading}
                style={{ padding: "9px 20px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 14 }}>
                {loading ? "검증 중…" : "서버 검증"}
              </button>
            )}
            {stage === "validated" && (
              <button onClick={handleCommit} disabled={loading || !allValid}
                title={!allValid ? "오류가 있는 행이 있습니다. 파일을 수정 후 다시 업로드하세요." : undefined}
                style={{
                  padding: "9px 20px", borderRadius: 6, border: "none", fontSize: 14,
                  background: allValid ? "#111827" : "#9ca3af",
                  color: "#fff",
                  cursor: (loading || !allValid) ? "not-allowed" : "pointer",
                  opacity: allValid ? 1 : 0.7,
                }}>
                {loading ? "등록 중…" : allValid ? `${validated.length}명 전체 등록` : "오류 수정 필요"}
              </button>
            )}
          </div>
        </>
      )}

      {/* Done */}
      {stage === "done" && commitResult && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>등록 완료</p>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 4 }}>성공: {commitResult.created}명</p>
          {commitResult.failed > 0 && <p style={{ fontSize: 14, color: "#dc2626", marginBottom: 4 }}>실패: {commitResult.failed}명</p>}
          {commitResult.errors?.length > 0 && (
            <ul style={{ textAlign: "left", maxWidth: 400, margin: "10px auto 0", fontSize: 13, color: "#dc2626" }}>
              {commitResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <button onClick={reset} style={{ marginTop: 20, padding: "8px 20px", borderRadius: 6, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14 }}>
            추가 등록
          </button>
        </div>
      )}

      {/* Instructions */}
      {stage === "idle" && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 20, fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 500, color: "#374151" }}>사용 방법</p>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>등록 양식을 다운로드하세요.</li>
            <li>양식에 회원 정보를 입력하세요. 이름은 필수입니다.</li>
            <li>파일을 선택하면 내용이 미리보기로 표시됩니다.</li>
            <li>서버 검증을 실행하면 중복·반 이름 오류 등을 확인합니다.</li>
            <li><strong>오류가 하나라도 있으면 등록 불가</strong>입니다 (ALL OR NOTHING). 파일을 수정 후 다시 업로드하세요.</li>
            <li>모든 행이 유효하면 전체 한 번에 등록됩니다.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
