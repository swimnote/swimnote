import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiaryLevel {
  id: string;
  level_name: string;
  sort_order: number;
  template_count: number;
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return (e as ApiError).message;
  return "오류가 발생했습니다.";
}

// ─── LevelsPage ───────────────────────────────────────────────────────────────

export default function LevelsPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<DiaryLevel | null>(null);

  const { data: levels = [], isLoading, isError } = useQuery<DiaryLevel[]>({
    queryKey: ["diary-template-levels"],
    queryFn: () => api.get("/diary-template-levels"),
  });

  const createMut = useMutation({
    mutationFn: () => api.post("/diary-template-levels", { level_name: newName.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diary-template-levels"] }); setNewName(""); setError(""); },
    onError: (e) => setError(errMsg(e)),
  });

  const editMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/diary-template-levels/${id}`, { level_name: name.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diary-template-levels"] }); setEditId(null); setEditName(""); setError(""); },
    onError: (e) => setError(errMsg(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/diary-template-levels/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diary-template-levels"] }); setDeleteConfirm(null); setError(""); },
    onError: (e) => { setError(errMsg(e)); setDeleteConfirm(null); },
  });

  const reorderMut = useMutation({
    mutationFn: (ordered_ids: string[]) => api.post("/diary-template-levels/reorder", { ordered_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diary-template-levels"] }),
    onError: (e) => setError(errMsg(e)),
  });

  function moveLevel(index: number, dir: -1 | 1) {
    const newOrder = [...levels];
    const target = index + dir;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    reorderMut.mutate(newOrder.map((l) => l.id));
  }

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/admin/curriculum">
          <a style={{ fontSize: "13px", color: "#64748B", textDecoration: "none", cursor: "pointer" }}>← 커리큘럼 관리</a>
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>일지 레벨 관리</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            일지 템플릿에서 사용하는 레벨 목록입니다. (커리큘럼 수영 레벨과 별개)
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {/* Add new level */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#475569", marginBottom: "10px" }}>새 레벨 추가</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMut.mutate(); }}
            placeholder="레벨 이름 (예: 초급, 중급, 고급)"
            maxLength={50}
            style={{ flex: 1, padding: "7px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}
          />
          <button
            onClick={() => { if (!newName.trim()) { setError("레벨 이름을 입력해주세요."); return; } createMut.mutate(); }}
            disabled={createMut.isPending}
            style={{
              padding: "7px 16px", background: createMut.isPending ? "#93A8C4" : "#1D4E8F",
              color: "#fff", border: "none", borderRadius: "6px", cursor: createMut.isPending ? "not-allowed" : "pointer",
              fontSize: "13px", fontWeight: 600,
            }}
          >
            {createMut.isPending ? "추가 중…" : "추가"}
          </button>
        </div>
      </div>

      {/* Level list */}
      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : levels.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>등록된 일지 레벨이 없습니다.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["순서", "레벨 이름", "템플릿 수", "관리"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {levels.map((lv, i) => (
                <tr key={lv.id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        onClick={() => moveLevel(i, -1)}
                        disabled={i === 0 || reorderMut.isPending}
                        style={{ padding: "2px 6px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "4px", cursor: i === 0 ? "not-allowed" : "pointer", fontSize: "11px", color: i === 0 ? "#CBD5E1" : "#475569" }}
                      >▲</button>
                      <button
                        onClick={() => moveLevel(i, 1)}
                        disabled={i === levels.length - 1 || reorderMut.isPending}
                        style={{ padding: "2px 6px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "4px", cursor: i === levels.length - 1 ? "not-allowed" : "pointer", fontSize: "11px", color: i === levels.length - 1 ? "#CBD5E1" : "#475569" }}
                      >▼</button>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    {editId === lv.id ? (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && editName.trim()) editMut.mutate({ id: lv.id, name: editName }); if (e.key === "Escape") { setEditId(null); setEditName(""); } }}
                          maxLength={50}
                          autoFocus
                          style={{ padding: "5px 8px", border: "1px solid #1D4E8F", borderRadius: "4px", fontSize: "13px", width: "160px" }}
                        />
                        <button onClick={() => { if (editName.trim()) editMut.mutate({ id: lv.id, name: editName }); }} disabled={editMut.isPending}
                          style={{ padding: "5px 10px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>
                          저장
                        </button>
                        <button onClick={() => { setEditId(null); setEditName(""); }}
                          style={{ padding: "5px 10px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#1E293B" }}>{lv.level_name}</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#64748B", borderBottom: "1px solid #F1F5F9" }}>
                    {lv.template_count}개
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {editId !== lv.id && (
                        <button onClick={() => { setEditId(lv.id); setEditName(lv.level_name); setError(""); }}
                          style={{ padding: "4px 10px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#475569" }}>
                          수정
                        </button>
                      )}
                      <button
                        onClick={() => { setError(""); setDeleteConfirm(lv); }}
                        disabled={levels.length <= 1}
                        title={levels.length <= 1 ? "최소 1개 레벨 유지 필요" : ""}
                        style={{
                          padding: "4px 10px", background: levels.length <= 1 ? "#F9FAFB" : "#FEF2F2",
                          border: "none", borderRadius: "4px", cursor: levels.length <= 1 ? "not-allowed" : "pointer",
                          fontSize: "11px", color: levels.length <= 1 ? "#CBD5E1" : "#DC2626",
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 70, background: "#fff", borderRadius: "10px",
            boxShadow: "0 8px 40px rgba(0,0,0,0.16)", padding: "28px",
            width: "min(380px, calc(100vw - 48px))",
          }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>레벨 삭제</div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "6px", lineHeight: 1.6 }}>
              <strong>{deleteConfirm.level_name}</strong> 레벨을 삭제합니다.
            </div>
            {deleteConfirm.template_count > 0 && (
              <div style={{ padding: "8px 12px", background: "#FEF9C3", border: "1px solid #FCD34D", borderRadius: "6px", fontSize: "12px", color: "#92400E", marginBottom: "14px" }}>
                이 레벨에 템플릿 {deleteConfirm.template_count}개가 있습니다. 레벨 삭제 시 해당 템플릿도 모두 삭제됩니다.
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>취소</button>
              <button onClick={() => deleteMut.mutate(deleteConfirm.id)} disabled={deleteMut.isPending}
                style={{ padding: "8px 16px", background: deleteMut.isPending ? "#FCA5A5" : "#DC2626", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                {deleteMut.isPending ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
