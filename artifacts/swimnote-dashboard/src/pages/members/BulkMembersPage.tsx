/**
 * BulkMembersPage — 회원 일괄등록 (1,000명 지원)
 *
 * 정책:
 *   - 필수: 이름 + 보호자 연락처 (2개만)
 *   - BLOCKING error: 이름 없음, 보호자 연락처 없음/불량, 1001명 초과
 *   - WARNING (등록 가능): 반 이름 미발견, 중복 의심
 *   - ALL-OR-NOTHING: blocking error 0건일 때만 전체 등록
 *   - 기존 7컬럼 파일도 업로드 가능 (backward compatible)
 */
import React, { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

// ── 헤더 별칭 매핑 (normalize 후 비교) ──────────────────────────────────────
function normH(h: string): string {
  return h.replace(/[\s\-_()（）·•,*]/g, "").toLowerCase();
}
const HEADER_ALIASES: Array<[string[], string]> = [
  [["이름", "name", "성명", "성함", "회원명", "학생명", "자녀이름", "학생이름"],          "name"],
  [["보호자연락처", "보호자전화번호", "보호자전화", "보호자번호", "parent_phone",
    "parentphone"],                                                                         "parent_phone"],
  // "연락처"/"연락처(보호자)": 보호자 연락처 컬럼 없으면 parent_phone으로 fallback
  [["연락처", "전화번호", "phone"],                                                         "phone_or_pp"],
  [["생년", "생년월일", "출생년도", "birth_year", "birthyear"],                             "birth_year"],
  [["보호자이름", "보호자성명", "학부모이름", "parent_name", "parentname"],                  "parent_name"],
  [["반이름", "반", "class_name", "classname"],                                             "class_name"],
  [["메모", "비고", "특이사항", "memo", "note"],                                            "memo"],
];
const ALIAS_MAP: Record<string, string> = {};
for (const [aliases, field] of HEADER_ALIASES) {
  for (const a of aliases) ALIAS_MAP[normH(a)] = field;
}

// ── 전화번호 normalize (+82 포함) ─────────────────────────────────────────
function normPhone(raw: string): string {
  let n = String(raw ?? "").replace(/^="?|"?$/g, "").replace(/^=/, "");
  n = n.replace(/[^0-9]/g, "");
  if (n.startsWith("82") && n.length >= 11) n = "0" + n.slice(2);
  if (n.length === 10 && /^1[0-9]/.test(n)) n = "0" + n;
  return n;
}

type ParsedRow = {
  _row: number;
  name: string;
  parent_phone?: string;
  phone?: string;
  birth_year?: string;
  parent_name?: string;
  class_name?: string;
  memo?: string;
};

type ValidateResponse = {
  total: number;
  valid: number;
  blocking_error_count: number;
  warning_count: number;
  errors: Array<{ row: number; name: string; field: string; code: string; message: string }>;
  warnings: Array<{ row: number; name: string; field: string; code: string; message: string }>;
  rows: Array<ParsedRow & { valid: boolean; class_group_id: string | null }>;
};

type Stage = "idle" | "preview" | "validated" | "done";
const MAX_PREVIEW = 100;

export default function BulkMembersPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResponse | null>(null);
  const [commitResult, setCommitResult] = useState<{ created: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [parseErr, setParseErr] = useState("");
  const [showAllPreview, setShowAllPreview] = useState(false);

  // ── Template Download (2컬럼) ────────────────────────────────────────────
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["이름", "보호자 연락처"],
      ["홍길동", "010-1234-5678"],
      ["김수영", "010-9876-5432"],
      ["이민준", "010-3333-4444"],
    ]);
    // 전화번호 컬럼 서식 (텍스트 — 앞자리 0 유지)
    ["B2", "B3", "B4"].forEach(addr => {
      if (!ws[addr]) return;
      ws[addr].z = "@";
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "회원목록");
    XLSX.writeFile(wb, "SWIMNOTE_회원등록_양식.xlsx");
  }

  // ── File Parse (client-side, flexible header) ───────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseErr("");
    setStage("idle");
    setParsed([]);
    setValidateResult(null);
    setShowAllPreview(false);

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      setParseErr("xlsx, xls, csv 파일만 지원합니다.");
      return;
    }
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (raw.length < 2) { setParseErr("데이터 행이 없습니다. 양식을 확인하세요."); return; }

      // Header detection (flexible alias)
      const headerRow = (raw[0] as string[]).map(h => String(h).trim());
      const colMap: Record<string, number> = {};
      headerRow.forEach((h, i) => {
        const key = ALIAS_MAP[normH(h)];
        if (key && colMap[key] === undefined) colMap[key] = i;
      });

      // "연락처" fallback → parent_phone if no 보호자 연락처 column
      if (colMap["phone_or_pp"] !== undefined && colMap["parent_phone"] === undefined) {
        colMap["parent_phone"] = colMap["phone_or_pp"];
      }
      delete colMap["phone_or_pp"];

      if (colMap["name"] === undefined) {
        setParseErr("열 이름에서 '이름' 컬럼을 찾을 수 없습니다. 양식을 확인하세요.");
        return;
      }

      const items: ParsedRow[] = [];
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i] as any[];
        const name = String(row[colMap["name"]] ?? "").trim();
        if (!name) continue; // 완전 빈 행 skip
        items.push({
          _row: i + 1, // Excel row number (header=1, data from 2)
          name,
          parent_phone: colMap["parent_phone"] != null
            ? normPhone(String(row[colMap["parent_phone"]] ?? "")) || undefined
            : undefined,
          phone: colMap["phone"] != null
            ? normPhone(String(row[colMap["phone"]] ?? "")) || undefined
            : undefined,
          birth_year: colMap["birth_year"] != null
            ? String(row[colMap["birth_year"]] ?? "").trim() || undefined
            : undefined,
          parent_name: colMap["parent_name"] != null
            ? String(row[colMap["parent_name"]] ?? "").trim() || undefined
            : undefined,
          class_name: colMap["class_name"] != null
            ? String(row[colMap["class_name"]] ?? "").trim() || undefined
            : undefined,
          memo: colMap["memo"] != null
            ? String(row[colMap["memo"]] ?? "").trim() || undefined
            : undefined,
        });
      }

      if (items.length === 0) { setParseErr("유효한 데이터 행이 없습니다."); return; }
      if (items.length > 1000) {
        setParseErr(`파일에 ${items.length.toLocaleString()}명이 있습니다. 한 번에 최대 1,000명까지 등록할 수 있습니다. 파일을 나눠 업로드해주세요.`);
        return;
      }
      setParsed(items);
      setStage("preview");
    } catch {
      setParseErr("파일 파싱에 실패했습니다. 형식을 확인하세요.");
    }
  }

  // ── Server Validate ──────────────────────────────────────────────────────
  async function handleValidate() {
    setLoading(true);
    setParseErr("");
    try {
      const r = await api.post<ValidateResponse>("/admin/members/bulk/validate", { rows: parsed });
      setValidateResult(r);
      setStage("validated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || "서버 검증 실패";
      const code = e?.response?.data?.code;
      if (code === "ROW_LIMIT_EXCEEDED") {
        setParseErr("한 번에 최대 1,000명까지 등록할 수 있습니다. 파일을 나눠주세요.");
      } else {
        setParseErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Commit ───────────────────────────────────────────────────────────────
  async function handleCommit() {
    if (!validateResult || validateResult.blocking_error_count > 0) return;
    const validRows = validateResult.rows.filter(r => r.valid);
    if (!confirm(`${validRows.length.toLocaleString()}명을 모두 등록하시겠습니까?`)) return;
    setLoading(true);
    setParseErr("");
    try {
      const r = await api.post<{ created: number }>("/admin/members/bulk/commit", { rows: validRows });
      setCommitResult(r);
      setStage("done");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e: any) {
      const code = e?.response?.data?.code;
      const msg  = e?.response?.data?.error || "등록 실패";
      if (code === "IMPORT_SYSTEM_ERROR") {
        setParseErr("서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      } else {
        setParseErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Error CSV Download ───────────────────────────────────────────────────
  function downloadErrorCsv() {
    if (!validateResult) return;
    const BOM = "\uFEFF";
    const header = "행 번호,이름,필드,오류 코드,오류 내용";
    const lines = validateResult.errors.map(e =>
      [e.row, `"${e.name}"`, e.field, e.code, `"${e.message}"`].join(",")
    );
    const csv = BOM + [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "오류목록.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function reset() {
    setStage("idle"); setParsed([]); setFileName(""); setValidateResult(null);
    setCommitResult(null); setParseErr(""); setShowAllPreview(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const canCommit = validateResult !== null && validateResult.blocking_error_count === 0;
  const vr = validateResult;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>회원 일괄등록</h2>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        이름과 보호자 연락처만 있으면 등록할 수 있습니다. 한 번에 최대 1,000명.
      </p>

      {/* ── 완료 ──────────────────────────────────────────────────────────── */}
      {stage === "done" && commitResult && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>등록 완료</p>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
            {commitResult.created.toLocaleString()}명이 모두 등록됐습니다.
          </p>
          <button onClick={reset}
            style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14 }}>
            추가 등록
          </button>
        </div>
      )}

      {/* ── idle / preview / validated ────────────────────────────────────── */}
      {stage !== "done" && (
        <>
          {/* Header row */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
            <button onClick={downloadTemplate}
              style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>
              📥 양식 다운로드
            </button>
            <label style={{
              padding: "7px 14px", borderRadius: 7, border: "1px solid #2563eb",
              background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 13,
            }}>
              파일 선택
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
                style={{ display: "none" }} onChange={handleFile} />
            </label>
            {fileName && (
              <span style={{ fontSize: 13, color: "#374151" }}>
                {fileName}
                <button onClick={reset} style={{ marginLeft: 6, fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}>✕ 초기화</button>
              </span>
            )}
          </div>

          {/* ── 안내 (idle) ─────────────────────────────────────────────── */}
          {stage === "idle" && (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 20, fontSize: 13, color: "#374151", lineHeight: 1.9 }}>
              <p style={{ margin: "0 0 10px", fontWeight: 600, color: "#111827" }}>사용 방법</p>
              <p style={{ margin: "0 0 6px" }}>기본 양식을 다운로드하고 이름과 보호자 연락처를 입력하세요.</p>
              <p style={{ margin: "0 0 6px" }}>이름과 보호자 연락처만 필수이며, 학생 연락처·생년·보호자 이름·반 이름·메모는 선택사항입니다.</p>
              <p style={{ margin: "0 0 12px" }}>한 번에 최대 1,000명까지 등록할 수 있습니다.</p>
              <p style={{ margin: "0 0 6px" }}>동명이인과 동일한 보호자 연락처를 사용하는 형제·자매도 등록할 수 있습니다.</p>
              <p style={{ margin: "0 0 12px" }}>기존 회원과 이름과 보호자 연락처가 같아도 중복 의심으로 안내만 하며 등록할 수 있습니다.</p>
              <p style={{ margin: "0 0 12px" }}>반 이름을 입력하지 않거나 등록된 반을 찾지 못하면 미배정 회원으로 등록됩니다.</p>
              <p style={{ margin: "0 0 6px" }}>파일을 선택하면 등록 전에 전체 회원을 한 번에 검사합니다.</p>
              <p style={{ margin: "0 0 6px" }}>수정이 필요한 항목이 있으면 엑셀 행 번호와 오류 이유를 모두 알려드립니다.</p>
              <p style={{ margin: "0 0 12px" }}>이 경우 파일을 수정해 다시 업로드하면 되며, 수정 전에는 아무 회원도 등록되지 않습니다.</p>
              <p style={{ margin: "0 0 12px" }}>중복 의심이나 반 미발견 같은 주의사항만 있는 경우에는 그대로 전체 등록할 수 있습니다.</p>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>기본 양식은 이름 / 보호자 연락처 2개 항목이며, 기존 7컬럼 파일도 그대로 업로드할 수 있습니다.</p>
            </div>
          )}

          {/* ── 오류 메시지 ─────────────────────────────────────────────── */}
          {parseErr && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13, color: "#991b1b" }}>
              ✗ {parseErr}
            </div>
          )}

          {/* ── Preview (파싱 완료) ─────────────────────────────────────── */}
          {(stage === "preview" || stage === "validated") && (
            <>
              {/* Summary bar */}
              <div style={{ display: "flex", gap: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px", marginBottom: 12, fontSize: 13 }}>
                <span>전체 <strong>{(vr ?? { total: parsed.length }).total?.toLocaleString() ?? parsed.length.toLocaleString()}명</strong></span>
                {vr && (
                  <>
                    <span style={{ color: "#16a34a" }}>등록 가능 <strong>{vr.valid.toLocaleString()}명</strong></span>
                    {vr.blocking_error_count > 0 && (
                      <span style={{ color: "#dc2626" }}>수정 필요 <strong>{vr.blocking_error_count}건</strong></span>
                    )}
                    {vr.warning_count > 0 && (
                      <span style={{ color: "#d97706" }}>주의사항 <strong>{vr.warning_count}건</strong></span>
                    )}
                  </>
                )}
              </div>

              {/* Blocking errors */}
              {vr && vr.errors.length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <p style={{ margin: 0, fontWeight: 600, color: "#991b1b", fontSize: 13 }}>
                      ✗ 수정이 필요한 회원이 있어 아직 아무 회원도 등록하지 않았습니다. 파일을 수정한 뒤 다시 업로드해주세요.
                    </p>
                    <button onClick={downloadErrorCsv}
                      style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", cursor: "pointer", fontSize: 12, color: "#991b1b", whiteSpace: "nowrap", marginLeft: 12 }}>
                      오류 목록 다운로드
                    </button>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#fee2e2" }}>
                        {["행", "이름", "필드", "오류 내용"].map(h => (
                          <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#7f1d1d" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vr.errors.map((e, i) => (
                        <tr key={i} style={{ borderTop: "1px solid #fecaca" }}>
                          <td style={{ padding: "5px 8px", color: "#dc2626" }}>{e.row}행</td>
                          <td style={{ padding: "5px 8px" }}>{e.name}</td>
                          <td style={{ padding: "5px 8px", color: "#6b7280" }}>{e.field}</td>
                          <td style={{ padding: "5px 8px" }}>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Warnings */}
              {vr && vr.warnings.length > 0 && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 600, color: "#92400e", fontSize: 13 }}>
                    ⚠ 주의사항 {vr.warning_count}건 — 등록은 가능합니다.
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#78350f", lineHeight: 1.7 }}>
                    {vr.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w.row}행 {w.name}: {w.message}</li>
                    ))}
                    {vr.warnings.length > 20 && (
                      <li style={{ color: "#9ca3af" }}>… 외 {vr.warnings.length - 20}건</li>
                    )}
                  </ul>
                </div>
              )}

              {/* All-valid banner */}
              {vr && vr.blocking_error_count === 0 && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13, color: "#166534" }}>
                  ✓ 모든 행이 유효합니다. 아래 등록 버튼을 눌러 {vr.valid.toLocaleString()}명을 전체 등록하세요.
                </div>
              )}

              {/* Preview table */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12, overflowX: "auto" }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid #e5e7eb", fontSize: 12, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
                  <span>
                    {parsed.length > MAX_PREVIEW && !showAllPreview
                      ? `처음 ${MAX_PREVIEW}명을 미리 표시합니다. (전체 ${parsed.length.toLocaleString()}명)`
                      : `전체 ${parsed.length.toLocaleString()}명`}
                  </span>
                  {vr && vr.errors.length > 0 && (
                    <span style={{ color: "#dc2626", fontWeight: 600 }}>오류 행은 빨간색으로 표시됩니다.</span>
                  )}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["#", "이름", "보호자 연락처", "반", "비고"].map(h => (
                        <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                      ))}
                      {stage === "validated" && (
                        <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>상태</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Preview rows: first MAX_PREVIEW OR show all */}
                    {((): ParsedRow[] => {
                      if (stage === "validated" && vr) {
                        // Show first MAX_PREVIEW normal rows + all error rows
                        const errRowNums = new Set(vr.errors.map(e => e.row));
                        const errRows = vr.rows.filter(r => errRowNums.has(r._row));
                        const normalRows = vr.rows.filter(r => !errRowNums.has(r._row));
                        const preview = showAllPreview
                          ? vr.rows
                          : [...normalRows.slice(0, MAX_PREVIEW), ...errRows].sort((a, b) => a._row - b._row);
                        return preview;
                      }
                      return showAllPreview ? parsed : parsed.slice(0, MAX_PREVIEW);
                    })().map((row: any, i) => {
                      const errRowNums = vr ? new Set(vr.errors.map(e => e.row)) : new Set<number>();
                      const warnRowNums = vr ? new Set(vr.warnings.map(w => w.row)) : new Set<number>();
                      const isErr = errRowNums.has(row._row);
                      const isWarn = !isErr && warnRowNums.has(row._row);
                      return (
                        <tr key={i} style={{
                          borderBottom: "1px solid #f3f4f6",
                          background: isErr ? "#fef2f2" : isWarn ? "#fffbeb" : undefined,
                        }}>
                          <td style={{ padding: "6px 10px", color: "#9ca3af", fontSize: 12 }}>{row._row}</td>
                          <td style={{ padding: "6px 10px", color: isErr ? "#dc2626" : "#111827" }}>{row.name || "—"}</td>
                          <td style={{ padding: "6px 10px", color: "#374151" }}>{row.parent_phone || "—"}</td>
                          <td style={{ padding: "6px 10px", color: "#6b7280" }}>{row.class_name || "—"}</td>
                          <td style={{ padding: "6px 10px", color: "#6b7280", fontSize: 12 }}>{row.birth_year || ""}</td>
                          {stage === "validated" && (
                            <td style={{ padding: "6px 10px" }}>
                              {isErr
                                ? <span style={{ color: "#dc2626", fontSize: 12 }}>
                                    {vr!.errors.filter(e => e.row === row._row).map(e => e.message).join(" / ")}
                                  </span>
                                : isWarn
                                  ? <span style={{ color: "#d97706", fontSize: 12 }}>⚠ 주의</span>
                                  : <span style={{ color: "#16a34a", fontSize: 12 }}>✓ 유효</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {parsed.length > MAX_PREVIEW && !showAllPreview && (
                  <div style={{ padding: "8px 14px", borderTop: "1px solid #e5e7eb" }}>
                    <button onClick={() => setShowAllPreview(true)}
                      style={{ fontSize: 13, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}>
                      전체 {parsed.length.toLocaleString()}명 모두 보기 ↓
                    </button>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                {stage === "preview" && (
                  <button onClick={handleValidate} disabled={loading}
                    style={{ padding: "9px 22px", borderRadius: 7, border: "none", background: "#2563eb", color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 14 }}>
                    {loading ? "검증 중…" : "서버 검증"}
                  </button>
                )}
                {stage === "validated" && (
                  <>
                    <button onClick={() => { reset(); }} style={{ padding: "9px 18px", borderRadius: 7, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13, color: "#374151" }}>
                      파일 다시 선택
                    </button>
                    <button
                      onClick={handleCommit}
                      disabled={loading || !canCommit}
                      title={!canCommit ? "수정이 필요한 행이 있습니다." : undefined}
                      style={{
                        padding: "9px 22px", borderRadius: 7, border: "none", fontSize: 14,
                        background: canCommit ? "#111827" : "#9ca3af",
                        color: "#fff", cursor: (loading || !canCommit) ? "not-allowed" : "pointer",
                      }}>
                      {loading ? "등록 중…"
                        : canCommit
                          ? `${(vr?.valid ?? 0).toLocaleString()}명 전체 등록`
                          : "오류 수정 필요"}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
