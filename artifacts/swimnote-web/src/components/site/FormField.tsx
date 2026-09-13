import { forwardRef, useState, InputHTMLAttributes } from "react";

/* ── Input ───────────────────────────────────────────────── */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, className = "", ...rest }, ref) => (
    <input
      ref={ref}
      className={[
        "ds-input",
        error ? "ds-input-error" : "",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    />
  )
);
Input.displayName = "Input";

/* ── PasswordInput ───────────────────────────────────────── */
interface PasswordInputProps extends Omit<InputProps, "type"> {}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ error, className = "", style, ...rest }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div style={{ position: "relative", ...style }}>
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          error={error}
          className={className}
          style={{ paddingRight: 44 }}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--ds-n-400)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

/* ── PinInput ───────────────────────────────────────────── */
export const PinInput = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(
  ({ error, className = "", ...rest }, ref) => (
    <Input
      ref={ref}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      error={error}
      className={["ds-pin-input", className].filter(Boolean).join(" ")}
      {...rest}
    />
  )
);
PinInput.displayName = "PinInput";

/* ── FieldLabel ─────────────────────────────────────────── */
export function FieldLabel({ children, htmlFor, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className="ds-label" htmlFor={htmlFor} {...rest}>
      {children}
    </label>
  );
}

/* ── ErrorText ──────────────────────────────────────────── */
export function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="ds-error-text">{children}</p>;
}

/* ── FormField (label + input + error) ─────────────────── */
interface FormFieldProps {
  label?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

export function FormField({ label, error, htmlFor, children }: FormFieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {label && <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>}
      {children}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
