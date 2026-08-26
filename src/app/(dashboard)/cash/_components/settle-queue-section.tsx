"use client";

import { Banknote, Loader2 } from "lucide-react";

import { WaitTime } from "@/components/gate-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AccessRequest } from "@/lib/types";

import type { ValidateTarget } from "@/utils/cash/types";
import { settleAmountLabel } from "@/utils/cash/utils";

export type SettleQueueSectionProps = {
  settleQueue: AccessRequest[];
  arBusyId: number | null;
  onValidate: (target: ValidateTarget) => void;
};

export function SettleQueueSection(props: SettleQueueSectionProps) {
  const { settleQueue, arBusyId, onValidate } = props;
  if (settleQueue.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Ready to take cash
        </h2>
        <Badge variant="warning" className="tabular-nums">
          {settleQueue.length}
        </Badge>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {settleQueue.map((row) => {
          const amount = settleAmountLabel(row);
          const busy = arBusyId === row.id;
          return (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-card p-4 shadow-sm ring-1 ring-primary/5 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-2xl font-bold leading-none tracking-wider">
                    {row.plate}
                  </p>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    {row.zone_name ? `${row.zone_name} · ` : ""}
                    {row.device_label}
                  </p>
                </div>
                <WaitTime createdAt={row.created_at} />
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Collect
                  </p>
                  <p className="text-2xl font-bold tabular-nums">
                    {amount ?? "—"}
                  </p>
                </div>
                <Button
                  size="lg"
                  className="h-12 gap-2 px-5 text-base"
                  disabled={busy}
                  onClick={() => onValidate({ kind: "request", row })}
                >
                  {busy ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Banknote className="size-5" />
                  )}
                  Cash received
                  <kbd className="ml-1 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold">
                    C
                  </kbd>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
