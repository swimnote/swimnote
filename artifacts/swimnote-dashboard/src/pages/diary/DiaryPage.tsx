import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiaryEntry {
  id: string;
  lesson_date: string | null;
  common_content: string | null;
  teacher_name: string | null;
  teacher_id: string;
  is_edited: boolean;
  created_at: string;
  class_name: string | null;
  schedule_days: string | null;
  schedule_time: string | null;
  note_count: number;
}

interface DiaryListResponse {
  success: boolean;
  entries: DiaryEntry[];
  total: number;
}

interface StudentNote {
  id: string;
  student_id: string;
  student_name: string;
  note_text?: string;
  content?: string;
  created_at: string;
}

interface MediaItem {
  id: string;
  file_url: string;
  thumbnail_url?: string;
  sort_order?: number | null;
  created_at?: string;
  kind: "photo" | "video";
}

interface DiaryDetail extends DiaryEntry {
  student_notes: StudentNote[];
  photos?: { id: string; file_url: string; thumbnail_url?: string; sort_order?: number | null; created_at?: string }[];
  videos?: { id: string; file_url: string; sort_order?: number | null; created_at?: string }[];
  class_group_id?: string;
  swimming_pool_id?: string;
  ai_generated?: boolean;
  edited_at?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s.includes("T") ? s : s + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    const koWeekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} (${koWeekdays[d.getDay()]})`;
  } catch { return "—"; }
}

function formatShortDate(s: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s.includes("T") ? s : s + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch { return "—"; }
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return (e as ApiError).message;
  return "오류가 발생했습니다.";
}

// ─── DiaryDetailDrawer ────────────────────────────────────────────────────────

function DiaryDetailDrawer({ diaryId, onClose }: { diaryId: string; onClose: () => void; }) {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const { data: detail, isLoading, isError } = useQuery<DiaryDetail>({
    queryKey: ["diary-detail", diaryId],
    queryFn: () => api.get(`/diaries/${diaryId}`),
  });

  const editMut = useMutation({
    mutationFn: () => api.put(`/diaries/${diaryId}`, { common_content: editContent.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["diary-detail", diaryId] });
      qc.invalidateQueries({ queryKey: ["diaries-admin"] });
      setEditMode(false);
      setEditError("");
    },
    onError: (e) => setEditError(errMsg(e)),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/diaries/${diaryId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diaries-admin"] }); onClose(); },
    onError: (e) => setEditError(errMsg(e)),
  });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "500px", background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", zIndex: 50, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#1E293B" }}>일지 상세</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isLoading ? <div style={{ color: "#94A3B8", fontSize: "13px" }}>로딩 중…</div>
            : isError ? <div style={{ color: "#EF4444", fontSize: "13px" }}>불러오지 못했습니다.</div>
            : detail ? (
              <>
                <div style={{ padding: "12px", background: "#F8FAFC", borderRadius: "6px", marginBottom: "16px", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                    <InfoRow label="수업일" value={formatDate(detail.lesson_date)} />
                    <InfoRow label="반" value={detail.class_name ?? "—"} />
                    <InfoRow label="선생님" value={detail.teacher_name ?? "—"} />
                    <InfoRow label="수업 시간" value={detail.schedule_time ?? "—"} />
                    <InfoRow label="요일" value={detail.schedule_days ?? "—"} />
                    <InfoRow label="작성일" value={formatDate(detail.created_at)} />
                  </div>
                  {detail.is_edited && <div style={{ marginTop: "8px", fontSize: "11px", color: "#94A3B8" }}>수정됨 {detail.edited_at ? `(${formatDate(detail.edited_at)})` : ""}</div>}
                  {detail.ai_generated && <div style={{ marginTop: "4px", fontSize: "11px", color: "#7C3AED", fontWeight: 600 }}>AI 자동 생성</div>}
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8", marginBottom: "6px", textTransform: "uppercase" as const, letterSpacing: "0.5px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>공통 수업 내용</span>
                    {!editMode && (
                      <button onClick={() => { setEditContent(detail.common_content ?? ""); setEditMode(true); setEditError(""); }}
                        style={{ background: "none", border: "1px solid #CBD5E1", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", color: "#475569", cursor: "pointer" }}>수정</button>
                    )}
                  </div>
                  {editMode ? (
                    <div>
                      <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)}
                        style={{ width: "100%", minHeight: "100px", padding: "8px 10px", border: "1px solid #1D4E8F", borderRadius: "6px", fontSize: "13px", resize: "vertical", boxSizing: "border-box", marginBottom: "6px" }} />
                      {editError && <div style={{ fontSize: "12px", color: "#DC2626", marginBottom: "6px" }}>{editError}</div>}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={() => setEditMode(false)} style={{ padding: "5px 12px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>취소</button>
                        <button onClick={() => { if (!editContent.trim()) { setEditError("내용을 입력해주세요."); return; } editMut.mutate(); }} disabled={editMut.isPending}
                          style={{ padding: "5px 12px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>
                          {editMut.isPending ? "저장 중…" : "저장"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "13px", color: detail.common_content ? "#1E293B" : "#94A3B8", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                      {detail.common_content || "내용 없음"}
                    </div>
                  )}
                </div>

                {detail.student_notes && detail.student_notes.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8", marginBottom: "8px", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                      학생별 개별 내용 ({detail.student_notes.length}명)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {detail.student_notes.map((note) => (
                        <div key={note.id} style={{ padding: "10px 12px", background: "#F8FAFC", borderRadius: "6px", border: "1px solid #E2E8F0" }}>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "#1E293B", marginBottom: "4px" }}>{note.student_name}</div>
                          <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{note.note_text ?? note.content ?? "내용 없음"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  // photos + videos merge-sorted by sort_order ASC (null→last), created_at ASC tie-break
                  const photos: MediaItem[] = (detail.photos ?? []).map(p => ({ ...p, kind: "photo" as const }));
                  const videos: MediaItem[] = (detail.videos ?? []).map(v => ({ ...v, kind: "video" as const }));
                  const mixed = [...photos, ...videos].sort((a, b) => {
                    const ao = typeof a.sort_order === "number" ? a.sort_order : 999999;
                    const bo = typeof b.sort_order === "number" ? b.sort_order : 999999;
                    if (ao !== bo) return ao - bo;
                    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
                  });
                  if (mixed.length === 0) return null;
                  return (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8", marginBottom: "8px", textTransform: "uppercase" as const }}>
                        미디어 ({photos.length}장 {videos.length > 0 ? `· 영상 ${videos.length}개` : ""})
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {mixed.map((m) =>
                          m.kind === "photo" ? (
                            <a key={m.id} href={m.file_url} target="_blank" rel="noopener noreferrer">
                              <img src={m.thumbnail_url ?? m.file_url} alt="사진"
                                style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "6px", border: "1px solid #E2E8F0", cursor: "pointer" }}
                                onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }} />
                            </a>
                          ) : (
                            <a key={m.id} href={m.file_url} target="_blank" rel="noopener noreferrer"
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "80px", height: "80px", borderRadius: "6px", border: "1px solid #E2E8F0", background: "#1E293B", cursor: "pointer", textDecoration: "none", fontSize: "22px" }}>
                              ▶
                            </a>
                          )
                        )}
                      </div>
                    </div>
                  );
                })()}

                {editError && !editMode && (
                  <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "12px" }}>{editError}</div>
                )}

                {deleteConfirm ? (
                  <div style={{ padding: "14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", marginTop: "16px" }}>
                    <div style={{ fontSize: "13px", color: "#DC2626", fontWeight: 600, marginBottom: "8px" }}>이 일지를 삭제합니다. 복구할 수 없습니다.</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => setDeleteConfirm(false)} style={{ padding: "6px 12px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>취소</button>
                      <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
                        style={{ padding: "6px 12px", background: "#DC2626", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>
                        {deleteMut.isPending ? "삭제 중…" : "삭제 확인"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #F1F5F9" }}>
                    <button onClick={() => { setEditError(""); setDeleteConfirm(true); }}
                      style={{ padding: "6px 12px", background: "none", border: "1px solid #FECACA", borderRadius: "4px", cursor: "pointer", fontSize: "12px", color: "#DC2626" }}>
                      일지 삭제
                    </button>
                  </div>
                )}
              </>
            ) : null}
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "1px" }}>{label}</div>
      <div style={{ fontSize: "12px", color: "#475569" }}>{value}</div>
    </div>
  );
}

// ─── DiaryPage ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function DiaryPage({ initialStudentId }: { initialStudentId?: string } = {}) {
  // Read student_id from URL search params (e.g. /admin/diary?student_id=123)
  const urlStudentId = initialStudentId ?? new URLSearchParams(window.location.search).get("student_id") ?? "";

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [studentId, setStudentId] = useState(urlStudentId);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Build server params — date range + student_id now go to server
  function buildParams() {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    if (studentId) p.set("student_id", studentId);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    return p.toString();
  }

  const { data, isLoading, isError } = useQuery<DiaryListResponse>({
    queryKey: ["diaries-admin", search, dateFrom, dateTo, studentId, offset],
    queryFn: () => api.get(`/diaries/admin/all-entries?${buildParams()}`),
    placeholderData: (prev) => prev,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  function handleSearch() { setOffset(0); }

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setStudentId("");
    setOffset(0);
  }

  const hasFilters = !!(search || dateFrom || dateTo || studentId);

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>일지 · 피드</h1>
        <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
          수영장 전체 수업일지를 조회합니다.
          {!isLoading && ` (전체 ${total}건)`}
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          placeholder="선생님·반·내용 검색"
          style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", width: "180px" }}
        />
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }} />
          <span style={{ color: "#94A3B8", fontSize: "12px" }}>—</span>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }} />
        </div>
        <button onClick={handleSearch}
          style={{ padding: "6px 12px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
          검색
        </button>
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ padding: "6px 10px", background: "#F1F5F9", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px", color: "#64748B" }}>
            초기화
          </button>
        )}
        <span style={{ fontSize: "12px", color: "#94A3B8", alignSelf: "center" }}>
          {isLoading ? "…" : `${entries.length}건 / 전체 ${total}건`}
        </span>
      </div>

      {studentId && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "6px", fontSize: "12px", color: "#1D4ED8", marginBottom: "12px" }}>
          <span>학생 일지 기록 — 담당 선생님·반 변경과 무관한 전체 History</span>
          <button onClick={() => { setStudentId(""); setOffset(0); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#60A5FA", fontSize: "11px", padding: "0 0 0 8px" }}>전체 보기</button>
        </div>
      )}

      {isError ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#EF4444" }}>불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8" }}>로딩 중…</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8" }}>
          {hasFilters ? "검색 결과가 없습니다." : "작성된 일지가 없습니다."}
        </div>
      ) : (
        <>
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  {["수업일", "반", "선생님", "내용 요약", "학생", "작성일"].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.id} onClick={() => setSelectedId(e.id)}
                    style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA", cursor: "pointer" }}
                    onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.background = "#F0F7FF")}
                    onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "#fff" : "#FAFAFA")}>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatDate(e.lesson_date)}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{e.class_name || "—"}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{e.teacher_name || "—"}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#64748B", borderBottom: "1px solid #F1F5F9", maxWidth: "280px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.common_content || <span style={{ color: "#CBD5E1" }}>내용 없음</span>}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "12px", color: "#64748B", borderBottom: "1px solid #F1F5F9" }}>
                      {e.note_count > 0 ? `${e.note_count}명` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "12px", color: "#94A3B8", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatShortDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "center" }}>
              <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
                style={{ padding: "6px 14px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: offset === 0 ? "not-allowed" : "pointer", fontSize: "13px", color: offset === 0 ? "#CBD5E1" : "#475569" }}>
                ← 이전
              </button>
              <span style={{ fontSize: "13px", color: "#64748B" }}>{currentPage} / {totalPages}</span>
              <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
                style={{ padding: "6px 14px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: offset + PAGE_SIZE >= total ? "not-allowed" : "pointer", fontSize: "13px", color: offset + PAGE_SIZE >= total ? "#CBD5E1" : "#475569" }}>
                다음 →
              </button>
            </div>
          )}
        </>
      )}

      {selectedId && <DiaryDetailDrawer diaryId={selectedId} onClose={closeDrawer} />}
    </div>
  );
}
