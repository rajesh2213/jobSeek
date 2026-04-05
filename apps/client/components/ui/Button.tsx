import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { AccentTone } from "./types";

export type { AccentTone };
export type ButtonVariant = "primary" | "outline" | "ghost";
export type ButtonSize = "sm" | "md";

const toneOutline: Record<AccentTone, string> = {
  teal: "hover:border-teal hover:text-teal",
  rose: "hover:border-rose hover:text-rose",
  amber: "hover:border-amber hover:text-amber",
  brand: "hover:border-brand hover:text-brand",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-5 py-2 text-xs",
  md: "px-6 py-2.5 text-sm",
};

const variantBase: Record<ButtonVariant, string> = {
  primary:
    "rounded-full bg-brand font-bold tracking-wide text-white shadow-sm transition-all duration-300 hover:bg-brand-hover hover:scale-[1.02] active:scale-95",
  outline:
    "rounded-full border-2 border-ink/12 bg-transparent font-bold tracking-wide text-ink/60 transition-all duration-300 active:scale-95",
  ghost:
    "rounded-full font-semibold text-ink/70 transition-colors duration-150 hover:bg-ink/5 hover:text-ink",
};

export const buttonFocusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/** Compose Button look on `Link` or other elements. */
export function buttonClassName(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  outlineTone?: AccentTone;
  className?: string;
}): string {
  const { variant = "primary", size = "sm", outlineTone = "teal", className } = options;
  return cn(
    "inline-flex items-center justify-center no-underline disabled:pointer-events-none disabled:opacity-50",
    buttonFocusRing,
    variantBase[variant],
    variant === "outline" && toneOutline[outlineTone],
    sizeClass[size],
    className,
  );
}

type ButtonBase = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  outlineTone?: AccentTone;
  children: ReactNode;
  className?: string;
};

export type ButtonProps = ButtonBase &
  (
    | (ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined })
    | (AnchorHTMLAttributes<HTMLAnchorElement> & { href: string })
  );

export function Button({
  variant = "primary",
  size = "sm",
  outlineTone = "teal",
  className,
  type = "button",
  children,
  href,
  ...rest
}: ButtonProps) {
  const cls = buttonClassName({ variant, size, outlineTone, className });

  if (href) {
    const { target, rel, ...aRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a href={href} className={cls} target={target} rel={rel} {...aRest}>
        {children}
      </a>
    );
  }

  const btnType =
    (type === "submit" || type === "reset" || type === "button" ? type : "button") satisfies
      | "button"
      | "submit"
      | "reset";

  return (
    <button type={btnType} className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
