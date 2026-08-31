import type { ParkingBreakdown } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

export function ParkingJourney({
  breakdown,
  className,
  showAmounts = true,
}: {
  breakdown?: ParkingBreakdown | null;
  className?: string;
  /** Hide billed slice amounts when Amount due is a discount/waiver preview. */
  showAmounts?: boolean;
}) {
  const segments = (breakdown?.segments || []).filter(
    (seg) => (seg.duration_seconds ?? 0) >= 60
  );
  if (!segments.length) return null;
  const currency = breakdown?.currency || segments[0]?.currency || "SAR";
  return (
    <div className={cn("space-y-1.5 text-sm", className)}>
      {segments.map((seg, index) => (
        <div
          key={`${seg.session_id}-${seg.start_time}-${index}`}
          className="flex items-baseline justify-between gap-3"
        >
          <span className="min-w-0 truncate">{seg.zone_name || "Zone"}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {seg.duration_label}
            {showAmounts && seg.amount
              ? ` · ${formatMoney(seg.amount, seg.currency || currency)}`
              : ""}
          </span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 border-t pt-1.5 font-medium">
        <span>Total time</span>
        <span className="tabular-nums">{breakdown?.total_duration_label}</span>
      </div>
    </div>
  );
}
