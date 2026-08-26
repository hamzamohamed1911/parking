"use client";

import Link from "next/link";
import { Banknote, Car, Loader2, Printer, Wallet } from "lucide-react";

import { elapsedLabel } from "@/components/gate-board";
import { Loader } from "@/components/loaders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AccessRequest } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";

import { ACTIVE_PREVIEW_COUNT } from "@/utils/cash/types";
import type { DeskRow } from "@/utils/cash/types";

export type DeskListSectionProps = {
  normalizedQuery: string;
  deskRows: DeskRow[];
  visibleDeskRows: DeskRow[];
  usingLookup: boolean;
  activeOwedTotal: string | null;
  activeLoading: boolean;
  searching: boolean;
  lookupPending: boolean;
  activeExpanded: boolean;
  onToggleExpanded: () => void;
  onRefresh: () => void;
  gateRequestFor: (row: DeskRow) => AccessRequest | undefined;
  nowTick: number;
  printBusyId: number | null;
  billSessionId: number | null;
  validateBusyId: number | null;
  onPrintReceipt: (sessionId: number) => void;
  onSendBillForSession: (row: DeskRow, accessRequestId: number) => void;
  onTakeCash: (row: DeskRow) => void;
};

export function DeskListSection(props: DeskListSectionProps) {
  const {
    normalizedQuery,
    deskRows,
    visibleDeskRows,
    usingLookup,
    activeOwedTotal,
    activeLoading,
    searching,
    lookupPending,
    activeExpanded,
    onToggleExpanded,
    onRefresh,
    gateRequestFor,
    nowTick,
    printBusyId,
    billSessionId,
    validateBusyId,
    onPrintReceipt,
    onSendBillForSession,
    onTakeCash,
  } = props;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {normalizedQuery
                ? `Matches for ${normalizedQuery}`
                : "Cars owing money"}
            </h2>
            {deskRows.length > 0 ? (
              <Badge variant="outline" className="tabular-nums">
                {deskRows.length}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {usingLookup
              ? "No car here owes money under that plate, so this is every open stay in the zone — including free and already-paid ones."
              : "Open stays in this zone with a fee due — take cash at the desk, or send the bill to the kiosk for cars already at a gate."}
            {!normalizedQuery && activeOwedTotal ? (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  {activeOwedTotal} outstanding
                </span>
              </>
            ) : null}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={activeLoading || searching}
        >
          {activeLoading || searching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Car className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {(activeLoading && !normalizedQuery && deskRows.length === 0) ||
      lookupPending ? (
        <div className="rounded-2xl border bg-card px-5 py-10 text-center shadow-sm">
          <Loader />
        </div>
      ) : deskRows.length === 0 ? (
        <div className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
          {normalizedQuery
            ? "No car on site matches that plate in this zone."
            : "Nothing to collect — every open stay is still free, already paid, or queued at a gate above."}
        </div>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {visibleDeskRows.map((row) => (
              <DeskRowItem
                key={row.session_id}
                row={row}
                gateRequest={gateRequestFor(row)}
                nowTick={nowTick}
                printBusyId={printBusyId}
                billSessionId={billSessionId}
                validateBusyId={validateBusyId}
                onPrintReceipt={onPrintReceipt}
                onSendBillForSession={onSendBillForSession}
                onTakeCash={onTakeCash}
              />
            ))}
          </ul>
          {!normalizedQuery && deskRows.length > ACTIVE_PREVIEW_COUNT ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={onToggleExpanded}
            >
              {activeExpanded
                ? "Show fewer"
                : `Show all ${deskRows.length}`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

function DeskRowItem({
  row,
  gateRequest,
  nowTick,
  printBusyId,
  billSessionId,
  validateBusyId,
  onPrintReceipt,
  onSendBillForSession,
  onTakeCash,
}: {
  row: DeskRow;
  gateRequest: AccessRequest | undefined;
  nowTick: number;
  printBusyId: number | null;
  billSessionId: number | null;
  validateBusyId: number | null;
  onPrintReceipt: (sessionId: number) => void;
  onSendBillForSession: (row: DeskRow, accessRequestId: number) => void;
  onTakeCash: (row: DeskRow) => void;
}) {
  const atGate = row.at_gate || Boolean(gateRequest);

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-lg font-semibold tracking-wider">
            {row.plate}
          </p>
          {row.match && !row.match.exact ? (
            <Badge variant={row.match.weak ? "warning" : "outline"}>
              {row.match.percent}% match
              {row.match.weak ? " · weak" : ""}
            </Badge>
          ) : null}
          {row.within_paid_exit_grace ? (
            <Badge variant="success">Exit grace active</Badge>
          ) : null}
          {atGate ? (
            <Badge variant="warning">
              At {row.gate_label ?? gateRequest?.device_label ?? "gate"}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {row.zone_name ? `${row.zone_name} · ` : ""}
          parked {elapsedLabel(row.start_time, nowTick)} · since{" "}
          {formatDateTime(row.start_time)}
          {row.within_paid_exit_grace && row.paid_exit_until
            ? ` · exit before ${formatDateTime(row.paid_exit_until)}`
            : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="sm:text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {row.within_paid_exit_grace ? "Paid" : "Amount due"}
          </p>
          <p className="text-xl font-bold tabular-nums">
            {formatMoney(row.fee)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/sessions/${row.session_id}`}>Session</Link>
          </Button>
          {row.within_paid_exit_grace ? (
            <Button
              variant="outline"
              size="sm"
              disabled={printBusyId === row.session_id}
              onClick={() => onPrintReceipt(row.session_id)}
            >
              {printBusyId === row.session_id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Printer className="size-4" />
              )}
              Receipt
            </Button>
          ) : null}
          {atGate && gateRequest ? (
            <Button
              variant="outline"
              size="sm"
              disabled={billSessionId === row.session_id}
              onClick={() => onSendBillForSession(row, gateRequest.id)}
            >
              {billSessionId === row.session_id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Banknote className="size-4" />
              )}
              Bill on kiosk
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!row.can_validate || validateBusyId === row.session_id}
            onClick={() => onTakeCash(row)}
          >
            {validateBusyId === row.session_id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wallet className="size-4" />
            )}
            {row.within_paid_exit_grace
              ? "Already paid"
              : gateRequest?.can_validate_payment
                ? "Take cash · open"
                : "Take cash"}
          </Button>
        </div>
      </div>
    </li>
  );
}
