import {
  BadgeCheck,
  CircleSlash,
  Pencil,
  Square,
  StickyNote,
  Tag,
  type LucideIcon,
} from "lucide-react";

import type { SessionAuditEntry } from "@/lib/types";
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
  };
  return labels[field] ?? field.replaceAll("_", " ");
}

export function isNoteEntry(entry: SessionAuditEntry) {
  return entry.action === "note" || entry.field === "note";
}
