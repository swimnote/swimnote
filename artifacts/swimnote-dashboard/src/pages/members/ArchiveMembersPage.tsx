/**
 * ArchiveMembersPage.tsx — WEB 지난 회원 (퇴원 Archive) 목록/상세/일지/연결
 *
 * pool_admin: 조회 + 수동 연결/해제
 * teacher   : 조회만
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api-client";
import { ChevronLeft, Search, Link2, Unlink, BookOpen } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ArchiveMember {
  id: string;
  original_student_id: string;
  student_name: string;
  birth_year?: string | null;
  last_class_name?: string | null;
  last_level_order?: number | null;
  withdrawn_at: string;
  withdrawn_by_name?: string | null;
}

interface ArchiveDiary {
  id: string;
  lesson_date: string;
  former_class_name?: string | null;
  former_teacher_name?: string | null;
  common_content?: string | null;
  student_note?: string | null;
  is_makeup_diary: boolean;
}

interface ArchiveDetail extends ArchiveMember {
  active_link?: {
    id: string;
    current_student_id: string;
    current_student_name: string;
    current_birth_year?: number | null;
    current_status: string;
    linked_at: string;
  } | null;
}

interface StudentCandidate {
  id: string;
  name: string;
  birth_year?: number | null;
  status: string;
}

function fmtDate(d?: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function phoneMatchLabel(m: boolean | null) {
  if (m === true) return { text: "일치", color: "#16A34A" };
  if (m === false) return { text: "불일치", color: "#DC2626" };
  return { text: "확인불가", color: "#6B7280" };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ArchiveMembersPage({ userRole }: { userRole?: string }) {
  const isAdmin = userRole === "pool_admin" || userRole === "super_admin";

  const [members, setMembers] = useState<ArchiveMember[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [diaries, setDiaries] = useState<ArchiveDiary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearchInput, setLinkSearchInput] = useState("");
  const [linkCandidates, setLinkCandidates] = useState<StudentCandidate[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkConfirm, setLinkConfirm] = useState<any | null>(null);
  const [linking, setLinking] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // load list
  const loadList = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const qs = q ? `?search=${encodeURIComponent(q)}&limit=100` : "?limit=100";
      const data = await api(`/admin/archives${qs}`);
      setMembers(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const handleSearch = () => { setSearch(searchInput); loadList(searchInput || undefined); };

  // open detail
  const openDetail = async (m: ArchiveMember) => {
    setDetail({ ...m });
    setDiaries([]);
    setDetailLoading(true);
    try {
      const [det, dias] = await Promise.all([
        api(`/admin/archives/${m.id}`),
        api(`/admin/archives/${m.id}/diaries`),
      ]);
      setDetail(det);
      setDiaries(dias ?? []);
    } catch { /* ignore */ } finally { setDetailLoading(false); }
  };

  // link candidate search
  const searchCandidates = async (q: string) => {
    if (!q.trim()) { setLinkCandidates([]); return; }
    setLinkLoading(true);
    try {
      const data = await api(`/admin/students?search=${encodeURIComponent(q)}&limit=20`);
      setLinkCandidates(data.students ?? data ?? []);
    } catch { /* ignore */ } finally { setLinkLoading(false); }
  };

  const selectLinkCandidate = async (candidate: StudentCandidate) => {
    if (!detail) return;
    try {
      const data = await api(`/admin/archive-link-candidates?archive_id=${detail.id}&student_id=${candidate.id}`);
      setLinkConfirm({ ...data, candidate });
    } catch { /* ignore */ }
  };

  const doLink = async () => {
    if (!detail || !linkConfirm) return;
    setLinking(true);
    try {
      await api("/admin/archive-links", {
        method: "POST",
        body: JSON.stringify({ archive_member_id: detail.id, current_student_id: linkConfirm.current?.id }),
      });
      setShowLinkSearch(false);
      setLinkConfirm(null);
      setLinkSearchInput("");
      setLinkCandidates([]);
      openDetail(detail); // refresh
    } catch (e: any) {
      alert(e?.message ?? "연결 실패");
    } finally { setLinking(false); }
  };

  const doUnlink = async () => {
    if (!detail?.active_link) return;
    setSaving(true);
    try {
      await api(`/admin/archive-links/${detail.active_link.id}`, { method: "DELETE" });
      setDetail(d => d ? { ...d, active_link: null } : d);
      setUnlinkConfirm(false);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  // ── List view ──────────────────────────────────────────────────────────────
  if (!detail) {
    return (
      <div style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#111827" }}>지난 회원</h2>
          <span style={{ fontSize: "13px", color: "#6B7280" }}>퇴원 Archive ({total}명)</span>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="이름 검색"
            style={{ flex: 1, height: "36px", borderRadius: "8px", border: "1px solid #E5E7EB", padding: "0 12px", fontSize: "14px" }}
          />
          <button onClick={handleSearch} style={{ height: "36px", padding: "0 16px", borderRadius: "8px", background: "#1E40AF", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
            <Search size={14} /> 검색
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#6B7280", padding: "40px" }}>로딩 중...</div>
        ) : members.length === 0 ? (
          <div style={{ textAlign: "center", color: "#6B7280", padding: "40px" }}>지난 회원이 없습니다.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
                <th style={th}>이름</th>
                <th style={th}>마지막 반</th>
                <th style={th}>출생연도</th>
                <th style={th}>퇴원일</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td style={td}><span style={{ fontWeight: 600, color: "#111827" }}>{m.student_name}</span></td>
                  <td style={td}>{m.last_class_name ?? "-"}</td>
                  <td style={td}>{m.birth_year ?? "-"}</td>
                  <td style={td}>{fmtDate(m.withdrawn_at)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button onClick={() => openDetail(m)} style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: "6px", padding: "4px 12px", cursor: "pointer", fontSize: "13px", color: "#374151" }}>
                      상세
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "24px" }}>
      <button onClick={() => setDetail(null)} style={{ display: "flex", alignItems: "center", gap: "4px", background: "none", border: "none", cursor: "pointer", color: "#6B7280", fontSize: "14px", marginBottom: "16px" }}>
        <ChevronLeft size={16} /> 목록으로
      </button>

      <h2 style={{ margin: "0 0 20px", fontSize: "18px", fontWeight: 700, color: "#111827" }}>{detail.student_name}</h2>

      {/* 회원 정보 */}
      <div style={card}>
        <h3 style={cardTitle}>회원 정보</h3>
        <dl style={dlStyle}>
          {detail.last_class_name && <><dt style={dtStyle}>마지막 반</dt><dd style={ddStyle}>{detail.last_class_name}</dd></>}
          {detail.birth_year && <><dt style={dtStyle}>출생연도</dt><dd style={ddStyle}>{detail.birth_year}</dd></>}
          <dt style={dtStyle}>퇴원일</dt><dd style={ddStyle}>{fmtDate(detail.withdrawn_at)}</dd>
          {detail.withdrawn_by_name && <><dt style={dtStyle}>처리자</dt><dd style={ddStyle}>{detail.withdrawn_by_name}</dd></>}
        </dl>
      </div>

      {/* 연결 */}
      {isAdmin && (
        <div style={card}>
          <h3 style={cardTitle}>현재 회원 연결</h3>
          {detail.active_link ? (
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>{detail.active_link.current_student_name}</div>
              <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "4px" }}>연결일: {fmtDate(detail.active_link.linked_at)}</div>
              <button onClick={() => setUnlinkConfirm(true)} style={{ marginTop: "12px", border: "1px solid #DC2626", borderRadius: "8px", padding: "6px 16px", background: "none", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600 }}>
                <Unlink size={14} /> 연결 해제
              </button>
            </div>
          ) : (
            <button onClick={() => { setShowLinkSearch(true); setLinkSearchInput(""); setLinkCandidates([]); setLinkConfirm(null); }} style={{ border: "none", borderRadius: "8px", padding: "8px 16px", background: "#1E40AF", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 600 }}>
              <Link2 size={14} /> 현재 회원과 연결
            </button>
          )}
        </div>
      )}

      {/* 지난 일지 */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <BookOpen size={16} color="#6B7280" />
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#374151" }}>지난 수업일지 ({diaries.length}건)</h3>
      </div>
      {detailLoading ? (
        <div style={{ color: "#6B7280", padding: "20px" }}>로딩 중...</div>
      ) : diaries.length === 0 ? (
        <div style={{ color: "#6B7280", fontSize: "14px" }}>저장된 수업일지가 없습니다.</div>
      ) : (
        diaries.map(d => (
          <div key={d.id} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "12px", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 700, fontSize: "13px", color: "#111827" }}>{d.lesson_date}</span>
              {d.is_makeup_diary && <span style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: "11px", fontWeight: 600, borderRadius: "4px", padding: "1px 6px" }}>보강</span>}
              {d.former_class_name && <span style={{ color: "#6B7280", fontSize: "12px" }}>{d.former_class_name} · {d.former_teacher_name ?? "-"}</span>}
            </div>
            {d.common_content && <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>{d.common_content}</p>}
            {d.student_note && (
              <div style={{ marginTop: "8px", background: "#FFF7ED", borderRadius: "6px", padding: "8px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#92400E", marginBottom: "2px" }}>개별 피드백</div>
                <div style={{ fontSize: "13px", color: "#374151" }}>{d.student_note}</div>
              </div>
            )}
          </div>
        ))
      )}

      {/* Link Search Modal */}
      {showLinkSearch && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowLinkSearch(false)}>
          <div style={{ background: "#fff", borderRadius: "16px", width: "480px", maxHeight: "80vh", overflow: "auto", padding: "24px" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700 }}>현재 회원 검색</h3>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <input
                value={linkSearchInput}
                onChange={e => setLinkSearchInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchCandidates(linkSearchInput)}
                placeholder="이름 검색"
                autoFocus
                style={{ flex: 1, height: "36px", borderRadius: "8px", border: "1px solid #E5E7EB", padding: "0 12px", fontSize: "14px" }}
              />
              <button onClick={() => searchCandidates(linkSearchInput)} style={{ height: "36px", padding: "0 16px", borderRadius: "8px", background: "#1E40AF", color: "#fff", border: "none", cursor: "pointer" }}>검색</button>
            </div>
            {linkLoading ? <div style={{ color: "#6B7280" }}>검색 중...</div> : (
              linkCandidates.map(c => (
                <div key={c.id} onClick={() => selectLinkCandidate(c)} style={{ padding: "10px 12px", borderRadius: "8px", cursor: "pointer", marginBottom: "4px", border: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.birth_year && <span style={{ color: "#6B7280", fontSize: "12px" }}>{c.birth_year}년생</span>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Link Confirm */}
      {linkConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "16px", width: "400px", padding: "24px" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700 }}>연결 확인</h3>
            <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
              <div style={{ flex: 1, background: "#F9FAFB", borderRadius: "8px", padding: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B7280", marginBottom: "4px" }}>지난 회원</div>
                <div style={{ fontWeight: 700 }}>{linkConfirm.archive?.student_name}</div>
                {linkConfirm.archive?.birth_year && <div style={{ fontSize: "12px", color: "#6B7280" }}>{linkConfirm.archive.birth_year}년생</div>}
                <div style={{ fontSize: "12px", color: "#6B7280" }}>퇴원 {fmtDate(linkConfirm.archive?.withdrawn_at)}</div>
              </div>
              <div style={{ flex: 1, background: "#F9FAFB", borderRadius: "8px", padding: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#6B7280", marginBottom: "4px" }}>현재 회원</div>
                <div style={{ fontWeight: 700 }}>{linkConfirm.current?.name}</div>
                {linkConfirm.current?.birth_year && <div style={{ fontSize: "12px", color: "#6B7280" }}>{linkConfirm.current.birth_year}년생</div>}
              </div>
            </div>
            <div style={{ marginBottom: "16px", fontSize: "13px" }}>
              전화번호: <span style={{ fontWeight: 700, color: phoneMatchLabel(linkConfirm.phone_match).color }}>{phoneMatchLabel(linkConfirm.phone_match).text}</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setLinkConfirm(null)} style={{ flex: 1, height: "36px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "none", cursor: "pointer", fontSize: "14px" }}>취소</button>
              <button onClick={doLink} disabled={linking} style={{ flex: 1, height: "36px", borderRadius: "8px", background: "#1E40AF", color: "#fff", border: "none", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
                {linking ? "연결 중..." : "연결"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlink Confirm */}
      {unlinkConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "16px", width: "360px", padding: "24px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "16px", fontWeight: 700 }}>연결 해제</h3>
            <p style={{ fontSize: "14px", color: "#374151", marginBottom: "20px" }}>현재 회원과의 연결을 해제합니다. Archive 원본은 유지됩니다.</p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setUnlinkConfirm(false)} style={{ flex: 1, height: "36px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "none", cursor: "pointer" }}>취소</button>
              <button onClick={doUnlink} disabled={saving} style={{ flex: 1, height: "36px", borderRadius: "8px", background: "#DC2626", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
                {saving ? "처리 중..." : "해제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", fontSize: "13px", fontWeight: 600, color: "#6B7280" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: "14px", color: "#374151" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #E5E7EB", borderRadius: "12px", padding: "16px", marginBottom: "16px" };
const cardTitle: React.CSSProperties = { margin: "0 0 12px", fontSize: "14px", fontWeight: 700, color: "#374151" };
const dlStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "90px 1fr", gap: "6px 12px" };
const dtStyle: React.CSSProperties = { fontSize: "13px", color: "#6B7280" };
const ddStyle: React.CSSProperties = { fontSize: "13px", color: "#111827", margin: 0 };
