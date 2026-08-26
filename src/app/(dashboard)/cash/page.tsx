"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote } from "lucide-react";
import { toast } from "sonner";

import { AttentionBanner, type AttentionBannerProps } from "./_components/attention-banner";
import { BillQueueSection, type BillQueueSectionProps } from "./_components/bill-queue-section";
import { CashDialogs, type CashDialogsProps } from "./_components/cash-dialogs";
import { CashHeaderSection, type CashHeaderSectionProps } from "./_components/cash-header-section";
import { DeskListSection, type DeskListSectionProps } from "./_components/desk-list-section";
import { GatesSection, type GatesSectionProps } from "./_components/gates-section";
import { ReceiptsSection, type ReceiptsSectionProps } from "./_components/receipts-section";
import { SettleQueueSection, type SettleQueueSectionProps } from "./_components/settle-queue-section";
import {
  ACTIVE_PREVIEW_COUNT,
  ALL_GATES,
  type ActiveSession,
  type CashierMe,
  type CashierReceipt,
  type CashierSearchHit,
  type CashierZone,
  type ChargeMode,
  type DecisionAction,
  type DeskRow,
  type DeskStay,
  type ReceiptInfo,
  type ValidateTarget,
  type ZoneTariff,
} from "@/utils/cash/types";
import {
  isExitDevice,
  isExitRequest,
  plateKey,
  printHtml,
  rowFromActiveSession,
  rowFromSearchHit,
  settleAmountLabel,
} from "@/utils/cash/utils";

import { amountsDiffer } from "@/components/gate-board";
import { EmptyState } from "@/components/empty-state";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { useProjectFilter } from "@/components/providers/project-filter-provider";
import {
  accessRequestStreamUrl,
  consumeSseBuffer,
  type StreamStatus,
} from "@/lib/access-request-stream";
import { api, ApiError, apiText } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import type { AccessRequest, Device, Paginated, Site, Zone } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

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
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [gatesLoading, setGatesLoading] = useState(false);
  const [arBusyId, setArBusyId] = useState<number | null>(null);
  const [paymentActionId, setPaymentActionId] = useState<number | null>(null);
  const [chargeRequest, setChargeRequest] = useState<AccessRequest | null>(
    null,
  );
  const [chargeMode, setChargeMode] = useState<ChargeMode>("new_session");
  const [chargeEntryTime, setChargeEntryTime] = useState("");
  const [chargeBusy, setChargeBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AccessRequest | null>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [zonesCatalog, setZonesCatalog] = useState<Zone[]>([]);
  const [pickedSiteId, setPickedSiteId] = useState<string>("");
  const [pickedZoneId, setPickedZoneId] = useState<string>("");
  const [pickedGateId, setPickedGateId] = useState<string>(ALL_GATES);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [manualDevice, setManualDevice] = useState<Device | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const [decisionRow, setDecisionRow] = useState<AccessRequest | null>(null);
  const [decisionAction, setDecisionAction] = useState<DecisionAction | null>(
    null,
  );
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
  const [validateTarget, setValidateTarget] = useState<ValidateTarget | null>(
    null,
  );
  const [alertsOn, setAlertsOn] = useState(false);
  const [freshDeviceIds, setFreshDeviceIds] = useState<Set<number>>(
    () => new Set(),
  );
  const pendingByDeviceRef = useRef<Record<number, AccessRequest>>({});
  const knownPendingIdsRef = useRef<Set<number>>(new Set());
  const allowedDeviceIdsRef = useRef<number[] | null>(null);
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
      if (!pickedZoneId) return [];
      const zone = me.zones.find((z) => String(z.id) === pickedZoneId);
      return zone ? [zone] : [];
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
      const allowed = allowedDeviceIdsRef.current;
      const scoped = rows.filter((row) => {
        if (!rowInActiveZone(row) || !isExitRequest(row)) return false;
        const deviceId = Number(row.device_id ?? row.device);
        if (!Number.isFinite(deviceId)) return false;
        return allowed == null || allowed.includes(deviceId);
      });
      const next: Record<number, AccessRequest> = {};
      for (const row of scoped) {
        const deviceId = Number(row.device_id ?? row.device);
        if (!next[deviceId]) next[deviceId] = row;
      }
      knownPendingIdsRef.current = new Set(scoped.map((row) => row.id));
      pendingByDeviceRef.current = next;
      setPendingByDevice(next);
    },
    [rowInActiveZone],
  );

  const upsertPendingRow = useCallback(
    (row: AccessRequest & { device_id?: number }) => {
      if (!rowInActiveZone(row) || !isExitRequest(row)) return;
      const deviceId = Number(row.device_id ?? row.device);
      if (!Number.isFinite(deviceId)) return;
      const allowed = allowedDeviceIdsRef.current;
      if (allowed != null && !allowed.includes(deviceId)) return;
      const isNew = !knownPendingIdsRef.current.has(row.id);
      knownPendingIdsRef.current.add(row.id);
      setPendingByDevice((current) => {
        const next = { ...current, [deviceId]: row };
        pendingByDeviceRef.current = next;
        return next;
      });
      if (!isNew) return;
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
      const pickedDevice =
        pickedGateId === ALL_GATES ? undefined : Number(pickedGateId);
      const arPages = await Promise.all(
        activeZoneIds.map((zoneId) =>
          api<Paginated<AccessRequest>>("access-requests/", {
            query: {
              zone: zoneId,
              status: "pending",
              page_size: 100,
              ...(pickedDevice != null ? { device: pickedDevice } : {}),
            },
          }),
        ),
      );
      applyPendingRows(arPages.flatMap((page) => page.results));
    } catch {
      /* stream reconnect will resync */
    }
  }, [activeZoneIds, applyPendingRows, pickedGateId]);

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
            query: { zone: zoneId, type: "exit", page_size: 100 },
          }),
        ),
      );
      const deviceMap = new Map<number, Device>();
      for (const page of devicePages) {
        for (const row of page.results) deviceMap.set(row.id, row);
      }
      setDevices([...deviceMap.values()].sort((a, b) => a.id - b.id));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load zone gates",
      );
      setDevices([]);
      applyPendingRows([]);
    } finally {
      setGatesLoading(false);
    }
  }, [activeZoneIds, applyPendingRows]);

  const loadReceipts = useCallback(async () => {
    if (!activeZoneIds.length) {
      setRecentReceipts([]);
      return;
    }
    setReceiptsLoading(true);
    try {
      const data = await api<{ results: CashierReceipt[] }>(
        "cashier/receipts/",
        {
          query: { limit: 7 },
        },
      );
      setRecentReceipts(data.results);
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
    if (!activeZoneIds.length) {
      setActiveSessions([]);
      return;
    }
    setActiveLoading(true);
    try {
      const data = await api<{ results: ActiveSession[] }>(
        "cashier/active-sessions/",
        { query: { zone: activeZoneIds[0], limit: 25 } },
      );
      setActiveSessions(data.results);
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
  }, [activeZoneIds]);

  useEffect(() => {
    void loadActiveSessions();
  }, [loadActiveSessions]);

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
    if (!activeZoneIds.length) {
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

  // Assigned cashiers stay in their Cashier zones — auto-pick when only one.
  useEffect(() => {
    if (!me?.has_assignment) return;
    if (me.zones.length === 1) {
      setPickedZoneId(String(me.zones[0].id));
      return;
    }
    if (
      me.zones.length > 1 &&
      !me.zones.some((z) => String(z.id) === pickedZoneId)
    ) {
      setPickedZoneId(String(me.zones[0].id));
    }
  }, [me, pickedZoneId]);

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
    setPickedGateId(ALL_GATES);
    setZonesCatalog([]);
    setHits([]);
    setSearchedQuery("");
  }, [projectId, me?.can_pick_zone]);

  useEffect(() => {
    void loadZonesForSite(pickedSiteId);
    setPickedZoneId("");
    setPickedGateId(ALL_GATES);
    setHits([]);
    setSearchedQuery("");
  }, [pickedSiteId, loadZonesForSite]);

  useEffect(() => {
    void loadGates();
  }, [loadGates]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (pickedGateId === ALL_GATES) return;
    if (
      !devices.some(
        (device) => String(device.id) === pickedGateId && isExitDevice(device),
      )
    ) {
      setPickedGateId(ALL_GATES);
    }
  }, [devices, pickedGateId]);

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
        const data = await api<{ query: string; results: CashierSearchHit[] }>(
          "cashier/search/",
          { query: { q, limit: 8, zone: activeZoneIds[0] } },
        );
        setHits(data.results);
        setSearchedQuery(data.query || plateKey(q));
        if (announce && data.results.length === 0) {
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
    setValidateBusyId(hit.session_id);
    try {
      await api(`sessions/${hit.session_id}/cashier-validate/`, {
        method: "POST",
        body: { note: "Validated at cashier desk" },
      });
      toast.success(
        `${hit.plate} paid · leave within ${hit.grace_minutes || "grace"} min`,
      );
      setValidateTarget(null);
      setReceipt({
        sessionId: hit.session_id,
        plate: hit.plate,
        amountLabel: formatMoney(hit.fee),
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

  const exitDevices = useMemo(() => devices.filter(isExitDevice), [devices]);
  const pickedDeviceId =
    pickedGateId === ALL_GATES ? null : Number(pickedGateId);
  const allowedDeviceIds = useMemo(() => {
    if (pickedDeviceId != null) return [pickedDeviceId];
    return exitDevices.map((device) => device.id);
  }, [exitDevices, pickedDeviceId]);
  allowedDeviceIdsRef.current = allowedDeviceIds;
  const visibleDevices = useMemo(() => {
    if (pickedDeviceId == null) return exitDevices;
    return exitDevices.filter((device) => device.id === pickedDeviceId);
  }, [exitDevices, pickedDeviceId]);

  const zonesWithDevices = useMemo(() => {
    const rows = activeZones.map((zone) => {
      const exits = visibleDevices.filter(
        (d) => d.zone === zone.id && isExitDevice(d),
      );
      return {
        zone,
        exits,
        waiting: exits.filter((d) => pendingByDevice[d.id]).length,
      };
    });
    if (pickedDeviceId == null) return rows;
    return rows.filter((row) => row.exits.length > 0);
  }, [activeZones, visibleDevices, pendingByDevice, pickedDeviceId]);

  const hubReady = Boolean(me && activeZoneIds.length > 0);
  const waitingCount = useMemo(
    () => zonesWithDevices.reduce((total, zone) => total + zone.waiting, 0),
    [zonesWithDevices],
  );

  // Exits the cashier can settle with cash right now — the desk's hot path.
  // Oldest first so the car that's been blocking the lane clears soonest.
  const settleQueue = useMemo(() => {
    return Object.values(pendingByDevice)
      .filter((row) => row.can_validate_payment)
      .filter(
        (row) =>
          pickedDeviceId == null || Number(row.device) === pickedDeviceId,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [pendingByDevice, pickedDeviceId]);

  // Live kiosk bills the desk may need to fix: on the kiosk, or owed but unsent.
  const billQueue = useMemo(() => {
    return Object.values(pendingByDevice)
      .filter((row) => !row.can_validate_payment)
      .filter((row) => row.open_payment_intent || row.billable_open_session)
      .filter(
        (row) =>
          pickedDeviceId == null || Number(row.device) === pickedDeviceId,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [pendingByDevice, pickedDeviceId]);

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
   * Cars already queued above (settleable exits and live kiosk bills) are
   * handled there — showing them again here would make the desk collect twice.
   * Longest stays first: they owe the most and leave soonest.
   */
  const sortedActiveSessions = useMemo(() => {
    const handled = new Set(
      [...settleQueue, ...billQueue].map((row) => row.id),
    );
    return activeSessions
      .filter(
        (row) => !row.access_request_id || !handled.has(row.access_request_id),
      )
      .sort((a, b) => {
        if (a.at_gate !== b.at_gate) return a.at_gate ? -1 : 1;
        return a.start_time.localeCompare(b.start_time);
      });
  }, [activeSessions, settleQueue, billQueue]);

  const normalizedQuery = useMemo(() => plateKey(query), [query]);

  const localMatches = useMemo(() => {
    if (!normalizedQuery) return sortedActiveSessions;
    return sortedActiveSessions.filter((row) =>
      plateKey(row.plate).includes(normalizedQuery),
    );
  }, [sortedActiveSessions, normalizedQuery]);

  // Typing narrows the worklist. Only when nothing in it matches do we ask the
  // server, which also sees the stays the worklist hides — free and paid ones.
  const usingLookup = Boolean(normalizedQuery) && localMatches.length === 0;

  // Hits are only trustworthy once they belong to the plate on screen.
  const lookupSettled = searchedQuery === normalizedQuery;

  const deskRows: DeskRow[] = useMemo(() => {
    const rows = usingLookup
      ? lookupSettled
        ? hits.map(rowFromSearchHit)
        : []
      : localMatches.map(rowFromActiveSession);
    if (pickedDeviceId == null) return rows;
    return rows.filter((row) => {
      const req =
        pendingByPlate[plateKey(row.plate)] ??
        (row.access_request_id
          ? pendingById[row.access_request_id]
          : undefined);
      if (!req) return !row.at_gate;
      return Number(req.device) === pickedDeviceId;
    });
  }, [
    usingLookup,
    lookupSettled,
    hits,
    localMatches,
    pickedDeviceId,
    pendingByPlate,
    pendingById,
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

  const handleZoneChange = useCallback((value: string) => {
    setPickedZoneId(value);
    setPickedGateId(ALL_GATES);
    setHits([]);
    setSearchedQuery("");
  }, []);

  const handleSiteChange = useCallback((value: string) => {
    setPickedSiteId(value);
    setPickedGateId(ALL_GATES);
  }, []);

  const openManualEntry = useCallback((device: Device) => {
    setManualDevice(device);
    setManualPlate("");
    setManualNote("");
  }, []);

  const scrollToGates = useCallback(() => {
    gatesSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleConfirmValidate = useCallback(() => {
    if (!validateTarget) return;
    if (validateTarget.kind === "session") {
      void validateSession(validateTarget.hit);
    } else {
      void validateAr(validateTarget.row);
    }
  }, [validateTarget]);

  const handleCloseCharge = useCallback(() => {
    setChargeRequest(null);
    setChargeEntryTime("");
  }, []);

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

  const headerSectionProps: CashHeaderSectionProps = {
    me,
    projectName,
    pickedZoneId,
    onZoneChange: handleZoneChange,
    pickedSiteId,
    onSiteChange: handleSiteChange,
    sites,
    catalogLoading,
    zonesCatalog,
    pickedGateId,
    onGateChange: setPickedGateId,
    exitDevices,
    gatesLoading,
    activeZoneIds,
    tariff,
    query,
    onQueryChange: setQuery,
    onSearch,
    searching,
    clearSearch,
    searchInputRef,
  };

  const settleQueueSectionProps: SettleQueueSectionProps = {
    settleQueue,
    arBusyId,
    onValidate: setValidateTarget,
  };

  const billQueueSectionProps: BillQueueSectionProps = {
    billQueue,
    paymentActionId,
    onRefreshBill: (row) => void refreshBill(row),
    onCancelBill: setCancelTarget,
    onSendBill: (row) => void sendBill(row),
  };

  const attentionBannerProps: AttentionBannerProps = {
    needsAttentionCount,
    onScrollToGates: scrollToGates,
  };

  const deskListSectionProps: DeskListSectionProps = {
    normalizedQuery,
    deskRows,
    visibleDeskRows,
    usingLookup,
    activeOwedTotal,
    activeLoading,
    searching,
    lookupPending,
    activeExpanded,
    onToggleExpanded: () => setActiveExpanded((open) => !open),
    onRefresh: () =>
      usingLookup
        ? void runLookup(normalizedQuery, { announce: true })
        : void loadActiveSessions(),
    gateRequestFor,
    nowTick,
    printBusyId,
    billSessionId,
    validateBusyId,
    onPrintReceipt: (sessionId) => void printSessionBill(sessionId),
    onSendBillForSession: (row, accessRequestId) =>
      void sendBillForSession(row, accessRequestId),
    onTakeCash: takeCashForRow,
  };

  const gatesSectionProps: GatesSectionProps = {
    sectionRef: gatesSectionRef,
    waitingCount,
    streamStatus,
    pickedDeviceId,
    visibleDevices,
    alertsOn,
    onToggleAlerts: toggleAlerts,
    onRefreshGates: () => void loadGates(),
    gatesLoading,
    hubReady,
    devices,
    zonesWithDevices,
    pendingByDevice,
    freshDeviceIds,
    canDecide,
    onApprove: (row) => openDecision(row, "approve"),
    onDeny: (row) => openDecision(row, "deny"),
    onManual: openManualEntry,
    onValidatePayment: (row) => setValidateTarget({ kind: "request", row }),
    onUnmatch: (row) => void unmatchAr(row),
    onChargeAtKiosk: openChargeAtKiosk,
    onCancelBill: setCancelTarget,
    onSendBill: (row) => void sendBill(row),
    onRefreshBill: (row) => void refreshBill(row),
    paymentActionId,
    arBusyId,
  };

  const receiptsSectionProps: ReceiptsSectionProps = {
    hubReady,
    receiptsLoading,
    recentReceipts,
    printBusyId,
    onRefresh: () => void loadReceipts(),
    onPrint: (sessionId) => void printSessionBill(sessionId),
  };

  const cashDialogsProps: CashDialogsProps = {
    decision: {
      row: decisionRow,
      action: decisionAction,
      note: decisionNote,
      arBusyId,
      onNoteChange: setDecisionNote,
      onClose: closeDecision,
      onSubmit: () => void submitDecision(),
    },
    manual: {
      device: manualDevice,
      plate: manualPlate,
      note: manualNote,
      busy: manualBusy,
      onPlateChange: setManualPlate,
      onNoteChange: setManualNote,
      onClose: () => setManualDevice(null),
      onSubmit: () => void submitManualPlate(),
    },
    charge: {
      request: chargeRequest,
      mode: chargeMode,
      entryTime: chargeEntryTime,
      busy: chargeBusy,
      onModeChange: setChargeMode,
      onEntryTimeChange: setChargeEntryTime,
      onClose: handleCloseCharge,
      onSubmit: () => void submitChargeAtKiosk(),
    },
    receipt: {
      receipt,
      printBusyId,
      onClose: () => setReceipt(null),
      onPrint: (sessionId) => void printSessionBill(sessionId),
    },
    validate: {
      target: validateTarget,
      validateBusyId,
      arBusyId,
      onClose: () => setValidateTarget(null),
      onConfirm: handleConfirmValidate,
    },
    cancel: {
      target: cancelTarget,
      paymentActionId,
      onClose: () => setCancelTarget(null),
      onConfirm: (row) => void cancelBill(row),
    },
  };

  return (
    <div className="space-y-6">
      <CashHeaderSection {...headerSectionProps} />
      <SettleQueueSection {...settleQueueSectionProps} />
      <BillQueueSection {...billQueueSectionProps} />
      <AttentionBanner {...attentionBannerProps} />
      <DeskListSection {...deskListSectionProps} />
      <GatesSection {...gatesSectionProps} />
      <ReceiptsSection {...receiptsSectionProps} />
      <CashDialogs {...cashDialogsProps} />
    </div>
  );
}
