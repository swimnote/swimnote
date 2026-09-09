/**
 * SuperNotifications — 슈퍼 어드민 알림 인박스
 *
 * 5종 알림:
 *   POOL_SIGNUP          수영장 신규 가입
 *   INQUIRY_RECEIVED     문의사항 접수
 *   X_TRIAL_STARTED      X 무료체험 시작
 *   PAID_PLAN_ACTIVATED  유료 플랜 결제 성공
 *   CURRICULUM_UPLOADED  커리큘럼 파일 업로드
 *
 * 기능:
 *   - 로그인 시 unread count fetch + 뱃지
 *   - 목록 + 읽음 처리 (단건/전체)
 *   - 수영장명 클릭 → Control Center 이동
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

interface SuperNotif {
  id: string;
  type: string;
  title: string;
  body: string;
  pool_id: string | null;
  ref_id: string | null;
  ref_type: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICON: Record<string, string> = {
  POOL_SIGNUP:         "🏊",
  INQUIRY_RECEIVED:    "📩",
  X_TRIAL_STARTED:     "⚡",
  PAID_PLAN_ACTIVATED: "💳",
  CURRICULUM_UPLOADED: "📄",
};

function fmtAgo(d: string) {
  const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return "방금";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return new Date(d).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

// ── 알림 벨 버튼 (레이아웃에 삽입) ────────────────────────────────────────────
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await api.get<{ unread: number }>("/super/notifications/unread-count");
      setUnread(data?.unread ?? 0);
    } catch { /* 조용히 무시 */ }
  }, []);

  useEffect(() => {
    fetchUnread();
    const iv = setInterval(fetchUnread, 60_000); // 1분 주기 polling
    return () => clearInterval(iv);
  }, [fetchUnread]);

  // 패널 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-full hover:bg-[#f0f4ff] transition-colors text-[#002F5F]"
        title="알림"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <NotificationPanel onClose={() => setOpen(false)} onRead={fetchUnread} />
      )}
    </div>
  );
}

// ── 알림 패널 드롭다운 ─────────────────────────────────────────────────────
function NotificationPanel({ onClose, onRead }: { onClose: () => void; onRead: () => void }) {
  const [, navigate] = useLocation();
  const [notifs, setNotifs] = useState<SuperNotif[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ notifications: SuperNotif[] }>("/super/notifications?limit=30");
      setNotifs(data?.notifications ?? []);
    } catch { setNotifs([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const markRead = async (id: string) => {
    await api.post(`/super/notifications/${id}/read`, {}).catch(() => {});
    setNotifs(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n));
    onRead();
  };

  const markAllRead = async () => {
    await api.post("/super/notifications/read-all", {}).catch(() => {});
    setNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
    onRead();
  };

  const handleClick = async (n: SuperNotif) => {
    if (!n.is_read) await markRead(n.id);
    if (n.pool_id) {
      navigate(`/super/pools/${n.pool_id}`);
      onClose();
    } else if (n.ref_type === "inquiry" && n.ref_id) {
      navigate(`/super/support`);
      onClose();
    }
  };

  const unreadCount = notifs.filter(n => !n.is_read).length;

  return (
    <div className="absolute right-0 top-10 w-[360px] bg-white rounded-xl shadow-xl border border-[#e5e5e5] z-50 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0f0]">
        <span className="text-[13px] font-bold text-[#002F5F]">알림 {unreadCount > 0 && <span className="text-red-500">({unreadCount})</span>}</span>
        <button onClick={markAllRead} className="text-[11px] text-[#01B2F1] hover:underline font-medium">전체 읽음</button>
      </div>
      {/* 목록 */}
      <div className="max-h-[420px] overflow-y-auto divide-y divide-[#f5f5f5]">
        {loading ? (
          <div className="py-8 text-center text-[12px] text-[#bbb]">불러오는 중...</div>
        ) : notifs.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-[#bbb]">알림이 없습니다.</div>
        ) : notifs.map(n => (
          <div
            key={n.id}
            onClick={() => handleClick(n)}
            className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[#f8f9ff] transition-colors ${!n.is_read ? "bg-[#f0f7ff]" : ""}`}
          >
            <div className="text-[20px] leading-none mt-0.5 flex-shrink-0">{TYPE_ICON[n.type] ?? "🔔"}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <span className="text-[12px] font-semibold text-[#111] leading-snug">{n.title}</span>
                {!n.is_read && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1" />}
              </div>
              {n.body && <p className="text-[11px] text-[#666] mt-0.5 leading-snug line-clamp-2">{n.body}</p>}
              <span className="text-[10px] text-[#bbb] mt-1 block">{fmtAgo(n.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
      {/* 하단 */}
      <div className="px-4 py-2.5 border-t border-[#f0f0f0] text-center">
        <button onClick={onClose} className="text-[11px] text-[#999] hover:text-[#555]">닫기</button>
      </div>
    </div>
  );
}

// ── 전체 인박스 페이지 (선택적 사용) ───────────────────────────────────────
export default function SuperNotifications() {
  const [, navigate] = useLocation();
  const [notifs, setNotifs] = useState<SuperNotif[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const q = unreadOnly ? "?unread=1&limit=100" : "?limit=100";
      const data = await api.get<{ notifications: SuperNotif[]; total: number }>(`/super/notifications${q}`);
      setNotifs(data?.notifications ?? []);
    } catch { setNotifs([]); } finally { setLoading(false); }
  }, [unreadOnly]);

  useEffect(() => { fetch(); }, [fetch]);

  const markRead = async (id: string) => {
    await api.post(`/super/notifications/${id}/read`, {}).catch(() => {});
    setNotifs(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n));
  };
  const markAllRead = async () => {
    await api.post("/super/notifications/read-all", {}).catch(() => {});
    setNotifs(ns => ns.map(n => ({ ...n, is_read: true })));
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[20px] font-bold text-[#002F5F]">슈퍼 어드민 알림</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-[#555] cursor-pointer">
            <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} className="rounded" />
            미읽음만
          </label>
          <button onClick={markAllRead} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-[#01B2F1] hover:opacity-80">
            전체 읽음
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-[#bbb] text-[13px]">불러오는 중...</div>
      ) : notifs.length === 0 ? (
        <div className="py-20 text-center text-[#bbb] text-[13px]">알림이 없습니다.</div>
      ) : (
        <div className="bg-white rounded-xl border border-[#e5e5e5] divide-y divide-[#f5f5f5]">
          {notifs.map(n => (
            <div key={n.id}
              className={`flex items-start gap-4 px-5 py-4 hover:bg-[#f8f9ff] transition-colors ${!n.is_read ? "bg-[#f0f7ff]" : ""}`}>
              <div className="text-[22px] leading-none mt-0.5 flex-shrink-0">{TYPE_ICON[n.type] ?? "🔔"}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[#111]">{n.title}</span>
                  {!n.is_read && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1" />}
                </div>
                {n.body && <p className="text-[12px] text-[#666] mt-0.5">{n.body}</p>}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[11px] text-[#bbb]">{fmtAgo(n.created_at)}</span>
                  {n.pool_id && (
                    <button onClick={() => navigate(`/super/pools/${n.pool_id}`)}
                      className="text-[11px] text-[#01B2F1] hover:underline">수영장 이동 →</button>
                  )}
                  {!n.is_read && (
                    <button onClick={() => markRead(n.id)} className="text-[11px] text-[#999] hover:text-[#555]">읽음 처리</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
