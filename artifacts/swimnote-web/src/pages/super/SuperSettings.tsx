/**
 * SuperSettings — 시스템 설정
 * 기존 SuperAdmin.tsx 「관리자 계정 생성」탭 이동 (MOVED).
 * 향후: maintenance / feature flags / global config 수용 구조.
 */
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Pool {
  id: string;
  name: string;
  approval_status: string;
}

const PRIMARY = "#002F5F";

type SettingsTab = "create-admin" | "plans" | "policies" | "readonly";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "create-admin", label: "관리자 계정 생성" },
  { id: "plans",        label: "구독 플랜" },
  { id: "policies",     label: "앱 정책" },
  { id: "readonly",     label: "읽기전용 제어" },
];

function CreateAdminTab() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [newAdmin, setNewAdmin] = useState({ email: "", password: "", name: "", phone: "", swimming_pool_id: "" });
  const [createMsg, setCreateMsg] = useState("");

  useEffect(() => {
    api.get<Pool[]>("/admin/pools?approval_status=approved")
      .then((data) => setPools(data))
      .catch(() => setPools([]));
  }, []);

  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg("");
    try {
      await api.post("/admin/users", { ...newAdmin, role: "pool_admin" });
      setCreateMsg("관리자 계정이 생성되었습니다.");
      setNewAdmin({ email: "", password: "", name: "", phone: "", swimming_pool_id: "" });
    } catch (err: any) {
      setCreateMsg(err?.data?.error || "생성 실패");
    }
  };

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-lg border border-[#e5e5e5] p-6">
        <h2 className="text-[16px] font-bold text-[#0a0a0a] mb-5">수영장 관리자 계정 생성</h2>
        <form onSubmit={createAdmin} className="space-y-4">
          {[
            { key: "name", label: "이름", placeholder: "홍길동", type: "text" },
            { key: "email", label: "이메일", placeholder: "admin@pool.com", type: "email" },
            { key: "password", label: "비밀번호", placeholder: "초기 비밀번호", type: "password" },
            { key: "phone", label: "전화번호", placeholder: "010-0000-0000", type: "text" },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] font-semibold text-[#555] mb-1.5">{f.label}</label>
              <input
                type={f.type}
                value={(newAdmin as any)[f.key]}
                onChange={(e) => setNewAdmin((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                required={f.key !== "phone"}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] transition-colors"
              />
            </div>
          ))}
          <div>
            <label className="block text-[11px] font-semibold text-[#555] mb-1.5">수영장</label>
            <select
              value={newAdmin.swimming_pool_id}
              onChange={(e) => setNewAdmin((prev) => ({ ...prev, swimming_pool_id: e.target.value }))}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] focus:outline-none focus:border-[#01B2F1] transition-colors"
            >
              <option value="">수영장 선택</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {createMsg && (
            <div className={`px-4 py-3 rounded-xl text-[12px] ${createMsg.includes("생성") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {createMsg}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85"
            style={{ background: PRIMARY }}
          >
            계정 생성
          </button>
        </form>
      </div>
    </div>
  );
}

function ComingSoonTab({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-8 text-center max-w-lg">
      <p className="text-[14px] font-semibold text-[#555]">{title}</p>
      <p className="text-[12px] text-[#aaa] mt-1">{desc}</p>
      <span className="inline-block mt-3 text-[11px] text-[#bbb] bg-[#f5f5f5] px-3 py-1 rounded-full">향후 구현</span>
    </div>
  );
}

export default function SuperSettings() {
  const [tab, setTab] = useState<SettingsTab>("create-admin");

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-[#111]">시스템 설정</h1>
        <p className="text-[12px] text-[#999] mt-0.5">관리자 계정 · 구독 플랜 · 정책 · 유지보수 제어</p>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-1.5 mb-6 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-[12px] font-medium transition-all ${
              tab === t.id
                ? "bg-[#002F5F] text-white"
                : "bg-white border border-[#e5e5e5] text-[#888] hover:bg-[#f5f5f5]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "create-admin" && <CreateAdminTab />}
      {tab === "plans" && (
        <ComingSoonTab
          title="구독 플랜 관리"
          desc="Free / Coach / Premier 플랜 설정 · 회원 한도 · 스토리지"
        />
      )}
      {tab === "policies" && (
        <ComingSoonTab
          title="앱 정책"
          desc="이용약관 · 개인정보처리방침 버전 관리"
        />
      )}
      {tab === "readonly" && (
        <ComingSoonTab
          title="읽기전용 제어"
          desc="운영 DB 읽기전용 모드 켜기/끄기 · 유지보수 모드"
        />
      )}
    </div>
  );
}
