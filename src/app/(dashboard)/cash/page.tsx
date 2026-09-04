/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/refs */
"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Banknote,
  Bell,
  BellOff,
  Car,
  ChevronDown,
  Loader2,
  Printer,
  Radio,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import {
  amountsDiffer,
  elapsedLabel,
  GateColumn,
  WaitTime,
  gateLabel,
} from "@/components/gate-board";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { useProjectFilter } from "@/components/providers/project-filter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  accessRequestStreamUrl,
  consumeSseBuffer,
  type StreamStatus,
} from "@/lib/access-request-stream";
import { api, ApiError, apiText } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ParkingJourney } from "@/components/parking-breakdown";
import type {
  AccessRequest,
  Device,
  Paginated,
  ParkingBreakdown,
  Site,
  Zone,
} from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import {
  owingRowMatchesSelectedExitGate,
} from "@/utils/cash/utils";

type CashierZone = {
  id: number;
  name: string;
  site_id: number;
  site_name: string;
  project_id: number;
  project_name: string;
};

type CashierMe = {
  zones: CashierZone[];
  zone_ids: number[];
  site_ids: number[];
  has_assignment: boolean;
  has_operator_wallet: boolean;
  can_pick_zone: boolean;
  uses_fixed_zones: boolean;
};

type CashierSearchHit = {
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

/**
 * What the desk needs to take cash for a stay, whether it came from plate
 * search or the active list.
 */
type DeskStay = {
  session_id: number;
  plate: string;
  fee: string;
  grace_minutes: number;
  within_paid_exit_grace?: boolean;
  at_gate?: boolean;
  parking_breakdown?: ParkingBreakdown;
};

/** Open stay in the zone that owes money right now. */
type ActiveSession = {
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

type CashierReceipt = {
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

type ZoneTariff = {
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
type ReceiptInfo = {
  sessionId: number;
  plate: string;
  amountLabel: string;
};

/** Rows shown before the desk has to ask for the rest of the list. */
const ACTIVE_PREVIEW_COUNT = 6;

/**
 * One row of the desk list. The zone worklist and the plate lookup render the
 * same card so the cashier never has to learn two layouts.
 */
type DeskRow = {
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

function plateKey(plate: string): string {
  return plate.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/** AccessRequest.device is the gate PK. Prefer device_id when a stream payload includes it. */
function accessRequestDeviceId(row: {
  device?: number;
  device_id?: number;
}): number | null {
  const id = Number(row.device_id ?? row.device);
  return Number.isFinite(id) ? id : null;
}

function cashGateStorageKey(zoneId: number) {
  return `cash:exit-gate:${zoneId}`;
}

/** Preview-only rounding. Backend `apply_cashier_discount` remains the source of truth. */
function roundMoneyHalfUp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100 + Number.EPSILON) / 100;
}

function cashierDiscountPreview(originalFee: string, percentageRaw: string) {
  const originalRaw = Number(originalFee);
  const original =
    Number.isFinite(originalRaw) && originalRaw > 0
      ? roundMoneyHalfUp(originalRaw)
      : 0;
  const trimmed = percentageRaw.trim();
  if (trimmed === "") {
    return {
      original,
      percentage: 0,
      discountAmount: 0,
      collect: original,
      hasDiscount: false,
      invalid: false,
    };
  }
  const percentage = Number(trimmed);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return {
      original,
      percentage,
      discountAmount: 0,
      collect: original,
      hasDiscount: false,
      invalid: true,
    };
  }
  if (percentage === 0) {
    return {
      original,
      percentage: 0,
      discountAmount: 0,
      collect: original,
      hasDiscount: false,
      invalid: false,
    };
  }
  let discountAmount = roundMoneyHalfUp((original * percentage) / 100);
  if (discountAmount > original) discountAmount = original;
  let collect = roundMoneyHalfUp(original - discountAmount);
  if (collect < 0) collect = 0;
  return {
    original,
    percentage,
    discountAmount,
    collect,
    hasDiscount: true,
    invalid: false,
  };
}

function rowFromActiveSession(row: ActiveSession): DeskRow {
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
function rowFromSearchHit(hit: CashierSearchHit): DeskRow {
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
function settleAmountLabel(row: AccessRequest): string | null {
  const bill = row.open_payment_intent;
  const owed = row.billable_open_session;
  const amount = bill?.amount || bill?.estimated_amount || owed?.amount;
  if (!amount) return null;
  return `${amount} ${bill?.currency || owed?.currency || ""}`.trim();
}

/**
 * Print server-rendered HTML through an isolated iframe: the dashboard
 * stylesheet would otherwise fight the 80mm till roll, and a popup window gets
 * blocked on desk browsers. The bill markup itself comes from the backend
 * (`/sessions/:id/bill/`) so cash and card paper stay byte-for-byte identical.
 */
function printHtml(html: string) {
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
    // Leave the frame long enough for the print dialog to read from it.
    window.setTimeout(() => frame.remove(), 1000);
  };
  if (frame.contentWindow?.document.readyState === "complete") run();
  else frame.onload = run;
}

export default function CashierHubPage() {
  const { canAccessCash, canDecide } = useAuth();
  const {
    projectId,
    projectName,
    projectQuery,
    ready: projectReady,
  } = useProjectFilter();
  const [me, setMe] = useState<CashierMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<CashierSearchHit[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [validateBusyId, setValidateBusyId] = useState<number | null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingByDevice, setPendingByDevice] = useState<
    Record<number, AccessRequest>
  >({});
  /** Full pending list for owing-desk matching (not collapsed to one AR per device). */
  const [pendingRows, setPendingRows] = useState<
    (AccessRequest & { device_id?: number })[]
  >([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [gatesLoading, setGatesLoading] = useState(false);
  const [arBusyId, setArBusyId] = useState<number | null>(null);
  const [paymentActionId, setPaymentActionId] = useState<number | null>(null);
  const [chargeRequest, setChargeRequest] = useState<AccessRequest | null>(
    null,
  );
  const [chargeMode, setChargeMode] = useState<
    "extend_previous" | "new_session"
  >("new_session");
  const [chargeEntryTime, setChargeEntryTime] = useState("");
  const [chargeBusy, setChargeBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AccessRequest | null>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [zonesCatalog, setZonesCatalog] = useState<Zone[]>([]);
  const [pickedSiteId, setPickedSiteId] = useState<string>("");
  const [pickedZoneId, setPickedZoneId] = useState<string>("");
  const [selectedGateId, setSelectedGateId] = useState<string>("");
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [manualDevice, setManualDevice] = useState<Device | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const [decisionRow, setDecisionRow] = useState<AccessRequest | null>(null);
  const [decisionAction, setDecisionAction] = useState<
    "approve" | "deny" | null
  >(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);
  const [printBusyId, setPrintBusyId] = useState<number | null>(null);
  const [recentReceipts, setRecentReceipts] = useState<CashierReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [tariff, setTariff] = useState<ZoneTariff | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeExpanded, setActiveExpanded] = useState(false);
  const [billSessionId, setBillSessionId] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Native window.confirm hides the amount and looks broken on desk tablets.
  const [validateTarget, setValidateTarget] = useState<
    | { kind: "session"; hit: DeskStay }
    | { kind: "request"; row: AccessRequest }
    | null
  >(null);
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [alertsOn, setAlertsOn] = useState(false);
  const [freshDeviceIds, setFreshDeviceIds] = useState<Set<number>>(
    () => new Set(),
  );
  const pendingByDeviceRef = useRef<Record<number, AccessRequest>>({});
  const knownPendingIdsRef = useRef<Set<number>>(new Set());
  const selectedGateIdRef = useRef("");
  selectedGateIdRef.current = selectedGateId;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const gatesSectionRef = useRef<HTMLElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const freshTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const loadMe = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<CashierMe>("cashier/me/");
      setMe(data);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load cashier hub",
      );
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    if (!me?.can_pick_zone) return;
    setCatalogLoading(true);
    try {
      const sitesData = await api<Paginated<Site>>("sites/", {
        query: { page_size: 200, is_active: true, ...projectQuery },
      });
      setSites(sitesData.results);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load sites",
      );
      setSites([]);
    } finally {
      setCatalogLoading(false);
    }
  }, [me?.can_pick_zone, projectQuery]);

  const toggleAlerts = useCallback(() => {
    setAlertsOn((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("cash:alerts", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) {
        try {
          const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (Ctor && !audioCtxRef.current) audioCtxRef.current = new Ctor();
          void audioCtxRef.current?.resume();
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  const playAlert = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {
      /* ignore */
    }
  }, []);

  const markFresh = useCallback((deviceId: number) => {
    setFreshDeviceIds((current) => new Set(current).add(deviceId));
    const existing = freshTimersRef.current.get(deviceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      freshTimersRef.current.delete(deviceId);
      setFreshDeviceIds((current) => {
        const next = new Set(current);
        next.delete(deviceId);
        return next;
      });
    }, 5000);
    freshTimersRef.current.set(deviceId, timer);
  }, []);

  const loadZonesForSite = useCallback(async (siteId: string) => {
    if (!siteId) {
      setZonesCatalog([]);
      return;
    }
    try {
      const zonesData = await api<Paginated<Zone> | Zone[]>("zones/", {
        query: { site: siteId, page_size: 200 },
      });
      const rows = Array.isArray(zonesData)
        ? zonesData
        : (zonesData.results ?? []);
      const active = rows.filter((z) => z.is_active !== false);
      setZonesCatalog(active);
      // Single-zone sites have nothing to choose — open the desk straight away.
      if (active.length === 1) setPickedZoneId(String(active[0].id));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load zones",
      );
      setZonesCatalog([]);
    }
  }, []);

  const activeZones = useMemo((): CashierZone[] => {
    if (!me) return [];
    if (me.has_assignment) {
      return me.zones;
    }
    if (!me.can_pick_zone || !pickedZoneId) return [];
    const zone = zonesCatalog.find((z) => String(z.id) === pickedZoneId);
    const site = sites.find((s) => String(s.id) === pickedSiteId);
    if (!zone) return [];
    return [
      {
        id: zone.id,
        name: zone.name,
        site_id: zone.site,
        site_name: zone.site_name || site?.name || "Site",
        project_id: zone.project,
        project_name: site?.project_name || "",
      },
    ];
  }, [me, pickedZoneId, pickedSiteId, zonesCatalog, sites]);

  const activeZoneIds = useMemo(
    () => activeZones.map((z) => z.id),
    [activeZones],
  );
  // Live ref so stream callbacks can reject rows outside the desk's zone even
  // if a mid-deploy backend (or an old Redis payload) forwards one.
  const activeZoneIdsRef = useRef<number[]>([]);
  activeZoneIdsRef.current = activeZoneIds;

  const rowInActiveZone = useCallback((row: { zone_id?: number | null }) => {
    const zoneId = row.zone_id;
    if (zoneId == null) return true; // Older payloads without a zone: trust the server.
    const zones = activeZoneIdsRef.current;
    return zones.length === 0 || zones.includes(Number(zoneId));
  }, []);

  const clearFresh = useCallback((deviceId: number) => {
    const existing = freshTimersRef.current.get(deviceId);
    if (existing) {
      clearTimeout(existing);
      freshTimersRef.current.delete(deviceId);
    }
    setFreshDeviceIds((current) => {
      if (!current.has(deviceId)) return current;
      const next = new Set(current);
      next.delete(deviceId);
      return next;
    });
  }, []);

  /** Seed the board without alerting — used by the snapshot frame and resyncs. */
  const applyPendingRows = useCallback(
    (rows: (AccessRequest & { device_id?: number })[]) => {
      const scoped = rows.filter((row) => rowInActiveZone(row));
      const withDevice: (AccessRequest & { device_id?: number })[] = [];
      const next: Record<number, AccessRequest> = {};
      for (const row of scoped) {
        const deviceId = Number(row.device_id ?? row.device);
        if (!Number.isFinite(deviceId)) continue;
        withDevice.push(row);
        if (!next[deviceId]) next[deviceId] = row;
      }
      knownPendingIdsRef.current = new Set(withDevice.map((row) => row.id));
      pendingByDeviceRef.current = next;
      setPendingByDevice(next);
      setPendingRows(withDevice);
    },
    [rowInActiveZone],
  );

  const upsertPendingRow = useCallback(
    (row: AccessRequest & { device_id?: number }) => {
      if (!rowInActiveZone(row)) return;
      const deviceId = Number(row.device_id ?? row.device);
      if (!Number.isFinite(deviceId)) return;
      const isNew = !knownPendingIdsRef.current.has(row.id);
      knownPendingIdsRef.current.add(row.id);
      setPendingByDevice((current) => {
        const next = { ...current, [deviceId]: row };
        pendingByDeviceRef.current = next;
        return next;
      });
      setPendingRows((current) => {
        const index = current.findIndex((item) => item.id === row.id);
        if (index >= 0) {
          const next = [...current];
          next[index] = row;
          return next;
        }
        return [...current, row];
      });
      if (!isNew) return;
      const selected = Number(selectedGateIdRef.current);
      if (
        !Number.isFinite(selected) ||
        accessRequestDeviceId(row) !== selected
      ) {
        return;
      }
      markFresh(deviceId);
      if (alertsOn) playAlert();
      toast.info(`${row.plate} is waiting at a gate`);
      if (typeof document !== "undefined" && document.hidden) {
        const count = Object.keys(pendingByDeviceRef.current).length || 1;
        document.title = `(${count}) Vehicle waiting`;
      }
    },
    [alertsOn, markFresh, playAlert, rowInActiveZone],
  );

  const removePendingRow = useCallback(
    (row: { id: number; device_id?: number; device?: number }) => {
      knownPendingIdsRef.current.delete(row.id);
      const deviceKey = Number(row.device_id ?? row.device);
      const cleared: number[] = [];
      setPendingRows((current) => current.filter((item) => item.id !== row.id));
      setPendingByDevice((current) => {
        const next = { ...current };
        if (Number.isFinite(deviceKey)) {
          const existing = next[deviceKey];
          if (!existing || existing.id === row.id) {
            delete next[deviceKey];
            cleared.push(deviceKey);
          }
        } else {
          for (const [deviceId, ar] of Object.entries(next)) {
            if (ar.id === row.id) {
              delete next[Number(deviceId)];
              cleared.push(Number(deviceId));
            }
          }
        }
        pendingByDeviceRef.current = next;
        return next;
      });
      for (const deviceId of cleared) clearFresh(deviceId);
    },
    [clearFresh],
  );

  const loadPending = useCallback(async () => {
    if (!activeZoneIds.length) {
      applyPendingRows([]);
      return;
    }
    try {
      const arPages = await Promise.all(
        activeZoneIds.map((zoneId) =>
          api<Paginated<AccessRequest>>("access-requests/", {
            query: { zone: zoneId, status: "pending", page_size: 100 },
          }),
        ),
      );
      applyPendingRows(arPages.flatMap((page) => page.results));
    } catch {
      /* stream reconnect will resync */
    }
  }, [activeZoneIds, applyPendingRows]);

  const loadGates = useCallback(async () => {
    if (!activeZoneIds.length) {
      setDevices([]);
      applyPendingRows([]);
      return;
    }
    setGatesLoading(true);
    try {
      const devicePages = await Promise.all(
        activeZoneIds.map((zoneId) =>
          api<Paginated<Device>>("devices/", {
            query: { zone: zoneId, page_size: 100 },
          }),
        ),
      );
      const deviceMap = new Map<number, Device>();
      for (const page of devicePages) {
        for (const row of page.results) deviceMap.set(row.id, row);
      }
      setDevices([...deviceMap.values()].sort((a, b) => a.id - b.id));
      await loadPending();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load zone gates",
      );
      setDevices([]);
      applyPendingRows([]);
    } finally {
      setGatesLoading(false);
    }
  }, [activeZoneIds, applyPendingRows, loadPending]);

  const loadReceipts = useCallback(async () => {
    if (!activeZoneIds.length) {
      setRecentReceipts([]);
      return;
    }
    setReceiptsLoading(true);
    try {
      const pages = await Promise.all(
        activeZoneIds.map((zoneId) =>
          api<{ results: CashierReceipt[] }>("cashier/receipts/", {
            query: { zone: zoneId, limit: 7 },
          }),
        ),
      );
      const byId = new Map<number, CashierReceipt>();
      for (const page of pages) {
        for (const row of page.results) byId.set(row.session_id, row);
      }
      setRecentReceipts(
        [...byId.values()]
          .sort((a, b) =>
            (b.paid_at || "").localeCompare(a.paid_at || ""),
          )
          .slice(0, 7),
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load receipts",
      );
      setRecentReceipts([]);
    } finally {
      setReceiptsLoading(false);
    }
  }, [activeZoneIds]);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  const loadActiveSessions = useCallback(async () => {
    const zoneIds = new Set(activeZoneIds);
    const gateId = selectedGateIdRef.current;
    if (gateId) {
      const gate = devices.find(
        (device) =>
          String(device.id) === gateId &&
          device.type === "exit" &&
          device.enabled !== false,
      );
      if (gate?.zone != null && Number.isFinite(Number(gate.zone))) {
        zoneIds.add(Number(gate.zone));
      }
    }
    const fetchZoneIds = [...zoneIds];
    if (!fetchZoneIds.length) {
      setActiveSessions([]);
      return;
    }
    setActiveLoading(true);
    try {
      const pages = await Promise.all(
        fetchZoneIds.map((zoneId) =>
          api<{ results: ActiveSession[] }>("cashier/active-sessions/", {
            query: { zone: zoneId, limit: 25 },
          }),
        ),
      );
      const byId = new Map<number, ActiveSession>();
      for (const page of pages) {
        for (const row of page.results) byId.set(row.session_id, row);
      }
      setActiveSessions([...byId.values()]);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Failed to load active sessions",
      );
      setActiveSessions([]);
    } finally {
      setActiveLoading(false);
    }
  }, [activeZoneIds, devices]);

  useEffect(() => {
    void loadActiveSessions();
  }, [loadActiveSessions, selectedGateId]);

  // Fees grow with every hour parked, so the desk must never quote a stale
  // amount. Re-price the list on a slow timer instead of on every render.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
      void loadActiveSessions();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loadActiveSessions]);

  const loadTariff = useCallback(async () => {
    if (activeZoneIds.length !== 1) {
      setTariff(null);
      return;
    }
    try {
      const data = await api<ZoneTariff>("cashier/zone-tariff/", {
        query: { zone: activeZoneIds[0] },
      });
      setTariff(data?.zone_id ? data : null);
    } catch {
      // Tariff is reference info — never block the desk on it.
      setTariff(null);
    }
  }, [activeZoneIds]);

  useEffect(() => {
    void loadTariff();
  }, [loadTariff]);

  useEffect(() => {
    if (!canAccessCash) return;
    void loadMe();
  }, [canAccessCash, loadMe]);

  useEffect(() => {
    try {
      setAlertsOn(window.localStorage.getItem("cash:alerts") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!projectReady) return;
    void loadCatalog();
  }, [projectReady, loadCatalog]);

  useEffect(() => {
    if (!me?.can_pick_zone) return;
    setPickedSiteId("");
    setPickedZoneId("");
    setSelectedGateId("");
    setZonesCatalog([]);
    setHits([]);
    setSearchedQuery("");
  }, [projectId, me?.can_pick_zone]);

  useEffect(() => {
    void loadZonesForSite(pickedSiteId);
    setPickedZoneId("");
    setSelectedGateId("");
    setHits([]);
    setSearchedQuery("");
  }, [pickedSiteId, loadZonesForSite]);

  useEffect(() => {
    void loadGates();
  }, [loadGates]);

  const exitGates = useMemo(
    () =>
      devices
        .filter((device) => device.type === "exit" && device.enabled !== false)
        .sort((a, b) => gateLabel(a).localeCompare(gateLabel(b))),
    [devices],
  );

  const selectedGateDevice = useMemo(
    () =>
      exitGates.find((device) => String(device.id) === selectedGateId) ?? null,
    [exitGates, selectedGateId],
  );

  const deskZoneId = selectedGateDevice?.zone ?? activeZoneIds[0] ?? null;

  useEffect(() => {
    if (!deskZoneId) {
      setSelectedGateId("");
      return;
    }
    setSelectedGateId((current) => {
      if (
        current &&
        exitGates.some((device) => String(device.id) === current)
      ) {
        return current;
      }
      let stored = "";
      try {
        stored =
          window.localStorage.getItem(cashGateStorageKey(deskZoneId)) || "";
      } catch {
        /* ignore */
      }
      if (stored && exitGates.some((device) => String(device.id) === stored)) {
        return stored;
      }
      if (exitGates.length === 1) return String(exitGates[0].id);
      return "";
    });
  }, [deskZoneId, exitGates]);

  function persistSelectedGate(deviceId: string) {
    setSelectedGateId(deviceId);
    if (!deskZoneId) return;
    try {
      window.localStorage.setItem(cashGateStorageKey(deskZoneId), deviceId);
    } catch {
      /* ignore */
    }
  }

  const loadPendingRef = useRef(loadPending);
  loadPendingRef.current = loadPending;
  const applyPendingRowsRef = useRef(applyPendingRows);
  applyPendingRowsRef.current = applyPendingRows;
  const upsertPendingRowRef = useRef(upsertPendingRow);
  upsertPendingRowRef.current = upsertPendingRow;
  const removePendingRowRef = useRef(removePendingRow);
  removePendingRowRef.current = removePendingRow;

  const zoneStreamKey = activeZoneIds.join(",");

  // Live gates over SSE, scoped to the desk's zones (same stream as gate control).
  useEffect(() => {
    if (!zoneStreamKey) {
      setStreamStatus("idle");
      return;
    }
    const zoneIds = zoneStreamKey.split(",").map(Number);
    let closed = false;
    let abort: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleResync(delayMs = 800) {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        if (!closed) void loadPendingRef.current();
      }, delayMs);
    }

    function handleEvent(event: string, raw: string) {
      try {
        if (event === "snapshot") {
          const data = JSON.parse(raw) as {
            pending_requests: (AccessRequest & { device_id?: number })[];
          };
          applyPendingRowsRef.current(data.pending_requests || []);
          setStreamStatus("live");
          return;
        }
        if (event === "ping") {
          setStreamStatus("live");
          return;
        }
        if (event === "access_request.pending") {
          upsertPendingRowRef.current(
            JSON.parse(raw) as AccessRequest & { device_id?: number },
          );
          setStreamStatus("live");
          return;
        }
        if (event === "access_request.removed") {
          removePendingRowRef.current(
            JSON.parse(raw) as {
              id: number;
              device_id?: number;
              device?: number;
            },
          );
          setStreamStatus("live");
        }
      } catch {
        /* ignore malformed frames */
      }
    }

    async function connect() {
      const token = getAccessToken();
      if (!token) {
        setStreamStatus("idle");
        return;
      }

      abort?.abort();
      abort = new AbortController();
      setStreamStatus("connecting");

      try {
        const res = await fetch(accessRequestStreamUrl(token, { zoneIds }), {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          signal: abort.signal,
          cache: "no-store",
        });

        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = consumeSseBuffer(buffer, handleEvent);
        }

        if (!closed) {
          setStreamStatus("offline");
          scheduleResync(500);
        }
      } catch (err) {
        if (
          closed ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setStreamStatus("offline");
        scheduleResync(800);
      }

      if (!closed) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (!closed) void connect();
        }, 1500);
      }
    }

    void connect();

    return () => {
      closed = true;
      abort?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (resyncTimer) clearTimeout(resyncTimer);
      setStreamStatus("idle");
    };
  }, [zoneStreamKey]);

  useEffect(() => {
    const timers = freshTimersRef.current;
    const originalTitle = document.title;
    function clearTitle() {
      if (!document.hidden) document.title = originalTitle;
    }
    document.addEventListener("visibilitychange", clearTitle);
    return () => {
      document.removeEventListener("visibilitychange", clearTitle);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      document.title = originalTitle;
    };
  }, []);

  /**
   * Plate lookup across every open stay in the zone, including the free and
   * already-paid ones the worklist leaves out. Runs silently while typing, so
   * it only speaks up when the cashier asked for it explicitly.
   */
  const runLookup = useCallback(
    async (raw: string, { announce = false }: { announce?: boolean } = {}) => {
      const q = raw.trim();
      if (q.length < 2 || !activeZoneIds.length) return;
      setSearching(true);
      try {
        const pages = await Promise.all(
          activeZoneIds.map((zoneId) =>
            api<{ query: string; results: CashierSearchHit[] }>(
              "cashier/search/",
              { query: { q, limit: 8, zone: zoneId } },
            ),
          ),
        );
        const byKey = new Map<string, CashierSearchHit>();
        for (const page of pages) {
          for (const row of page.results) {
            byKey.set(`${row.session_id ?? row.plate}-${row.zone_id ?? ""}`, row);
          }
        }
        const results = [...byKey.values()];
        setHits(results);
        setSearchedQuery(pages[0]?.query || plateKey(q));
        if (announce && results.length === 0) {
          toast.message("No on-site matches in this zone");
        }
      } catch (err) {
        if (announce) {
          toast.error(err instanceof ApiError ? err.message : "Search failed");
        }
        setHits([]);
        setSearchedQuery(plateKey(q));
      } finally {
        setSearching(false);
      }
    },
    [activeZoneIds],
  );

  async function onSearch(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      toast.error("Enter at least 2 characters");
      return;
    }
    if (!activeZoneIds.length) {
      toast.error("Select a zone first");
      return;
    }
    await runLookup(q, { announce: true });
  }

  /** Fetch the shared session bill HTML and drop it straight into the printer. */
  const printSessionBill = useCallback(async (sessionId: number) => {
    setPrintBusyId(sessionId);
    try {
      const html = await apiText(`sessions/${sessionId}/bill/`);
      printHtml(html);
    } catch (err) {
      // Settling already succeeded — a missing bill must not read as a failure.
      toast.message(
        err instanceof ApiError
          ? `Bill unavailable · ${err.message}`
          : "Bill unavailable",
      );
    } finally {
      setPrintBusyId(null);
    }
  }, []);

  async function validateSession(hit: DeskStay) {
    const preview = cashierDiscountPreview(hit.fee, discountPercentage);
    if (preview.invalid) {
      toast.error("Discount must be between 0 and 100");
      return;
    }
    const reason = discountReason.trim();
    if (preview.hasDiscount && !reason) {
      toast.error("A reason is required when applying a discount");
      return;
    }
    setValidateBusyId(hit.session_id);
    try {
      const body: {
        note: string;
        discount_percentage?: string;
        discount_reason?: string;
      } = { note: "Validated at cashier desk" };
      if (preview.hasDiscount) {
        body.discount_percentage = String(preview.percentage);
        body.discount_reason = reason;
      }
      await api(`sessions/${hit.session_id}/cashier-validate/`, {
        method: "POST",
        body,
      });
      toast.success(
        `${hit.plate} paid · leave within ${hit.grace_minutes || "grace"} min`,
      );
      setValidateTarget(null);
      setReceipt({
        sessionId: hit.session_id,
        plate: hit.plate,
        amountLabel: formatMoney(preview.collect),
      });
      await onSearch();
      void loadPending();
      void loadReceipts();
      void loadActiveSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Validate failed");
    } finally {
      setValidateBusyId(null);
    }
  }

  function openDecision(row: AccessRequest, action: "approve" | "deny") {
    setDecisionRow(row);
    setDecisionAction(action);
    setDecisionNote("");
  }

  function closeDecision() {
    setDecisionRow(null);
    setDecisionAction(null);
    setDecisionNote("");
  }

  async function submitDecision() {
    if (!decisionRow || !decisionAction) return;
    const note = decisionNote.trim();
    if (!note) {
      toast.error("Write a note before deciding");
      return;
    }
    setArBusyId(decisionRow.id);
    try {
      await api(`access-requests/${decisionRow.id}/${decisionAction}/`, {
        method: "POST",
        body: {
          note,
          exempted: false,
        },
      });
      toast.success(
        decisionAction === "approve" ? "Approved · gate pulsed" : "Denied",
      );
      closeDecision();
      void loadPending();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Decision failed");
    } finally {
      setArBusyId(null);
    }
  }

  async function validateAr(row: AccessRequest) {
    setArBusyId(row.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/validate-payment/`,
        {
          method: "POST",
          body: { note: "Validated payment via cashier hub" },
        },
      );
      toast.success("Payment validated · gate opened");
      setValidateTarget(null);
      if (updated.linked_session_id) {
        setReceipt({
          sessionId: updated.linked_session_id,
          plate: updated.plate,
          amountLabel:
            settleAmountLabel(row) ?? settleAmountLabel(updated) ?? "",
        });
      }
      void loadPending();
      void loadReceipts();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Validate failed");
    } finally {
      setArBusyId(null);
    }
  }

  async function unmatchAr(row: AccessRequest) {
    setArBusyId(row.id);
    try {
      await api(`access-requests/${row.id}/unmatch-session/`, {
        method: "POST",
      });
      toast.success("Match undone");
      void loadPending();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not undo match",
      );
    } finally {
      setArBusyId(null);
    }
  }

  /** Kiosk billing — same actions as Gate Control, scoped to cashier zones. */
  function openChargeAtKiosk(row: AccessRequest) {
    if (row.billable_open_session || row.open_payment_intent) {
      toast.message(
        row.open_payment_intent
          ? "A bill is already on the kiosk — cancel or update it instead"
          : "Use Resend bill for this unpaid open session",
      );
      return;
    }
    setChargeRequest(row);
    setChargeMode(row.can_extend_previous ? "extend_previous" : "new_session");
    setChargeEntryTime("");
  }

  async function cancelBill(row: AccessRequest) {
    setPaymentActionId(row.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/cancel-bill/`,
        { method: "POST" },
      );
      upsertPendingRow(updated);
      setCancelTarget(null);
      const amount = updated.billable_open_session
        ? `${updated.billable_open_session.amount} ${updated.billable_open_session.currency}`
        : null;
      toast.success("Bill cancelled — kiosk idle", {
        description: amount
          ? `Session still open. Resend ${amount} when ready.`
          : "Session still open.",
        action: updated.billable_open_session
          ? {
              label: "Resend",
              onClick: () => {
                void sendBill(updated);
              },
            }
          : undefined,
        duration: 12000,
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not cancel kiosk bill",
      );
    } finally {
      setPaymentActionId(null);
    }
  }

  /**
   * Push an active stay's bill to the kiosk it is queued at. Only cars already
   * waiting at a gate have a kiosk to receive the bill.
   */
  async function sendBillForSession(row: DeskRow, accessRequestId: number) {
    setBillSessionId(row.session_id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${accessRequestId}/send-bill/`,
        { method: "POST" },
      );
      upsertPendingRow(updated);
      const bill = updated.open_payment_intent;
      toast.success(
        bill
          ? `Bill on kiosk · ${bill.amount} ${bill.currency}`
          : `Bill sent to ${row.gate_label ?? "kiosk"}`,
      );
      void loadActiveSessions();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not send the bill",
      );
    } finally {
      setBillSessionId(null);
    }
  }

  async function sendBill(row: AccessRequest) {
    setPaymentActionId(row.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/send-bill/`,
        { method: "POST" },
      );
      upsertPendingRow(updated);
      const bill = updated.open_payment_intent;
      const prev = row.billable_open_session?.previous_amount;
      const drifted = bill && amountsDiffer(prev, bill.amount);
      toast.success(
        bill
          ? `Bill on kiosk · ${bill.amount} ${bill.currency}`
          : "Bill sent to kiosk",
        drifted && prev
          ? { description: `Was ${prev}, now ${bill.amount}` }
          : undefined,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not resend the bill",
      );
    } finally {
      setPaymentActionId(null);
    }
  }

  async function refreshBill(row: AccessRequest) {
    setPaymentActionId(row.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/refresh-bill/`,
        { method: "POST" },
      );
      upsertPendingRow(updated);
      const bill = updated.open_payment_intent;
      toast.success(
        bill
          ? `Amount updated · ${bill.amount} ${bill.currency}`
          : "Bill amount updated",
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not update bill amount",
      );
    } finally {
      setPaymentActionId(null);
    }
  }

  async function submitChargeAtKiosk() {
    if (!chargeRequest) return;
    if (chargeMode === "new_session" && !chargeEntryTime) {
      toast.error("Entry time is required for a new session");
      return;
    }
    setChargeBusy(true);
    setPaymentActionId(chargeRequest.id);
    try {
      await api(`access-requests/${chargeRequest.id}/charge-at-kiosk/`, {
        method: "POST",
        body: {
          mode: chargeMode,
          ...(chargeMode === "new_session"
            ? { entry_time: new Date(chargeEntryTime).toISOString() }
            : {}),
        },
      });
      toast.success("Bill sent to exit kiosk");
      setChargeRequest(null);
      setChargeEntryTime("");
      void loadPending();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not create kiosk bill",
      );
    } finally {
      setChargeBusy(false);
      setPaymentActionId(null);
    }
  }

  async function submitManualPlate() {
    if (!manualDevice) return;
    const plate = manualPlate.trim();
    if (!plate) {
      toast.error("Enter a plate number");
      return;
    }
    setManualBusy(true);
    try {
      const result = await api<{
        granted: boolean;
        access_request: AccessRequest | null;
        event_id: number | null;
      }>("access-requests/manual/", {
        method: "POST",
        body: {
          device_id: manualDevice.id,
          plate,
          note: manualNote || "Manual entry from cashier desk",
          exempted: false,
        },
      });
      toast.success(result.granted ? "Gate opened" : "Processed");
      setManualDevice(null);
      setManualPlate("");
      setManualNote("");
      void loadPending();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Manual entry failed",
      );
    } finally {
      setManualBusy(false);
    }
  }

  const selectedGateNumeric = selectedGateId ? Number(selectedGateId) : null;
  const gateFilterReady =
    selectedGateNumeric != null && Number.isFinite(selectedGateNumeric);

  const requestOnSelectedGate = useCallback(
    (row: AccessRequest) => {
      if (!gateFilterReady) return false;
      return accessRequestDeviceId(row) === selectedGateNumeric;
    },
    [gateFilterReady, selectedGateNumeric],
  );

  const pendingOnSelectedGate = useMemo(
    () => Object.values(pendingByDevice).filter(requestOnSelectedGate),
    [pendingByDevice, requestOnSelectedGate],
  );

  const zonesWithDevices = useMemo(() => {
    return activeZones.map((zone) => {
      const zoneDevices = devices.filter((d) => {
        if (d.zone !== zone.id) return false;
        if (!gateFilterReady) return false;
        return d.id === selectedGateNumeric;
      });
      return {
        zone,
        entries: zoneDevices.filter((d) => d.type !== "exit"),
        exits: zoneDevices.filter((d) => d.type === "exit"),
        waiting: zoneDevices.filter((d) => pendingByDevice[d.id]).length,
      };
    });
  }, [
    activeZones,
    devices,
    pendingByDevice,
    gateFilterReady,
    selectedGateNumeric,
  ]);

  const hubReady = Boolean(me && activeZoneIds.length > 0);
  const waitingCount = useMemo(
    () => zonesWithDevices.reduce((total, zone) => total + zone.waiting, 0),
    [zonesWithDevices],
  );

  // Exits the cashier can settle with cash right now — the desk's hot path.
  // Oldest first so the car that's been blocking the lane clears soonest.
  const settleQueue = useMemo(() => {
    return pendingOnSelectedGate
      .filter((row) => row.can_validate_payment)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [pendingOnSelectedGate]);

  // Live kiosk bills the desk may need to fix: on the kiosk, or owed but unsent.
  const billQueue = useMemo(() => {
    return pendingOnSelectedGate
      .filter((row) => !row.can_validate_payment)
      .filter((row) => row.open_payment_intent || row.billable_open_session)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [pendingOnSelectedGate]);

  // Whatever is left only needs a plain approve/deny at the gate.
  const needsAttentionCount = Math.max(
    0,
    waitingCount - settleQueue.length - billQueue.length,
  );

  /** Live gate queue indexed both ways so any desk row can find its request. */
  const { pendingById, pendingByPlate } = useMemo(() => {
    const byId: Record<number, AccessRequest> = {};
    const byPlate: Record<string, AccessRequest> = {};
    Object.values(pendingByDevice).forEach((row) => {
      byId[row.id] = row;
      byPlate[plateKey(row.plate)] = row;
    });
    return { pendingById: byId, pendingByPlate: byPlate };
  }, [pendingByDevice]);

  const gateRequestFor = useCallback(
    (row: DeskRow): AccessRequest | undefined =>
      pendingByPlate[plateKey(row.plate)] ??
      (row.access_request_id ? pendingById[row.access_request_id] : undefined),
    [pendingByPlate, pendingById],
  );

  /**
   * Desk validate marks the stay paid and starts the exit grace, but it does
   * not pulse a barrier. A car already queued at a gate must be settled
   * through its exit request so the gate actually opens.
   */
  const takeCashForRow = useCallback(
    (row: DeskRow) => {
      const gateRequest = gateRequestFor(row);
      if (gateRequest?.can_validate_payment) {
        setValidateTarget({ kind: "request", row: gateRequest });
        return;
      }
      setValidateTarget({
        kind: "session",
        hit: { ...row, at_gate: Boolean(gateRequest) },
      });
    },
    [gateRequestFor],
  );

  /**
   * Longest stays first: they owe the most and leave soonest.
   * Pending exit ARs are kept when they belong to the selected exit device;
   * they are no longer stripped just because they also sit in settle/bill.
   */
  const sortedActiveSessions = useMemo(() => {
    return activeSessions
      .filter((row) =>
        owingRowMatchesSelectedExitGate(
          row,
          gateFilterReady ? selectedGateDevice : null,
          pendingRows,
        ),
      )
      .sort((a, b) => {
        if (a.at_gate !== b.at_gate) return a.at_gate ? -1 : 1;
        return a.start_time.localeCompare(b.start_time);
      });
  }, [
    activeSessions,
    pendingRows,
    gateFilterReady,
    selectedGateDevice,
  ]);

  const normalizedQuery = useMemo(() => plateKey(query), [query]);

  const localMatches = useMemo(() => {
    if (!normalizedQuery) return sortedActiveSessions;
    return sortedActiveSessions.filter((row) =>
      plateKey(row.plate).includes(normalizedQuery),
    );
  }, [sortedActiveSessions, normalizedQuery]);

  // Typing narrows the worklist. Only when nothing in it matches do we ask the
  // server, which also sees the stays the worklist hides  free and paid ones.
  const usingLookup = Boolean(normalizedQuery) && localMatches.length === 0;

  // Hits are only trustworthy once they belong to the plate on screen.
  const lookupSettled = searchedQuery === normalizedQuery;

  const deskRows: DeskRow[] = useMemo(() => {
    const rows = usingLookup
      ? lookupSettled
        ? hits.map(rowFromSearchHit)
        : []
      : localMatches.map(rowFromActiveSession);
    return rows.filter((row) =>
      owingRowMatchesSelectedExitGate(
        row,
        gateFilterReady ? selectedGateDevice : null,
        pendingRows,
      ),
    );
  }, [
    usingLookup,
    lookupSettled,
    hits,
    localMatches,
    pendingRows,
    gateFilterReady,
    selectedGateDevice,
  ]);

  const lookupPending = usingLookup && (searching || !lookupSettled);

  const visibleDeskRows =
    normalizedQuery || activeExpanded
      ? deskRows
      : deskRows.slice(0, ACTIVE_PREVIEW_COUNT);

  const activeOwedTotal = useMemo(() => {
    const total = sortedActiveSessions.reduce(
      (sum, row) => sum + (Number(row.fee) || 0),
      0,
    );
    return total > 0 ? formatMoney(total, tariff?.currency ?? "SAR") : null;
  }, [sortedActiveSessions, tariff?.currency]);

  useEffect(() => {
    setDiscountPercentage("");
    setDiscountReason("");
  }, [validateTarget]);

  useEffect(() => {
    if (!usingLookup || normalizedQuery.length < 2) return;
    const timer = window.setTimeout(() => void runLookup(normalizedQuery), 300);
    return () => window.clearTimeout(timer);
  }, [usingLookup, normalizedQuery, runLookup]);

  const focusSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const dialogOpen = Boolean(
    validateTarget ||
    receipt ||
    decisionRow ||
    cancelTarget ||
    chargeRequest ||
    manualDevice,
  );

  const sessionDiscountBlocked =
    validateTarget?.kind === "session" &&
    (() => {
      const preview = cashierDiscountPreview(
        validateTarget.hit.fee,
        discountPercentage,
      );
      return preview.invalid || (preview.hasDiscount && !discountReason.trim());
    })();

  // Plate entry is the desk's primary job — keep it one keystroke away.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      // Post-settle receipt: P prints, Enter / Esc dismisses.
      if (receipt) {
        if (key === "p" && !typingElsewhere) {
          event.preventDefault();
          void printSessionBill(receipt.sessionId);
          return;
        }
        if (
          (key === "Enter" || key === "Escape") &&
          !typingElsewhere &&
          printBusyId == null
        ) {
          event.preventDefault();
          setReceipt(null);
          return;
        }
        return;
      }

      // Cash confirm dialog: Enter confirms (button is autoFocused), Esc cancels.
      if (validateTarget) {
        if (key === "Escape" && validateBusyId == null && arBusyId == null) {
          event.preventDefault();
          setValidateTarget(null);
        }
        return;
      }

      if (dialogOpen) return;

      if (key === "/" && !typingElsewhere) {
        event.preventDefault();
        focusSearch();
        return;
      }

      // C — take cash on the oldest waiting exit, else the top desk row.
      if (key === "c" && !typingElsewhere) {
        const firstSettle = settleQueue[0];
        if (firstSettle) {
          event.preventDefault();
          setValidateTarget({ kind: "request", row: firstSettle });
          return;
        }
        const row = visibleDeskRows.find(
          (candidate) =>
            candidate.can_validate && !candidate.within_paid_exit_grace,
        );
        if (row) {
          event.preventDefault();
          takeCashForRow(row);
        }
        return;
      }

      // P — reprint the newest receipt in the zone.
      if (key === "p" && !typingElsewhere && recentReceipts[0]) {
        event.preventDefault();
        void printSessionBill(recentReceipts[0].session_id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    arBusyId,
    dialogOpen,
    focusSearch,
    printBusyId,
    printSessionBill,
    receipt,
    recentReceipts,
    settleQueue,
    takeCashForRow,
    validateBusyId,
    validateTarget,
    visibleDeskRows,
  ]);

  function clearSearch() {
    setQuery("");
    setHits([]);
    setSearchedQuery("");
    focusSearch();
  }

  if (!canAccessCash) {
    return (
      <EmptyState
        icon={Banknote}
        title="Cashier hub unavailable"
        description="You need a cashier zone assignment, Control Room access, or an operator wallet."
      />
    );
  }

  if (loading) {
    return <Loader label="Opening cashier hub…" />;
  }

  if (!me?.has_assignment && !me?.can_pick_zone) {
    return (
      <EmptyState
        icon={Banknote}
        title="No cashier zones assigned"
        description="Ask an admin to assign your user to one or more zones, or assign you an operator wallet so you can pick a site and zone."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-4xl border bg-card shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 brand-hero-mesh"
        />
        <div className="relative space-y-5 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Banknote className="size-5 text-primary" />
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Cash
                </h1>
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Take cash before a car reaches the gate and it can exit within
                the grace window. Waiting exits open the gate immediately. Type
                a plate to narrow the list — it falls back to every on-site stay
                when nothing here owes money.
              </p>
            </div>
            {me?.has_assignment ? (
              <div className="flex flex-wrap justify-end gap-2">
                {me.zones.map((zone) => (
                  <Badge
                    key={zone.id}
                    variant="outline"
                    className="font-normal"
                  >
                    {zone.site_name} · {zone.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          {me?.can_pick_zone ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Project workspace
                </p>
                <Badge variant="outline">{projectName || "All projects"}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Site
                  </label>
                  <Select
                    value={pickedSiteId || undefined}
                    onValueChange={setPickedSiteId}
                    disabled={catalogLoading}
                  >
                    <SelectTrigger className="h-11 rounded-xl bg-background/90">
                      <SelectValue
                        placeholder={
                          catalogLoading ? "Loading sites…" : "Select site"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={String(site.id)}>
                          {site.name}
                          {site.project_name ? ` · ${site.project_name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Zone
                  </label>
                  <Select
                    value={pickedZoneId || undefined}
                    onValueChange={(value) => {
                      setPickedZoneId(value);
                      setSelectedGateId("");
                      setHits([]);
                      setSearchedQuery("");
                    }}
                    disabled={!pickedSiteId || zonesCatalog.length === 0}
                  >
                    <SelectTrigger className="h-11 rounded-xl bg-background/90">
                      <SelectValue
                        placeholder={
                          !pickedSiteId
                            ? "Select a site first"
                            : zonesCatalog.length === 0
                              ? "No zones on this site"
                              : "Select zone"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {zonesCatalog.map((zone) => (
                        <SelectItem key={zone.id} value={String(zone.id)}>
                          {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}

          {hubReady ? (
            <div className="space-y-1.5 sm:max-w-sm">
              <label className="text-xs font-medium text-muted-foreground">
                Exit gate
              </label>
              {exitGates.length === 0 ? (
                <p className="rounded-xl border bg-background/90 px-3 py-2.5 text-sm text-muted-foreground">
                  No gates available.
                </p>
              ) : (
                <Select
                  value={selectedGateId || undefined}
                  onValueChange={persistSelectedGate}
                >
                  <SelectTrigger className="h-11 rounded-xl bg-background/90">
                    <SelectValue placeholder="Select exit gate" />
                  </SelectTrigger>
                  <SelectContent>
                    {exitGates.map((device) => (
                      <SelectItem key={device.id} value={String(device.id)}>
                        {gateLabel(device)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}

          {tariff ? (
            <dl className="flex flex-wrap items-stretch gap-2">
              <div className="min-w-30 flex-1 rounded-xl border bg-background/70 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Zone
                </dt>
                <dd className="truncate text-sm font-semibold">
                  {tariff.zone_name}
                </dd>
              </div>
              <div className="min-w-30 flex-1 rounded-xl border bg-background/70 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Rate / hour
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {tariff.pricing_configured
                    ? `${tariff.price} ${tariff.currency}`
                    : "Not configured"}
                </dd>
              </div>
              {tariff.pricing_configured &&
              tariff.additional_fee &&
              Number(tariff.additional_fee) > 0 ? (
                <div className="min-w-30 flex-1 rounded-xl border bg-background/70 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Extra fee
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {tariff.additional_fee} {tariff.currency}
                  </dd>
                </div>
              ) : null}
              {tariff.pricing_configured ? (
                <div className="min-w-30 flex-1 rounded-xl border bg-background/70 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    First hour
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {tariff.first_hour_total} {tariff.currency}
                  </dd>
                </div>
              ) : null}
              <div className="min-w-30 flex-1 rounded-xl border bg-background/70 px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Exit grace
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {tariff.grace_minutes} min
                </dd>
              </div>
            </dl>
          ) : null}

          <form onSubmit={onSearch} className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Escape") clearSearch();
              }}
              placeholder="Filter by plate…"
              className={cn(
                "h-14 rounded-2xl border-0 bg-background/90 pl-12 text-lg font-semibold tracking-wide shadow-sm focus-visible:ring-2",
                query ? "pr-40" : "pr-28",
              )}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              inputMode="search"
              enterKeyHint="search"
              disabled={!activeZoneIds.length}
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {query ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-xl text-muted-foreground"
                  onClick={clearSearch}
                  aria-label="Clear plate search"
                >
                  <X className="size-4" />
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={searching || !activeZoneIds.length}
                className="h-10 rounded-xl px-4"
              >
                {searching ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Search all
              </Button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
              /
            </kbd>{" "}
            filter ·{" "}
            <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
              C
            </kbd>{" "}
            take cash ·{" "}
            <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
              P
            </kbd>{" "}
            print last receipt ·{" "}
            <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
              Esc
            </kbd>{" "}
            clear
          </p>
        </div>
      </section>

      {settleQueue.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Ready to take cash
            </h2>
            <Badge variant="warning" className="tabular-nums">
              {settleQueue.length}
            </Badge>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {settleQueue.map((row) => {
              const amount = settleAmountLabel(row);
              const busy = arBusyId === row.id;
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-card p-4 shadow-sm ring-1 ring-primary/5 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-2xl font-bold leading-none tracking-wider">
                        {row.plate}
                      </p>
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">
                        {row.zone_name ? `${row.zone_name} · ` : ""}
                        {row.device_label}
                      </p>
                    </div>
                    <WaitTime createdAt={row.created_at} />
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Collect
                      </p>
                      <p className="text-2xl font-bold tabular-nums">
                        {amount ?? "—"}
                      </p>
                    </div>
                    <Button
                      size="lg"
                      className="h-12 gap-2 px-5 text-base"
                      disabled={busy}
                      onClick={() =>
                        setValidateTarget({ kind: "request", row })
                      }
                    >
                      {busy ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <Banknote className="size-5" />
                      )}
                      Cash received
                      <kbd className="ml-1 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold">
                        C
                      </kbd>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {billQueue.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Kiosk bills
            </h2>
            <Badge variant="outline" className="tabular-nums">
              {billQueue.length}
            </Badge>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {billQueue.map((row) => {
              const bill = row.open_payment_intent;
              const owed = row.billable_open_session;
              const busy = paymentActionId === row.id;
              const drifted =
                bill && amountsDiffer(bill.amount, bill.estimated_amount);
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-lg font-semibold tracking-wider">
                        {row.plate}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.zone_name ? `${row.zone_name} · ` : ""}
                        {row.device_label}
                      </p>
                    </div>
                    {bill ? (
                      <Badge variant="warning">On kiosk</Badge>
                    ) : (
                      <Badge variant="destructive">Not sent</Badge>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {bill ? "Billed" : "Owed"}
                      </p>
                      <p className="text-xl font-bold tabular-nums">
                        {bill
                          ? `${bill.amount} ${bill.currency}`
                          : owed
                            ? `${owed.amount} ${owed.currency}`
                            : "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {bill ? (
                        <>
                          {drifted ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void refreshBill(row)}
                            >
                              Update → {bill.estimated_amount}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => setCancelTarget(row)}
                          >
                            Cancel bill
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void sendBill(row)}
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          Send to kiosk
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {hubReady && !gateFilterReady && exitGates.length > 1 ? (
        <div className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
          Select an exit gate to see pending payments for that lane.
        </div>
      ) : null}

      {hubReady &&
      gateFilterReady &&
      settleQueue.length === 0 &&
      billQueue.length === 0 &&
      waitingCount === 0 ? (
        <div className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
          No pending payments for this gate.
        </div>
      ) : null}

      {needsAttentionCount > 0 ? (
        <button
          type="button"
          onClick={() =>
            gatesSectionRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
          className="flex w-full items-center gap-3 rounded-2xl border border-warning/40 bg-warning-muted px-4 py-3 text-left shadow-sm transition-colors hover:bg-warning-muted/70 sm:px-5"
        >
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/20">
            <Car className="size-4.5 text-warning-muted-foreground" />
            <span className="absolute inset-0 animate-ping rounded-full bg-warning/30" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {needsAttentionCount}{" "}
              {needsAttentionCount === 1 ? "car needs" : "cars need"} a decision
            </span>
            <span className="block text-xs text-muted-foreground">
              Approve or deny them at the gates below.
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {normalizedQuery
                  ? `Matches for ${normalizedQuery}`
                  : "Cars owing money"}
              </h2>
              {deskRows.length > 0 ? (
                <Badge variant="outline" className="tabular-nums">
                  {deskRows.length}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {usingLookup
                ? "No car here owes money under that plate, so this is every open stay in the zone — including free and already-paid ones."
                : "Open stays for this exit gate with a fee due — take cash at the desk, or send the bill to the kiosk for cars already at a gate."}
              {!normalizedQuery && activeOwedTotal ? (
                <>
                  {" "}
                  <span className="font-medium text-foreground">
                    {activeOwedTotal} outstanding
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              usingLookup
                ? void runLookup(normalizedQuery, { announce: true })
                : void loadActiveSessions()
            }
            disabled={activeLoading || searching}
          >
            {activeLoading || searching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Car className="size-4" />
            )}
            Refresh
          </Button>
        </div>

        {(activeLoading && !normalizedQuery && deskRows.length === 0) ||
        lookupPending ? (
          <div className="rounded-2xl border bg-card px-5 py-10 text-center shadow-sm">
            <Loader />
          </div>
        ) : deskRows.length === 0 ? (
          <div className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
            {normalizedQuery
              ? "No car on site matches that plate for this exit gate."
              : gateFilterReady
                ? "Nothing to collect at this exit gate — every open stay is still free, already paid, or queued above."
                : "Select an exit gate to see cars owing money at that lane."}
          </div>
        ) : (
          <>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
              {visibleDeskRows.map((row) => {
                const gateRequest = gateRequestFor(row);
                const atGate = row.at_gate || Boolean(gateRequest);
                return (
                  <li
                    key={row.session_id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-lg font-semibold tracking-wider">
                          {row.plate}
                        </p>
                        {row.match && !row.match.exact ? (
                          <Badge
                            variant={row.match.weak ? "warning" : "outline"}
                          >
                            {row.match.percent}% match
                            {row.match.weak ? " · weak" : ""}
                          </Badge>
                        ) : null}
                        {row.within_paid_exit_grace ? (
                          <Badge variant="success">Exit grace active</Badge>
                        ) : null}
                        {atGate ? (
                          <Badge variant="warning">
                            At{" "}
                            {row.gate_label ??
                              gateRequest?.device_label ??
                              "gate"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {row.zone_name ? `${row.zone_name} · ` : ""}
                        parked {elapsedLabel(row.start_time, nowTick)} · since{" "}
                        {formatDateTime(row.start_time)}
                        {row.within_paid_exit_grace && row.paid_exit_until
                          ? ` · exit before ${formatDateTime(row.paid_exit_until)}`
                          : ""}
                      </p>
                      {row.parking_breakdown?.segments?.length ? (
                        <ParkingJourney
                          breakdown={row.parking_breakdown}
                          className="mt-2 rounded-xl border bg-muted/30 px-3 py-2"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="sm:text-right">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {row.within_paid_exit_grace ? "Paid" : "Amount due"}
                        </p>
                        <p className="text-xl font-bold tabular-nums">
                          {formatMoney(row.fee)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/sessions/${row.session_id}`}>
                            Session
                          </Link>
                        </Button>
                        {row.within_paid_exit_grace ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={printBusyId === row.session_id}
                            onClick={() =>
                              void printSessionBill(row.session_id)
                            }
                          >
                            {printBusyId === row.session_id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Printer className="size-4" />
                            )}
                            Receipt
                          </Button>
                        ) : null}
                        {atGate && gateRequest ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={billSessionId === row.session_id}
                            onClick={() =>
                              void sendBillForSession(row, gateRequest.id)
                            }
                          >
                            {billSessionId === row.session_id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Banknote className="size-4" />
                            )}
                            Bill on kiosk
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          disabled={
                            !row.can_validate ||
                            validateBusyId === row.session_id
                          }
                          onClick={() => takeCashForRow(row)}
                        >
                          {validateBusyId === row.session_id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Wallet className="size-4" />
                          )}
                          {row.within_paid_exit_grace
                            ? "Already paid"
                            : gateRequest?.can_validate_payment
                              ? "Take cash · open"
                              : "Take cash"}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!normalizedQuery && deskRows.length > ACTIVE_PREVIEW_COUNT ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setActiveExpanded((open) => !open)}
              >
                {activeExpanded ? "Show fewer" : `Show all ${deskRows.length}`}
              </Button>
            ) : null}
          </>
        )}
      </section>

      <section ref={gatesSectionRef} className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                Zone gates
              </h2>
              {waitingCount > 0 ? (
                <Badge variant="warning" className="tabular-nums">
                  {waitingCount} waiting
                </Badge>
              ) : null}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  streamStatus === "live" &&
                    "bg-success-muted text-success-muted-foreground",
                  streamStatus === "offline" &&
                    "bg-destructive/15 text-destructive",
                  (streamStatus === "connecting" || streamStatus === "idle") &&
                    "bg-muted text-muted-foreground",
                )}
              >
                <Radio className="size-3" />
                {streamStatus === "live"
                  ? "Live"
                  : streamStatus === "connecting"
                    ? "Connecting…"
                    : streamStatus === "offline"
                      ? "Reconnecting…"
                      : "Idle"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {gateFilterReady
                ? "Live view of the selected exit gate"
                : me?.can_pick_zone
                  ? "Select an exit gate to load that lane"
                  : "Select an exit gate to load that lane"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleAlerts}
              aria-pressed={alertsOn}
              title={
                alertsOn
                  ? "Sound and visual alerts are on"
                  : "Click to enable alerts for new waiting vehicles"
              }
            >
              {alertsOn ? (
                <Bell className="size-4" />
              ) : (
                <BellOff className="size-4" />
              )}
              {alertsOn ? "Alerts on" : "Alerts off"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadGates()}
              disabled={gatesLoading || !hubReady}
            >
              {gatesLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Refresh
            </Button>
          </div>
        </div>

        {!hubReady ? (
          <div className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
            Select a site and zone to load gates.
          </div>
        ) : exitGates.length === 0 && !gatesLoading ? (
          <div className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
            No gates available.
          </div>
        ) : !gateFilterReady ? (
          <div className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
            Select an exit gate to see this lane.
          </div>
        ) : gatesLoading && devices.length === 0 ? (
          <Loader compact label="Loading gates…" />
        ) : (
          <div className="space-y-4">
            {zonesWithDevices.map(({ zone, entries, exits, waiting }) => (
              <div
                key={zone.id}
                className="overflow-hidden rounded-2xl border bg-card/40 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-semibold tracking-tight">
                      {zone.site_name} · {zone.name}
                      {selectedGateDevice
                        ? ` · ${gateLabel(selectedGateDevice)}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {zone.project_name ? `${zone.project_name} · ` : ""}
                      selected exit gate
                    </p>
                  </div>
                  {waiting > 0 ? (
                    <Badge variant="warning" className="tabular-nums">
                      {waiting} waiting
                    </Badge>
                  ) : (
                    <Badge variant="outline">All clear</Badge>
                  )}
                </div>
                {entries.length + exits.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
                    No pending payments for this gate.
                  </p>
                ) : (
                  <div
                    className={cn(
                      "grid gap-4 p-4",
                      entries.length > 0 &&
                        exits.length > 0 &&
                        "lg:grid-cols-2",
                    )}
                  >
                    {entries.length > 0 ? (
                      <GateColumn
                        title="Entry gates"
                        hint="Cars waiting to come in"
                        tone="entry"
                        devices={entries}
                        pendingByDevice={pendingByDevice}
                        freshDeviceIds={freshDeviceIds}
                        canDecide={canDecide}
                        onApprove={(row) => openDecision(row, "approve")}
                        onDeny={(row) => openDecision(row, "deny")}
                        onManual={
                          canDecide
                            ? (device) => {
                                setManualDevice(device);
                                setManualPlate("");
                                setManualNote("");
                              }
                            : undefined
                        }
                        onValidatePayment={(row) =>
                          setValidateTarget({ kind: "request", row })
                        }
                        onUnmatch={(row) => void unmatchAr(row)}
                        onChargeAtKiosk={openChargeAtKiosk}
                        onCancelBill={(row) => setCancelTarget(row)}
                        onSendBill={(row) => void sendBill(row)}
                        onRefreshBill={(row) => void refreshBill(row)}
                        paymentActionId={paymentActionId}
                        unmatchBusy={arBusyId != null}
                        validateBusy={arBusyId != null}
                      />
                    ) : null}
                    {exits.length > 0 ? (
                      <GateColumn
                        title="Exit gate"
                        hint="Cars waiting to leave"
                        tone="exit"
                        devices={exits}
                        pendingByDevice={pendingByDevice}
                        freshDeviceIds={freshDeviceIds}
                        canDecide={canDecide}
                        onApprove={(row) => openDecision(row, "approve")}
                        onDeny={(row) => openDecision(row, "deny")}
                        onManual={
                          canDecide
                            ? (device) => {
                                setManualDevice(device);
                                setManualPlate("");
                                setManualNote("");
                              }
                            : undefined
                        }
                        onValidatePayment={(row) =>
                          setValidateTarget({ kind: "request", row })
                        }
                        onUnmatch={(row) => void unmatchAr(row)}
                        onChargeAtKiosk={openChargeAtKiosk}
                        onCancelBill={(row) => setCancelTarget(row)}
                        onSendBill={(row) => void sendBill(row)}
                        onRefreshBill={(row) => void refreshBill(row)}
                        paymentActionId={paymentActionId}
                        unmatchBusy={arBusyId != null}
                        validateBusy={arBusyId != null}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Latest receipts
            </h2>
            <p className="text-sm text-muted-foreground">
              Last 7 in this zone · newest first ·{" "}
              <kbd className="rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
                P
              </kbd>{" "}
              reprints the newest
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={receiptsLoading || !hubReady}
            onClick={() => void loadReceipts()}
          >
            {receiptsLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Refresh
          </Button>
        </div>
        {!hubReady ? (
          <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Select a zone to see receipts.
          </p>
        ) : receiptsLoading && recentReceipts.length === 0 ? (
          <Loader label="Loading receipts…" />
        ) : recentReceipts.length === 0 ? (
          <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No receipts in this zone yet.
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {recentReceipts.map((row, index) => {
              const busy = printBusyId === row.session_id;
              const isNewest = index === 0;
              return (
                <li
                  key={row.session_id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5",
                    isNewest && "bg-muted/30",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-base font-semibold tracking-wider">
                        {row.plate}
                      </p>
                      <Badge
                        variant="outline"
                        className="font-normal capitalize"
                      >
                        {row.payment_method}
                      </Badge>
                      {isNewest ? (
                        <Badge variant="success" className="font-normal">
                          Latest
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.paid_at ? formatDateTime(row.paid_at) : "—"}
                      {row.zone_name ? ` · ${row.zone_name}` : ""}
                      {row.invoice_number ? ` · ${row.invoice_number}` : ""}
                    </p>
                  </div>
                  <p className="text-base font-bold tabular-nums">
                    {row.amount}{" "}
                    <span className="text-xs font-semibold text-muted-foreground">
                      {row.currency}
                    </span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void printSessionBill(row.session_id)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Printer className="size-4" />
                    )}
                    Print
                    {isNewest ? (
                      <kbd className="ml-1 rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
                        P
                      </kbd>
                    ) : null}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={Boolean(decisionRow && decisionAction)}
        onOpenChange={(open) => {
          if (!open) closeDecision();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionAction === "approve" ? "Approve" : "Deny"}{" "}
              {decisionRow?.plate}
            </DialogTitle>
            <DialogDescription>
              {decisionRow?.site_name}
              {decisionRow?.zone_name ? ` · ${decisionRow.zone_name}` : ""}
              {decisionRow?.device_label
                ? ` · ${decisionRow.device_label}`
                : ""}
              {decisionRow?.action ? ` · ${decisionRow.action}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {decisionRow?.reason ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  System reason
                </p>
                <p className="mt-0.5 leading-snug">{decisionRow.reason}</p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="cash-decision-note">Operator note</Label>
              <Textarea
                id="cash-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={
                  decisionAction === "approve"
                    ? "Why are you approving this?"
                    : "Why are you denying this?"
                }
                rows={3}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Required — saved on the access request and visible in history.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDecision}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={decisionAction === "deny" ? "destructive" : "default"}
                disabled={arBusyId === decisionRow?.id || !decisionNote.trim()}
                onClick={() => void submitDecision()}
              >
                {arBusyId === decisionRow?.id
                  ? "Saving…"
                  : decisionAction === "approve"
                    ? "Approve"
                    : "Deny"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(manualDevice)}
        onOpenChange={(open) => {
          if (!open) setManualDevice(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter plate manually</DialogTitle>
            <DialogDescription>
              {manualDevice
                ? `${manualDevice.site_name}${
                    manualDevice.zone_name ? ` · ${manualDevice.zone_name}` : ""
                  } · ${manualDevice.name || manualDevice.ip} · ${manualDevice.type}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cash-manual-plate">Plate number</Label>
              <Input
                id="cash-manual-plate"
                value={manualPlate}
                onChange={(e) => setManualPlate(e.target.value.toUpperCase())}
                placeholder="ABC1234"
                className="font-mono text-lg tracking-wider"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cash-manual-note">Operator note (optional)</Label>
              <Textarea
                id="cash-manual-note"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="Why the gate was opened manually"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This records the plate at the gate and opens the barrier straight
              away — an entry creates a stay, an exit closes and charges it.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={manualBusy}
                onClick={() => setManualDevice(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={manualBusy || !manualPlate.trim()}
                onClick={() => void submitManualPlate()}
              >
                {manualBusy ? "Opening…" : "Open gate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(chargeRequest)}
        onOpenChange={(open) => {
          if (!open && !chargeBusy) {
            setChargeRequest(null);
            setChargeEntryTime("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Charge at kiosk · {chargeRequest?.plate}</DialogTitle>
            <DialogDescription>
              Create a bill and keep the gate closed until the kiosk confirms
              payment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <button
              type="button"
              disabled={!chargeRequest?.can_extend_previous}
              onClick={() => setChargeMode("extend_previous")}
              className={cn(
                "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
                !chargeRequest?.can_extend_previous
                  ? "cursor-not-allowed opacity-55"
                  : chargeMode === "extend_previous"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 size-4 shrink-0 rounded-full border-2",
                  chargeMode === "extend_previous" &&
                    chargeRequest?.can_extend_previous
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Extend previous session
                </span>
                <span className="block text-xs text-muted-foreground">
                  {chargeRequest?.can_extend_previous
                    ? "Bills only the time after the previous paid grace expired."
                    : "Unavailable: no paid session for this plate/site outside grace."}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setChargeMode("new_session")}
              className={cn(
                "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
                chargeMode === "new_session"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 size-4 shrink-0 rounded-full border-2",
                  chargeMode === "new_session"
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  New session from entry time
                </span>
                <span className="block text-xs text-muted-foreground">
                  Bills the full interval from the manual entry time.
                </span>
              </span>
            </button>
            {chargeMode === "new_session" ? (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted p-3">
                <Label htmlFor="cash-charge-entry-time">
                  Entry time (required)
                </Label>
                <Input
                  id="cash-charge-entry-time"
                  type="datetime-local"
                  value={chargeEntryTime}
                  onChange={(e) => setChargeEntryTime(e.target.value)}
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setChargeRequest(null)}
                disabled={chargeBusy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitChargeAtKiosk()}
                disabled={
                  chargeBusy ||
                  (chargeMode === "extend_previous" &&
                    !chargeRequest?.can_extend_previous)
                }
              >
                {chargeBusy ? "Creating bill…" : "Send bill to kiosk"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(receipt)}
        onOpenChange={(open) => {
          if (!open) setReceipt(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cash taken</DialogTitle>
            <DialogDescription>
              Hand the printed bill to the driver.
            </DialogDescription>
          </DialogHeader>
          {receipt ? (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/30 p-4 text-center">
                <p className="font-mono text-2xl font-bold tracking-wider">
                  {receipt.plate}
                </p>
                <p className="mt-3 text-3xl font-bold tabular-nums">
                  {receipt.amountLabel}
                </p>
                <p className="text-xs text-muted-foreground">paid in cash</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReceipt(null)}>
                  Done
                  <kbd className="ml-1 rounded border bg-muted px-1 font-sans text-[10px] font-semibold">
                    Esc
                  </kbd>
                </Button>
                <Button
                  disabled={printBusyId === receipt.sessionId}
                  onClick={() => void printSessionBill(receipt.sessionId)}
                >
                  {printBusyId === receipt.sessionId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Printer className="size-4" />
                  )}
                  Print bill
                  <kbd className="ml-1 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold">
                    P
                  </kbd>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(validateTarget)}
        onOpenChange={(open) => {
          const busy = validateBusyId != null || arBusyId != null;
          if (!open && !busy) setValidateTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Take cash ·{" "}
              <span className="font-mono tracking-wider">
                {validateTarget?.kind === "session"
                  ? validateTarget.hit.plate
                  : validateTarget?.row.plate}
              </span>
            </DialogTitle>
            <DialogDescription>
              {validateTarget?.kind === "session"
                ? `Marks the stay paid. The car is not at a gate yet — they can leave within ${
                    validateTarget.hit.grace_minutes || "the grace"
                  } minutes once they reach exit.`
                : "Marks the stay paid and opens the gate straight away."}
              {validateTarget?.kind === "session" &&
              validateTarget.hit.at_gate ? (
                <>
                  {" "}
                  This car is waiting at a gate but its exit request cannot be
                  settled yet, so the barrier will not open from here.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(() => {
              if (validateTarget?.kind === "session") {
                const preview = cashierDiscountPreview(
                  validateTarget.hit.fee,
                  discountPercentage,
                );
                const reasonRequired =
                  preview.hasDiscount && !discountReason.trim();
                const currency = "SAR";
                return (
                  <>
                    {validateTarget.hit.parking_breakdown ? (
                      <div className="rounded-xl border bg-muted/40 px-4 py-3">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Parking details
                        </p>
                        <ParkingJourney
                          breakdown={validateTarget.hit.parking_breakdown}
                          showAmounts={!preview.hasDiscount}
                        />
                      </div>
                    ) : null}
                    <div className="flex items-baseline justify-between rounded-xl border bg-muted/40 px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        Original amount
                      </span>
                      <span className="text-2xl font-bold tabular-nums">
                        {formatMoney(preview.original, currency)}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cash-discount-percentage">Discount</Label>
                      <div className="relative">
                        <Input
                          id="cash-discount-percentage"
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          inputMode="decimal"
                          placeholder="0"
                          value={discountPercentage}
                          disabled={validateBusyId != null}
                          onChange={(e) =>
                            setDiscountPercentage(e.target.value)
                          }
                          className="pr-8"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                          %
                        </span>
                      </div>
                      {preview.invalid ? (
                        <p className="text-xs text-destructive">
                          Enter a value between 0 and 100.
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cash-discount-reason">
                        Discount reason
                        {preview.hasDiscount ? (
                          <span className="text-destructive"> *</span>
                        ) : null}
                      </Label>
                      <Input
                        id="cash-discount-reason"
                        value={discountReason}
                        disabled={validateBusyId != null}
                        placeholder={
                          preview.hasDiscount
                            ? "Required when a discount is applied"
                            : "Optional unless a discount is applied"
                        }
                        onChange={(e) => setDiscountReason(e.target.value)}
                      />
                      {reasonRequired ? (
                        <p className="text-xs text-destructive">
                          A reason is required when applying a discount.
                        </p>
                      ) : null}
                    </div>
                    {preview.hasDiscount ? (
                      <div className="space-y-1.5 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                        <div className="flex items-baseline justify-between">
                          <span className="text-muted-foreground">
                            Original amount
                          </span>
                          <span className="tabular-nums">
                            {formatMoney(preview.original, currency)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-muted-foreground">
                            Discount
                          </span>
                          <span className="tabular-nums">
                            −{formatMoney(preview.discountAmount, currency)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between border-t pt-1.5">
                          <span className="font-medium">Amount to collect</span>
                          <span className="text-xl font-bold tabular-nums">
                            {formatMoney(preview.collect, currency)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-baseline justify-between rounded-xl border bg-muted/40 px-4 py-3">
                        <span className="text-sm text-muted-foreground">
                          Amount to collect
                        </span>
                        <span className="text-2xl font-bold tabular-nums">
                          {formatMoney(preview.collect, currency)}
                        </span>
                      </div>
                    )}
                  </>
                );
              }
              const amount = validateTarget
                ? settleAmountLabel(validateTarget.row)
                : null;
              if (!amount) return null;
              return (
                <div className="flex items-baseline justify-between rounded-xl border bg-muted/40 px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    Amount to collect
                  </span>
                  <span className="text-2xl font-bold tabular-nums">
                    {amount}
                  </span>
                </div>
              );
            })()}
            <p className="rounded-lg border border-warning/30 bg-warning-muted/50 px-3 py-2.5 text-xs leading-relaxed">
              The fee is charged to <strong>your operator wallet</strong>, which
              may go negative until you settle up. Only confirm once you have
              the cash in hand.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={validateBusyId != null || arBusyId != null}
                onClick={() => setValidateTarget(null)}
              >
                Cancel
              </Button>
              <Button
                autoFocus
                disabled={
                  validateBusyId != null ||
                  arBusyId != null ||
                  sessionDiscountBlocked
                }
                onClick={() => {
                  if (!validateTarget) return;
                  if (validateTarget.kind === "session") {
                    void validateSession(validateTarget.hit);
                  } else {
                    void validateAr(validateTarget.row);
                  }
                }}
              >
                {validateBusyId != null || arBusyId != null ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wallet className="size-4" />
                )}
                {validateBusyId != null || arBusyId != null
                  ? "Validating…"
                  : "Cash received · Enter"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open && paymentActionId == null) setCancelTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel bill · {cancelTarget?.plate}</DialogTitle>
            <DialogDescription>
              Removes the bill from the exit kiosk. The unpaid session stays
              open — you can Resend immediately from the toast or the card.
            </DialogDescription>
          </DialogHeader>
          {cancelTarget?.open_payment_intent ? (
            <div className="rounded-lg border border-warning/30 bg-warning-muted/50 px-3 py-2.5 text-sm">
              Outstanding bill:{" "}
              <span className="font-semibold tabular-nums">
                {cancelTarget.open_payment_intent.amount}{" "}
                {cancelTarget.open_payment_intent.currency}
              </span>
              .
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={paymentActionId != null}
            >
              Keep bill
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelTarget && void cancelBill(cancelTarget)}
              disabled={paymentActionId != null}
            >
              {paymentActionId != null ? "Cancelling…" : "Cancel bill"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
