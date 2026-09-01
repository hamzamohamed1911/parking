"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  FilePenLine,
  Gavel,
  History,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDiscountPercent,
  humanizeAuditText,
  parseCashierDiscountEntry,
  stripPaymentDiscountSuffix,
} from "@/lib/session-audit";
import type { Session } from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

export type StayTimelineItem = {
  id: string;
  at: string;
  kind: "ar" | "gate" | "edit" | "wallet" | "status";
  title: string;
  detail?: string;
  /** Extra readable lines (discount recap, etc.) — not an operator note. */
  lines?: string[];
  /** Operator's own note, surfaced on its own line. */
  note?: string;
  /** When set on an AR card, shows the request→decision gap. */
  requestedAt?: string;
  decidedBy?: string;
  device?: string;
  badge?: string;
  badgeVariant?:
    | "default"
    | "secondary"
    | "outline"
    | "success"
    | "warning"
    | "destructive"
    | "exempt";
  href?: string;
  /** De-emphasize noise (timed-out attempts). */
  muted?: boolean;
  /** Internal: marks a coalescible timed-out attempt. */
  timeout?: boolean;
  actionLabel?: string;
  /** Children folded into a single "prior attempts" summary. */
  groupItems?: { id: string; device?: string; at: string }[];
};

/** "Exit 2 (exit) @ 192.168.0.182" -> "Exit 2" */
function cleanDevice(label?: string | null): string {
  if (!label) return "";
  return label
    .replace(/\s*@.*$/, "")
    .replace(/\s*\((?:entry|exit)\)\s*$/i, "")
    .trim();
}

function arStatusVariant(
  status: string
): NonNullable<StayTimelineItem["badgeVariant"]> {
  switch (status) {
    case "approved":
      return "success";
    case "denied":
      return "destructive";
    case "pending":
      return "warning";
    case "timeout":
      return "secondary";
    default:
      return "outline";
  }
}

function kindIcon(kind: StayTimelineItem["kind"]) {
  switch (kind) {
    case "ar":
      return Gavel;
    case "gate":
      return CircleDot;
    case "edit":
      return FilePenLine;
    case "wallet":
      return Wallet;
    default:
      return Clock3;
  }
}

export function buildStayTimeline(session: Session): StayTimelineItem[] {
  const items: StayTimelineItem[] = [];

  for (const ar of session.access_requests || []) {
    const device = cleanDevice(ar.device_label);
    if (ar.status === "timeout") {
      // Noise: no decision was made. Coalesced into a summary below.
      items.push({
        id: `ar-timeout-${ar.id}`,
        at: ar.created_at,
        kind: "ar",
        title: `Timed-out ${ar.action} attempt`,
        detail: [ar.reason, device].filter(Boolean).join(" · "),
        badge: "timeout",
        badgeVariant: "secondary",
        muted: true,
        timeout: true,
        actionLabel: ar.action,
        device,
      });
      continue;
    }
    // One card per request: created + decision folded together.
    items.push({
      id: `ar-${ar.id}`,
      at: ar.decided_at || ar.created_at,
      kind: "ar",
      title: `Access request · ${ar.action}`,
      detail: [ar.reason, device, ar.exempted ? "billing exempt" : null]
        .filter(Boolean)
        .join(" · "),
      note: ar.decision_note || undefined,
      requestedAt: ar.decided_at ? ar.created_at : undefined,
      decidedBy: ar.decided_by_username || undefined,
      badge: ar.status,
      badgeVariant: arStatusVariant(ar.status),
      href: ar.status === "pending" ? "/gate-control" : undefined,
    });
  }

  if (session.start_event_detail) {
    const ev = session.start_event_detail;
    items.push({
      id: `gate-entry-${ev.id}`,
      at: ev.created_at || session.start_time,
      kind: "gate",
      title: "Entry granted",
      detail: [cleanDevice(ev.device_label), ev.decision]
        .filter(Boolean)
        .join(" · "),
      badge: "entry",
      badgeVariant: "success",
    });
  } else {
    items.push({
      id: "stay-start",
      at: session.start_time,
      kind: "status",
      title: "Stay started",
      detail: session.entry_device_label || undefined,
      badge: "open",
      badgeVariant: "warning",
    });
  }

  if (session.end_event_detail) {
    const ev = session.end_event_detail;
    items.push({
      id: `gate-exit-${ev.id}`,
      at: ev.created_at || session.end_time || session.start_time,
      kind: "gate",
      title: "Exit granted",
      detail: [cleanDevice(ev.device_label), ev.decision]
        .filter(Boolean)
        .join(" · "),
      badge: "exit",
      badgeVariant: "outline",
    });
  } else if (session.end_time) {
    items.push({
      id: "stay-end",
      at: session.end_time,
      kind: "status",
      title: "Stay closed",
      badge: session.payment_status,
      badgeVariant:
        session.payment_status === "paid"
          ? "success"
          : session.payment_status === "exempted"
            ? "exempt"
            : "warning",
    });
  }

  for (const entry of session.audit_entries || []) {
    const isExitMatch = entry.field === "exit_access_request";
    const isExitUnmatch = entry.field === "exit_access_request_undo";
    const discount = parseCashierDiscountEntry(entry);
    if (discount) {
      const pct = discount.percentage
        ? formatDiscountPercent(discount.percentage)
        : "";
      items.push({
        id: `audit-${entry.id}`,
        at: entry.created_at,
        kind: "edit",
        title: "Discount applied",
        detail: [
          pct ? `${pct} discount` : null,
          discount.discountAmount
            ? `−${formatMoney(discount.discountAmount)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        lines: [
          discount.originalFee
            ? `Original fee: ${formatMoney(discount.originalFee)}`
            : "",
          discount.finalFee
            ? `Final amount: ${formatMoney(discount.finalFee)}`
            : "",
          discount.reason ? `Reason: ${discount.reason}` : "",
        ].filter(Boolean),
        badge: entry.actor_username || undefined,
        badgeVariant: "secondary",
      });
      continue;
    }
    const paymentNote =
      entry.field === "payment_status"
        ? stripPaymentDiscountSuffix(humanizeAuditText(entry.note))
        : "";
    items.push({
      id: `audit-${entry.id}`,
      at: entry.created_at,
      kind: "edit",
      title: isExitMatch
        ? "Exit OCR matched"
        : isExitUnmatch
          ? "Exit match undone"
          : entry.field === "payment_status"
            ? "Payment updated"
            : entry.action.replaceAll("_", " "),
      detail: isExitMatch
        ? `OCR ${entry.old_value || "—"} → session ${entry.new_value || "—"}${
            entry.note ? ` · ${entry.note}` : ""
          }`
        : isExitUnmatch
          ? `Restored OCR ${entry.new_value || "—"} from session ${
              entry.old_value || "—"
            }${entry.note ? ` · ${entry.note}` : ""}`
        : entry.field === "payment_status"
          ? paymentNote ||
            `${entry.old_value || "—"} → ${entry.new_value || "—"}`
          : entry.field === "note" || entry.action === "note"
            ? entry.note || entry.new_value
            : `${entry.field}: ${entry.old_value || "—"} → ${entry.new_value || "—"}`,
      badge: entry.actor_username || undefined,
      badgeVariant: "secondary",
    });
  }

  for (const tx of session.transactions || []) {
    if (tx.transaction_type !== "parking_fee") continue;
    items.push({
      id: `tx-${tx.id}`,
      at: tx.created_at,
      kind: "wallet",
      title: "Parking fee charged",
      detail: formatMoney(tx.amount),
      badge: "paid",
      badgeVariant: "success",
    });
  }

  if (
    session.end_time &&
    session.payment_status === "exempted" &&
    !(session.transactions || []).some((t) => t.transaction_type === "parking_fee")
  ) {
    items.push({
      id: "waived",
      at: session.end_time,
      kind: "status",
      title: "Billing waived",
      detail:
        session.fee != null
          ? `Fee recorded ${formatMoney(session.fee)}`
          : undefined,
      badge: "waived",
      badgeVariant: "exempt",
    });
  }

  const sorted = items.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  // Fold consecutive timed-out attempts into one muted, expandable summary so
  // the real stay events stand out from retry noise.
  const merged: StayTimelineItem[] = [];
  let run: StayTimelineItem[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      merged.push(run[0]);
    } else {
      const first = run[0];
      const action = first.actionLabel || "access";
      merged.push({
        id: `timeout-group-${first.id}`,
        at: first.at,
        kind: "ar",
        title: `${run.length} timed-out ${action} attempts`,
        detail: first.detail,
        badge: "timeout",
        badgeVariant: "secondary",
        muted: true,
        groupItems: run.map((r) => ({
          id: r.id,
          device: r.device,
          at: r.at,
        })),
      });
    }
    run = [];
  };
  for (const item of sorted) {
    if (item.timeout) {
      run.push(item);
    } else {
      flush();
      merged.push(item);
    }
  }
  flush();
  return merged;
}

function TimelineRow({
  item,
  isLast,
}: {
  item: StayTimelineItem;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isGroup = Boolean(item.groupItems && item.groupItems.length > 0);
  const Icon = isGroup ? History : kindIcon(item.kind);

  return (
    <li className={cn("relative pl-8", !isLast && "pb-6")}>
      <span
        className={cn(
          "absolute -left-[9px] top-1 flex size-[18px] items-center justify-center rounded-full border bg-card",
          item.muted && "opacity-70"
        )}
      >
        <Icon className="size-2.5 text-muted-foreground" />
      </span>
      <div className={cn("flex flex-wrap items-center gap-2", item.muted && "opacity-75")}>
        <p className={cn("text-sm font-semibold", item.muted && "font-medium text-muted-foreground")}>
          {item.title}
        </p>
        {item.badge ? (
          <Badge variant={item.badgeVariant || "outline"} className="capitalize">
            {item.badge}
          </Badge>
        ) : null}
        {isGroup ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"} attempts
            <ChevronDown
              className={cn("size-3 transition-transform", open && "rotate-180")}
            />
          </button>
        ) : null}
      </div>

      {item.detail ? (
        <p className={cn("mt-1 text-sm text-muted-foreground", item.muted && "opacity-90")}>
          {item.detail}
        </p>
      ) : null}

      {item.lines && item.lines.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
          {item.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {item.note ? (
        <p className="mt-1.5 rounded-lg border-l-2 border-primary/40 bg-muted/40 px-2.5 py-1.5 text-sm">
          <span className="font-medium text-foreground/70">Operator note: </span>
          {item.note}
        </p>
      ) : null}

      {isGroup && open ? (
        <ul className="mt-2 space-y-1 border-l border-border/60 pl-3">
          {item.groupItems!.map((child) => (
            <li
              key={child.id}
              className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
            >
              <span className="tabular-nums">{formatDateTime(child.at)}</span>
              {child.device ? <span>· {child.device}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatDateTime(item.at)}</span>
        {item.decidedBy ? <span>by {item.decidedBy}</span> : null}
        {item.requestedAt ? (
          <span className="opacity-80">
            requested {formatDateTime(item.requestedAt)}
          </span>
        ) : null}
        {item.href ? (
          <Link
            href={item.href}
            className="font-medium text-primary hover:underline"
          >
            Open
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function SessionStayTimeline({ session }: { session: Session }) {
  const items = buildStayTimeline(session);

  return (
    <section className="rounded-3xl border bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Stay timeline</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Access requests, gate events, operator edits, and settlement in
          order. Timed-out attempts are grouped.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No timeline events yet.</p>
      ) : (
        <ol className="relative ml-3 mt-6 space-y-0 border-l border-border/80">
          {items.map((item, index) => (
            <TimelineRow
              key={item.id}
              item={item}
              isLast={index === items.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

export function SessionUnpaidBanner({
  session,
  busy,
  onWaive,
  onSettle,
}: {
  session: Session;
  busy: boolean;
  onWaive: () => void;
  onSettle: () => void;
}) {
  const unpaidClosed =
    Boolean(session.end_time) && session.payment_status === "pending";
  if (!unpaidClosed) return null;

  const pendingAr = (session.access_requests || []).find(
    (row) => row.status === "pending"
  );
  const canSettle = session.billing_method !== "card";

  return (
    <section className="rounded-3xl border border-warning/40 bg-warning-muted p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Clock3 className="size-4 text-warning-muted-foreground" />
            <h2 className="text-base font-semibold tracking-tight">
              Unpaid closed stay
            </h2>
            <Badge variant="warning">Needs settlement</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {pendingAr?.reason
              ? pendingAr.reason
              : "This stay closed without a completed charge. Validate via your operator wallet (may go negative) to open the gate, or waive billing."}
            {session.fee != null
              ? ` Estimated fee ${formatMoney(session.fee)}.`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pendingAr ? (
            <Button asChild variant="outline" disabled={busy}>
              <Link href="/gate-control">Gate control</Link>
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={onWaive}>
            <CheckCircle2 className="size-4" />
            Waive
          </Button>
          <Button disabled={busy || !canSettle} onClick={onSettle}>
            <Wallet className="size-4" />
            {canSettle ? "Validate / settle" : "Card stays use kiosk"}
          </Button>
        </div>
      </div>
    </section>
  );
}
