import type { Session } from "@/lib/types";

/** Display label for Session.payment_status */
export function sessionPaymentLabel(status: string) {
  switch (status) {
    case "paid":
      return "Paid";
    case "failed":
      return "Failed";
    case "exempted":
      return "Waived";
    case "pending":
      return "Pending";
    default:
      return status.replaceAll("_", " ");
  }
}

export function sessionPaymentVariant(
  status: string
): "success" | "destructive" | "exempt" | "warning" | "secondary" {
  switch (status) {
    case "paid":
      return "success";
    case "failed":
      return "destructive";
    case "exempted":
      return "exempt";
    case "pending":
      return "warning";
    default:
      return "secondary";
  }
}

export function sessionWaiverLabel(kind: string | null | undefined) {
  switch (kind) {
    case "guest":
      return "Guest";
    case "policy":
      return "Policy exempt";
    case "operator":
      return "Operator waived";
    case "grace":
      return "Grace";
    default:
      return "";
  }
}

export function sessionWaiverVariant(
  kind: string | null | undefined
): "secondary" | "exempt" | "outline" | "warning" {
  switch (kind) {
    case "guest":
      return "secondary";
    case "policy":
      return "exempt";
    case "operator":
      return "warning";
    case "grace":
      return "outline";
    default:
      return "outline";
  }
}

/**
 * Show a separate "Exempt" policy badge only when it isn't already
 * expressed by payment_status = waived.
 * Typical cases: open stay that won't be charged.
 */
export function sessionShowsExemptPolicy(session: Pick<
  Session,
  "billing_exempt" | "payment_status" | "waiver_kind"
>) {
  if (session.payment_status === "exempted" && session.waiver_kind) {
    return false;
  }
  return Boolean(session.billing_exempt) && session.payment_status !== "exempted";
}

/**
 * Hide redundant "Pending" when the stay is already marked exempt —
 * the Exempt badge carries the meaning until close.
 */
export function sessionShowsPaymentBadge(session: Pick<
  Session,
  "end_time" | "billing_exempt" | "payment_status"
>) {
  const open = !session.end_time;
  if (open && session.billing_exempt && session.payment_status === "pending") {
    return false;
  }
  return true;
}

/** Backend billing_method values only — never invent "Cash". */
export function sessionBillingMethodLabel(method: string | null | undefined) {
  switch (method) {
    case "wallet":
      return "Wallet";
    case "card":
      return "Card";
    default:
      return method ? method.replaceAll("_", " ") : "";
  }
}

/**
 * Settlement path actually recorded on the stay.
 * Operator-wallet desk settlement is `operator_validate`; fleet charge is wallet;
 * kiosk/PSP is card.
 */
export function sessionSettlementLabel(
  session: Pick<Session, "billing_method" | "transactions">
) {
  const txs = session.transactions || [];
  if (txs.some((tx) => tx.transaction_type === "operator_validate")) {
    return "Operator validate";
  }
  if (txs.some((tx) => tx.transaction_type === "parking_fee")) {
    return sessionBillingMethodLabel(session.billing_method) || "Wallet";
  }
  return sessionBillingMethodLabel(session.billing_method);
}
