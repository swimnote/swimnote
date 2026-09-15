import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RefreshCw, Save } from "lucide-react";

type SystemSettings = { [key: string]: unknown };
type Policy = { key: string; value: unknown; description?: string; updated_at?: string };

export default function SuperSettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"settings" | "policies">("settings");

  const { data: settings, isLoading: settingsLoading, refetch: refetchSettings } = useQuery({
    queryKey: ["super", "settings"],
    queryFn: () => api.get<SystemSettings>("/super/settings"),
    refetchInterval: 120_000,
  });

  const { data: policies = [], isLoading: policiesLoading } = useQuery({
    queryKey: ["super", "policies"],
    queryFn: () => api.get<Policy[]>("/super/policies/all").catch(() => [] as Policy[]),
    refetchInterval: 120_000,
  });

  const [editedSettings, setEditedSettings] = useState<SystemSettings>({});
  const [saved, setSaved] = useState(false);

  const saveMut = useMutation({
    mutationFn: (data: SystemSettings) => api.post("/super/settings", data),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); qc.invalidateQueries({ queryKey: ["super", "settings"] }); },
  });

  const currentSettings = { ...(settings ?? {}), ...editedSettings };

  const TABS = [
    { key: "settings" as const, label: "시스템 설정" },
    { key: "policies" as const, label: "정책 설정" },
  ];

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "900px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>시스템 설정</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>플랫폼 전역 설정 · 정책 관리</div>
        </div>
        <button onClick={() => refetchSettings()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      <div style={{ display: "flex", gap: "2px", marginBottom: "20px", borderBottom: "1px solid var(--border-default)" }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--x-primary)" : "2px solid transparent", marginBottom: "-1px", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? "var(--x-primary)" : "var(--text-muted)", cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "settings" && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "24px" }}>
          {settingsLoading ? (
            <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
          ) : !settings ? (
            <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>설정을 불러올 수 없습니다.</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
                {Object.entries(currentSettings).map(([key, value]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ width: "240px", fontSize: "13px", fontWeight: 600, color: "var(--text-body)", fontFamily: "monospace" }}>{key}</div>
                    {typeof value === "boolean" ? (
                      <button
                        onClick={() => setEditedSettings((prev) => ({ ...prev, [key]: !value }))}
                        style={{ width: "44px", height: "24px", borderRadius: "12px", border: "none", cursor: "pointer", background: value ? "var(--x-primary)" : "#D1D5DB", position: "relative", transition: "background 0.2s" }}
                      >
                        <div style={{ position: "absolute", top: "2px", left: value ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                      </button>
                    ) : typeof value === "number" ? (
                      <input type="number" value={value} onChange={(e) => setEditedSettings((prev) => ({ ...prev, [key]: Number(e.target.value) }))} style={{ height: "34px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", width: "160px" }} />
                    ) : (
                      <input type="text" value={String(value ?? "")} onChange={(e) => setEditedSettings((prev) => ({ ...prev, [key]: e.target.value }))} style={{ height: "34px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", flex: 1 }} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => saveMut.mutate(editedSettings)}
                  disabled={Object.keys(editedSettings).length === 0 || saveMut.isPending}
                  style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 20px", background: saved ? "#059669" : "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 700, transition: "background 0.2s" }}
                >
                  <Save size={14} />
                  {saved ? "저장됨 ✓" : "변경사항 저장"}
                </button>
                <button onClick={() => setEditedSettings({})} style={{ padding: "10px 16px", background: "var(--surface-subtle)", color: "var(--text-muted)", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>초기화</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "policies" && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
          {policiesLoading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--surface-subtle)" }}>
                {["정책 키", "값", "설명", "수정일"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {policies.map((p, i) => (
                  <tr key={p.key} style={{ borderBottom: i < policies.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                    <td style={{ padding: "12px 16px", fontSize: "12px", fontWeight: 700, color: "var(--text-body)", fontFamily: "monospace" }}>{p.key}</td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--text-strong)", fontWeight: 600 }}>{String(p.value ?? "-")}</td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", color: "var(--text-muted)" }}>{p.description ?? "-"}</td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", color: "var(--text-faint)" }}>{p.updated_at ? new Date(p.updated_at).toLocaleDateString("ko-KR") : "-"}</td>
                  </tr>
                ))}
                {policies.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>정책 데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
