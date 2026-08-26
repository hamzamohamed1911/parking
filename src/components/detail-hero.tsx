import { cn } from "@/lib/utils";

export function DetailHero({
  title,
  badges,
  description,
  meta,
  leading,
  actions,
  className,
}: {
  title: React.ReactNode;
  badges?: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-card shadow-sm",
        className
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 brand-hero-mesh" />
      <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
        <div className={cn("min-w-0", leading && "flex items-start gap-4")}>
          {leading}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
                {title}
              </h1>
              {badges}
            </div>
            {description ? (
              <div className="mt-1 text-sm text-muted-foreground">{description}</div>
            ) : null}
            {meta ? (
              <div className="mt-2 text-xs text-muted-foreground">{meta}</div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
