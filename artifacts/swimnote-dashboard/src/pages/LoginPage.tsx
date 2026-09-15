import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { publicPost } from "@/lib/api-client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";

type LoginStep =
  | { kind: "credentials" }
  | { kind: "pin-required"; webSession: string };

type LoginResponse = {
  success: boolean;
  token?: string;
  web_pin_required?: boolean;
  web_session?: string;
  message?: string;
};

type PinVerifyResponse = {
  success: boolean;
  token?: string;
  message?: string;
};

export default function LoginPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (step.kind === "credentials") {
        if (email.trim().length < 6) {
          setError("아이디는 6자 이상 입력해주세요.");
          setLoading(false);
          return;
        }
        const res = await publicPost<LoginResponse>("/auth/login", {
          email: email.trim(),
          password,
          web_login: true,
        });

        if (res.web_pin_required && res.web_session) {
          // Need PIN verification
          setStep({ kind: "pin-required", webSession: res.web_session });
        } else if (res.token) {
          // No PIN required (shouldn't happen for pool_admin with PIN set, but handle it)
          await login(res.token);
          navigate("/admin");
        } else {
          setError("로그인에 실패했습니다.");
        }
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
          await login(res.token);
          navigate("/admin");
        } else {
          setError(res.message ?? "PIN 인증에 실패했습니다.");
        }
      }
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 401 || e.status === 403) {
        if (step.kind === "pin-required") {
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
      setLoading(false);
    }
  }

  function handleBackToCredentials() {
    setStep({ kind: "credentials" });
    setPin("");
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
          ) : (
            <>
              <div
                style={{
                  background: "var(--surface-subtle)",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  marginBottom: "20px",
                  fontSize: "13px",
                  color: "var(--text-muted)",
                }}
              >
                <strong style={{ color: "var(--text-body)" }}>PIN 번호를 입력해주세요.</strong>
                <br />
                SWIMNOTE 앱에서 설정한 웹 접속 PIN 번호를 입력합니다.
              </div>

              <Field label="PIN 번호">
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="PIN 번호 입력"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  autoFocus
                  required
                  style={inputStyle}
                />
              </Field>
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

          <Button
            type="submit"
            loading={loading}
            style={{ width: "100%", marginTop: "24px", height: "44px", fontSize: "15px" }}
          >
            {step.kind === "credentials" ? "로그인" : "PIN 확인"}
          </Button>

          {step.kind === "pin-required" && (
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
