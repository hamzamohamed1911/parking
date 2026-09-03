import type { AccessRequest, Device, ParkingBreakdown } from "@/lib/types";

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
  site_id?: number;
  access_request_id?: number | null;
  at_gate?: boolean;
  zone_id?: number | null;
  parking_breakdown?: ParkingBreakdown;
};

type SelectedExitGate = Pick<Device, "id" | "zone" | "site">;

/**
 * Exit device PK for an owing-desk row, from the pending AccessRequest list
 * (not zone/site). Prefers access_request_id, then plate, then session match.
 *
 * Rows not queued at a gate (no access_request_id / at_gate) must not inherit
 * another lane's pending exit AR for the same plate — that was hiding cars
 * the active-sessions API still lists as owing money.
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

  // Only match plate/session when the row is explicitly queued at a gate.
  // Otherwise an unrelated pending AR for the same plate would hide the stay
  // from every exit lane.
  if (!row.at_gate) {
    return null;
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

/** Zone ids that decide which exit lane an open stay belongs to. */
export function stayZoneIdsForOwingFilter(row: OwingDeskKey): number[] {
  const zones = new Set<number>();
  const segments = row.parking_breakdown?.segments ?? [];
  for (const segment of segments.filter((s) => s.end_time == null)) {
    if (segment.zone_id != null) zones.add(Number(segment.zone_id));
  }
  if (zones.size === 0) {
    for (const segment of segments) {
      if (segment.zone_id != null) zones.add(Number(segment.zone_id));
    }
  }
  if (row.zone_id != null) zones.add(Number(row.zone_id));
  return [...zones];
}

/**
 * Cars owing money for the selected exit gate only.
 *
 * - Same site as the exit device.
 * - Queued at a gate → that exit device PK must match.
 * - Otherwise → stay zone(s) must include the exit device's zone.
 */
export function owingRowMatchesSelectedExitGate(
  row: OwingDeskKey,
  selectedExit: SelectedExitGate | null | undefined,
  pendingRequests: Array<
    AccessRequest & { device_id?: number; linked_session_id?: number | null }
  >,
): boolean {
  if (selectedExit == null) return false;

  if (
    row.site_id != null &&
    Number(row.site_id) !== Number(selectedExit.site)
  ) {
    return false;
  }

  const gateDeviceId = Number(selectedExit.id);
  const gateZoneId = Number(selectedExit.zone);
  const pendingDeviceId = pendingExitDeviceIdForOwingRow(row, pendingRequests);

  if (
    pendingDeviceId != null &&
    Number(pendingDeviceId) !== gateDeviceId
  ) {
    return false;
  }

  if (row.at_gate || row.access_request_id != null || pendingDeviceId != null) {
    return Number(pendingDeviceId) === gateDeviceId;
  }

  const stayZones = stayZoneIdsForOwingFilter(row);
  if (!stayZones.length) return false;
  return stayZones.some((zoneId) => Number(zoneId) === gateZoneId);
}

function segmentZoneMatchesGate(
  segmentZoneId: number | null | undefined,
  gateZoneId: number,
): boolean {
  return segmentZoneId != null && Number(segmentZoneId) === gateZoneId;
}

/**
 * Open stay belongs on this exit gate's zone.
 *
 * When a journey has nested segments, the car's **current** open segment decides
 * which exit lane it belongs to — not the original entry zone alone.
 */
export function sessionVisibleForSelectedExitGate(
  row: OwingDeskKey,
  selectedExitGateZoneId: number | null | undefined,
): boolean {
  if (
    selectedExitGateZoneId == null ||
    !Number.isFinite(Number(selectedExitGateZoneId))
  ) {
    return true;
  }

  const gateZone = Number(selectedExitGateZoneId);
  const segments = row.parking_breakdown?.segments ?? [];
  const openSegments = segments.filter((segment) => segment.end_time == null);

  if (openSegments.length > 0) {
    return openSegments.some((segment) =>
      segmentZoneMatchesGate(segment.zone_id, gateZone),
    );
  }

  if (segments.length > 0) {
    return segments.some((segment) =>
      segmentZoneMatchesGate(segment.zone_id, gateZone),
    );
  }

  return row.zone_id != null && Number(row.zone_id) === gateZone;
}

export function rowFromActiveSession(row: ActiveSession): DeskRow {
  return {
    session_id: row.session_id,
    plate: row.plate,
    fee: row.fee,
    grace_minutes: row.grace_minutes,
    site_id: row.site_id,
    zone_id: row.zone_id,
    zone_name: row.zone_name,
    start_time: row.start_time,
    at_gate: row.at_gate,
    gate_label: row.gate_label,
    access_request_id: row.access_request_id,
    can_validate: row.can_validate,
    within_paid_exit_grace: false,
    paid_exit_until: null,
    match: null,
    parking_breakdown: row.parking_breakdown,
  };
}

/** Lookup hits cover stays the worklist hides: free ones and already-paid ones. */
export function rowFromSearchHit(hit: CashierSearchHit): DeskRow {
  return {
    session_id: hit.session_id,
    plate: hit.plate,
    fee: hit.fee,
    grace_minutes: hit.grace_minutes,
    site_id: hit.site_id,
    zone_id: hit.zone_id,
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
    parking_breakdown: hit.parking_breakdown,
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
