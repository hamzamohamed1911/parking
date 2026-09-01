export type User = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  is_superuser: boolean;
  groups: string[];
  permissions: string[];
  all_projects: boolean;
  projects: { id: number; name: string; is_active: boolean }[];
  has_operator_wallet?: boolean;
  has_cashier_assignment?: boolean;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type Project = {
  id: number;
  name: string;
  is_active: boolean;
  wallet_enabled?: boolean;
  pay_at_exit_enabled?: boolean;
  currency?: string;
  grace_minutes?: number;
  site_count: number;
  created_at: string;
  updated_at: string;
};

export type ProjectDashboard = {
  project: Project;
  stats: {
    sites: number;
    devices: number;
    devices_enabled: number;
    sessions: number;
    sessions_open: number;
    vehicles: number;
    wallets: number;
  };
};

export type ProjectVehicle = {
  plate: string;
  vehicle_id: number | null;
  wallet_id: number | null;
  wallet_name: string | null;
  is_active: boolean | null;
  note?: string | null;
  site_id: number;
  site_name: string;
  zone_id?: number | null;
  zone_name?: string | null;
  project_id?: number;
  project_name?: string;
  is_open: boolean;
  last_seen: string;
  session_id: number;
  session_count: number;
};

export type Site = {
  id: number;
  project: number;
  project_name: string;
  name: string;
  is_active: boolean;
  hourly_rate: string;
  additional_fee: string;
  grace_minutes: number;
  iot_thing_name: string;
  iot_certificate_id: string;
  provisioned_at: string | null;
  device_count: number;
  entry_device_count?: number;
  exit_device_count?: number;
  zone_count?: number;
};

export type Zone = {
  id: number;
  site: number;
  site_name: string;
  project: number;
  parent: number | null;
  parent_name: string | null;
  name: string;
  is_active: boolean;
  hourly_rate: string;
  additional_fee: string;
  parking_spots?: number;
  start_time?: string;
  end_time?: string;
  coord_a_latitude?: string | null;
  coord_a_longitude?: string | null;
  coord_b_latitude?: string | null;
  coord_b_longitude?: string | null;
  coord_c_latitude?: string | null;
  coord_c_longitude?: string | null;
  coord_d_latitude?: string | null;
  coord_d_longitude?: string | null;
  device_count: number;
};

export type Device = {
  id: number;
  site: number;
  site_name: string;
  zone: number;
  zone_name: string;
  zone_parent?: number | null;
  zone_parent_name?: string | null;
  project: number;
  project_name: string;
  name: string;
  ip: string;
  username: string;
  type: "entry" | "exit";
  barrier_lane: number;
  enabled: boolean;
  gate_locked: boolean;
  has_kiosk?: boolean | null;
  kiosk_last_used_at?: string | null;
  created_at: string;
  updated_at: string;
};

/** Exit kiosk / NearPay terminal (staff list — no API token). */
export type KioskCredential = {
  id: number;
  device: number;
  device_name: string;
  site_id: number;
  site_name: string;
  project: number;
  project_name: string;
  nearpay_terminal_id: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

/** Pay-at-exit PaymentIntent for Terminals → Payments. */
export type PaymentIntent = {
  id: number;
  project: number;
  project_name?: string;
  session: number;
  access_request: number | null;
  amount: string;
  currency: string;
  merchant_reference_id: string;
  pin: string;
  provider: string;
  provider_transaction_id: string;
  status: string;
  plate: string;
  site_id: number;
  site_name: string;
  session_start: string | null;
  session_end: string | null;
  paid_exit_until?: string | null;
  gate_opened?: boolean;
  created_at: string;
  paid_at: string | null;
  device_id?: number | null;
  device_name?: string;
  kiosk_credential_id?: number | null;
  nearpay_terminal_id?: string;
  kiosk_label?: string;
};

export type Wallet = {
  id: number;
  project: number;
  project_name: string;
  name: string;
  assigned_user?: number | null;
  assigned_user_username?: string | null;
  is_operator_wallet?: boolean;
  is_active: boolean;
  is_exempted: boolean;
  balance: string;
  currency: string;
  updated_at: string;
  vehicles: Vehicle[];
  last_topup_balance_after?: string | null;
  balance_pct_of_last_topup?: number | null;
};

export type Vehicle = {
  id: number;
  wallet: number;
  wallet_name?: string;
  project?: number;
  project_name?: string;
  plate: string;
  note?: string;
  is_active: boolean;
};

export type Transaction = {
  id: number;
  wallet: number;
  wallet_name: string;
  project: number;
  amount: string;
  balance_after: string;
  transaction_type: string;
  session: number | null;
  reference: string;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
};

export type Event = {
  id: number;
  device: number;
  device_label: string;
  site_name: string;
  plate: string;
  /** Optional ANPR vehicle type from the gateway (e.g. car, truck). */
  vehicle_type?: string;
  action: string;
  decision: string;
  created_at: string;
};

export type ParkingBreakdownSegment = {
  zone_id: number | null;
  zone_name: string;
  session_id: number;
  start_time: string;
  end_time: string | null;
  duration_seconds: number;
  duration_minutes: number;
  duration_label: string;
  /** Billed slice from session_slice_fee; omitted when it would not sum to Amount due. */
  amount?: string | null;
  currency?: string;
  amount_label?: string;
};

export type ParkingBreakdown = {
  segments: ParkingBreakdownSegment[];
  total_duration_seconds: number;
  total_duration_minutes: number;
  total_duration_label: string;
  currency?: string;
};

export type Session = {
  id: number;
  plate: string;
  site: number;
  site_name: string;
  zone?: number | null;
  zone_name?: string | null;
  parent_session?: number | null;
  grace_exit_until?: string | null;
  paid_exit_until?: string | null;
  project?: number;
  project_name?: string;
  entry_device: number;
  entry_device_label?: string | null;
  /** ANPR vehicle type from the entry read, falling back to the exit read. */
  vehicle_type?: string;
  start_event: number;
  start_event_detail?: Event;
  start_time: string;
  end_event: number | null;
  end_event_detail?: Event | null;
  end_time: string | null;
  fee: string | null;
  payment_status: string;
  billing_method?: string;
  billing_exempt: boolean;
  /** Why billing was waived: guest | policy | operator | grace */
  waiver_kind?: string;
  /** Operator matched an exit OCR read to this stay. */
  exit_matched?: boolean;
  /** Exit OCR plate before the operator match. */
  exit_match_ocr?: string | null;
  /** Pending access request that was matched to this stay. */
  exit_match_access_request_id?: number | null;
  /** Open stay with an active operator exit match can be unmatched. */
  can_unmatch_exit?: boolean;
  /** Successful pay-at-exit card payment has an invoice available. */
  can_download_bill?: boolean;
  allow_negative_balance: boolean;
  wallet_id?: number | null;
  wallet_name?: string | null;
  wallet_exempted?: boolean;
  audit_entries?: SessionAuditEntry[];
  transactions?: Transaction[];
  /** Control-room access requests tied to this stay (entry/exit/settlement). */
  access_requests?: SessionAccessRequest[];
  /** Occupancy by zone; computed at read time. Does not change the fee. */
  parking_breakdown?: ParkingBreakdown;
};

/** Compact AR row nested on session detail. */
export type SessionAccessRequest = {
  id: number;
  device: number;
  device_label: string;
  action: string;
  status: string;
  reason: string;
  decision_note: string;
  exempted: boolean;
  decided_by_username: string | null;
  decided_at: string | null;
  resolution_event: number | null;
  created_at: string;
};

export type SessionAuditEntry = {
  id: number;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  note: string;
  actor: number | null;
  actor_username: string | null;
  created_at: string;
};

export type OpsProjectRow = {
  id: number;
  name: string;
  is_active: boolean;
  sites: number;
  devices: number;
  devices_enabled: number;
  sessions_open: number;
  sessions_today: number;
  pending_requests: number;
  revenue_today: string;
};

export type OpsTrendDay = {
  date: string;
  label: string;
  sessions: number;
  revenue: number;
  events: number;
  granted: number;
  denied: number;
};

export type OpsDashboard = {
  generated_at: string;
  stats: {
    pending_requests: number;
    sessions_open: number;
    sessions_today: number;
    sessions_total: number;
    events_today: number;
    events_granted_today: number;
    events_denied_today: number;
    revenue_today: string;
    revenue_currency: string;
    projects: number;
    projects_active: number;
    sites: number;
    devices: number;
    devices_enabled: number;
    wallets: number;
    vehicles: number;
    payment_paid_today: number;
    payment_failed_today: number;
    payment_exempted_today: number;
    payment_guest_today: number;
    payment_operator_waived_today: number;
    /** Closed stays still awaiting wallet settlement. */
    sessions_unpaid_closed: number;
  };
  projects: OpsProjectRow[];
  trend_7d?: OpsTrendDay[];
  pending_requests: AccessRequest[];
  open_sessions: Session[];
  recent_events: Event[];
};

export type AccessRequest = {
  id: number;
  device: number;
  device_label: string;
  site_name: string;
  zone_name?: string | null;
  zone_id?: number | null;
  project_name: string;
  wallet_enabled?: boolean;
  pay_at_exit_enabled?: boolean;
  plate: string;
  /** Optional ANPR vehicle type from the gateway (e.g. car, truck). */
  vehicle_type?: string;
  action: string;
  status: string;
  /** System escalate reason (platform-set). Not the operator note. */
  reason: string;
  /** Operator note on approve/deny. Separate from `reason`. */
  decision_note: string;
  exempted: boolean;
  wallet_exempted?: boolean;
  wallet_name?: string | null;
  decided_by: number | null;
  decided_by_username: string | null;
  decided_at: string | null;
  resolution_event: number | null;
  created_at: string;
  has_open_session: boolean;
  /** Session created or closed by this decision, when known. */
  linked_session_id?: number | null;
  /** Approved exit that opened the gate with no stay to close or bill. */
  opened_without_session?: boolean;
  /** Operator matched this exit OCR to an open stay. */
  exit_matched?: boolean;
  exit_match_session_id?: number | null;
  exit_match_ocr?: string | null;
  /** Wallet / fleet payment AR (insufficient balance or residual after grace). */
  is_wallet_fleet_payment?: boolean;
  /** Operator can validate via their assigned operator wallet. */
  can_validate_payment?: boolean;
  /** True when approve needs an entry time to build a billable session. */
  requires_entry_time?: boolean;
  can_extend_previous?: boolean;
  previous_session?: {
    id: number;
    start_time: string;
    paid_exit_until: string | null;
    fee: string | null;
  } | null;
  open_payment_intent?: {
    id: number;
    status: string;
    amount: string;
    currency: string;
    estimated_amount?: string | null;
  } | null;
  billable_open_session?: {
    id: number;
    start_time: string;
    amount: string;
    currency: string;
    previous_amount?: string | null;
  } | null;
};

export type SiteDashboard = {
  site: Site;
  stats: {
    devices: number;
    devices_enabled: number;
    devices_locked: number;
    sessions_open: number;
    sessions_today: number;
    pending_requests: number;
    revenue_today: string;
    revenue_currency: string;
  };
  devices: Device[];
  open_sessions: Session[];
  pending_requests: AccessRequest[];
};
