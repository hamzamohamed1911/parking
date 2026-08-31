"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Download,
  ParkingSquare,
  Percent,
  RotateCcw,
  Save,
  Square,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { DetailHero } from "@/components/detail-hero";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { SessionBillingBadges } from "@/components/session-billing-badges";
import {
  SessionStayTimeline,
  SessionUnpaidBanner,
} from "@/components/session-stay-timeline";
import { VehicleNoteEditor } from "@/components/vehicle-note-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, apiDownload, ApiError } from "@/lib/api";
import {
  auditActionMeta,
  auditFieldLabel,
  auditNoteParts,
  formatDiscountPercent,
  humanizeAuditText,
  isCashierDiscountEntry,
  isNoteEntry,
  parseCashierDiscountEntry,
  sessionCashierDiscount,
  stripPaymentDiscountSuffix,
} from "@/lib/session-audit";
import {
  sessionPaymentLabel,
  sessionPaymentVariant,
  sessionSettlementLabel,
  sessionWaiverLabel,
  sessionWaiverVariant,
} from "@/lib/session-billing";
import { vehicleTypeMeta } from "@/lib/vehicle-type";
import { ParkingJourney } from "@/components/parking-breakdown";
import type { Paginated, Session, Vehicle } from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

function sessionTxMeta(type: string) {
  switch (type) {
    case "top_up":
      return {
        label: "Top up",
        Icon: ArrowDownLeft,
        iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        amountClass: "text-emerald-700 dark:text-emerald-400",
      };
    case "refund":
      return {
        label: "Refund",
        Icon: RotateCcw,
        iconClass: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
        amountClass: "text-sky-800 dark:text-sky-300",
      };
    case "withdraw":
      return {
        label: "Withdraw",
        Icon: ArrowUpRight,
        iconClass: "bg-destructive/15 text-destructive",
        amountClass: "text-destructive",
      };
    case "parking_fee":
      return {
        label: "Parking fee",
        Icon: ParkingSquare,
        iconClass: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        amountClass: "text-amber-800 dark:text-amber-300",
      };
    case "operator_validate":
      return {
        label: "Operator validate",
        Icon: Wallet,
        iconClass: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
        amountClass: "text-violet-800 dark:text-violet-300",
      };
    default:
      return {
        label: type.replaceAll("_", " "),
        Icon: Wallet,
        iconClass: "bg-muted text-muted-foreground",
        amountClass: "text-foreground",
      };
  }
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const { cashOnly } = useAuth();
  const sessionId = params.id;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [plate, setPlate] = useState("");
  const [exempted, setExempted] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [settling, setSettling] = useState(false);
  const [billBusy, setBillBusy] = useState(false);
  const [unmatching, setUnmatching] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);

  const loadVehicleNote = useCallback(async (plateValue: string) => {
    const normalized = plateValue.trim().toUpperCase();
    if (!normalized) {
      setVehicle(null);
      return;
    }
    try {
      const data = await api<Paginated<Vehicle>>("vehicles/", {
        query: { search: normalized },
      });
      const match =
        data.results.find((v) => v.plate.toUpperCase() === normalized) ?? null;
      setVehicle(match);
    } catch {
      setVehicle(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Session>(`sessions/${sessionId}/`);
      setSession(data);
      setPlate(data.plate);
      setExempted(data.billing_exempt);
      setNote("");
      void loadVehicleNote(data.plate);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load session");
      setSession(null);
      setVehicle(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId, loadVehicleNote]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    const paidLocked = session.payment_status === "paid";
    const canEditExempt = !session.end_time && !paidLocked;
    const body: Record<string, unknown> = {};
    if (
      !paidLocked &&
      plate.trim() &&
      plate.trim().toUpperCase().replace(/\s+/g, "") !== session.plate
    ) {
      body.plate = plate.trim();
    }
    if (canEditExempt && exempted !== session.billing_exempt) {
      body.billing_exempt = exempted;
    }
    if (note.trim()) body.note = note.trim();
    if (Object.keys(body).length === 0) {
      toast.message(paidLocked ? "Add a note to save" : "Nothing to update");
      return;
    }
    setBusy(true);
    try {
      const updated = await api<Session>(`sessions/${session.id}/`, {
        method: "PATCH",
        body,
      });
      setSession(updated);
      setPlate(updated.plate);
      setExempted(updated.billing_exempt);
      setNote("");
      void loadVehicleNote(updated.plate);
      toast.success(paidLocked ? "Note added" : "Session updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onEndSession() {
    if (!session || session.end_time) return;
    if (
      !window.confirm(
        `End session for ${session.plate}? This closes the stay and may charge the wallet.`
      )
    ) {
      return;
    }
    setEnding(true);
    try {
      const closed = await api<Session>(`sessions/${session.id}/end/`, {
        method: "POST",
        body: { note: note.trim() || "Ended from session form" },
      });
      setSession(closed);
      setPlate(closed.plate);
      setExempted(closed.billing_exempt);
      setNote("");
      toast.success("Session ended");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not end session");
    } finally {
      setEnding(false);
    }
  }

  async function onWaiveUnpaid() {
    if (!session) return;
    if (
      !window.confirm(
        `Waive billing for ${session.plate}? The stay will be marked exempted.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const updated = await api<Session>(`sessions/${session.id}/`, {
        method: "PATCH",
        body: {
          billing_exempt: true,
          note: note.trim() || "Waived from unpaid stay banner",
        },
      });
      setSession(updated);
      setExempted(updated.billing_exempt);
      setNote("");
      toast.success("Stay waived");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not waive stay");
    } finally {
      setBusy(false);
    }
  }

  async function onUnmatchExit() {
    if (!session || !session.can_unmatch_exit) return;
    if (
      !window.confirm(
        `Undo exit match for ${session.plate}? Match history stays in the audit log.`
      )
    ) {
      return;
    }
    setUnmatching(true);
    try {
      const updated = await api<Session>(`sessions/${session.id}/unmatch-exit/`, {
        method: "POST",
        body: {},
      });
      setSession(updated);
      setPlate(updated.plate);
      toast.success("Exit match undone");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not undo exit match"
      );
    } finally {
      setUnmatching(false);
    }
  }

  async function onSettleUnpaid() {
    if (!session) return;
    if (
      !window.confirm(
        `Validate / settle ${session.plate}? This charges your operator wallet (may go negative), opens the gate, and starts the exit grace window.`
      )
    ) {
      return;
    }
    setSettling(true);
    try {
      const updated = await api<Session>(`sessions/${session.id}/settle/`, {
        method: "POST",
        body: { note: note.trim() || "Settled from unpaid stay banner" },
      });
      setSession(updated);
      setExempted(updated.billing_exempt);
      setNote("");
      toast.success("Stay settled");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not settle stay");
    } finally {
      setSettling(false);
    }
  }

  async function onValidateOpen() {
    if (!session || session.end_time) return;
    if (
      !window.confirm(
        `Validate payment for ${session.plate}? This charges your operator wallet (which may go negative) and starts the exit grace window.`
      )
    ) {
      return;
    }
    setSettling(true);
    try {
      const updated = await api<Session>(
        `sessions/${session.id}/${
          cashOnly ? "cashier-validate" : "operator-validate"
        }/`,
        {
          method: "POST",
          body: { note: note.trim() || "Validated from session details" },
        }
      );
      setSession(updated);
      setExempted(updated.billing_exempt);
      setNote("");
      toast.success("Payment validated · exit grace started");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not validate payment"
      );
    } finally {
      setSettling(false);
    }
  }

  async function onDownloadBill() {
    if (!session) return;
    setBillBusy(true);
    try {
      await apiDownload(`sessions/${session.id}/bill/`, {
        filename: `session-${session.id}-bill.html`,
      });
      toast.success("Tax invoice downloaded");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not download bill"
      );
    } finally {
      setBillBusy(false);
    }
  }

  if (loading) {
    return <Loader label="Loading session…" />;
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link href={cashOnly ? "/cash" : "/sessions"}>
            <ArrowLeft className="size-4" />
            {cashOnly ? "Back to cash" : "Back to sessions"}
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const open = !session.end_time;
  const paidLocked = session.payment_status === "paid";
  const unpaidClosed =
    Boolean(session.end_time) && session.payment_status === "pending";
  const waiverLabel = sessionWaiverLabel(session.waiver_kind);
  const alreadyWaived =
    session.payment_status === "exempted" ||
    (Boolean(session.billing_exempt) && Boolean(waiverLabel));
  /** Editable only on open stays — closed unpaid uses Waive on the banner. */
  const canEditExempt = open && !paidLocked;
  const paidGraceActive =
    paidLocked &&
    Boolean(session.paid_exit_until) &&
    new Date(session.paid_exit_until as string).getTime() >= Date.now();
  const canValidateOpen =
    open &&
    session.billing_method !== "card" &&
    session.payment_status !== "exempted" &&
    !paidGraceActive;
  const vehicleType = vehicleTypeMeta(
    session.vehicle_type ||
      session.start_event_detail?.vehicle_type ||
      session.end_event_detail?.vehicle_type
  );
  const actionBusy = busy || ending || settling || billBusy || unmatching;
  const cashierDiscount = sessionCashierDiscount(session);
  const settlementLabel = sessionSettlementLabel(session);
  const paid = paidLocked;
  const exemptedStay = session.payment_status === "exempted";
  const showDiscount = Boolean(cashierDiscount) && paid && !exemptedStay;
  const paidAmount = paid
    ? session.fee ?? cashierDiscount?.finalFee ?? "0.00"
    : null;
  const showUnpaidFee =
    !paid &&
    !exemptedStay &&
    session.fee != null &&
    session.fee !== "";

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={cashOnly ? "/cash" : "/sessions"}>
          <ArrowLeft className="size-4" />
          {cashOnly ? "Cash" : "Sessions"}
        </Link>
      </Button>

      <DetailHero
        leading={
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ParkingSquare className="size-6" />
          </div>
        }
        title={
          <span className="font-mono tracking-wider">{session.plate}</span>
        }
        badges={
          <>
            <SessionBillingBadges session={session} showMethod />
            {vehicleType ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold">
                <vehicleType.Icon className="size-3.5" />
                {vehicleType.label}
              </span>
            ) : null}
            {open ? (
              <span className="inline-flex items-center rounded-md border border-transparent bg-warning-muted px-2.5 py-0.5 text-xs font-semibold text-warning-muted-foreground">
                Open
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold">
                Closed
              </span>
            )}
          </>
        }
        description={`${session.site_name}${
          session.zone_name ? ` · ${session.zone_name}` : ""
        }${session.project_name ? ` · ${session.project_name}` : ""}`}
        meta={`Session #${session.id}${
          session.wallet_name ? ` · ${session.wallet_name}` : ""
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            {session.can_download_bill ? (
              <Button
                variant="outline"
                onClick={() => void onDownloadBill()}
                disabled={actionBusy}
              >
                <Download className="size-4" />
                {billBusy ? "Preparing…" : "Download bill"}
              </Button>
            ) : null}
            {session.can_unmatch_exit ? (
              <Button
                variant="outline"
                onClick={() => void onUnmatchExit()}
                disabled={actionBusy}
              >
                <RotateCcw className="size-4" />
                {unmatching ? "Undoing…" : "Undo match"}
              </Button>
            ) : null}
            {canValidateOpen ? (
              <Button
                onClick={() => void onValidateOpen()}
                disabled={actionBusy}
              >
                <Wallet className="size-4" />
                {settling ? "Validating…" : "Validate payment"}
              </Button>
            ) : null}
            {open && paidGraceActive ? (
              <Button variant="outline" disabled>
                <Wallet className="size-4" />
                Exit grace active
              </Button>
            ) : null}
            {open ? (
              <Button
                variant="destructive"
                onClick={() => void onEndSession()}
                disabled={actionBusy}
              >
                <Square className="size-4" />
                {ending ? "Ending…" : "End session"}
              </Button>
            ) : null}
          </div>
        }
      />

      <SessionUnpaidBanner
        session={session}
        busy={actionBusy}
        onWaive={() => void onWaiveUnpaid()}
        onSettle={() => void onSettleUnpaid()}
      />

      {vehicle ? (
        <VehicleNoteEditor
          vehicleId={vehicle.id}
          note={vehicle.note}
          plate={vehicle.plate}
          onSaved={(next) =>
            setVehicle((prev) => (prev ? { ...prev, note: next } : prev))
          }
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SessionStayTimeline session={session} />

        <div className="space-y-6">
          <section className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight">Stay summary</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Entry</dt>
                <dd className="mt-0.5 font-medium">
                  {formatDateTime(session.start_time)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Exit</dt>
                <dd className="mt-0.5 font-medium">
                  {session.end_time
                    ? formatDateTime(session.end_time)
                    : "In progress"}
                </dd>
              </div>
            </dl>

            {session.parking_breakdown?.segments?.length ? (
              <div className="rounded-2xl border bg-muted/20 p-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Parking details
                </p>
                <ParkingJourney breakdown={session.parking_breakdown} />
              </div>
            ) : null}

            <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
                  {showDiscount && cashierDiscount ? (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          Original fee
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatMoney(cashierDiscount.originalFee)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          Discount
                          {cashierDiscount.percentage
                            ? ` · ${formatDiscountPercent(cashierDiscount.percentage)}`
                            : ""}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {cashierDiscount.discountAmount
                            ? `−${formatMoney(cashierDiscount.discountAmount)}`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t pt-2">
                        <span className="text-sm font-semibold">
                          Amount paid
                        </span>
                        <span className="text-2xl font-bold tabular-nums tracking-tight">
                          {formatMoney(paidAmount)}
                        </span>
                      </div>
                    </div>
                  ) : paid ? (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold">Amount paid</span>
                      <span className="text-2xl font-bold tabular-nums tracking-tight">
                        {formatMoney(paidAmount)}
                      </span>
                    </div>
                  ) : showUnpaidFee ? (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Fee</span>
                      <span className="text-lg font-semibold tabular-nums">
                        {formatMoney(session.fee)}
                      </span>
                    </div>
                  ) : exemptedStay ? (
                    <p className="text-sm text-muted-foreground">
                      This stay was waived — it is not a payment or discount.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No payment recorded yet.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        Payment status
                      </span>
                      <Badge variant={sessionPaymentVariant(session.payment_status)}>
                        {session.payment_status === "exempted" &&
                        sessionWaiverLabel(session.waiver_kind)
                          ? sessionWaiverLabel(session.waiver_kind)
                          : sessionPaymentLabel(session.payment_status)}
                      </Badge>
                    </div>
                    {paid && settlementLabel ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          Payment method
                        </span>
                        <span className="font-medium">{settlementLabel}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

            {showDiscount && cashierDiscount ? (
                <div className="space-y-2.5 rounded-2xl border px-4 py-3">
                  <p className="text-sm font-semibold">Discount applied</p>
                  <p className="text-sm text-muted-foreground">
                    {cashierDiscount.percentage
                      ? `${formatDiscountPercent(cashierDiscount.percentage)} discount`
                      : "Discount"}
                  </p>
                  <dl className="grid gap-1.5 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Original fee</dt>
                      <dd className="tabular-nums">
                        {formatMoney(cashierDiscount.originalFee)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Discount</dt>
                      <dd className="tabular-nums">
                        {cashierDiscount.discountAmount
                          ? `−${formatMoney(cashierDiscount.discountAmount)}`
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Final amount</dt>
                      <dd className="font-semibold tabular-nums">
                        {formatMoney(cashierDiscount.finalFee || session.fee)}
                      </dd>
                    </div>
                    {cashierDiscount.reason ? (
                      <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
                        <dt className="text-muted-foreground">Reason</dt>
                        <dd className="max-w-[70%] text-right font-medium" dir="auto">
                          {cashierDiscount.reason}
                        </dd>
                      </div>
                    ) : null}
                    {cashierDiscount.actorUsername ? (
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">Applied by</dt>
                        <dd className="font-medium">{cashierDiscount.actorUsername}</dd>
                      </div>
                    ) : null}
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Date</dt>
                      <dd className="tabular-nums text-muted-foreground">
                        {formatDateTime(cashierDiscount.createdAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
            ) : null}

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {sessionWaiverLabel(session.waiver_kind) ? (
                <div>
                  <dt className="text-muted-foreground">Waiver</dt>
                  <dd className="mt-0.5 font-medium">
                    {sessionWaiverLabel(session.waiver_kind)}
                  </dd>
                </div>
              ) : null}
              {session.exit_matched ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Exit match</dt>
                  <dd className="mt-0.5 flex flex-wrap items-center gap-3">
                    <span className="font-medium">
                      {session.exit_match_ocr
                        ? `OCR ${session.exit_match_ocr} → ${session.plate}`
                        : "Operator matched exit OCR"}
                    </span>
                    {session.can_unmatch_exit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={unmatching}
                        onClick={() => void onUnmatchExit()}
                      >
                        {unmatching ? "Undoing…" : "Undo match"}
                      </Button>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Vehicle type</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                  {vehicleType ? (
                    <>
                      <vehicleType.Icon className="size-4 text-muted-foreground" />
                      {vehicleType.label}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Not reported by ANPR
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Entry device</dt>
                <dd className="mt-0.5 font-medium">
                  {session.entry_device_label || `#${session.entry_device}`}
                </dd>
              </div>
              {session.zone_name ? (
                <div>
                  <dt className="text-muted-foreground">Zone</dt>
                  <dd className="mt-0.5 font-medium">{session.zone_name}</dd>
                </div>
              ) : null}
              {session.wallet_name ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Wallet</dt>
                  <dd className="mt-0.5">
                    <Link
                      href={`/wallets/${session.wallet_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {session.wallet_name}
                      {session.wallet_exempted ? " · Exempt wallet" : ""}
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {paidLocked ? "Session notes" : "Edit session"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {paidLocked
                  ? "This stay is paid. Plate and exemption are locked — you can still add audit notes."
                  : canEditExempt
                    ? "Correct the plate or mark the stay exempt before exit. Gate entry/exit events stay unchanged for audit."
                    : unpaidClosed
                      ? "Correct the plate if needed. To skip charging, use Waive on the unpaid banner above."
                      : "Correct the plate if needed. Billing for this stay is already settled or waived."}
              </p>
            </div>
            <form className="space-y-4" onSubmit={onSave}>
              <div className="space-y-2">
                <Label htmlFor="plate">Plate</Label>
                <Input
                  id="plate"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  className="font-mono tracking-wider"
                  required
                  disabled={paidLocked}
                />
              </div>
              {canEditExempt ? (
                <label className="flex items-start gap-3 rounded-2xl border bg-muted/30 px-4 py-3 text-sm">
                  <Checkbox
                    checked={exempted}
                    onCheckedChange={(v) => setExempted(v === true)}
                    className="mt-0.5"
                    disabled={Boolean(session.wallet_exempted)}
                  />
                  <span>
                    <span className="font-medium">Exempt from billing</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {session.wallet_exempted
                        ? "Locked on — this plate belongs to an exempt wallet."
                        : "Skip wallet charge when this stay closes. Does not rewrite entry/exit events."}
                    </span>
                  </span>
                </label>
              ) : unpaidClosed ? (
                <div className="rounded-2xl border border-warning/30 bg-warning-muted/40 px-4 py-3 text-sm">
                  <p className="font-medium">Billing still open</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Use <span className="font-medium text-foreground">Waive</span>{" "}
                    on the banner above to exempt this closed stay, or{" "}
                    <span className="font-medium text-foreground">Validate / settle</span>{" "}
                    to withdraw from the wallet.
                  </p>
                </div>
              ) : alreadyWaived || session.billing_exempt ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/30 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Billing</span>
                  <Badge
                    variant={
                      waiverLabel
                        ? sessionWaiverVariant(session.waiver_kind)
                        : "exempt"
                    }
                  >
                    {waiverLabel || "Exempt"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Exemption is locked for this stay.
                  </span>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="note">Audit note</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    paidLocked
                      ? "Add a note about this paid stay…"
                      : "Why this change was made…"
                  }
                  rows={3}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {open ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={actionBusy}
                    onClick={() => void onEndSession()}
                  >
                    <Square className="size-4" />
                    {ending ? "Ending…" : "End session"}
                  </Button>
                ) : null}
                <Button type="submit" disabled={actionBusy}>
                  <Save className="size-4" />
                  {busy ? "Saving…" : paidLocked ? "Add note" : "Save changes"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">Operator edits</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Plate, exemption, notes, and manual end actions from this console.
          </p>
          {(session.audit_entries || []).length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No edits yet.</p>
          ) : (
            <ol className="mt-5 space-y-1">
              {(session.audit_entries || []).map((entry, index, rows) => {
                const discount = parseCashierDiscountEntry(entry);
                const meta = isCashierDiscountEntry(entry)
                  ? {
                      label: "Discount applied",
                      Icon: Percent,
                      tone: "bg-muted text-muted-foreground",
                    }
                  : entry.field === "payment_status"
                    ? {
                        ...auditActionMeta("updated"),
                        label: "Payment updated",
                      }
                    : auditActionMeta(entry.action);
                const noteEntry = !discount && entry.field !== "payment_status" && isNoteEntry(entry);
                const paymentNote =
                  entry.field === "payment_status"
                    ? stripPaymentDiscountSuffix(
                        humanizeAuditText(entry.note)
                      )
                    : "";
                const parts = auditNoteParts(entry.note || entry.new_value);
                const [headline, ...details] = noteEntry ? parts : [];
                const extraNote = noteEntry
                  ? ""
                  : discount
                    ? ""
                    : entry.field === "payment_status"
                      ? ""
                      : humanizeAuditText(entry.note);
                return (
                  <li key={entry.id} className="relative flex gap-3 pb-4">
                    {index < rows.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute left-[15px] top-9 bottom-0 w-px bg-border"
                      />
                    ) : null}
                    <span
                      className={cn(
                        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full",
                        meta.tone
                      )}
                    >
                      <meta.Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      {discount ? (
                        <>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold">
                              Discount applied
                              {entry.actor_username
                                ? ` by ${entry.actor_username}`
                                : ""}
                            </span>
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                              {formatDateTime(entry.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {[
                              discount.percentage
                                ? formatDiscountPercent(discount.percentage)
                                : null,
                              discount.discountAmount
                                ? `${formatMoney(discount.discountAmount)} discount`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {discount.reason ? (
                            <p className="mt-1 text-sm" dir="auto">
                              <span className="text-muted-foreground">
                                Reason:{" "}
                              </span>
                              {discount.reason}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold">{meta.label}</span>
                        {entry.actor_username ? (
                          <span className="text-xs text-muted-foreground">
                            by {entry.actor_username}
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {formatDateTime(entry.created_at)}
                        </span>
                      </div>

                      {noteEntry ? (
                        headline ? (
                          <p className="mt-1 text-sm">{headline}</p>
                        ) : null
                      ) : entry.field === "payment_status" ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {paymentNote ||
                            `${humanizeAuditText(entry.old_value) || "—"} → ${
                              humanizeAuditText(entry.new_value) || "—"
                            }`}
                        </p>
                      ) : (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="text-muted-foreground">
                            {auditFieldLabel(entry.field)}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs line-through decoration-muted-foreground/50">
                            {humanizeAuditText(entry.old_value) || "—"}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">
                            {humanizeAuditText(entry.new_value) || "—"}
                          </span>
                        </p>
                      )}

                      {details.length ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {details.map((detail, i) => (
                            <li
                              key={i}
                              className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {detail}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {extraNote ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {extraNote}
                        </p>
                      ) : null}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">Wallet activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Charges linked to this session.
          </p>
          {(session.transactions || []).length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No wallet transactions.
            </p>
          ) : (
            <ul className="mt-4 divide-y">
              {(session.transactions || []).map((tx) => {
                const amountNum = Number(tx.amount);
                const credit = !Number.isNaN(amountNum) && amountNum > 0;
                const meta = sessionTxMeta(tx.transaction_type);
                const Icon = meta.Icon;
                return (
                  <li key={tx.id} className="flex items-start gap-3 py-3.5">
                    <div
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
                        meta.iconClass
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{meta.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(tx.created_at)}
                        {tx.reference ? ` · ${tx.reference}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          meta.amountClass
                        )}
                      >
                        {credit ? "+" : ""}
                        {formatMoney(tx.amount)}
                      </p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        Remaining balance {formatMoney(tx.balance_after)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
