/**
 * SettingsPage — /admin/settings
 * 수영장 홈페이지 설정 (GET/PATCH /homepage/settings)
 * X mode 상태 (GET /x-setup/status, read-only display)
 * Web PIN 안내 (앱 전용 설명)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface HomepageSettings {
  homepage_slug: string;
  homepage_enabled: boolean;
  name?: string;
  phone?: string;
  address?: string;
  introduction?: string;
}

interface XSetupSubmission {
  overall_status?: string;
  x_plan_key?: string;
  pool_id?: string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");

  const { data: hp, isLoading: hpLoading } = useQuery({
    queryKey: ["homepage-settings"],
    queryFn: async () => {
      const r = await api.get<HomepageSettings>("/homepage/settings");
      return r.data;
    },
  });

  const { data: xSetup } = useQuery({
    queryKey: ["x-setup-status-settings"],
    queryFn: async () => {
      try {
        const r = await api.get<{ submission: XSetupSubmission | null }>("/x-setup/status");
        return r.data.submission;
      } catch {
        return null;
      }
    },
  });

  const [slug, setSlug] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [initialized, setInitialized] = useState(false);

  if (hp && !initialized) {
    setSlug(hp.homepage_slug ?? "");
    setEnabled(hp.homepage_enabled ?? true);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/homepage/settings", { homepage_slug: slug, homepage_enabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["homepage-settings"] });
      setSaveMsg("저장되었습니다.");
      setSaveErr("");
      setTimeout(() => setSaveMsg(""), 3000);
    },
    onError: (e: any) => setSaveErr(e?.response?.data?.message || "저장 실패"),
  });

  return (
    <div style={{ padding: "24px", maxWidth: 700, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 24px" }}>설정</h2>

      {/* Pool Homepage Settings */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 24, marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>홈페이지 설정</h3>

        {hpLoading && <p style={{ color: "#6b7280" }}>불러오는 중…</p>}

        {hp && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {hp.name && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>수영장 이름</label>
                  <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{hp.name}</p>
                </div>
              )}
              {hp.phone && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>연락처</label>
                  <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{hp.phone}</p>
                </div>
              )}
              {hp.address && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>주소</label>
                  <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{hp.address}</p>
                </div>
              )}

              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 }}>홈페이지 슬러그</label>
                <input value={slug} onInput={(e: any) => setSlug(e.target.value)}
                  placeholder="my-pool" style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
                <p style={{ fontSize: 12, color: "#9ca3af", margin: "4px 0 0" }}>swimnote.kr/pool/[슬러그] 형식으로 공개됩니다.</p>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={enabled} onChange={(e: any) => setEnabled(e.target.checked)} />
                  홈페이지 공개
                </label>
              </div>
            </div>

            {saveErr && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 12 }}>{saveErr}</p>}
            {saveMsg && <p style={{ color: "#16a34a", fontSize: 13, marginTop: 12 }}>{saveMsg}</p>}

            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14 }}>
                {saveMutation.isPending ? "저장 중…" : "저장"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* X Mode Status */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 24, marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>SWIMNOTE X 상태</h3>
        {xSetup ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "#6b7280", width: 100 }}>플랜</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{xSetup.x_plan_key ?? "—"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "#6b7280", width: 100 }}>상태</span>
              <span style={{ fontSize: 14 }}>{xSetup.overall_status ?? "—"}</span>
            </div>
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "8px 0 0" }}>
              구독 및 결제 변경은 SWIMNOTE 앱에서 진행하세요.
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
            X 설정 정보를 불러오지 못했습니다. SWIMNOTE X를 구독 중인지 확인하세요.
          </p>
        )}
      </section>

      {/* Web PIN */}
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>PC 로그인 PIN</h3>
        <p style={{ fontSize: 14, color: "#6b7280", margin: 0, lineHeight: 1.6 }}>
          PC 로그인 PIN은 SWIMNOTE 앱에서 변경할 수 있습니다.<br />
          앱 → 마이페이지 → 보안 설정 → PC 로그인 PIN 변경
        </p>
      </section>
    </div>
  );
}
