import { useState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { publicPost } from "@/lib/api-client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";

type LoginStep =
  | { kind: "credentials" }
  | { kind: "pin-required"; webSession: string }
  | { kind: "totp"; totpSession: string };

type LoginResponse = {
  success: boolean;
  token?: string;
  web_pin_required?: boolean;
  web_session?: string;
  totp_required?: boolean;
  totp_session?: string;
  message?: string;
};

type PinVerifyResponse = {
  success: boolean;
  token?: string;
  message?: string;
};

export default function LoginPage() {
  const { login } = useAuth();
  return <LoginForm login={login} />;
}

export function LoginForm({
  login, bootstrapOnly = false, desktop = false, beforeCredentials, footer, redirectAfterLogin = true,
}: {
  login: (token: string) => Promise<void>;
  bootstrapOnly?: boolean;
  desktop?: boolean;
  beforeCredentials?: () => Promise<void>;
  footer?: ReactNode;
  redirectAfterLogin?: boolean;
}) {
  const [, navigate] = useLocation();

  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const inFlight = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step.kind === "pin-required" && pin.length === 4) {
      handlePinVerify(pin, (step as { kind: "pin-required"; webSession: string }).webSession);
    }
  }, [pin, step]);

  async function completeLogin(token: string) {
    await login(token);
    setPassword("");
    setPin("");
    setOtpCode("");
    setStep({ kind: "credentials" });
    if (redirectAfterLogin) navigate("/admin");
  }

  async function handlePinVerify(pinValue: string, webSession: string) {
    if (bootstrapOnly || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setLoading(true);
    try {
      const res = await publicPost<PinVerifyResponse>("/auth/web-pin/verify", {
        web_session: webSession,
        web_pin: pinValue,
      });
      if (res.token) {
        await completeLogin(res.token);
      } else {
        setError(res.message ?? "PIN 인증에 실패했습니다.");
        setPin("");
      }
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 401 || e.status === 403) {
        setError("PIN 번호가 올바르지 않습니다.");
      } else if (e.status === 0 || !e.status) {
        setError("서버에 연결할 수 없습니다. 네트워크를 확인해주세요.");
      } else {
        setError(e.message ?? "PIN 인증 중 오류가 발생했습니다.");
      }
      setPin("");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (bootstrapOnly || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setLoading(true);

    try {
      if (step.kind === "credentials") {
        if (email.trim().length < 6) {
          setError("아이디는 6자 이상 입력해주세요.");
          return;
        }
        if (beforeCredentials) await beforeCredentials();
        const res = await publicPost<LoginResponse>("/auth/login", {
          email: email.trim(),
          password,
          web_login: true,
        });

        if (res.totp_required && desktop && res.totp_session) {
          setPassword("");
          setStep({ kind: "totp", totpSession: res.totp_session });
        } else if (res.totp_required) {
          setError("추가 인증 상태를 확인할 수 없습니다. 다시 로그인해주세요.");
        } else if (res.web_pin_required && res.web_session) {
          // Need PIN verification
          if (desktop) setPassword("");
          setStep({ kind: "pin-required", webSession: res.web_session });
        } else if (res.web_pin_required) {
          setError("추가 인증 상태를 확인할 수 없습니다. 다시 로그인해주세요.");
        } else if (res.token) {
          // No PIN required (shouldn't happen for pool_admin with PIN set, but handle it)
          await completeLogin(res.token);
        } else {
          setError("로그인에 실패했습니다.");
        }
      } else if (step.kind === "totp") {
        if (!/^\d{6}$/.test(otpCode)) {
          setError("인증 앱의 6자리 코드를 입력해주세요.");
          return;
        }
        const res = await publicPost<PinVerifyResponse>("/auth/totp/verify-login", {
          totp_session: step.totpSession,
          otp_code: otpCode,
        });
        setOtpCode("");
        if (res.token) await completeLogin(res.token);
        else setError("추가 인증에 실패했습니다.");
      } else {
        // PIN verification step
        if (!pin.trim()) {
          setError("PIN 번호를 입력해주세요.");
          setLoading(false);
          return;
        }
        const res = await publicPost<PinVerifyResponse>("/auth/web-pin/verify", {
          web_session: step.webSession,
          web_pin: pin,
        });
        if (res.token) {
          await completeLogin(res.token);
        } else {
          setError(res.message ?? "PIN 인증에 실패했습니다.");
        }
      }
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 401 || e.status === 403) {
        if (step.kind === "totp") {
          setOtpCode("");
          setError("OTP 코드가 올바르지 않거나 인증 세션이 만료되었습니다.");
        } else if (step.kind === "pin-required") {
          setError("PIN 번호가 올바르지 않습니다.");
        } else {
          setError("아이디 또는 비밀번호가 올바르지 않습니다.");
        }
      } else if (e.status === 0 || !e.status) {
        setError("서버에 연결할 수 없습니다. 네트워크를 확인해주세요.");
      } else {
        setError(e.message ?? "로그인 중 오류가 발생했습니다.");
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function handleBackToCredentials() {
    setStep({ kind: "credentials" });
    setPin("");
    setPassword("");
    setOtpCode("");
    setError(null);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-off)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: "var(--surface-white)",
          border: "1px solid var(--border-default)",
          borderRadius: "12px",
          padding: "40px 36px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "20px",
                fontWeight: 800,
                color: "var(--x-primary)",
                letterSpacing: "-0.5px",
              }}
            >
              SWIMNOTE
            </span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--x-highlight)",
                background: "var(--x-primary-soft)",
                borderRadius: "4px",
                padding: "1px 6px",
              }}
            >
              X
            </span>
          </div>
          <div
            style={{
              fontSize: "14px",
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            PC 관리자 로그인
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <fieldset disabled={bootstrapOnly || (desktop && loading)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {step.kind === "credentials" ? (
            <>
              <Field label="아이디">
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="아이디를 입력하세요"
                  autoComplete="username"
                  autoFocus
                  style={inputStyle}
                />
              </Field>

              <Field label="비밀번호" style={{ marginTop: "16px" }}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  required
                  style={inputStyle}
                />
              </Field>

            </>
          ) : step.kind === "totp" ? (
            <Field label="추가 인증">
              <input
                type="text"
                value={otpCode}
                onChange={event => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="인증 앱의 6자리 코드"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                style={inputStyle}
              />
            </Field>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: "24px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
                  SWIMNOTE 앱에서 설정한 웹 접속 PIN 번호를 입력하세요.
                </div>
                {/* PIN dots display */}
                <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginBottom: "24px" }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        background: pin.length > i ? "var(--x-primary)" : "var(--border-default)",
                        transition: "background 0.15s",
                      }}
                    />
                  ))}
                </div>
                {/* Numeric keypad */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", maxWidth: "240px", margin: "0 auto" }}>
                  {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key) => (
                    <button
                      key={key}
                      type="button"
                      disabled={key === ""}
                      onClick={() => {
                        if (key === "⌫") {
                          setPin((p) => p.slice(0, -1));
                        } else if (key !== "" && pin.length < 4) {
                          setPin((p) => p + key);
                        }
                      }}
                      style={{
                        height: "52px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-default)",
                        background: key === "" ? "transparent" : "var(--surface-white)",
                        fontSize: key === "⌫" ? "18px" : "18px",
                        fontWeight: 600,
                        color: key === "⌫" ? "var(--text-muted)" : "var(--text-body)",
                        cursor: key === "" ? "default" : "pointer",
                        borderColor: key === "" ? "transparent" : undefined,
                        visibility: key === "" ? "hidden" : "visible",
                      }}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && (
            <div
              style={{
                marginTop: "16px",
                padding: "10px 12px",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "6px",
                fontSize: "13px",
                color: "#DC2626",
              }}
            >
              {error}
            </div>
          )}

          {footer}
          <Button
            type="submit"
            loading={loading}
            style={{ width: "100%", marginTop: "24px", height: "44px", fontSize: "15px" }}
          >
            {step.kind === "credentials" ? "로그인" : step.kind === "totp" ? "추가 인증 확인" : "PIN 확인"}
          </Button>

          {step.kind !== "credentials" && (
            <button
              type="button"
              onClick={handleBackToCredentials}
              style={{
                display: "block",
                width: "100%",
                marginTop: "12px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "13px",
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              ← 처음으로 돌아가기
            </button>
          )}
          </fieldset>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <label
        style={{
          display: "block",
          fontSize: "13px",
          fontWeight: 500,
          color: "var(--text-body)",
          marginBottom: "6px",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "40px",
  padding: "0 12px",
  fontSize: "14px",
  color: "var(--text-body)",
  background: "var(--surface-white)",
  border: "1px solid var(--border-default)",
  borderRadius: "6px",
  outline: "none",
  transition: "border-color 0.15s",
};
