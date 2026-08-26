import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, label, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={id}
            className="block text-xs font-semibold uppercase tracking-wide text-stone-500"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "block w-full rounded-xl border bg-stone-50 px-3 py-2.5 text-sm text-sky-950 shadow-inner",
            "placeholder:text-stone-400 font-medium",
            "transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:ring-offset-0 focus:border-sky-500",
            error
              ? "border-red-400 focus:ring-red-400/40"
              : "border-stone-200 hover:border-stone-300",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
