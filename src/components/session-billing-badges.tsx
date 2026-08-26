import { Badge } from "@/components/ui/badge";
import {
  sessionPaymentLabel,
  sessionPaymentVariant,
  sessionShowsExemptPolicy,
  sessionShowsPaymentBadge,
  sessionWaiverLabel,
  sessionWaiverVariant,
} from "@/lib/session-billing";
import type { Session } from "@/lib/types";

type SessionBillingFields = Pick<
  Session,
  | "end_time"
  | "billing_exempt"
  | "payment_status"
  | "billing_method"
  | "waiver_kind"
>;

export function SessionBillingBadges({
  session,
  showMethod = false,
}: {
  session: SessionBillingFields & {
    exit_matched?: boolean;
    exit_match_ocr?: string | null;
  };
  showMethod?: boolean;
}) {
  const waiverLabel = sessionWaiverLabel(session.waiver_kind);
  return (
    <>
      {sessionShowsPaymentBadge(session) ? (
        <Badge variant={sessionPaymentVariant(session.payment_status)}>
          {session.payment_status === "exempted" && waiverLabel
            ? waiverLabel
            : sessionPaymentLabel(session.payment_status)}
        </Badge>
      ) : null}
      {sessionShowsExemptPolicy(session) ? (
        <Badge variant="exempt">Exempt</Badge>
      ) : null}
      {session.exit_matched ? (
        <Badge variant="outline" className="font-normal">
          {session.exit_match_ocr
            ? `Matched · OCR ${session.exit_match_ocr}`
            : "Exit matched"}
        </Badge>
      ) : null}
      {showMethod && session.billing_method ? (
        <Badge variant="outline" className="font-normal capitalize">
          {session.billing_method}
        </Badge>
      ) : null}
    </>
  );
}

export function SessionWaiverBadge({
  kind,
}: {
  kind: string | null | undefined;
}) {
  const label = sessionWaiverLabel(kind);
  if (!label) return null;
  return <Badge variant={sessionWaiverVariant(kind)}>{label}</Badge>;
}
