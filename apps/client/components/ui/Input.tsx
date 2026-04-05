import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const inputBaseClass =
  "w-full rounded-2xl border-0 bg-surface px-3.5 py-2.5 text-sm text-ink shadow-sm ring-1 ring-ink/5 transition-shadow placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/30";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputBaseClass, className)} {...props} />;
});
