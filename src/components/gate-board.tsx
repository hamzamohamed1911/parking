"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Clock,
  CreditCard,
  DoorClosed,
  DoorOpen,
  RefreshCw,
  RotateCcw,
  Send,
  Smartphone,
  SmartphoneNfc,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AccessRequest, Device } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

export function exitPayAtExitRequest(row: AccessRequest): boolean {
  return (
    row.action === "exit" &&
    row.status === "pending" &&
    Boolean(row.pay_at_exit_enabled)
  );
}

/** Wallet-only exit with no open stay and no billable wallet — open gate only. */
export function exitGuestNoSession(row: AccessRequest): boolean {
  return (
    row.action === "exit" &&
    row.has_open_session === false &&
    !row.requires_entry_time &&
    Boolean(row.wallet_enabled) &&
    !row.pay_at_exit_enabled
  );
}

type PayState =
  | "awaiting"
  | "retrying"
  | "billed"
  | "needs_bill"
  | "needs_charge";

/** Classify an exit pay-at-exit request for the operator at a glance. */
export function payAtExitState(row: AccessRequest): PayState {
  const reason = (row.reason || "").toLowerCase();
  if (row.open_payment_intent) {
    return reason.includes("retry") || reason.includes("issue")
      ? "retrying"
      : "billed";
  }
  if (row.billable_open_session) return "needs_bill";
  if (
    reason.includes("grace") ||
    reason.includes("control-room") ||
    reason.includes("control room") ||
    reason.includes("cancelled") ||
    reason.includes("canceled")
  ) {
    return "needs_charge";
  }
  return "awaiting";
}

export function PaymentStateBadge({ row }: { row: AccessRequest }) {
  const state = payAtExitState(row);
  if (state === "retrying")
    return <Badge variant="warning">Retrying payment</Badge>;
  if (state === "billed") return <Badge variant="warning">Bill on kiosk</Badge>;
  if (state === "needs_bill")
    return <Badge variant="destructive">Needs resend</Badge>;
  if (state === "needs_charge")
    return <Badge variant="destructive">Needs charge</Badge>;
  return <Badge variant="outline">Awaiting payment</Badge>;
}

export function amountsDiffer(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (a == null || b == null || a === "" || b === "") return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a !== b;
  return na !== nb;
}

export function elapsedLabel(fromIso: string, now: number): string {
  const start = new Date(fromIso).getTime();
  if (!Number.isFinite(start)) return "";
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${String(min % 60).padStart(2, "0")}m`;
}

export function waitTone(
  fromIso: string,
  now: number
): "fresh" | "aging" | "stale" {
  const min = (now - new Date(fromIso).getTime()) / 60000;
  if (min >= 5) return "stale";
  if (min >= 2) return "aging";
  return "fresh";
}

/** Live-updating waiting duration; self-contained so the board doesn't re-tick. */
export function WaitTime({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  const tone = waitTone(createdAt, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        tone === "fresh" && "bg-muted text-muted-foreground",
        tone === "aging" &&
          "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tone === "stale" && "bg-destructive/15 text-destructive"
      )}
      title={`Waiting since ${formatDateTime(createdAt)}`}
    >
      <Clock className="size-3" />
      {elapsedLabel(createdAt, now)}
    </span>
  );
}

type KioskHealth = "none" | "cold" | "idle" | "active";

/** Exit kiosk readiness from pairing + last-used age (no live heartbeat). */
export function kioskHealth(device: Device, now: number): KioskHealth {
  if (device.type !== "exit") return "none";
  if (!device.has_kiosk) return "none";
  const last = device.kiosk_last_used_at
    ? new Date(device.kiosk_last_used_at).getTime()
    : NaN;
  if (Number.isNaN(last)) return "cold";
  const mins = (now - last) / 60000;
  if (mins <= 10) return "active";
  if (mins <= 120) return "idle";
  return "cold";
}

/** Compact exit-kiosk status chip so ops don't bill a kiosk that isn't there. */
export function KioskStatus({ device }: { device: Device }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (device.type !== "exit") return null;
  const health = kioskHealth(device, now);
  const last = device.kiosk_last_used_at;
  const label =
    health === "none"
      ? "No kiosk paired"
      : health === "active"
        ? "Kiosk active"
        : health === "idle"
          ? `Kiosk ${last ? elapsedLabel(last, now) : "idle"}`
          : "Kiosk cold";
  const Icon = health === "none" ? Smartphone : SmartphoneNfc;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        health === "none" && "bg-destructive/15 text-destructive",
        health === "cold" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        health === "idle" && "bg-muted text-muted-foreground",
        health === "active" &&
          "bg-success-muted text-success-muted-foreground"
      )}
      title={
        last ? `Kiosk last used ${formatDateTime(last)}` : "Kiosk never used"
      }
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

export function gateLabel(device: Device) {
  const name = device.name?.trim();
  if (name) return name;
  return `${device.type === "entry" ? "Entry" : "Exit"} #${device.id}`;
}

/** Waiting devices first (oldest first), then idle gates by label. */
export function orderDevicesByWaiting(
  devices: Device[],
  pendingByDevice: Record<number, AccessRequest>
): Device[] {
  return [...devices].sort((a, b) => {
    const aw = pendingByDevice[a.id];
    const bw = pendingByDevice[b.id];
    if (Boolean(aw) !== Boolean(bw)) return aw ? -1 : 1;
    if (aw && bw) {
      return (
        new Date(aw.created_at).getTime() - new Date(bw.created_at).getTime()
      );
    }
    return gateLabel(a).localeCompare(gateLabel(b));
  });
}

export function GateCard({
  device,
  waiting,
  isFresh,
  canDecide,
  onApprove,
  onDeny,
  onManual,
  onUnmatch,
  onValidatePayment,
  onChargeAtKiosk,
  onCancelBill,
  onSendBill,
  onRefreshBill,
  paymentActionBusy,
  unmatchBusy,
  validateBusy,
}: {
  device: Device;
  waiting?: AccessRequest;
  isFresh: boolean;
  canDecide: boolean;
  onApprove: (row: AccessRequest) => void;
  onDeny: (row: AccessRequest) => void;
  /** Manual plate entry; the idle-gate shortcut is hidden when omitted. */
  onManual?: (device: Device) => void;
  onUnmatch?: (row: AccessRequest) => void;
  onValidatePayment?: (row: AccessRequest) => void;
  onChargeAtKiosk?: (row: AccessRequest) => void;
  onCancelBill?: (row: AccessRequest) => void;
  onSendBill?: (row: AccessRequest) => void;
  onRefreshBill?: (row: AccessRequest) => void;
  paymentActionBusy?: boolean;
  unmatchBusy?: boolean;
  validateBusy?: boolean;
}) {
  const isEntry = device.type === "entry";
  const GateIcon = waiting ? DoorOpen : DoorClosed;
  const TypeIcon = isEntry ? ArrowDownToLine : ArrowUpFromLine;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-[box-shadow,border-color,background-color,transform] duration-300",
        waiting &&
          (isEntry
            ? "border-success/40 ring-1 ring-success/20"
            : "border-warning/50 ring-1 ring-warning/25"),
        isFresh &&
          "scale-[1.01] border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/45 dark:border-amber-400 dark:bg-amber-400/10"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b px-4 py-2.5",
          isEntry
            ? "border-success/15 bg-success-muted/40"
            : "border-warning/20 bg-warning-muted/50"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              waiting
                ? isEntry
                  ? "bg-success text-success-foreground"
                  : "bg-warning text-warning-foreground"
                : isEntry
                  ? "bg-success-muted text-success-muted-foreground"
                  : "bg-warning-muted text-warning-muted-foreground"
            )}
          >
            <TypeIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold tracking-tight">
              {gateLabel(device)}
            </h4>
            <p className="truncate text-[11px] text-muted-foreground">
              {device.ip}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Badge variant={isEntry ? "secondary" : "outline"} className="uppercase">
            {device.type}
          </Badge>
          {!device.enabled ? <Badge variant="destructive">Off</Badge> : null}
          {device.gate_locked ? <Badge variant="warning">Locked</Badge> : null}
          {device.type === "exit" ? <KioskStatus device={device} /> : null}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <GateIcon
            className={cn(
              "size-4",
              waiting
                ? isEntry
                  ? "text-success"
                  : "text-warning"
                : "text-muted-foreground"
            )}
          />
          <span className="font-medium uppercase tracking-wide">
            {waiting ? "Waiting" : "Idle"}
          </span>
          {isFresh ? (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
              New
            </span>
          ) : null}
          {waiting ? (
            <span className="ml-auto">
              <WaitTime createdAt={waiting.created_at} />
            </span>
          ) : null}
        </div>

        {waiting ? (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Plate
              </p>
              <p className="mt-0.5 font-mono text-3xl font-semibold tracking-[0.12em]">
                {waiting.plate}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {device.type === "exit" && waiting.is_wallet_fleet_payment ? (
                <Badge variant="warning">Wallet / fleet payment</Badge>
              ) : null}
              {device.type === "exit" && waiting.exit_matched ? (
                <Badge variant="warning">Exit matched</Badge>
              ) : null}
              {device.type === "exit" && exitPayAtExitRequest(waiting) ? (
                <PaymentStateBadge row={waiting} />
              ) : null}
              {device.type === "exit" && exitGuestNoSession(waiting) ? (
                <Badge variant="secondary">No session · open only</Badge>
              ) : null}
              {waiting.wallet_exempted ? (
                <Badge variant="exempt">Exempt wallet</Badge>
              ) : null}
              {waiting.wallet_name ? (
                <Badge variant="outline">{waiting.wallet_name}</Badge>
              ) : null}
            </div>
            <div className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
              <p>
                <span className="font-medium text-foreground/70">
                  System reason:{" "}
                </span>
                {waiting.reason || "Awaiting decision"}
              </p>
              <p className="opacity-80">{formatDateTime(waiting.created_at)}</p>
            </div>
            {canDecide &&
            device.type === "exit" &&
            waiting.exit_matched ? (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  OCR {waiting.exit_match_ocr || "—"} → {waiting.plate}
                  {waiting.exit_match_session_id
                    ? ` · session #${waiting.exit_match_session_id}`
                    : ""}
                  . Undo keeps the match history in the session audit.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={unmatchBusy || paymentActionBusy}
                  onClick={() => onUnmatch?.(waiting)}
                >
                  <RotateCcw className="size-4" />
                  {unmatchBusy ? "Undoing…" : "Undo match"}
                </Button>
              </div>
            ) : null}
            {canDecide &&
            device.type === "exit" &&
            exitPayAtExitRequest(waiting) ? (
              <div className="space-y-2 pt-1">
                {device.has_kiosk === false ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] leading-snug text-destructive">
                    No kiosk paired — waiting for a manual decision only. No bill
                    was sent. Use Approve without charge or Deny.
                  </p>
                ) : waiting.open_payment_intent ? (
                  <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-muted/40 p-2.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Bill on kiosk</span>
                      <span className="font-semibold tabular-nums">
                        {waiting.open_payment_intent.amount}{" "}
                        {waiting.open_payment_intent.currency}
                      </span>
                    </div>
                    {amountsDiffer(
                      waiting.open_payment_intent.amount,
                      waiting.open_payment_intent.estimated_amount
                    ) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={paymentActionBusy}
                        onClick={() => onRefreshBill?.(waiting)}
                      >
                        <RefreshCw className="size-4" />
                        {paymentActionBusy
                          ? "Updating…"
                          : `Update amount · was ${waiting.open_payment_intent.amount} → ${waiting.open_payment_intent.estimated_amount}`}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full"
                      disabled={paymentActionBusy}
                      onClick={() => onCancelBill?.(waiting)}
                    >
                      <Ban className="size-4" />
                      Cancel bill
                    </Button>
                  </div>
                ) : waiting.billable_open_session ? (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-destructive">
                        No bill on kiosk
                      </span>
                      <span className="font-semibold tabular-nums">
                        {waiting.billable_open_session.amount}{" "}
                        {waiting.billable_open_session.currency}
                      </span>
                    </div>
                    {amountsDiffer(
                      waiting.billable_open_session.previous_amount,
                      waiting.billable_open_session.amount
                    ) ? (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Was{" "}
                        <span className="tabular-nums">
                          {waiting.billable_open_session.previous_amount}
                        </span>
                        , now{" "}
                        <span className="tabular-nums text-foreground">
                          {waiting.billable_open_session.amount}
                        </span>{" "}
                        · session from{" "}
                        {formatDateTime(
                          waiting.billable_open_session.start_time
                        )}
                      </p>
                    ) : (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Open session from{" "}
                        {formatDateTime(
                          waiting.billable_open_session.start_time
                        )}
                        . Put the same bill back on the kiosk.
                      </p>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={paymentActionBusy}
                      onClick={() => onSendBill?.(waiting)}
                    >
                      <Send className="size-4" />
                      {paymentActionBusy
                        ? "Sending…"
                        : `Resend bill · ${waiting.billable_open_session.amount} ${waiting.billable_open_session.currency}`}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={paymentActionBusy}
                    onClick={() => onChargeAtKiosk?.(waiting)}
                  >
                    <CreditCard className="size-4" />
                    Charge at kiosk
                  </Button>
                )}
                {waiting.can_validate_payment ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={validateBusy || paymentActionBusy}
                    onClick={() => onValidatePayment?.(waiting)}
                  >
                    <Wallet className="size-4" />
                    {validateBusy ? "Validating…" : "Validate payment"}
                  </Button>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full text-muted-foreground hover:text-foreground"
                    disabled={paymentActionBusy}
                    onClick={() => onApprove(waiting)}
                  >
                    Approve, no charge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full text-destructive hover:text-destructive"
                    disabled={paymentActionBusy}
                    onClick={() => onDeny(waiting)}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ) : canDecide ? (
              <div className="space-y-2 pt-1">
                {device.type === "exit" && waiting.can_validate_payment ? (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={validateBusy || paymentActionBusy}
                    onClick={() => onValidatePayment?.(waiting)}
                  >
                    <CreditCard className="size-4" />
                    {validateBusy ? "Validating…" : "Validate payment"}
                  </Button>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" className="w-full" onClick={() => onApprove(waiting)}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full"
                    onClick={() => onDeny(waiting)}
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">No vehicle in queue</p>
            {canDecide && device.enabled && onManual ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onManual(device)}
              >
                Enter plate
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

export function GateColumn({
  title,
  hint,
  tone,
  devices,
  pendingByDevice,
  freshDeviceIds,
  canDecide,
  onApprove,
  onDeny,
  onManual,
  onUnmatch,
  onValidatePayment,
  onChargeAtKiosk,
  onCancelBill,
  onSendBill,
  onRefreshBill,
  paymentActionId,
  unmatchBusy,
  validateBusy,
}: {
  title: string;
  hint: string;
  tone: "entry" | "exit";
  devices: Device[];
  pendingByDevice: Record<number, AccessRequest>;
  freshDeviceIds?: Set<number>;
  canDecide: boolean;
  onApprove: (row: AccessRequest) => void;
  onDeny: (row: AccessRequest) => void;
  onManual?: (device: Device) => void;
  onUnmatch?: (row: AccessRequest) => void;
  onValidatePayment?: (row: AccessRequest) => void;
  onChargeAtKiosk?: (row: AccessRequest) => void;
  onCancelBill?: (row: AccessRequest) => void;
  onSendBill?: (row: AccessRequest) => void;
  onRefreshBill?: (row: AccessRequest) => void;
  paymentActionId?: number | null;
  unmatchBusy?: boolean;
  validateBusy?: boolean;
}) {
  const waitingHere = devices.filter((d) => pendingByDevice[d.id]).length;
  const ordered = orderDevicesByWaiting(devices, pendingByDevice);
  return (
    <div className="min-w-0 space-y-3">
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-opacity-80",
          tone === "entry"
            ? "border-success/20 bg-success-muted/30"
            : "border-warning/25 bg-warning-muted/40"
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        {waitingHere > 0 ? (
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
              tone === "entry"
                ? "bg-success text-success-foreground"
                : "bg-warning text-warning-foreground"
            )}
          >
            {waitingHere} waiting
          </span>
        ) : (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            0/{devices.length} waiting
          </span>
        )}
      </div>
      {devices.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          No {tone} gates
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {ordered.map((device) => (
            <GateCard
              key={device.id}
              device={device}
              waiting={pendingByDevice[device.id]}
              isFresh={Boolean(freshDeviceIds?.has(device.id))}
              canDecide={canDecide}
              onApprove={onApprove}
              onDeny={onDeny}
              onManual={onManual}
              onUnmatch={onUnmatch}
              onValidatePayment={onValidatePayment}
              onChargeAtKiosk={onChargeAtKiosk}
              onCancelBill={onCancelBill}
              onSendBill={onSendBill}
              onRefreshBill={onRefreshBill}
              paymentActionBusy={
                paymentActionId != null &&
                paymentActionId === pendingByDevice[device.id]?.id
              }
              unmatchBusy={unmatchBusy}
              validateBusy={validateBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
