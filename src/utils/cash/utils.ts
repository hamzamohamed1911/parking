import type { AccessRequest, Device } from "@/lib/types";

import type {
  ActiveSession,
  CashierSearchHit,
  DeskRow,
} from "@/utils/cash/types";

export function plateKey(plate: string): string {
  return plate.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function isExitDevice(device: Device): boolean {
  return device.type === "exit";
}

export function isExitRequest(row: { action?: string }): boolean {
  return !row.action || row.action === "exit";
}

/** AccessRequest.device is the gate PK. Prefer device_id from SSE payloads. */
export function accessRequestDeviceId(row: {
  device?: number;
  device_id?: number;
}): number | null {
  const id = Number(row.device_id ?? row.device);
  return Number.isFinite(id) ? id : null;
}

type OwingDeskKey = {
  plate: string;
  session_id?: number;
  access_request_id?: number | null;
  at_gate?: boolean;
};

/**
 * Exit device PK for an owing-desk row, from the pending AccessRequest list
 * (not zone/site). Prefers access_request_id, then plate, then session match.
 */
export function pendingExitDeviceIdForOwingRow(
  row: OwingDeskKey,
  pendingRequests: Array<
    AccessRequest & { device_id?: number; linked_session_id?: number | null }
  >,
): number | null {
  const exits = pendingRequests.filter(isExitRequest);
  if (row.access_request_id != null) {
    const byId = exits.find((ar) => ar.id === row.access_request_id);
    const id = byId ? accessRequestDeviceId(byId) : null;
    if (id != null) return id;
  }
  const key = plateKey(row.plate);
  const byPlate = exits.find((ar) => plateKey(ar.plate) === key);
  if (byPlate) {
    const id = accessRequestDeviceId(byPlate);
    if (id != null) return id;
  }
  if (row.session_id != null) {
    const bySession = exits.find(
      (ar) =>
        ar.exit_match_session_id === row.session_id ||
        ar.linked_session_id === row.session_id,
    );
    if (bySession) return accessRequestDeviceId(bySession);
  }
  return null;
}

/**
 * Cars owing money: keep rows whose pending exit AR is this gate's device PK.
 * Rows with no pending exit AR stay visible (ordinary open stays).
 */
export function owingRowVisibleOnSelectedExit(
  row: OwingDeskKey,
  pendingRequests: Array<
    AccessRequest & { device_id?: number; linked_session_id?: number | null }
  >,
  selectedExitDeviceId: number | null,
): boolean {
  if (selectedExitDeviceId == null || !Number.isFinite(selectedExitDeviceId)) {
    return false;
  }

  const deviceId = pendingExitDeviceIdForOwingRow(row, pendingRequests);

  if (deviceId == null) {
    return false;
  }

  return Number(deviceId) === Number(selectedExitDeviceId);
}

export function rowFromActiveSession(row: ActiveSession): DeskRow {
  return {
    session_id: row.session_id,
    plate: row.plate,
    fee: row.fee,
    grace_minutes: row.grace_minutes,
    zone_name: row.zone_name,
    start_time: row.start_time,
    at_gate: row.at_gate,
    gate_label: row.gate_label,
    access_request_id: row.access_request_id,
    can_validate: row.can_validate,
    within_paid_exit_grace: false,
    paid_exit_until: null,
    match: null,
  };
}

/** Lookup hits cover stays the worklist hides: free ones and already-paid ones. */
export function rowFromSearchHit(hit: CashierSearchHit): DeskRow {
  return {
    session_id: hit.session_id,
    plate: hit.plate,
    fee: hit.fee,
    grace_minutes: hit.grace_minutes,
    zone_name: hit.zone_name,
    start_time: hit.start_time,
    at_gate: false,
    gate_label: null,
    access_request_id: null,
    can_validate: hit.can_validate,
    within_paid_exit_grace: hit.within_paid_exit_grace,
    paid_exit_until: hit.paid_exit_until,
    match: {
      percent: hit.match_percent,
      exact: hit.exact,
      weak: hit.weak,
    },
  };
}

/** Cash the cashier should collect before settling — bill, else open stay. */
export function settleAmountLabel(row: AccessRequest): string | null {
  if (row.open_payment_intent) {
    return `${row.open_payment_intent.amount} ${row.open_payment_intent.currency}`;
  }
  if (row.billable_open_session) {
    return `${row.billable_open_session.amount} ${row.billable_open_session.currency}`;
  }
  return null;
}

/**
 * Print server-rendered HTML through an isolated iframe: the dashboard
 * stylesheet would otherwise fight the 80mm till roll, and a popup window gets
 * blocked on desk browsers. The bill markup itself comes from the backend
 * (`/sessions/:id/bill/`) so cash and card paper stay byte-for-byte identical.
 */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const run = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  };
  if (frame.contentWindow?.document.readyState === "complete") run();
  else frame.onload = run;
}
