import { HTMLAttributes } from "react";

type TitleLevel = "display-xl" | "display-lg" | "display-md" | "display-sm";

interface SectionTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: TitleLevel;
  as?: "h1" | "h2" | "h3" | "h4";
  tone?: "dark" | "light";
}

/** Semantic heading with design system typography scale. */
export function SectionTitle({
  level = "display-md",
  as: Tag = "h2",
  tone = "dark",
  className = "",
  style,
  children,
  ...rest
}: SectionTitleProps) {
  const colorStyle: React.CSSProperties =
    tone === "light"
      ? { color: "var(--ds-text-on-dark)" }
      : { color: "var(--ds-text-primary)" };

  return (
    <Tag
      className={`ds-${level} ${className}`}
      style={{ margin: 0, ...colorStyle, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
