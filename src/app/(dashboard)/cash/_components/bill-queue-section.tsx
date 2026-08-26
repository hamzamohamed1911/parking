"use client";

import { Loader2 } from "lucide-react";

import { amountsDiffer } from "@/components/gate-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AccessRequest } from "@/lib/types";

export type BillQueueSectionProps = {
  billQueue: AccessRequest[];
  paymentActionId: number | null;
  onRefreshBill: (row: AccessRequest) => void;
  onCancelBill: (row: AccessRequest) => void;
  onSendBill: (row: AccessRequest) => void;
};

export function BillQueueSection(props: BillQueueSectionProps) {
  const {
    billQueue,
    paymentActionId,
    onRefreshBill,
    onCancelBill,
    onSendBill,
  } = props;
  if (billQueue.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Kiosk bills</h2>
        <Badge variant="outline" className="tabular-nums">
          {billQueue.length}
        </Badge>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {billQueue.map((row) => {
          const bill = row.open_payment_intent;
          const owed = row.billable_open_session;
          const busy = paymentActionId === row.id;
          const drifted =
            bill && amountsDiffer(bill.amount, bill.estimated_amount);
          return (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-semibold tracking-wider">
                    {row.plate}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {row.zone_name ? `${row.zone_name} · ` : ""}
                    {row.device_label}
                  </p>
                </div>
                {bill ? (
                  <Badge variant="warning">On kiosk</Badge>
                ) : (
                  <Badge variant="destructive">Not sent</Badge>
                )}
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {bill ? "Billed" : "Owed"}
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {bill
                      ? `${bill.amount} ${bill.currency}`
                      : owed
                        ? `${owed.amount} ${owed.currency}`
                        : "—"}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {bill ? (
                    <>
                      {drifted ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onRefreshBill(row)}
                        >
                          Update → {bill.estimated_amount}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => onCancelBill(row)}
                      >
                        Cancel bill
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => onSendBill(row)}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Send to kiosk
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
