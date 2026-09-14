import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CurriculumLevel {
  level_order: number;
  level_name: string;
  node_count: number;
}

interface CurriculumLevelsResponse {
  has_curriculum: boolean;
  version_id?: string;
  version_name?: string;
  levels?: CurriculumLevel[];
}

interface CurriculumNode {
  id: string;
  level_order: number;
  stroke: string | null;
  domain: string | null;
  skill_group: string | null;
  node_text: string;
  sort_order: number;
  is_test_item: boolean;
}

interface CurriculumNodesResponse {
  nodes: CurriculumNode[];
  total: number;
}

interface FacetsResponse {
  strokes: { value: string; label: string }[];
  domains: { value: string; label: string }[];
  skill_groups: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Badge({ children, color = "#E2E8F0", text = "#475569" }: { children: React.ReactNode; color?: string; text?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: "4px", fontSize: "11px", fontWeight: 600, background: color, color: text }}>
      {children}
    </span>
  );
}

// ─── CurriculumPage ───────────────────────────────────────────────────────────

export default function CurriculumPage() {
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [strokeFilter, setStrokeFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");

  const { data: levelsData, isLoading: levelsLoading, isError: levelsError } = useQuery<CurriculumLevelsResponse>({
    queryKey: ["curriculum-levels"],
    queryFn: () => api.get("/curriculum/diary/levels"),
  });

  const { data: facets } = useQuery<FacetsResponse>({
    queryKey: ["curriculum-facets", selectedLevel],
    queryFn: () =>
      api.get(`/curriculum/diary/facets${selectedLevel != null ? `?level_order=${selectedLevel}` : ""}`),
    enabled: levelsData?.has_curriculum === true,
  });

  const nodesParams = new URLSearchParams();
  if (selectedLevel != null) nodesParams.set("level_order", String(selectedLevel));
  if (strokeFilter) nodesParams.set("stroke", strokeFilter);
  if (domainFilter) nodesParams.set("domain", domainFilter);
  nodesParams.set("limit", "200");

  const { data: nodesData, isLoading: nodesLoading } = useQuery<CurriculumNodesResponse>({
    queryKey: ["curriculum-nodes", selectedLevel, strokeFilter, domainFilter],
    queryFn: () => api.get(`/curriculum/diary/nodes?${nodesParams.toString()}`),
    enabled: levelsData?.has_curriculum === true,
  });

  const levels = levelsData?.levels ?? [];
  const nodes = nodesData?.nodes ?? [];

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>커리큘럼 관리</h1>
          {levelsData?.version_name && (
            <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
              현재 버전: {levelsData.version_name}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link href="/admin/curriculum/levels">
            <a style={{ padding: "7px 14px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", color: "#475569", textDecoration: "none", cursor: "pointer" }}>
              일지 레벨 관리
            </a>
          </Link>
          <Link href="/admin/curriculum/templates">
            <a style={{ padding: "7px 14px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", color: "#475569", textDecoration: "none", cursor: "pointer" }}>
              일지 템플릿
            </a>
          </Link>
          <Link href="/admin/curriculum/new">
            <a style={{ padding: "7px 14px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", fontSize: "13px", textDecoration: "none", cursor: "pointer", fontWeight: 600 }}>
              커리큘럼 등록
            </a>
          </Link>
        </div>
      </div>

      {/* Info banner: read-only */}
      <div style={{ padding: "10px 14px", background: "#F0F7FF", border: "1px solid #BFDBFE", borderRadius: "6px", fontSize: "12px", color: "#1E40AF", marginBottom: "20px" }}>
        커리큘럼 구조는 읽기 전용입니다. 커리큘럼 등록 및 버전 관리는 SWIMNOTE 운영팀을 통해 진행됩니다.
      </div>

      {levelsLoading ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8" }}>로딩 중…</div>
      ) : levelsError ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#EF4444" }}>커리큘럼 정보를 불러오지 못했습니다.</div>
      ) : !levelsData?.has_curriculum ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8" }}>
          <div style={{ fontSize: "15px", marginBottom: "8px" }}>등록된 커리큘럼이 없습니다.</div>
          <div style={{ fontSize: "13px" }}>SWIMNOTE 운영팀에 커리큘럼 등록을 요청하세요.</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
          {/* Level sidebar */}
          <div style={{ width: "180px", flexShrink: 0 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>레벨</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <button
                onClick={() => { setSelectedLevel(null); setStrokeFilter(""); setDomainFilter(""); }}
                style={{
                  padding: "8px 12px", borderRadius: "6px", cursor: "pointer", textAlign: "left",
                  border: selectedLevel === null ? "1.5px solid #1D4E8F" : "1px solid #E2E8F0",
                  background: selectedLevel === null ? "#EEF4FB" : "#fff",
                  fontSize: "13px", fontWeight: selectedLevel === null ? 600 : 400,
                  color: selectedLevel === null ? "#1D4E8F" : "#475569",
                }}
              >
                전체
              </button>
              {levels.map((lv) => (
                <button
                  key={lv.level_order}
                  onClick={() => { setSelectedLevel(lv.level_order); setStrokeFilter(""); setDomainFilter(""); }}
                  style={{
                    padding: "8px 12px", borderRadius: "6px", cursor: "pointer", textAlign: "left",
                    border: selectedLevel === lv.level_order ? "1.5px solid #1D4E8F" : "1px solid #E2E8F0",
                    background: selectedLevel === lv.level_order ? "#EEF4FB" : "#fff",
                    fontSize: "13px", fontWeight: selectedLevel === lv.level_order ? 600 : 400,
                    color: selectedLevel === lv.level_order ? "#1D4E8F" : "#475569",
                  }}
                >
                  <div>{lv.level_name}</div>
                  <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>{lv.node_count}개 항목</div>
                </button>
              ))}
            </div>
          </div>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Filters */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              {facets && facets.strokes.length > 0 && (
                <select
                  value={strokeFilter}
                  onChange={(e) => setStrokeFilter(e.target.value)}
                  style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}
                >
                  <option value="">영법 전체</option>
                  {facets.strokes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              {facets && facets.domains.length > 0 && (
                <select
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}
                >
                  <option value="">영역 전체</option>
                  {facets.domains.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              )}
              <span style={{ alignSelf: "center", fontSize: "12px", color: "#94A3B8" }}>
                {nodesLoading ? "…" : `${nodesData?.total ?? nodes.length}개`}
              </span>
            </div>

            {/* Node table */}
            {nodesLoading ? (
              <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
            ) : nodes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>등록된 커리큘럼이 없습니다.</div>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC" }}>
                      {["레벨", "영법", "영역", "기술명", "시험항목"].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n, i) => (
                      <tr key={n.id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <td style={{ padding: "9px 14px", fontSize: "13px", color: "#64748B", borderBottom: "1px solid #F1F5F9" }}>L{n.level_order}</td>
                        <td style={{ padding: "9px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{n.stroke || "—"}</td>
                        <td style={{ padding: "9px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{n.domain || "—"}</td>
                        <td style={{ padding: "9px 14px", fontSize: "13px", color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{n.node_text}</td>
                        <td style={{ padding: "9px 14px", borderBottom: "1px solid #F1F5F9" }}>
                          {n.is_test_item ? <Badge color="#FEF9C3" text="#92400E">시험</Badge> : <span style={{ color: "#CBD5E1", fontSize: "12px" }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
