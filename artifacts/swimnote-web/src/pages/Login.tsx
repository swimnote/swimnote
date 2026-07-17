import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { LoginResult, WebPinRequired } from "@/contexts/AuthContext";
import { Shield, Smartphone, Globe } from "lucide-react";

const PRIMARY = "#002F5F";
const PURPLE = "#7C3AED";

export default function Login() {
  const [, navigate] = useLocation();
  const { login, completeTotpLogin, completeWebPinLogin } = useAuth();

  // ?pool=:poolId 파라미터 — 수영장 전용 로그인 제한
  const poolId = new URLSearchParams(window.location.search).get("pool") ?? "";

  const [step, setStep] = useState<"credentials" | "otp" | "web_pin">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpSession, setTotpSession] = useState("");
  const [webSession, setWebSession] = useState("");
  const [webPin, setWebPin] = useState("");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const digitRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));
  const webPinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "otp") setTimeout(() => digitRefs.current[0]?.focus(), 100);
    if (step === "web_pin") setTimeout(() => webPinRef.current?.focus(), 100);
  }, [step]);

  const otpCode = digits.join("");

  const redirectByRole = (role: string, userPoolId?: string | null) => {
    // 수영장 전용 로그인 — pool_admin이고 해당 수영장 관리자여야만 허용
    if (poolId) {
      if (role !== "pool_admin" || userPoolId !== poolId) {
        setError("해당 수영장 관리자 계정으로만 로그인할 수 있습니다.");
        setLoading(false);
        return;
      }
      navigate(`/pool/${poolId}/admin`);
      return;
    }
    if (role === "super_admin") navigate("/super-admin");
    else if (role === "pool_admin" && userPoolId) navigate(`/pool/${userPoolId}/admin`);
    else navigate("/");
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password);
      if ((result as LoginResult).totp_required) {
        setTotpSession((result as LoginResult).totp_session);
        setStep("otp");
      } else if ((result as WebPinRequired).web_pin_required) {
        setWebSession((result as WebPinRequired).web_session);
        setWebPin("");
        setStep("web_pin");
      } else {
        const u = result as any;
        redirectByRole(u.role, u.swimming_pool_id);
      }
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtp = async () => {
    if (otpCode.length !== 6) { setError("6자리 코드를 입력해주세요."); return; }
    setError("");
    setLoading(true);
    try {
      const user = await completeTotpLogin(totpSession, otpCode);
      redirectByRole(user.role, user.swimming_pool_id);
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "OTP 코드가 올바르지 않거나 만료되었습니다.");
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => digitRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  const handleWebPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webPin) { setError("웹 접속 비밀번호를 입력해주세요."); return; }
    setError("");
    setLoading(true);
    try {
      const user = await completeWebPinLogin(webSession, webPin);
      redirectByRole(user.role, user.swimming_pool_id);
    } catch (err: any) {
      setError(err?.data?.error || err?.data?.message || "웹 접속 비밀번호가 올바르지 않습니다.");
      setWebPin("");
      webPinRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError("");
    if (digit && index < 5) digitRefs.current[index + 1]?.focus();
    if (digit && index === 5) {
      const full = next.join("");
      if (full.length === 6) setTimeout(handleOtp, 80);
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      digitRefs.current[5]?.focus();
      setTimeout(handleOtp, 80);
    }
    e.preventDefault();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#f8f9fb]">
      <div className="w-full max-w-sm">

        {step === "credentials" && (
          <>
            <div className="mb-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: PRIMARY }}>
                <span className="text-white text-[22px] font-black tracking-tighter" translate="no">S</span>
              </div>
              <h1 className="text-[22px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</h1>
              <p className="text-[13px] text-[#888] mt-1">관리자 로그인</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
              <form onSubmit={handleCredentials} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-[#555] mb-1.5">이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="이메일 주소 입력"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#002F5F] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#555] mb-1.5">비밀번호</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#002F5F] transition-colors"
                  />
                </div>
                {error && <p className="text-[12px] text-red-500 text-center">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl text-white font-semibold text-[14px] transition-opacity disabled:opacity-60"
                  style={{ background: PRIMARY }}
                >
                  {loading ? "로그인 중..." : "로그인"}
                </button>
              </form>
            </div>
            <p className="text-center mt-6 text-[12px] text-[#bbb]">
              <a href="/" className="hover:text-[#888] transition-colors">← 홈으로 돌아가기</a>
            </p>
          </>
        )}

        {step === "otp" && (
          <>
            <div className="mb-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: PURPLE }}>
                <Smartphone className="text-white" size={24} />
              </div>
              <h1 className="text-[20px] font-bold text-[#0a0a0a]">2단계 인증</h1>
              <p className="text-[13px] text-[#888] mt-1">인증 앱의 6자리 코드를 입력하세요</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
              <div className="flex items-center gap-2 justify-center mb-6">
                <Shield size={14} className="text-[#7C3AED]" />
                <span className="text-[12px] text-[#7C3AED] font-medium">보안 코드 입력</span>
              </div>
              <div className="flex gap-2 justify-center mb-6">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { digitRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={i === 0 ? handleDigitPaste : undefined}
                    className="w-10 h-12 text-center text-[18px] font-bold border-2 rounded-xl focus:outline-none transition-colors"
                    style={{ borderColor: d ? PURPLE : "#e5e5e5" }}
                  />
                ))}
              </div>
              {error && <p className="text-[12px] text-red-500 text-center mb-4">{error}</p>}
              <button
                onClick={handleOtp}
                disabled={loading || otpCode.length !== 6}
                className="w-full py-3.5 rounded-xl text-white font-semibold text-[14px] transition-opacity disabled:opacity-60"
                style={{ background: PURPLE }}
              >
                {loading ? "확인 중..." : "확인"}
              </button>
            </div>
            <button
              onClick={() => { setStep("credentials"); setDigits(["", "", "", "", "", ""]); setError(""); }}
              className="w-full text-center mt-4 text-[12px] text-[#bbb] hover:text-[#888] transition-colors"
            >
              ← 이전으로
            </button>
          </>
        )}

        {step === "web_pin" && (
          <>
            <div className="mb-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "#0369A1" }}>
                <Globe className="text-white" size={24} />
              </div>
              <h1 className="text-[20px] font-bold text-[#0a0a0a]">웹 접속 비밀번호</h1>
              <p className="text-[13px] text-[#888] mt-1">앱에서 설정한 웹 전용 비밀번호를 입력하세요</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#ebebeb] p-8">
              <div className="flex items-center gap-2 justify-center mb-6">
                <Shield size={14} className="text-[#0369A1]" />
                <span className="text-[12px] text-[#0369A1] font-medium">추가 보안 인증</span>
              </div>
              <form onSubmit={handleWebPin} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-[#555] mb-1.5">웹 접속 비밀번호</label>
                  <input
                    ref={webPinRef}
                    type="password"
                    value={webPin}
                    onChange={(e) => { setWebPin(e.target.value); setError(""); }}
                    placeholder="앱에서 설정한 웹 전용 비밀번호"
                    autoComplete="off"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#0369A1] transition-colors"
                  />
                </div>
                {error && <p className="text-[12px] text-red-500 text-center">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !webPin}
                  className="w-full py-3.5 rounded-xl text-white font-semibold text-[14px] transition-opacity disabled:opacity-60"
                  style={{ background: "#0369A1" }}
                >
                  {loading ? "확인 중..." : "접속하기"}
                </button>
              </form>
            </div>
            <button
              onClick={() => { setStep("credentials"); setWebPin(""); setError(""); }}
              className="w-full text-center mt-4 text-[12px] text-[#bbb] hover:text-[#888] transition-colors"
            >
              ← 이전으로
            </button>
          </>
        )}
      </div>
    </div>
  );
}
