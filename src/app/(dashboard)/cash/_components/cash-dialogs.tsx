"use client";

import { Loader2, Printer, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AccessRequest, Device } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

import type {
  ChargeMode,
  DecisionAction,
  ReceiptInfo,
  ValidateTarget,
} from "@/utils/cash/types";
import { settleAmountLabel } from "@/utils/cash/utils";

export type DecisionDialogProps = {
  row: AccessRequest | null;
  action: DecisionAction | null;
  note: string;
  arBusyId: number | null;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export type ManualPlateDialogProps = {
  device: Device | null;
  plate: string;
  note: string;
  busy: boolean;
  onPlateChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export type ChargeAtKioskDialogProps = {
  request: AccessRequest | null;
  mode: ChargeMode;
  entryTime: string;
  busy: boolean;
  onModeChange: (mode: ChargeMode) => void;
  onEntryTimeChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export type ReceiptDialogProps = {
  receipt: ReceiptInfo | null;
  printBusyId: number | null;
  onClose: () => void;
  onPrint: (sessionId: number) => void;
};

export type ValidateDialogProps = {
  target: ValidateTarget | null;
  validateBusyId: number | null;
  arBusyId: number | null;
  onClose: () => void;
  onConfirm: () => void;
};

export type CancelBillDialogProps = {
  target: AccessRequest | null;
  paymentActionId: number | null;
  onClose: () => void;
  onConfirm: (row: AccessRequest) => void;
};

export type CashDialogsProps = {
  decision: DecisionDialogProps;
  manual: ManualPlateDialogProps;
  charge: ChargeAtKioskDialogProps;
  receipt: ReceiptDialogProps;
  validate: ValidateDialogProps;
  cancel: CancelBillDialogProps;
};

export function CashDialogs(props: CashDialogsProps) {
  const { decision, manual, charge, receipt, validate, cancel } = props;

  return (
    <>
      <DecisionDialog {...decision} />
      <ManualPlateDialog {...manual} />
      <ChargeAtKioskDialog {...charge} />
      <ReceiptDialog {...receipt} />
      <ValidateDialog {...validate} />
      <CancelBillDialog {...cancel} />
    </>
  );
}

function DecisionDialog(props: DecisionDialogProps) {
  const { row, action, note, arBusyId, onNoteChange, onClose, onSubmit } =
    props;
  return (
    <Dialog
      open={Boolean(row && action)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === "approve" ? "Approve" : "Deny"} {row?.plate}
          </DialogTitle>
          <DialogDescription>
            {row?.site_name}
            {row?.zone_name ? ` · ${row.zone_name}` : ""}
            {row?.device_label ? ` · ${row.device_label}` : ""}
            {row?.action ? ` · ${row.action}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {row?.reason ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                System reason
              </p>
              <p className="mt-0.5 leading-snug">{row.reason}</p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="cash-decision-note">Operator note</Label>
            <Textarea
              id="cash-decision-note"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder={
                action === "approve"
                  ? "Why are you approving this?"
                  : "Why are you denying this?"
              }
              rows={3}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Required — saved on the access request and visible in history.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={action === "deny" ? "destructive" : "default"}
              disabled={arBusyId === row?.id || !note.trim()}
              onClick={onSubmit}
            >
              {arBusyId === row?.id
                ? "Saving…"
                : action === "approve"
                  ? "Approve"
                  : "Deny"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManualPlateDialog(props: ManualPlateDialogProps) {
  const {
    device,
    plate,
    note,
    busy,
    onPlateChange,
    onNoteChange,
    onClose,
    onSubmit,
  } = props;
  return (
    <Dialog
      open={Boolean(device)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter plate manually</DialogTitle>
          <DialogDescription>
            {device
              ? `${device.site_name}${
                  device.zone_name ? ` · ${device.zone_name}` : ""
                } · ${device.name || device.ip} · ${device.type}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cash-manual-plate">Plate number</Label>
            <Input
              id="cash-manual-plate"
              value={plate}
              onChange={(e) => onPlateChange(e.target.value.toUpperCase())}
              placeholder="ABC1234"
              className="font-mono text-lg tracking-wider"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cash-manual-note">Operator note (optional)</Label>
            <Textarea
              id="cash-manual-note"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Why the gate was opened manually"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This records the plate at the gate and opens the barrier straight
            away — an entry creates a stay, an exit closes and charges it.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !plate.trim()} onClick={onSubmit}>
              {busy ? "Opening…" : "Open gate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChargeAtKioskDialog(props: ChargeAtKioskDialogProps) {
  const {
    request,
    mode,
    entryTime,
    busy,
    onModeChange,
    onEntryTimeChange,
    onClose,
    onSubmit,
  } = props;
  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Charge at kiosk · {request?.plate}</DialogTitle>
          <DialogDescription>
            Create a bill and keep the gate closed until the kiosk confirms
            payment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <button
            type="button"
            disabled={!request?.can_extend_previous}
            onClick={() => onModeChange("extend_previous")}
            className={cn(
              "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
              !request?.can_extend_previous
                ? "cursor-not-allowed opacity-55"
                : mode === "extend_previous"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "mt-0.5 size-4 shrink-0 rounded-full border-2",
                mode === "extend_previous" && request?.can_extend_previous
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/40",
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                Extend previous session
              </span>
              <span className="block text-xs text-muted-foreground">
                {request?.can_extend_previous
                  ? "Bills only the time after the previous paid grace expired."
                  : "Unavailable: no paid session for this plate/site outside grace."}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange("new_session")}
            className={cn(
              "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
              mode === "new_session"
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "mt-0.5 size-4 shrink-0 rounded-full border-2",
                mode === "new_session"
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/40",
              )}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                New session from entry time
              </span>
              <span className="block text-xs text-muted-foreground">
                Bills the full interval from the manual entry time.
              </span>
            </span>
          </button>
          {mode === "new_session" ? (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted p-3">
              <Label htmlFor="cash-charge-entry-time">
                Entry time (required)
              </Label>
              <Input
                id="cash-charge-entry-time"
                type="datetime-local"
                value={entryTime}
                onChange={(e) => onEntryTimeChange(e.target.value)}
              />
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              disabled={
                busy ||
                (mode === "extend_previous" && !request?.can_extend_previous)
              }
            >
              {busy ? "Creating bill…" : "Send bill to kiosk"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog(props: ReceiptDialogProps) {
  const { receipt, printBusyId, onClose, onPrint } = props;
  return (
    <Dialog
      open={Boolean(receipt)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cash taken</DialogTitle>
          <DialogDescription>
            Hand the printed bill to the driver.
          </DialogDescription>
        </DialogHeader>
        {receipt ? (
          <div className="space-y-3">
            <div className="rounded-xl border bg-muted/30 p-4 text-center">
              <p className="font-mono text-2xl font-bold tracking-wider">
                {receipt.plate}
              </p>
              <p className="mt-3 text-3xl font-bold tabular-nums">
                {receipt.amountLabel}
              </p>
              <p className="text-xs text-muted-foreground">paid in cash</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Done
                <kbd className="ml-1 rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
                  Esc
                </kbd>
              </Button>
              <Button
                disabled={printBusyId === receipt.sessionId}
                onClick={() => onPrint(receipt.sessionId)}
              >
                {printBusyId === receipt.sessionId ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Printer className="size-4" />
                )}
                Print bill
                <kbd className="ml-1 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold">
                  P
                </kbd>
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ValidateDialog(props: ValidateDialogProps) {
  const { target, validateBusyId, arBusyId, onClose, onConfirm } = props;
  const amount =
    target?.kind === "session"
      ? formatMoney(target.hit.fee)
      : target
        ? settleAmountLabel(target.row)
        : null;

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        const busy = validateBusyId != null || arBusyId != null;
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Take cash ·{" "}
            <span className="font-mono tracking-wider">
              {target?.kind === "session"
                ? target.hit.plate
                : target?.row.plate}
            </span>
          </DialogTitle>
          <DialogDescription>
            {target?.kind === "session"
              ? `Marks the stay paid. The car is not at a gate yet — they can leave within ${
                  target.hit.grace_minutes || "the grace"
                } minutes once they reach exit.`
              : "Marks the stay paid and opens the gate straight away."}
            {target?.kind === "session" && target.hit.at_gate ? (
              <>
                {" "}
                This car is waiting at a gate but its exit request cannot be
                settled yet, so the barrier will not open from here.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {amount ? (
            <div className="flex items-baseline justify-between rounded-xl border bg-muted/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Amount to collect
              </span>
              <span className="text-2xl font-bold tabular-nums">{amount}</span>
            </div>
          ) : null}
          <p className="rounded-lg border border-warning/30 bg-warning-muted/50 px-3 py-2.5 text-xs leading-relaxed">
            The fee is charged to <strong>your operator wallet</strong>, which
            may go negative until you settle up. Only confirm once you have the
            cash in hand.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={validateBusyId != null || arBusyId != null}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              autoFocus
              disabled={validateBusyId != null || arBusyId != null}
              onClick={onConfirm}
            >
              {validateBusyId != null || arBusyId != null ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wallet className="size-4" />
              )}
              {validateBusyId != null || arBusyId != null
                ? "Validating…"
                : "Cash received · Enter"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelBillDialog(props: CancelBillDialogProps) {
  const { target, paymentActionId, onClose, onConfirm } = props;
  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open && paymentActionId == null) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel bill · {target?.plate}</DialogTitle>
          <DialogDescription>
            Removes the bill from the exit kiosk. The unpaid session stays open
            — you can Resend immediately from the toast or the card.
          </DialogDescription>
        </DialogHeader>
        {target?.open_payment_intent ? (
          <div className="rounded-lg border border-warning/30 bg-warning-muted/50 px-3 py-2.5 text-sm">
            Outstanding bill:{" "}
            <span className="font-semibold tabular-nums">
              {target.open_payment_intent.amount}{" "}
              {target.open_payment_intent.currency}
            </span>
            .
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={paymentActionId != null}
          >
            Keep bill
          </Button>
          <Button
            variant="destructive"
            onClick={() => target && onConfirm(target)}
            disabled={paymentActionId != null}
          >
            {paymentActionId != null ? "Cancelling…" : "Cancel bill"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
