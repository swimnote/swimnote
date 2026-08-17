/**
 * SuperSupport — 고객센터
 * 기존 SuperAdmin.tsx 「지원센터」탭 로직을 그대로 이동 (MOVED, not duplicated).
 * 기존 탭명 "지원센터" → 새 메뉴명 "고객센터"로 rename.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

interface Ticket {
  id: string;
  ticket_type: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  requester_name: string;
  requester_type: string;
  consultation_requested: boolean;
  created_at: string;
  updated_at: string;
}
interface TicketDetail extends Ticket {
  content: string;
  pool_id?: string | null;
  replies?: TicketReply[];
}
interface TicketReply {
  id: string;
  content: string;
  author_name: string;
  author_role: string;
  created_at: string;
}

const PRIMARY = "#002F5F";

const statusMap: Record<string, { label: string; cls: string }> = {
  open:        { label: "미처리", cls: "bg-red-50 text-red-600 border-red-200" },
  in_progress: { label: "처리중", cls: "bg-blue-50 text-blue-600 border-blue-200" },
  resolved:    { label: "해결됨", cls: "bg-green-50 text-green-700 border-green-200" },
  closed:      { label: "종료",   cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

export default function SuperSupport() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketFilter, setTicketFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");
  const [ticketLoading, setTicketLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const fetchTickets = useCallback(async () => {
    setTicketLoading(true);
    try {
      const status = ticketFilter === "all" ? "" : ticketFilter;
      const data = await api.get<Ticket[]>(`/super/support-general${status ? `?status=${status}` : ""}`);
      setTickets(data);
    } catch {
      setTickets([]);
    } finally {
      setTicketLoading(false);
    }
  }, [ticketFilter]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const fetchTicketDetail = async (id: string) => {
    try {
      const data = await api.get<TicketDetail>(`/support/tickets/${id}`);
      setSelectedTicket(data);
      setReplyContent("");
    } catch { /* ignore */ }
  };

  const sendReply = async () => {
    if (!selectedTicket || !replyContent.trim()) return;
    setReplyLoading(true);
    try {
      await api.post(`/support/tickets/${selectedTicket.id}/replies`, { content: replyContent });
      setReplyContent("");
      fetchTicketDetail(selectedTicket.id);
    } catch { /* ignore */ } finally {
      setReplyLoading(false);
    }
  };

  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">고객센터</h1>
          <p className="text-[12px] text-[#999] mt-0.5">
            수영장 및 사용자 문의 · 답변 관리
            {openCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                미처리 {openCount}건
              </span>
            )}
          </p>
        </div>
        <button onClick={fetchTickets} className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg">
          새로고침
        </button>
      </div>

      <div className="flex gap-6 h-[calc(100vh-180px)]">
        {/* Ticket list */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Filter */}
          <div className="flex gap-1.5 mb-3">
            {([
              { id: "all", label: "전체" },
              { id: "open", label: "미처리" },
              { id: "in_progress", label: "처리중" },
              { id: "resolved", label: "해결됨" },
            ] as const).map((f) => (
              <button
                key={f.id}
                onClick={() => setTicketFilter(f.id as any)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                  ticketFilter === f.id
                    ? "bg-[#002F5F] text-white"
                    : "bg-white border border-[#e5e5e5] text-[#888] hover:bg-[#f5f5f5]"
                }`}
              >
                {f.label}
                {f.id !== "all" && (
                  <span className="ml-1 text-[10px]">({tickets.filter((t) => t.status === f.id).length})</span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {ticketLoading ? (
              <div className="py-16 text-center text-[#aaa] text-[13px]">불러오는 중...</div>
            ) : tickets.length === 0 ? (
              <div className="py-16 text-center text-[#aaa] text-[13px]">문의 내역이 없습니다.</div>
            ) : (
              tickets.map((ticket) => {
                const s = statusMap[ticket.status] ?? statusMap.closed;
                const isSelected = selectedTicket?.id === ticket.id;
                return (
                  <div
                    key={ticket.id}
                    onClick={() => fetchTicketDetail(ticket.id)}
                    className={`bg-white rounded-lg border p-4 cursor-pointer transition-all ${
                      isSelected ? "border-[#002F5F] shadow-sm" : "border-[#e5e5e5] hover:border-[#ddd]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s.cls}`}>
                            {s.label}
                          </span>
                          {ticket.consultation_requested && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-600 border border-purple-200">
                              상담 요청
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] font-semibold text-[#0a0a0a] truncate">{ticket.subject}</p>
                        <p className="text-[11px] text-[#aaa] mt-0.5">
                          {ticket.requester_name} · {ticket.created_at?.slice(0, 10)}
                        </p>
                      </div>
                      <span className="text-[#ccc] text-[12px] shrink-0">›</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Ticket detail */}
        {selectedTicket && (
          <div className="w-[420px] shrink-0 bg-white rounded-lg border border-[#e5e5e5] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[#f0f0f0]">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-[14px] font-bold text-[#0a0a0a]">{selectedTicket.subject}</p>
                <button onClick={() => setSelectedTicket(null)} className="text-[#bbb] hover:text-[#888] text-[18px] leading-none shrink-0">×</button>
              </div>
              <p className="text-[11px] text-[#aaa]">
                {selectedTicket.requester_name} · {selectedTicket.requester_type} · {selectedTicket.created_at?.slice(0, 10)}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="bg-[#f8f9fb] rounded-xl p-4">
                <p className="text-[11px] font-semibold text-[#888] mb-2">문의 내용</p>
                <p className="text-[13px] text-[#333] whitespace-pre-wrap">{selectedTicket.content}</p>
              </div>
              {(selectedTicket.replies || []).map((reply) => (
                <div
                  key={reply.id}
                  className={`rounded-xl p-4 ${reply.author_role === "super_admin" ? "bg-blue-50 ml-6" : "bg-[#f8f9fb] mr-6"}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-semibold text-[#888]">
                      {reply.author_name} {reply.author_role === "super_admin" ? "(관리자)" : ""}
                    </p>
                    <p className="text-[10px] text-[#bbb]">{reply.created_at?.slice(0, 10)}</p>
                  </div>
                  <p className="text-[13px] text-[#333] whitespace-pre-wrap">{reply.content}</p>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[#f0f0f0]">
              <textarea
                ref={replyRef}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="답변을 입력하세요..."
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#002F5F] resize-none transition-colors mb-2"
              />
              <button
                onClick={sendReply}
                disabled={replyLoading || !replyContent.trim()}
                className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-40"
                style={{ background: PRIMARY }}
              >
                {replyLoading ? "전송 중..." : "답변 전송"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Future modules placeholder */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {["AI 처리", "사람 확인 필요", "긴급", "Knowledge"].map((label) => (
          <div key={label} className="bg-white border border-[#e5e5e5] rounded-lg px-4 py-3 opacity-50">
            <p className="text-[12px] font-medium text-[#888]">{label}</p>
            <p className="text-[10px] text-[#bbb] mt-0.5">향후 구현</p>
          </div>
        ))}
      </div>
    </div>
  );
}
