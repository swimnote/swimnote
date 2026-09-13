import { HTMLAttributes } from "react";

type SurfaceVariant = "default" | "subtle" | "dark" | "faq" | "visual";

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  padding?: React.CSSProperties["padding"];
}

const variantClass: Record<SurfaceVariant, string> = {
  default: "ds-surface",
  subtle:  "ds-surface-subtle",
  dark:    "ds-surface-dark",
  faq:     "ds-surface-faq",
  visual:  "ds-visual-container",
};

/** Shared surface / card container. */
export function Surface({
  variant = "default",
  padding,
  className = "",
  style,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <div
      className={`${variantClass[variant]} ${className}`}
      style={{ padding, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
