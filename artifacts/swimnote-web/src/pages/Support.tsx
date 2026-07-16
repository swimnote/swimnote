import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Phone, Lock, ChevronDown, ChevronRight } from "lucide-react";

const inView = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

type Post = { id: number; title: string; password: string; content: string; date: string; answer?: string };

function Board() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", password: "", content: "" });
  const [formError, setFormError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [pwInput, setPwInput] = useState<{ [id: number]: string }>({});
  const [pwError, setPwError] = useState<{ [id: number]: string }>({});
  const [unlocked, setUnlocked] = useState<number[]>([]);

  const submit = () => {
    if (!form.title.trim() || !form.content.trim()) { setFormError("제목과 내용을 입력해주세요."); return; }
    if (!/^\d{4}$/.test(form.password)) { setFormError("비밀번호는 숫자 4자리입니다."); return; }
    setPosts(p => [{ id: Date.now(), title: form.title, password: form.password, content: form.content, date: new Date().toLocaleDateString("ko-KR") }, ...p]);
    setForm({ title: "", password: "", content: "" });
    setShowForm(false);
    setFormError("");
  };

  const tryUnlock = (post: Post) => {
    const pw = pwInput[post.id] || "";
    if (pw === post.password) { setUnlocked(u => [...u, post.id]); setPwError(e => ({ ...e, [post.id]: "" })); }
    else setPwError(e => ({ ...e, [post.id]: "비밀번호가 일치하지 않습니다." }));
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h3 className="text-[18px] font-bold text-[#0a0a0a] mb-1">1:1 문의게시판</h3>
          <p className="text-[13px] text-[#aaa]">4자리 비밀번호를 설정하면 작성자만 조회할 수 있습니다.</p>
        </div>
        <button onClick={() => { setShowForm(v => !v); setFormError(""); }} data-testid="btn-write"
          className="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold hover:opacity-85 transition-opacity shrink-0"
          style={{ background: PRIMARY }}>
          {showForm ? "취소" : "문의 작성"}
        </button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="mb-8 p-8 border border-[#ebebeb] rounded-2xl bg-[#fafafa] space-y-5">
          <div>
            <label className="block text-[12px] font-medium text-[#999] mb-2">제목</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="문의 제목"
              data-testid="input-title" className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] bg-white text-[14px] outline-none transition-colors focus:border-[#002F5F]" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#999] mb-2"><Lock className="inline w-3 h-3 mr-1" strokeWidth={1.5} />비밀번호 (숫자 4자리)</label>
            <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="0000"
              maxLength={4} type="password" data-testid="input-password"
              className="px-4 py-3 rounded-xl border border-[#e5e5e5] bg-white text-[14px] outline-none transition-colors focus:border-[#002F5F] max-w-[180px]" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#999] mb-2">내용</label>
            <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="문의 내용을 작성해주세요"
              rows={5} data-testid="input-content"
              className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] bg-white text-[14px] outline-none transition-colors focus:border-[#002F5F] resize-none" />
          </div>
          {formError && <p className="text-[13px] text-red-500">{formError}</p>}
          <button onClick={submit} data-testid="btn-submit-post"
            className="px-7 py-3 rounded-full text-white text-[13px] font-semibold hover:opacity-85 transition-opacity"
            style={{ background: PRIMARY }}>
            접수하기
          </button>
        </motion.div>
      )}

      {posts.length === 0
        ? <div className="py-20 text-center border border-dashed border-[#e5e5e5] rounded-2xl">
            <p className="text-[14px] text-[#ccc]">접수된 문의가 없습니다.</p>
          </div>
        : <div className="divide-y divide-[#f0f0f0] border-t border-[#f0f0f0]">
            {posts.map(post => {
              const isUnlocked = unlocked.includes(post.id);
              const isOpen = openId === post.id;
              return (
                <div key={post.id} className="py-5">
                  <button className="w-full flex items-center justify-between gap-4 text-left"
                    onClick={() => setOpenId(isOpen ? null : post.id)} data-testid={`post-${post.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Lock className="w-3.5 h-3.5 text-[#ccc] shrink-0" strokeWidth={1.5} />
                      <span className="text-[14.5px] font-medium text-[#0a0a0a] truncate">{post.title}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[12px] text-[#ccc]">{post.date}</span>
                      <ChevronDown className={`w-4 h-4 text-[#ccc] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {isOpen && !isUnlocked && (
                    <div className="mt-4 flex flex-wrap gap-2 items-center">
                      <input type="password" maxLength={4} value={pwInput[post.id] || ""}
                        onChange={e => { setPwInput(p => ({ ...p, [post.id]: e.target.value })); setPwError(er => ({ ...er, [post.id]: "" })); }}
                        placeholder="비밀번호 4자리"
                        className="px-3 py-2.5 rounded-lg border border-[#e5e5e5] text-[13px] outline-none focus:border-[#002F5F] w-36" />
                      <button onClick={() => tryUnlock(post)}
                        className="px-4 py-2.5 rounded-lg text-white text-[12px] font-semibold hover:opacity-85 transition-opacity"
                        style={{ background: PRIMARY }}>확인</button>
                      {pwError[post.id] && <span className="text-[12px] text-red-400">{pwError[post.id]}</span>}
                    </div>
                  )}
                  {isOpen && isUnlocked && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                      className="mt-4 p-6 bg-[#fafafa] rounded-xl">
                      <p className="text-[14px] text-[#555] leading-relaxed whitespace-pre-wrap">{post.content}</p>
                      {post.answer
                        ? <div className="mt-5 pt-5 border-t border-[#ebebeb]"><p className="text-[11px] font-medium text-[#ccc] mb-2">운영자 답변</p><p className="text-[14px] text-[#555] leading-relaxed">{post.answer}</p></div>
                        : <p className="mt-4 text-[12px] text-[#ccc]">답변 대기 중입니다.</p>
                      }
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

const adoptionItems = ["교육과정", "교재", "APP", "피드백 시스템", "성장기록", "운영 시스템", "공인 민간자격증"];

export default function Support() {
  const [tab, setTab] = useState<"app" | "system">("system");

  return (
    <div className="pt-16">
      {/* Header */}
      <section className="py-24 md:py-32 px-6 border-b border-[#f0f0f0]">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6" style={{ width: 80, height: 50, overflow: "hidden", borderRadius: 16 }}>
            <img src="/logo.png" alt="SWIMNOTE 아이콘" style={{ width: 80, height: "auto", display: "block" }} />
          </div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
            className="text-[12px] font-semibold tracking-[0.2em] uppercase mb-6" style={{ color: SECONDARY }}>
            고객지원
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="text-[40px] md:text-[56px] font-bold tracking-tight text-[#0a0a0a] leading-[1.15] mb-8">
            고객지원
          </motion.h1>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.2 }} className="flex gap-2">
            <button onClick={() => setTab("system")} data-testid="tab-system"
              className="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-all"
              style={tab === "system" ? { background: PRIMARY, color: "#fff" } : { color: "#888", background: "transparent" }}>
              도입·제휴 문의
            </button>
            <button onClick={() => setTab("app")} data-testid="tab-app"
              className="px-5 py-2.5 rounded-full text-[13px] font-semibold transition-all"
              style={tab === "app" ? { background: PRIMARY, color: "#fff" } : { color: "#888", background: "transparent" }}>
              APP 사용 1:1 문의
            </button>
          </motion.div>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">

          {tab === "app" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
              <Board />
            </motion.div>
          )}

          {tab === "system" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }} className="space-y-12">

              {/* 제휴문의 안내 */}
              <div>
                <h3 className="text-[20px] font-bold text-[#0a0a0a] mb-3">도입·제휴 문의 안내</h3>
                <p className="text-[15px] text-[#666] leading-[1.85] font-light mb-6 max-w-2xl">
                  SWIMNOTE 교육 시스템을 도입하고 싶은 수영장을 위한 문의입니다.<br />
                  기존 수영장의 운영 철학을 반영하여 맞춤 제작이 가능합니다.
                </p>

                {/* 도입 대상 */}
                <div className="mb-4 rounded-2xl border border-[#ebebeb] bg-[#fafafa] p-6 space-y-3 max-w-2xl">
                  {[
                    "기존 운영 중인 수영장에서 체계적인 시스템 도입이나 변화가 필요한 수영장",
                    "교육 품질을 높이고 회원 서비스를 늘리고 싶은 수영장",
                    "신규 수영장에서 초기 수업 세팅을 체계적으로 구축하고 싶은 수영장",
                  ].map((text, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold text-white" style={{ background: SECONDARY }}>{i + 1}</span>
                      <p className="text-[14px] text-[#444] leading-[1.75] font-light">{text}</p>
                    </div>
                  ))}
                </div>
                <div className="mb-3 flex items-center gap-2 max-w-2xl">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECONDARY }} />
                  <p className="text-[14px] font-semibold" style={{ color: PRIMARY }}>모든 수영장 조건에 맞춰 수업 시스템 도입이 가능합니다.</p>
                </div>
                <div className="mb-8 flex items-center gap-2 max-w-2xl">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECONDARY }} />
                  <p className="text-[14px] font-semibold" style={{ color: PRIMARY }}>수업 교재 저자는 해당 수영장 대표님의 이름으로 출간됩니다.</p>
                </div>

                {/* Before / After */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                  <div className="p-8 border border-[#ebebeb] rounded-2xl bg-[#fafafa]">
                    <p className="text-[12px] font-semibold text-[#ccc] tracking-widest uppercase mb-4">기존 운영 방식</p>
                    <div className="space-y-2.5">
                      {["전화", "카카오톡", "종이출석", "개인 기억", "선생님마다 다른 수업"].map((v, i) => (
                        <div key={i} className="flex items-center gap-2 text-[14px] text-[#bbb]">
                          <span className="w-4 h-px bg-[#ddd] shrink-0" />
                          {v}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-8 border rounded-2xl" style={{ borderColor: SECONDARY, background: "#f0fbff" }}>
                    <p className="text-[12px] font-semibold tracking-widest uppercase mb-4" style={{ color: SECONDARY }}>SWIMNOTE 도입 후</p>
                    <div className="space-y-2.5">
                      {adoptionItems.map((v, i) => (
                        <div key={i} className="flex items-center gap-2 text-[14px] text-[#0a0a0a] font-medium">
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: SECONDARY }} />
                          {v}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-[14px] text-[#888] font-light leading-relaxed mb-3">
                  선생님이 바뀌더라도 동일한 교육 시스템 안에서 같은 교육 품질을 제공합니다.<br />
                  시스템이 갖춰져야 선생님의 역량을 더욱 크게 발휘할 수 있습니다.
                </p>
              </div>

              {/* Contact */}
              <div className="space-y-4">
                <motion.div {...inView(0)} className="flex items-start gap-5 p-8 border border-[#ebebeb] rounded-2xl">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#f0fbff" }}>
                    <Mail className="w-5 h-5" strokeWidth={1.5} style={{ color: SECONDARY }} />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-[#bbb] mb-1">이메일</p>
                    <a href="mailto:swimnote.admin@gmail.com" data-testid="link-email"
                      className="text-[16px] font-semibold text-[#0a0a0a] hover:underline">swimnote.admin@gmail.com</a>
                  </div>
                </motion.div>
                <motion.div {...inView(0.1)} className="flex items-start gap-5 p-8 border border-[#ebebeb] rounded-2xl">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#f0fbff" }}>
                    <Phone className="w-5 h-5" strokeWidth={1.5} style={{ color: SECONDARY }} />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-[#bbb] mb-1">전화 / 문자</p>
                    <a href="tel:01077871507" data-testid="link-phone"
                      className="text-[16px] font-semibold text-[#0a0a0a] hover:underline">010-7787-1507</a>
                    <p className="text-[12px] text-[#ccc] mt-1">문자 가능</p>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>
      </section>
    </div>
  );
}