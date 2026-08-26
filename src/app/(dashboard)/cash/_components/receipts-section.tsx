"use client";

import { Loader2, Printer } from "lucide-react";

import { Loader } from "@/components/loaders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime } from "@/lib/utils";

import type { CashierReceipt } from "@/utils/cash/types";

export type ReceiptsSectionProps = {
  hubReady: boolean;
  receiptsLoading: boolean;
  recentReceipts: CashierReceipt[];
  printBusyId: number | null;
  onRefresh: () => void;
  onPrint: (sessionId: number) => void;
};

export function ReceiptsSection(props: ReceiptsSectionProps) {
  const {
    hubReady,
    receiptsLoading,
    recentReceipts,
    printBusyId,
    onRefresh,
    onPrint,
  } = props;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Latest receipts
          </h2>
          <p className="text-sm text-muted-foreground">
            Last 7 in this zone · newest first ·{" "}
            <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
              P
            </kbd>{" "}
            reprints the newest
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={receiptsLoading || !hubReady}
          onClick={onRefresh}
        >
          {receiptsLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Refresh
        </Button>
      </div>
      {!hubReady ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Select a zone to see receipts.
        </p>
      ) : receiptsLoading && recentReceipts.length === 0 ? (
        <Loader label="Loading receipts…" />
      ) : recentReceipts.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No receipts in this zone yet.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {recentReceipts.map((row, index) => {
            const busy = printBusyId === row.session_id;
            const isNewest = index === 0;
            return (
              <li
                key={row.session_id}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5",
                  isNewest && "bg-muted/30",
                )}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-base font-semibold tracking-wider">
                      {row.plate}
                    </p>
                    <Badge variant="outline" className="font-normal capitalize">
                      {row.payment_method}
                    </Badge>
                    {isNewest ? (
                      <Badge variant="success" className="font-normal">
                        Latest
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.paid_at ? formatDateTime(row.paid_at) : "—"}
                    {row.zone_name ? ` · ${row.zone_name}` : ""}
                    {row.invoice_number ? ` · ${row.invoice_number}` : ""}
                  </p>
                </div>
                <p className="text-base font-bold tabular-nums">
                  {row.amount}{" "}
                  <span className="text-xs font-semibold text-muted-foreground">
                    {row.currency}
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onPrint(row.session_id)}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Printer className="size-4" />
                  )}
                  Print
                  {isNewest ? (
                    <kbd className="ml-1 rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
                      P
                    </kbd>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
