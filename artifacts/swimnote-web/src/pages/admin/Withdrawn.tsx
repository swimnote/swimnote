import { useEffect, useState } from "react";
import { UserX } from "lucide-react";
import { api } from "@/lib/api";

interface WithdrawnMember { id: string; name: string; withdrawn_at?: string; reason?: string; class_name?: string; }

export default function Withdrawn() {
  const [members, setMembers] = useState<WithdrawnMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<any>("/students?status=withdrawn").then(d => {
      const all = Array.isArray(d) ? d : [];
      setMembers(all.filter((s: any) => s.pool_status === "withdrawn" || s.pool_status === "deleted"));
    }).catch(() => setMembers([])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">탈퇴 회원</h1>
        <p className="text-[13px] text-[#999] mt-1">퇴원 처리된 회원 {members.length}명</p>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-white rounded-xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <UserX size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">탈퇴 회원이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#F5F5F5]">
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">이름</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">수업</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">퇴원일</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">사유</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={i > 0 ? "border-t border-[#F9F9F9]" : ""}>
                  <td className="px-5 py-3 font-semibold text-[14px] text-[#666]">{m.name}</td>
                  <td className="px-5 py-3 text-[13px] text-[#999]">{m.class_name || "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-[#999]">{m.withdrawn_at?.slice(0, 10) || "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-[#999]">{m.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
