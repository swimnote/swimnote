import { useEffect, useState } from "react";
import { BookOpen, Search, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

interface DiaryEntry {
  id: string;
  teacher_name: string;
  class_name: string;
  date: string;
  content: string;
  level?: string;
  created_at?: string;
}

export default function Diary() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<any>("/diaries/admin/all-entries?limit=300");
      const list = Array.isArray(data) ? data : data?.entries || [];
      setEntries(list);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm("이 일지를 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/diaries/${id}`);
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (e: any) {
      alert(e?.data?.message || "삭제에 실패했습니다.");
    }
  }

  const filtered = entries.filter(e =>
    !search || e.teacher_name?.includes(search) || e.class_name?.includes(search) || e.content?.includes(search)
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">선생님 일지</h1>
          <p className="text-[13px] text-[#999] mt-1">선생님들이 작성한 수업 일지를 확인하세요.</p>
        </div>
      </div>

      {/* 검색 */}
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#999]" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="선생님, 수업명, 내용 검색..."
          className="w-full pl-10 pr-4 py-2.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1] bg-white"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <BookOpen size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">{search ? "검색 결과가 없습니다." : "작성된 일지가 없습니다."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => {
            const open = expanded === e.id;
            return (
              <div key={e.id} className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[#FAFAFA] transition-colors"
                  onClick={() => setExpanded(open ? null : e.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[14px] text-[#0A0A0A]">{e.class_name}</span>
                      <span className="text-[11px] bg-[#EFF6FF] text-[#0369A1] px-2 py-0.5 rounded-full">{e.teacher_name}</span>
                      {e.level && <span className="text-[11px] bg-[#F3F4F6] text-[#666] px-2 py-0.5 rounded-full">{e.level}</span>}
                    </div>
                    <p className="text-[12px] text-[#999] mt-1">{e.date} · {open ? "" : (e.content?.slice(0, 60) + (e.content?.length > 60 ? "..." : ""))}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={ev => { ev.stopPropagation(); handleDelete(e.id); }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2]">
                      <Trash2 size={13} color="#DC2626" />
                    </button>
                    {open ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                  </div>
                </button>
                {open && (
                  <div className="px-5 pb-5 border-t border-[#F5F5F5]">
                    <p className="text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap mt-4">{e.content}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
