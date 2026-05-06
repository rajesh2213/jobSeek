import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** `content` === max-w-4xl (56rem); `jobs` === main listing width (80rem). */
  width?: "content" | "readable" | "wide" | "jobs";
}

export function Container({
  children,
  className,
  width = "content",
  ...rest
}: ContainerProps) {
  const max =
    width === "content"
      ? "max-w-content"
      : width === "readable"
        ? "max-w-readable"
        : width === "jobs"
          ? "max-w-jobs"
          : "max-w-[1400px]";
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6", max, className)} {...rest}>
      {children}
    </div>
  );
}
