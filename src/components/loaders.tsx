import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function Loader({
  label,
  className,
  fullScreen,
  compact,
}: {
  label?: string;
  className?: string;
  fullScreen?: boolean;
  /** Shorter height for lists / panel interiors */
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground",
        fullScreen ? "min-h-svh" : compact ? "h-36" : "h-48",
        className
      )}
    >
      <span className="relative flex size-12 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-primary/10" />
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:1.6s]" />
        <span className="relative flex size-12 items-center justify-center rounded-full border border-primary/25 bg-gradient-to-b from-primary/15 to-primary/5 text-primary shadow-[0_0_24px_-6px_var(--primary)]">
          <Loader2 className="size-5 animate-spin [animation-duration:0.85s]" />
        </span>
      </span>
      {label ? <span className="font-medium tracking-tight">{label}</span> : null}
    </div>
  );
}
