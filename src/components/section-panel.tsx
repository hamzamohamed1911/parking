import { cn } from "@/lib/utils";

export function SectionPanel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border bg-card shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
