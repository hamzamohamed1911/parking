import {
  BadgeCheck,
  CircleSlash,
  Pencil,
  Square,
  StickyNote,
  Tag,
  type LucideIcon,
} from "lucide-react";

import type { Session, SessionAuditEntry } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/** Audit values are written server-side and often embed raw ISO timestamps. */
export function humanizeAuditText(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return "";
  return text.replace(ISO_TIMESTAMP, (match) => formatDateTime(match));
}

/** Backend joins note fragments with " · "; render them as separate lines. */
export function auditNoteParts(value: string | null | undefined) {
  return humanizeAuditText(value)
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
}

const ACTIONS: Record<
  string,
  { label: string; Icon: LucideIcon; tone: string }
> = {
  plate_changed: {
    label: "Plate changed",
    Icon: Tag,
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  exempted: {
    label: "Marked exempt",
    Icon: BadgeCheck,
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  unexempted: {
    label: "Exemption cleared",
    Icon: CircleSlash,
    tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  ended: {
    label: "Ended manually",
    Icon: Square,
    tone: "bg-destructive/15 text-destructive",
  },
  note: {
    label: "Note",
    Icon: StickyNote,
    tone: "bg-muted text-muted-foreground",
  },
  updated: {
    label: "Updated",
    Icon: Pencil,
    tone: "bg-primary/10 text-primary",
  },
};

export function auditActionMeta(action: string) {
  return (
    ACTIONS[action] ?? {
      label: action.replaceAll("_", " "),
      Icon: Pencil,
      tone: "bg-muted text-muted-foreground",
    }
  );
}

/** Field-level changes read better as a labelled before → after pair. */
export function auditFieldLabel(field: string) {
  const labels: Record<string, string> = {
    plate: "Plate",
    end_time: "Ended at",
    start_time: "Started at",
    payment_status: "Payment",
    paid_exit_until: "Exit grace",
    billing_exempt: "Billing exemption",
    exit_access_request: "Exit match",
    exit_access_request_undo: "Exit match undone",
    cashier_discount: "Discount",
  };
  return labels[field] ?? field.replaceAll("_", " ");
}

export function isNoteEntry(entry: SessionAuditEntry) {
  return (
    (entry.action === "note" || entry.field === "note") &&
    !isCashierDiscountEntry(entry)
  );
}

export type CashierDiscountAudit = {
  percentage: string;
  discountAmount: string;
  originalFee: string;
  finalFee: string;
  reason: string;
  actorUsername: string | null;
  createdAt: string;
};

const CASHIER_DISCOUNT_NOTE =
  /^percentage=(\S+)\s+discount_amount=(\S+)\s+original_fee=(\S+)\s+final_fee=(\S+)\s+reason=([\s\S]*)$/;

export function isCashierDiscountEntry(entry: SessionAuditEntry) {
  return entry.field === "cashier_discount";
}

export function formatDiscountPercent(value: string | number) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return `${value}%`;
  const rounded = Math.round(n * 100) / 100;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded);
  return `${text}%`;
}

export function parseCashierDiscountEntry(
  entry: SessionAuditEntry
): CashierDiscountAudit | null {
  if (!isCashierDiscountEntry(entry)) return null;
  const match = (entry.note || "").trim().match(CASHIER_DISCOUNT_NOTE);
  const originalFee = match?.[3] || entry.old_value || "";
  const finalFee = match?.[4] || entry.new_value || "";
  if (!originalFee && !finalFee) return null;
  let discountAmount = match?.[2] || "";
  if (!discountAmount && originalFee && finalFee) {
    const orig = Number(originalFee);
    const fin = Number(finalFee);
    if (Number.isFinite(orig) && Number.isFinite(fin) && orig >= fin) {
      discountAmount = (orig - fin).toFixed(2);
    }
  }
  return {
    percentage: match?.[1] || "",
    discountAmount,
    originalFee,
    finalFee,
    reason: (match?.[5] || "").trim(),
    actorUsername: entry.actor_username,
    createdAt: entry.created_at,
  };
}

export function sessionCashierDiscount(
  session: Pick<Session, "audit_entries">
): CashierDiscountAudit | null {
  const entries = session.audit_entries || [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const parsed = parseCashierDiscountEntry(entries[i]);
    if (parsed) return parsed;
  }
  return null;
}

/** Drop the appended discount fragment when a dedicated discount audit exists. */
export function stripPaymentDiscountSuffix(note: string) {
  return note
    .replace(/\s*·\s*discount\s+\S+%\s+\([^)]*\)\s+reason:\s*[\s\S]*$/i, "")
    .trim();
}
