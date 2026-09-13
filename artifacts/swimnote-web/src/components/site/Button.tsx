import { forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "secondary-dark" | "dashboard" | "text" | "text-accent";
type ButtonSize    = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  as?: "button" | "a" | "span";
  href?: string;
}

const variantClass: Record<ButtonVariant, string> = {
  "primary":        "ds-btn ds-btn-primary",
  "secondary":      "ds-btn ds-btn-secondary",
  "secondary-dark": "ds-btn ds-btn-secondary-dark",
  "dashboard":      "ds-btn ds-btn-dashboard",
  "text":           "ds-text-link",
  "text-accent":    "ds-text-link ds-text-link-accent",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "ds-btn-sm",
  md: "",
  lg: "ds-btn-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", as: Tag = "button", className = "", children, ...rest }, ref) => {
    const isText = variant === "text" || variant === "text-accent";
    const cls = [
      variantClass[variant],
      !isText ? sizeClass[size] : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    // @ts-expect-error polymorphic element
    return <Tag ref={ref} className={cls} {...rest}>{children}</Tag>;
  }
);
Button.displayName = "Button";
