import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: "default" | "warn" | "good" | "danger";
  href?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const toneClass =
    tone === "warn"
      ? "text-warning"
      : tone === "good"
        ? "text-success"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";

  const body = (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4 text-left shadow-sm transition-all",
        (href || onClick) &&
          "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary/40 ring-2 ring-primary/15"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className={cn("mt-1 text-3xl font-semibold tabular-nums tracking-tight", toneClass)}>
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Icon className="size-5" />
          </div>
        ) : null}
      </div>
    </div>
  );

  if (href) return <Link href={href}>{body}</Link>;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full">
        {body}
      </button>
    );
  }
  return body;
}
