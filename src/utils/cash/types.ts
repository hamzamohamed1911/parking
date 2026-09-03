import type { AccessRequest, Device, ParkingBreakdown } from "@/lib/types";

export type CashierZone = {
  id: number;
  name: string;
  site_id: number;
  site_name: string;
  project_id: number;
  project_name: string;
};

export type CashierMe = {
  zones: CashierZone[];
  zone_ids: number[];
  site_ids: number[];
  has_assignment: boolean;
  has_operator_wallet: boolean;
  can_pick_zone: boolean;
  uses_fixed_zones: boolean;
};

export type CashierSearchHit = {
  session_id: number;
  plate: string;
  match_percent: number;
  exact: boolean;
  weak: boolean;
  site_id: number;
  site_name: string;
  zone_id: number | null;
  zone_name: string | null;
  start_time: string;
  payment_status: string;
  billing_method: string;
  fee: string;
  paid_exit_until: string | null;
  within_paid_exit_grace: boolean;
  grace_minutes: number;
  can_validate: boolean;
  parking_breakdown?: ParkingBreakdown;
};

/** What the desk needs to take cash for a stay, whether it came from plate search or the active list. */
export type DeskStay = {
  session_id: number;
  plate: string;
  fee: string;
  grace_minutes: number;
  within_paid_exit_grace?: boolean;
  at_gate?: boolean;
};

/** Open stay in the zone that owes money right now. */
export type ActiveSession = {
  session_id: number;
  plate: string;
  site_id: number;
  site_name: string;
  zone_id: number | null;
  zone_name: string | null;
  start_time: string;
  payment_status: string;
  billing_method: string;
  fee: string;
  grace_minutes: number;
  can_validate: boolean;
  access_request_id: number | null;
  at_gate: boolean;
  gate_label: string | null;
  parking_breakdown?: ParkingBreakdown;
};

export type CashierReceipt = {
  session_id: number;
  plate: string;
  amount: string;
  currency: string;
  payment_method: "cash" | "card" | string;
  invoice_number: string;
  paid_at: string | null;
  site_id: number;
  site_name: string;
  zone_id: number | null;
  zone_name: string | null;
  exit_before: string | null;
  session_end: string | null;
};

export type ZoneTariff = {
  zone_id?: number;
  zone_name?: string;
  site_id?: number;
  site_name?: string;
  currency?: string;
  grace_minutes?: number;
  pricing_configured?: boolean;
  price?: string | null;
  additional_fee?: string | null;
  first_hour_total?: string | null;
};

/** Just enough to confirm the collection and offer a reprint of the paper bill. */
export type ReceiptInfo = {
  sessionId: number;
  plate: string;
  amountLabel: string;
};

/** Rows shown before the desk has to ask for the rest of the list. */
export const ACTIVE_PREVIEW_COUNT = 6;

export const ALL_GATES = "all";

/**
 * One row of the desk list. The zone worklist and the plate lookup render the
 * same card so the cashier never has to learn two layouts.
 */
export type DeskRow = {
  session_id: number;
  plate: string;
  fee: string;
  grace_minutes: number;
  site_id: number;
  zone_id: number | null;
  zone_name: string | null;
  start_time: string;
  at_gate: boolean;
  gate_label: string | null;
  access_request_id: number | null;
  can_validate: boolean;
  within_paid_exit_grace: boolean;
  paid_exit_until: string | null;
  match: { percent: number; exact: boolean; weak: boolean } | null;
  parking_breakdown?: ParkingBreakdown;
};

export type ValidateTarget =
  | { kind: "session"; hit: DeskStay }
  | { kind: "request"; row: AccessRequest };

export type ZoneWithDevices = {
  zone: CashierZone;
  exits: Device[];
  waiting: number;
};

export type ChargeMode = "extend_previous" | "new_session";

export type DecisionAction = "approve" | "deny";
