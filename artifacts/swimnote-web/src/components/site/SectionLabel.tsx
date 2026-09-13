import { HTMLAttributes } from "react";

interface SectionLabelProps extends HTMLAttributes<HTMLParagraphElement> {
  /** "light" = default gray, "dark" = on dark bg, "accent-sn" = SWIMNOTE blue, "accent-x" = X blue */
  tone?: "light" | "dark" | "accent-sn" | "accent-x";
}

const toneStyle: Record<NonNullable<SectionLabelProps["tone"]>, React.CSSProperties> = {
  light:       { color: "var(--ds-text-secondary)" },
  dark:        { color: "var(--ds-text-muted-dark)" },
  "accent-sn": { color: "var(--ds-sn-blue)" },
  "accent-x":  { color: "var(--ds-x-blue)" },
};

/** 11px uppercase tracking label — placed above section headings. */
export function SectionLabel({
  tone = "light",
  className = "",
  style,
  children,
  ...rest
}: SectionLabelProps) {
  return (
    <p
      className={`ds-section-label ${className}`}
      style={{ ...toneStyle[tone], ...style }}
      {...rest}
    >
      {children}
    </p>
  );
}
