import { useEffect, useState } from "react";
import { Search, Baby, Smartphone } from "lucide-react";
import { api } from "@/lib/api";

interface Parent {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  children?: Array<{ id: string; name: string; class_name?: string }>;
  students?: Array<{ id: string; name: string }>;
  app_connected?: boolean;
  linked?: boolean;
}

export default function Parents() {
  const [parents, setParents] = useState<Parent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<any>("/admin/parents").then(d => {
      setParents(Array.isArray(d) ? d : d?.parents || []);
    }).catch(() => setParents([])).finally(() => setLoading(false));
  }, []);

  const filtered = parents.filter(p => !search || p.name?.includes(search) || p.email?.includes(search));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">학부모 목록</h1>
          <p className="text-[13px] text-[#999] mt-1">앱에 연결된 학부모 {parents.filter(p => p.app_connected || p.linked).length}명 / 전체 {parents.length}명</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름, 이메일 검색"
            className="pl-9 pr-4 py-2 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <Baby size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">{search ? "검색 결과가 없습니다." : "연결된 학부모가 없습니다."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center">
                  <span className="text-[13px] font-bold text-[#666]">{p.name?.[0] || "P"}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[14px] text-[#0A0A0A]">{p.name}</span>
                    {(p.app_connected || p.linked)
                      ? <span className="flex items-center gap-1 text-[10px] font-semibold text-[#059669] bg-[#DCFCE7] px-1.5 py-0.5 rounded-full"><Smartphone size={9} /> 앱연결</span>
                      : <span className="text-[10px] font-medium text-[#BBB] bg-[#F5F5F5] px-1.5 py-0.5 rounded-full">미연결</span>}
                  </div>
                  {p.email && <p className="text-[11px] text-[#999]">{p.email}</p>}
                </div>
              </div>
              {(() => {
                const kids = p.children?.length ? p.children : (p.students || []);
                return kids.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {kids.map((c: any) => (
                      <span key={c.id} className="text-[11px] bg-[#EFF6FF] text-[#0369A1] px-2 py-0.5 rounded-full font-medium">
                        {c.name}{c.class_name ? ` (${c.class_name})` : ""}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
