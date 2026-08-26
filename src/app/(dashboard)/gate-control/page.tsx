"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  DoorClosed,
  DoorOpen,
  History,
  Layers,
  ListFilter,
  Radio,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { DetailHero } from "@/components/detail-hero";
import { EmptyState } from "@/components/empty-state";
import {
  GateColumn,
  amountsDiffer,
  exitGuestNoSession,
  exitPayAtExitRequest,
  gateLabel,
} from "@/components/gate-board";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { useProjectFilter } from "@/components/providers/project-filter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  accessRequestStreamUrl,
  consumeSseBuffer,
  type StreamStatus,
} from "@/lib/access-request-stream";
import { api, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import type { AccessRequest, Device, Paginated } from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

type SessionMatch = {
  id: number;
  plate: string;
  match_percent: number;
  weak?: boolean;
  start_time: string;
  entry_device_label: string;
  zone_name: string | null;
};

type ZoneGroup = {
  zoneId: number;
  zoneName: string;
  parentId: number | null;
  parentName: string | null;
  depth: number;
  entries: Device[];
  exits: Device[];
};

type SiteGroup = {
  siteId: number;
  siteName: string;
  zones: ZoneGroup[];
};

type ProjectGroup = {
  projectId: number;
  projectName: string;
  sites: SiteGroup[];
};

function zoneGateCount(zone: ZoneGroup) {
  return zone.entries.length + zone.exits.length;
}

function zoneWaitingCount(
  zone: ZoneGroup,
  pendingByDevice: Record<number, AccessRequest>
) {
  return [...zone.entries, ...zone.exits].filter((d) => pendingByDevice[d.id])
    .length;
}

function siteGateCounts(site: SiteGroup) {
  let entries = 0;
  let exits = 0;
  for (const zone of site.zones) {
    entries += zone.entries.length;
    exits += zone.exits.length;
  }
  return { entries, exits };
}

function zoneDepth(zoneId: number, byId: Map<number, ZoneGroup>): number {
  let depth = 0;
  let current = byId.get(zoneId);
  const seen = new Set<number>();
  while (current?.parentId != null && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

function sortZones(zones: ZoneGroup[]): ZoneGroup[] {
  const byId = new Map(zones.map((z) => [z.zoneId, z]));
  for (const zone of zones) {
    zone.depth = zoneDepth(zone.zoneId, byId);
  }

  const children = new Map<number | null, ZoneGroup[]>();
  for (const zone of zones) {
    const key =
      zone.parentId != null && byId.has(zone.parentId) ? zone.parentId : null;
    const list = children.get(key) || [];
    list.push(zone);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  }

  const ordered: ZoneGroup[] = [];
  function walk(parentId: number | null) {
    for (const zone of children.get(parentId) || []) {
      ordered.push(zone);
      walk(zone.zoneId);
    }
  }
  walk(null);
  for (const zone of zones) {
    if (!ordered.includes(zone)) ordered.push(zone);
  }
  return ordered;
}

function groupDevices(devices: Device[]): ProjectGroup[] {
  const projects = new Map<number, ProjectGroup>();

  for (const device of devices) {
    const projectId = device.project ?? 0;
    const projectName = device.project_name || "Unassigned project";
    let project = projects.get(projectId);
    if (!project) {
      project = { projectId, projectName, sites: [] };
      projects.set(projectId, project);
    }

    let site = project.sites.find((s) => s.siteId === device.site);
    if (!site) {
      site = {
        siteId: device.site,
        siteName: device.site_name || `Site #${device.site}`,
        zones: [],
      };
      project.sites.push(site);
    }

    const zoneId = device.zone || 0;
    const zoneName =
      device.zone_name || (zoneId ? `Zone #${zoneId}` : "Unassigned");
    let zone = site.zones.find((z) => z.zoneId === zoneId);
    if (!zone) {
      zone = {
        zoneId,
        zoneName,
        parentId: device.zone_parent ?? null,
        parentName: device.zone_parent_name ?? null,
        depth: 0,
        entries: [],
        exits: [],
      };
      site.zones.push(zone);
    }
    if (device.type === "exit") zone.exits.push(device);
    else zone.entries.push(device);
  }

  const sorted = [...projects.values()].sort((a, b) =>
    a.projectName.localeCompare(b.projectName)
  );
  for (const project of sorted) {
    project.sites.sort((a, b) => a.siteName.localeCompare(b.siteName));
    for (const site of project.sites) {
      for (const zone of site.zones) {
        zone.entries.sort((a, b) => gateLabel(a).localeCompare(gateLabel(b)));
        zone.exits.sort((a, b) => gateLabel(a).localeCompare(gateLabel(b)));
      }
      site.zones = sortZones(site.zones);
    }
  }
  return sorted;
}

export default function GateControlPage() {
  const { canDecide } = useAuth();
  const { projectId, projectQuery, setProjectId, canSelectAll } =
    useProjectFilter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingByDevice, setPendingByDevice] = useState<
    Record<number, AccessRequest>
  >({});
  const [freshDeviceIds, setFreshDeviceIds] = useState<Set<number>>(
    () => new Set()
  );
  const freshTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  /** Tracks current pending map for diffing new request ids. */
  const pendingByDeviceRef = useRef<Record<number, AccessRequest>>({});
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const [waitingOnly, setWaitingOnly] = useState<boolean>(false);
  const [soundOn, setSoundOn] = useState<boolean>(false);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [decisions, setDecisions] = useState<AccessRequest[] | null>(null);
  const [decisionsBusy, setDecisionsBusy] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const titleFlashRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseTitleRef = useRef<string>("");

  // Restore operator toggles.
  useEffect(() => {
    try {
      const wo = window.localStorage.getItem("gate-control:waiting-only");
      const sound = window.localStorage.getItem("gate-control:sound");
      setWaitingOnly(wo === null ? projectId === null : wo === "1");
      setSoundOn(sound === "1");
    } catch {
      /* ignore */
    }
    // Only on mount; projectId default handled once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleWaitingOnly = useCallback(() => {
    setWaitingOnly((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          "gate-control:waiting-only",
          next ? "1" : "0"
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("gate-control:sound", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) {
        // Unlock audio within the click gesture.
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

  const playChime = useCallback(() => {
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

  const flashTitle = useCallback((count: number) => {
    if (typeof document === "undefined") return;
    if (!baseTitleRef.current) baseTitleRef.current = document.title;
    if (titleFlashRef.current) clearInterval(titleFlashRef.current);
    let on = false;
    titleFlashRef.current = setInterval(() => {
      document.title = on
        ? baseTitleRef.current
        : `(${count}) Vehicle waiting`;
      on = !on;
    }, 1000);
  }, []);

  const clearTitleFlash = useCallback(() => {
    if (titleFlashRef.current) {
      clearInterval(titleFlashRef.current);
      titleFlashRef.current = null;
    }
    if (baseTitleRef.current && typeof document !== "undefined") {
      document.title = baseTitleRef.current;
    }
  }, []);

  /** Alert on a genuinely new pending request while the tab is hidden. */
  const alertNewWait = useCallback(() => {
    if (soundOn) playChime();
    if (typeof document !== "undefined" && document.hidden) {
      const count = Object.keys(pendingByDeviceRef.current).length || 1;
      flashTitle(count);
    }
  }, [soundOn, playChime, flashTitle]);

  // Stop the title flash as soon as the operator returns to the tab.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden) clearTitleFlash();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTitleFlash();
    };
  }, [clearTitleFlash]);

  const markFresh = useCallback((deviceId: number) => {
    setFreshDeviceIds((prev) => {
      const next = new Set(prev);
      next.add(deviceId);
      return next;
    });
    const existing = freshTimersRef.current.get(deviceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      freshTimersRef.current.delete(deviceId);
      setFreshDeviceIds((prev) => {
        if (!prev.has(deviceId)) return prev;
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
    }, 5000);
    freshTimersRef.current.set(deviceId, timer);
  }, []);

  const clearFresh = useCallback((deviceId: number) => {
    const existing = freshTimersRef.current.get(deviceId);
    if (existing) {
      clearTimeout(existing);
      freshTimersRef.current.delete(deviceId);
    }
    setFreshDeviceIds((prev) => {
      if (!prev.has(deviceId)) return prev;
      const next = new Set(prev);
      next.delete(deviceId);
      return next;
    });
  }, []);

  useEffect(() => {
    const timers = freshTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const [selected, setSelected] = useState<AccessRequest | null>(null);
  const [action, setAction] = useState<"approve" | "deny" | null>(null);
  const [note, setNote] = useState("");
  const [exempted, setExempted] = useState(false);
  const [entryTime, setEntryTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionMatches, setSessionMatches] = useState<SessionMatch[]>([]);
  const [sessionMatchesLoading, setSessionMatchesLoading] = useState(false);
  const [matchingSessionId, setMatchingSessionId] = useState<number | null>(null);

  const [manualDevice, setManualDevice] = useState<Device | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualExempted, setManualExempted] = useState(false);
  const [manualEntryTime, setManualEntryTime] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [paymentActionId, setPaymentActionId] = useState<number | null>(null);
  const [validateBusyId, setValidateBusyId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AccessRequest | null>(null);
  const [chargeRequest, setChargeRequest] = useState<AccessRequest | null>(null);
  const [chargeMode, setChargeMode] = useState<
    "extend_previous" | "new_session"
  >("new_session");
  const [chargeEntryTime, setChargeEntryTime] = useState("");
  const [chargeBusy, setChargeBusy] = useState(false);

  const deviceIdFromRow = useCallback(
    (row: AccessRequest & { device_id?: number }) => {
      const raw = row.device_id ?? row.device;
      const n =
        typeof raw === "object" && raw !== null && "id" in raw
          ? Number((raw as { id: number }).id)
          : Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    []
  );

  const applyPendingRows = useCallback(
    (rows: AccessRequest[]) => {
      const map: Record<number, AccessRequest> = {};
      for (const row of rows || []) {
        const deviceId = deviceIdFromRow(
          row as AccessRequest & { device_id?: number }
        );
        if (deviceId != null) map[deviceId] = row;
      }
      // Snapshot / REST seed — update board only, never highlight.
      pendingByDeviceRef.current = map;
      setPendingByDevice(map);
    },
    [deviceIdFromRow]
  );

  const upsertPendingRow = useCallback(
    (row: AccessRequest & { device_id?: number }) => {
      const deviceKey = deviceIdFromRow(row);
      if (deviceKey == null) return;
      const prev = pendingByDeviceRef.current[deviceKey];
      const isNewRequest = !prev || prev.id !== row.id;
      pendingByDeviceRef.current = {
        ...pendingByDeviceRef.current,
        [deviceKey]: row,
      };
      setPendingByDevice((p) => ({ ...p, [deviceKey]: row }));
      // Pulse only for a newly arrived pending request (not snapshot/resync).
      if (isNewRequest) {
        markFresh(deviceKey);
        alertNewWait();
      }
    },
    [deviceIdFromRow, markFresh, alertNewWait]
  );

  const loadPending = useCallback(async () => {
    try {
      const data = await api<Paginated<AccessRequest>>("access-requests/", {
        query: {
          page_size: 200,
          status: "pending",
          ...projectQuery,
        },
      });
      applyPendingRows(data.results || []);
      return true;
    } catch {
      return false;
    }
  }, [applyPendingRows, projectQuery]);

  const loadDecisions = useCallback(async () => {
    setDecisionsBusy(true);
    try {
      const data = await api<Paginated<AccessRequest>>("access-requests/", {
        query: {
          page_size: 12,
          decided: 1,
          ordering: "-decided_at",
          ...projectQuery,
        },
      });
      setDecisions(data.results || []);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not load recent decisions"
      );
    } finally {
      setDecisionsBusy(false);
    }
  }, [projectQuery]);

  const clearPendingForRequest = useCallback(
    (requestId: number, deviceId: number) => {
      setPendingByDevice((prev) => {
        const current = prev[deviceId];
        if (!current || current.id !== requestId) return prev;
        const next = { ...prev };
        delete next[deviceId];
        pendingByDeviceRef.current = next;
        return next;
      });
      clearFresh(deviceId);
    },
    [clearFresh]
  );

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Paginated<Device>>("devices/", {
        query: {
          page_size: 500,
          ordering: "id",
          site_active: true,
          ...projectQuery,
        },
      });
      setDevices(data.results);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load gates");
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [projectQuery]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  // Keep the current board until the new scope actually loads, so a slow or
  // failed refetch (e.g. switching to All projects) never blanks the gates.
  useEffect(() => {
    setFreshDeviceIds(new Set());
    void loadPending();
  }, [loadPending]);

  const loadPendingRef = useRef(loadPending);
  loadPendingRef.current = loadPending;
  const applyPendingRowsRef = useRef(applyPendingRows);
  applyPendingRowsRef.current = applyPendingRows;
  const upsertPendingRowRef = useRef(upsertPendingRow);
  upsertPendingRowRef.current = upsertPendingRow;
  const clearFreshRef = useRef(clearFresh);
  clearFreshRef.current = clearFresh;

  // Fetch-based SSE: mark Live only after real bytes (snapshot/ping), not TCP open.
  useEffect(() => {
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
      setLastEventAt(Date.now());
      try {
        if (event === "snapshot") {
          const data = JSON.parse(raw) as { pending_requests: AccessRequest[] };
          // Initial board seed only — no highlight.
          applyPendingRowsRef.current(data.pending_requests || []);
          setStreamStatus("live");
          return;
        }
        if (event === "ping") {
          setStreamStatus("live");
          return;
        }
        if (event === "access_request.pending") {
          const row = JSON.parse(raw) as AccessRequest & { device_id?: number };
          upsertPendingRowRef.current(row);
          setStreamStatus("live");
          return;
        }
        if (event === "access_request.removed") {
          const row = JSON.parse(raw) as {
            id: number;
            device_id?: number;
            device?: number;
          };
          const deviceKey = Number(row.device_id ?? row.device);
          const clearedIds: number[] = [];
          setPendingByDevice((prev) => {
            const next = { ...prev };
            if (Number.isFinite(deviceKey)) {
              const current = next[deviceKey];
              if (!current || current.id === row.id) {
                delete next[deviceKey];
                clearedIds.push(deviceKey);
              }
            } else {
              for (const [deviceId, ar] of Object.entries(next)) {
                if (ar.id === row.id) {
                  delete next[Number(deviceId)];
                  clearedIds.push(Number(deviceId));
                }
              }
            }
            pendingByDeviceRef.current = next;
            return next;
          });
          for (const id of clearedIds) clearFreshRef.current(id);
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
        const res = await fetch(accessRequestStreamUrl(token, { projectId }), {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          signal: abort.signal,
          cache: "no-store",
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE HTTP ${res.status}`);
        }

        scheduleResync(0);
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
        if (closed || (err instanceof DOMException && err.name === "AbortError")) {
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
  }, [projectId]);

  const waitingCount = useMemo(
    () => Object.keys(pendingByDevice).length,
    [pendingByDevice]
  );

  // Soft-refresh pending so open-bill estimated amounts can drift while waiting.
  useEffect(() => {
    if (waitingCount === 0) return;
    const t = setInterval(() => {
      void loadPendingRef.current();
    }, 60000);
    return () => clearInterval(t);
  }, [waitingCount]);

  const grouped = useMemo(() => groupDevices(devices), [devices]);

  // Per-project waiting tallies for the sticky chips (All projects view).
  const projectChips = useMemo(
    () =>
      grouped.map((project) => {
        let waiting = 0;
        for (const site of project.sites) {
          for (const zone of site.zones) {
            waiting += zoneWaitingCount(zone, pendingByDevice);
          }
        }
        return {
          projectId: project.projectId,
          projectName: project.projectName,
          waiting,
        };
      }),
    [grouped, pendingByDevice]
  );

  // Waiting-only: keep just the gates with a waiting vehicle; hide idle lanes,
  // and drop any zone / site / project left with nothing to decide.
  const visibleGrouped = useMemo(() => {
    if (!waitingOnly) return grouped;
    const filtered: ProjectGroup[] = [];
    for (const project of grouped) {
      const sites: SiteGroup[] = [];
      for (const site of project.sites) {
        const zones: ZoneGroup[] = [];
        for (const zone of site.zones) {
          const entries = zone.entries.filter((d) => pendingByDevice[d.id]);
          const exits = zone.exits.filter((d) => pendingByDevice[d.id]);
          if (entries.length || exits.length) {
            zones.push({ ...zone, entries, exits });
          }
        }
        if (zones.length) sites.push({ ...site, zones });
      }
      if (sites.length) filtered.push({ ...project, sites });
    }
    return filtered;
  }, [waitingOnly, grouped, pendingByDevice]);

  function focusProject(id: number) {
    if (projectId === null && canSelectAll) {
      const el = document.getElementById(`gate-project-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    setProjectId(id);
  }

  async function openDecisions() {
    setDecisionsOpen(true);
    await loadDecisions();
  }

  async function loadSessionMatches(row: AccessRequest) {
    if (row.action !== "exit" || row.has_open_session) {
      setSessionMatches([]);
      return;
    }
    setSessionMatchesLoading(true);
    try {
      const rows = await api<SessionMatch[]>(
        `access-requests/${row.id}/session-matches/`
      );
      setSessionMatches(rows);
    } catch (err) {
      setSessionMatches([]);
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Could not load sessions inside this zone"
      );
    } finally {
      setSessionMatchesLoading(false);
    }
  }

  function openDecision(row: AccessRequest, next: "approve" | "deny") {
    setSelected(row);
    setAction(next);
    setNote("");
    setSessionMatches([]);
    setMatchingSessionId(null);
    setExempted(
      Boolean(
        row.wallet_exempted ||
          (next === "approve" && exitPayAtExitRequest(row))
      )
    );
    setEntryTime("");
    if (next === "approve") void loadSessionMatches(row);
  }

  async function matchSession(row: AccessRequest, session: SessionMatch) {
    setMatchingSessionId(session.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/match-session/`,
        {
          method: "POST",
          body: { session_id: session.id },
        }
      );
      upsertPendingRow(updated);
      setSelected(updated);
      setSessionMatches([]);
      toast.success(`Matched exit to session ${session.plate}`);
      if (updated.pay_at_exit_enabled && updated.open_payment_intent) {
        toast.success("Bill sent to the paired exit kiosk");
        setSelected(null);
        setAction(null);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not match this session"
      );
    } finally {
      setMatchingSessionId(null);
    }
  }

  async function unmatchSession(row: AccessRequest) {
    setMatchingSessionId(-1);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/unmatch-session/`,
        { method: "POST", body: {} }
      );
      upsertPendingRow(updated);
      setSelected(updated);
      toast.success("Exit match undone");
      void loadSessionMatches(updated);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not undo this match"
      );
    } finally {
      setMatchingSessionId(null);
    }
  }

  async function validatePayment(row: AccessRequest) {
    if (
      !window.confirm(
        `Validate payment for ${row.plate}? This charges your operator wallet (may go negative) and opens the gate.`
      )
    ) {
      return;
    }
    setValidateBusyId(row.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/validate-payment/`,
        {
          method: "POST",
          body: { note: "Validated payment via operator wallet" },
        }
      );
      const deviceId = deviceIdFromRow(updated) ?? Number(row.device);
      if (deviceId != null && Number.isFinite(deviceId)) {
        clearPendingForRequest(updated.id, deviceId);
      }
      setSelected(null);
      setAction(null);
      toast.success("Payment validated · gate opened");
      void loadPending();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not validate payment"
      );
    } finally {
      setValidateBusyId(null);
    }
  }

  function openManual(device: Device) {
    setManualDevice(device);
    setManualPlate("");
    setManualNote("");
    setManualExempted(false);
    setManualEntryTime("");
  }

  const needsEntryTime =
    action === "approve" && Boolean(selected?.requires_entry_time);

  // Wallet-only exit, no open session, no wallet: approve opens the gate
  // without a session — exempt would only flip an audit flag.
  const approveWithoutSession =
    action === "approve" &&
    selected != null &&
    exitGuestNoSession(selected);

  // Exemption is a charge-time call, so only offer it on exit approvals.
  // Entry just admits the vehicle; billing is decided when they leave.
  const showExemptOption =
    action === "approve" &&
    selected?.action === "exit" &&
    !approveWithoutSession;

  function openChargeAtKiosk(row: AccessRequest) {
    // Unpaid open session always uses Resend — Charge is for paid-outside-grace only.
    if (row.billable_open_session || row.open_payment_intent) {
      toast.message(
        row.open_payment_intent
          ? "A bill is already on the kiosk — cancel or update it instead"
          : "Use Resend bill for this unpaid open session"
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
        {
          method: "POST",
        }
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
        err instanceof ApiError ? err.message : "Could not cancel kiosk bill"
      );
    } finally {
      setPaymentActionId(null);
    }
  }

  async function sendBill(row: AccessRequest) {
    setPaymentActionId(row.id);
    try {
      const updated = await api<AccessRequest>(
        `access-requests/${row.id}/send-bill/`,
        {
          method: "POST",
        }
      );
      upsertPendingRow(updated);
      const bill = updated.open_payment_intent;
      const prev = row.billable_open_session?.previous_amount;
      const drifted =
        bill &&
        amountsDiffer(prev, bill.amount);
      toast.success(
        bill
          ? `Bill on kiosk · ${bill.amount} ${bill.currency}`
          : "Bill sent to kiosk",
        drifted && prev
          ? { description: `Was ${prev}, now ${bill.amount}` }
          : undefined
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not resend the bill"
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
        {
          method: "POST",
        }
      );
      upsertPendingRow(updated);
      const bill = updated.open_payment_intent;
      toast.success(
        bill
          ? `Amount updated · ${bill.amount} ${bill.currency}`
          : "Bill amount updated"
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not update bill amount"
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
        err instanceof ApiError ? err.message : "Could not create kiosk bill"
      );
    } finally {
      setChargeBusy(false);
      setPaymentActionId(null);
    }
  }

  async function submitDecision() {
    if (!selected || !action) return;
    if (needsEntryTime && !exempted && !entryTime) {
      toast.error("Entry time is required when there is no open session");
      return;
    }
    const noteRequired =
      action === "approve" &&
      (exempted ||
        approveWithoutSession ||
        (selected != null && exitPayAtExitRequest(selected)));
    if (noteRequired && !note.trim()) {
      toast.error("Operator note is required for this approval");
      return;
    }
    setBusy(true);
    try {
      const body =
        action === "approve"
          ? {
              note,
              exempted: approveWithoutSession ? false : exempted,
              ...(needsEntryTime && !exempted && entryTime
                ? { entry_time: new Date(entryTime).toISOString() }
                : {}),
            }
          : { note };
      const requestId = selected.id;
      const deviceId = Number(selected.device);
      await api(`access-requests/${requestId}/${action}/`, {
        method: "POST",
        body,
      });
      clearPendingForRequest(requestId, deviceId);
      toast.success(action === "approve" ? "Approved" : "Denied");
      setSelected(null);
      setAction(null);
      setNote("");
      setExempted(false);
      setEntryTime("");
      void loadPending();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Decision failed");
    } finally {
      setBusy(false);
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
          note: manualNote,
          exempted: manualDevice.type === "exit" ? manualExempted : false,
          ...(manualDevice.type === "exit" &&
          !manualExempted &&
          manualEntryTime
            ? { entry_time: new Date(manualEntryTime).toISOString() }
            : {}),
        },
      });
      if (result.granted) {
        toast.success("Gate opened");
      } else {
        toast.success("Processed");
      }
      const deviceId = manualDevice.id;
      if (result.access_request?.id) {
        clearPendingForRequest(result.access_request.id, deviceId);
      } else {
        setPendingByDevice((prev) => {
          if (!(deviceId in prev)) return prev;
          const next = { ...prev };
          delete next[deviceId];
          pendingByDeviceRef.current = next;
          return next;
        });
        clearFresh(deviceId);
      }
      setManualDevice(null);
      setManualPlate("");
      setManualNote("");
      setManualExempted(false);
      setManualEntryTime("");
      void loadPending();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to process plate"
      );
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <DetailHero
        title="Gate control"
        description="Zones with entry and exit lanes, and live vehicles waiting for a decision."
        meta={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                streamStatus === "live" && "text-success",
                streamStatus === "connecting" && "text-muted-foreground",
                streamStatus === "offline" && "text-destructive"
              )}
            >
              <Radio className="size-3.5" />
              {streamStatus === "live"
                ? "Live"
                : streamStatus === "connecting"
                  ? "Connecting…"
                  : streamStatus === "offline"
                    ? "Offline · reconnecting"
                    : "Idle"}
            </span>
            <span>
              {waitingCount} waiting · {devices.length} gates
            </span>
            {lastEventAt ? (
              <span className="text-muted-foreground">Stream receiving</span>
            ) : streamStatus === "connecting" ? (
              <span className="text-muted-foreground">Waiting for first event…</span>
            ) : (
              <span className="text-muted-foreground">No stream events yet</span>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={waitingOnly ? "default" : "outline"}
              size="sm"
              onClick={toggleWaitingOnly}
              aria-pressed={waitingOnly}
            >
              <ListFilter className="size-4" />
              {waitingOnly ? "Waiting only" : "All gates"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleSound}
              aria-pressed={soundOn}
              title={
                soundOn
                  ? "Sound on for new vehicles"
                  : "Sound off — click to enable alerts"
              }
            >
              {soundOn ? (
                <Bell className="size-4" />
              ) : (
                <BellOff className="size-4" />
              )}
              {soundOn ? "Alerts on" : "Alerts off"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void openDecisions()}
            >
              <History className="size-4" />
              Recent
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void loadDevices();
                void loadPending();
              }}
              disabled={loading}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              Refresh gates
            </Button>
          </div>
        }
      />

      {projectId === null && canSelectAll && projectChips.length > 1 ? (
        <div className="sticky top-2 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border bg-background/85 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <span className="pl-1 text-xs font-medium text-muted-foreground">
            Jump to
          </span>
          {projectChips.map((chip) => (
            <button
              key={chip.projectId}
              type="button"
              onClick={() => focusProject(chip.projectId)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/60",
                chip.waiting > 0
                  ? "border-warning/40 bg-warning-muted/50"
                  : "bg-background"
              )}
            >
              {chip.projectName}
              {chip.waiting > 0 ? (
                <span className="rounded-md bg-warning px-1.5 py-0.5 tabular-nums text-warning-foreground">
                  {chip.waiting}
                </span>
              ) : (
                <span className="tabular-nums text-muted-foreground">0</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {loading && devices.length === 0 ? (
        <Loader label="Loading gates…" />
      ) : devices.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No gates yet"
          description="Add entry/exit devices under a project site to see them here."
        />
      ) : waitingOnly && visibleGrouped.length === 0 ? (
        <EmptyState
          icon={DoorClosed}
          title="No vehicles waiting"
          description="Every gate is clear. Switch to All gates to see idle lanes."
        />
      ) : (
        <div className="space-y-8">
          {visibleGrouped.map((project) => (
            <section
              key={project.projectId}
              id={`gate-project-${project.projectId}`}
              className="scroll-mt-24 space-y-4"
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Project
                </p>
                <h2 className="text-lg font-semibold tracking-tight">
                  {project.projectName}
                </h2>
              </div>

              <div className="space-y-10">
                {project.sites.map((site) => {
                  const counts = siteGateCounts(site);
                  return (
                    <div key={site.siteId} className="space-y-5">
                      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Site
                          </p>
                          <h3 className="text-base font-semibold tracking-tight">
                            {site.siteName}
                          </h3>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {site.zones.length} zone
                          {site.zones.length === 1 ? "" : "s"} · {counts.entries}{" "}
                          entry · {counts.exits} exit
                        </span>
                      </div>

                      {site.zones.length > 1 ? (
                        <div className="flex flex-wrap gap-2">
                          {site.zones.map((zone) => {
                            const waiting = zoneWaitingCount(
                              zone,
                              pendingByDevice
                            );
                            return (
                              <a
                                key={zone.zoneId}
                                href={`#gate-zone-${site.siteId}-${zone.zoneId}`}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60",
                                  waiting > 0
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100"
                                    : "bg-background"
                                )}
                              >
                                <Layers className="size-3.5 opacity-70" />
                                <span
                                  className={cn(
                                    zone.depth > 0 && "text-muted-foreground"
                                  )}
                                >
                                  {zone.depth > 0 ? `${"· ".repeat(zone.depth)}` : ""}
                                  {zone.zoneName}
                                </span>
                                {waiting > 0 ? (
                                  <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 tabular-nums">
                                    {waiting}
                                  </span>
                                ) : (
                                  <span className="tabular-nums text-muted-foreground">
                                    {zoneGateCount(zone)}
                                  </span>
                                )}
                              </a>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="space-y-5">
                        {site.zones.map((zone) => {
                          const waiting = zoneWaitingCount(
                            zone,
                            pendingByDevice
                          );
                          const nested = zone.depth > 0 || Boolean(zone.parentName);
                          return (
                            <section
                              key={zone.zoneId}
                              id={`gate-zone-${site.siteId}-${zone.zoneId}`}
                              className={cn(
                                "scroll-mt-24 overflow-hidden rounded-2xl border bg-card/40",
                                nested && "border-l-[3px] border-l-sky-600/70"
                              )}
                              style={
                                zone.depth > 0
                                  ? {
                                      marginLeft: Math.min(zone.depth, 3) * 12,
                                    }
                                  : undefined
                              }
                            >
                              <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                                <div className="flex min-w-0 items-start gap-3">
                                  <span
                                    className={cn(
                                      "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                                      waiting > 0
                                        ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                                        : nested
                                          ? "bg-sky-500/10 text-sky-800 dark:text-sky-200"
                                          : "bg-muted text-muted-foreground"
                                    )}
                                  >
                                    <Layers className="size-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="truncate text-sm font-semibold tracking-tight">
                                        {zone.zoneName}
                                      </h4>
                                      {nested && zone.parentName ? (
                                        <Badge variant="outline" className="font-normal">
                                          Inside {zone.parentName}
                                        </Badge>
                                      ) : null}
                                      {waiting > 0 ? (
                                        <Badge variant="warning">
                                          {waiting} waiting
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                      {zone.entries.length} entry ·{" "}
                                      {zone.exits.length} exit
                                      {nested
                                        ? " · nested zone — exit bills the full stack"
                                        : ""}
                                    </p>
                                  </div>
                                </div>
                              </header>

                              <div
                                className={cn(
                                  "grid gap-6 p-4",
                                  !(waitingOnly && zone.entries.length === 0) &&
                                    !(waitingOnly && zone.exits.length === 0) &&
                                    "xl:grid-cols-2"
                                )}
                              >
                                {waitingOnly && zone.entries.length === 0 ? null : (
                                  <GateColumn
                                    title="Entry"
                                    hint={`Into ${zone.zoneName}`}
                                    tone="entry"
                                    devices={zone.entries}
                                    pendingByDevice={pendingByDevice}
                                    freshDeviceIds={freshDeviceIds}
                                    canDecide={canDecide}
                                    onApprove={(row) =>
                                      openDecision(row, "approve")
                                    }
                                    onDeny={(row) => openDecision(row, "deny")}
                                    onManual={openManual}
                                  />
                                )}
                                {waitingOnly && zone.exits.length === 0 ? null : (
                                  <GateColumn
                                    title="Exit"
                                    hint={`Out of ${zone.zoneName}`}
                                    tone="exit"
                                    devices={zone.exits}
                                    pendingByDevice={pendingByDevice}
                                    freshDeviceIds={freshDeviceIds}
                                    canDecide={canDecide}
                                    onApprove={(row) =>
                                      openDecision(row, "approve")
                                    }
                                    onDeny={(row) => openDecision(row, "deny")}
                                    onManual={openManual}
                                  onUnmatch={(row) => {
                                    void unmatchSession(row);
                                  }}
                                  onValidatePayment={(row) => {
                                    void validatePayment(row);
                                  }}
                                  onChargeAtKiosk={(row) => {
                                    openChargeAtKiosk(row);
                                  }}
                                  onCancelBill={(row) => {
                                    setCancelTarget(row);
                                  }}
                                  onSendBill={(row) => {
                                    void sendBill(row);
                                  }}
                                  onRefreshBill={(row) => {
                                    void refreshBill(row);
                                  }}
                                  paymentActionId={paymentActionId}
                                  unmatchBusy={matchingSessionId === -1}
                                  validateBusy={validateBusyId != null}
                                />
                                )}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

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
                    : "hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 size-4 shrink-0 rounded-full border-2",
                  chargeMode === "extend_previous" &&
                    chargeRequest?.can_extend_previous
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40"
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
                {chargeRequest?.previous_session ? (
                  <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>Started</span>
                    <span className="text-right tabular-nums text-foreground">
                      {formatDateTime(
                        chargeRequest.previous_session.start_time
                      )}
                    </span>
                    <span>Grace ended</span>
                    <span className="text-right tabular-nums text-foreground">
                      {formatDateTime(
                        chargeRequest.previous_session.paid_exit_until
                      )}
                    </span>
                    <span>Paid so far</span>
                    <span className="text-right tabular-nums text-foreground">
                      {formatMoney(chargeRequest.previous_session.fee)}
                    </span>
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setChargeMode("new_session")}
              className={cn(
                "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
                chargeMode === "new_session"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 size-4 shrink-0 rounded-full border-2",
                  chargeMode === "new_session"
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40"
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  New session from entry time
                </span>
                <span className="block text-xs text-muted-foreground">
                  Bills the full interval from the manual entry time. Any older
                  open session is closed administratively and recorded in its
                  audit history.
                </span>
              </span>
            </button>
            {chargeMode === "new_session" ? (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted p-3">
                <Label htmlFor="gc-charge-entry-time">Entry time (required)</Label>
                <Input
                  id="gc-charge-entry-time"
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
              . A late payment on this bill is still recorded, but the gate stays
              closed unless the request is still pending.
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

      <Dialog
        open={decisionsOpen}
        onOpenChange={(open) => {
          setDecisionsOpen(open);
          if (!open) setDecisions(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recent decisions</DialogTitle>
            <DialogDescription>
              Last approvals and denials for the current project scope.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {decisionsBusy && decisions === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            ) : decisions && decisions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No decisions yet in this scope.
              </p>
            ) : (
              (decisions || []).map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold tracking-wide">
                        {row.plate}
                      </span>
                      <Badge
                        variant={
                          row.status === "approved"
                            ? "success"
                            : "destructive"
                        }
                      >
                        {row.status}
                      </Badge>
                      <span className="text-[11px] uppercase text-muted-foreground">
                        {row.action}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.site_name}
                      {row.decided_by_username
                        ? ` · ${row.decided_by_username}`
                        : ""}
                    </p>
                    {row.reason ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/70">
                          System:{" "}
                        </span>
                        {row.reason}
                      </p>
                    ) : null}
                    {row.decision_note ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/70">
                          Operator:{" "}
                        </span>
                        {row.decision_note}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatDateTime(row.decided_at)}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDecisions()}
              disabled={decisionsBusy}
            >
              <RefreshCw
                className={cn("size-4", decisionsBusy && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selected && action)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setAction(null);
            setSessionMatches([]);
            setMatchingSessionId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "approve" && selected && exitPayAtExitRequest(selected)
                ? "Approve without charge"
                : action === "approve"
                  ? "Approve"
                  : "Deny"}{" "}
              {selected?.plate}
            </DialogTitle>
            <DialogDescription>
              {selected?.site_name}
              {selected?.zone_name ? ` · ${selected.zone_name}` : ""} ·{" "}
              {selected?.device_label} · {selected?.action}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selected?.reason ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  System reason
                </p>
                <p className="mt-0.5 leading-snug">{selected.reason}</p>
              </div>
            ) : null}
            {selected?.action === "exit" && selected.exit_matched ? (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div>
                  <p className="text-sm font-medium">Matched to open session</p>
                  <p className="text-xs text-muted-foreground">
                    OCR {selected.exit_match_ocr || "—"} → {selected.plate}
                    {selected.exit_match_session_id
                      ? ` · session #${selected.exit_match_session_id}`
                      : ""}
                    . Undo keeps the match history in the session audit.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={matchingSessionId !== null}
                  onClick={() => void unmatchSession(selected)}
                >
                  <RotateCcw className="size-4" />
                  {matchingSessionId === -1 ? "Undoing…" : "Undo match"}
                </Button>
              </div>
            ) : action === "approve" &&
              selected?.action === "exit" &&
              selected.has_open_session === false ? (
              <div className="space-y-2 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">
                    Match a session inside {selected.zone_name || "this zone"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Best plate matches are first (≥50%). Matching does not open
                    the gate; it links this exit read to the selected stay.
                  </p>
                </div>
                {sessionMatchesLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading open sessions…
                  </p>
                ) : sessionMatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No useful plate matches (≥50%) among open sessions in this
                    zone.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-2 overflow-y-auto">
                    {sessionMatches.slice(0, 3).map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold">
                              {session.plate}
                            </span>
                            {session.weak || session.match_percent < 60 ? (
                              <Badge variant="outline">
                                {session.match_percent}% · weak
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                {session.match_percent}% match
                              </Badge>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            Entered {formatDateTime(session.start_time)} ·{" "}
                            {session.entry_device_label}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={matchingSessionId !== null}
                          onClick={() => void matchSession(selected, session)}
                        >
                          {matchingSessionId === session.id
                            ? "Matching…"
                            : "Match"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="gc-note">
                {action === "approve" &&
                (exempted ||
                  approveWithoutSession ||
                  (selected != null && exitPayAtExitRequest(selected)))
                  ? "Operator note (required)"
                  : "Operator note (optional)"}
              </Label>
              <Textarea
                id="gc-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  action === "approve" &&
                  (exempted ||
                    approveWithoutSession ||
                    (selected != null && exitPayAtExitRequest(selected)))
                    ? "Required — e.g. cash paid, stuck vehicle, exempt exception…"
                    : "Your note for this decision — separate from the system reason above"
                }
              />
            </div>
            {action === "approve" ? (
              <>
                {selected && exitPayAtExitRequest(selected) ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
                    <p className="font-medium">Approve without charge</p>
                    <p className="mt-0.5 text-xs opacity-80">
                      Exception only (cash, stuck vehicle, etc.). Opens the gate
                      without kiosk payment; note is required and the stay is
                      stamped as operator-waived.
                    </p>
                  </div>
                ) : null}
                {showExemptOption && selected?.wallet_exempted ? (
                  <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-900 dark:text-sky-100">
                    <p className="font-medium">Exempt wallet</p>
                    <p className="mt-0.5 text-xs opacity-80">
                      {selected.wallet_name
                        ? `${selected.wallet_name} is billing-exempt`
                        : "This plate belongs to a billing-exempt wallet"}
                      . Approve will not charge the wallet.
                    </p>
                  </div>
                ) : null}
                {showExemptOption &&
                !(selected != null && exitPayAtExitRequest(selected)) ? (
                  <label className="flex items-start gap-3 rounded-lg border p-3">
                    <Checkbox
                      checked={exempted}
                      onCheckedChange={(v) => setExempted(v === true)}
                      disabled={Boolean(selected?.wallet_exempted)}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        Exempt from billing
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {selected?.wallet_exempted
                          ? "Locked on because this is an exempt wallet."
                          : "No wallet charge. If unchecked, fee may drive the wallet negative."}
                      </span>
                    </span>
                  </label>
                ) : null}
                {needsEntryTime && !exempted ? (
                  <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted p-3">
                    <Label htmlFor="gc-entry-time">Entry time (required)</Label>
                    <Input
                      id="gc-entry-time"
                      type="datetime-local"
                      value={entryTime}
                      onChange={(e) => setEntryTime(e.target.value)}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSelected(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant={action === "deny" ? "destructive" : "default"}
                onClick={() => void submitDecision()}
                disabled={
                  busy ||
                  (action === "approve" &&
                    (exempted ||
                      approveWithoutSession ||
                      (selected != null && exitPayAtExitRequest(selected))) &&
                    !note.trim())
                }
              >
                {busy ? "Saving…" : `Confirm ${action}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(manualDevice)}
        onOpenChange={(open) => {
          if (!open) {
            setManualDevice(null);
            setManualPlate("");
            setManualNote("");
            setManualExempted(false);
            setManualEntryTime("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter plate</DialogTitle>
            <DialogDescription>
              {manualDevice
                ? `${manualDevice.site_name}${
                    manualDevice.zone_name
                      ? ` · ${manualDevice.zone_name}`
                      : ""
                  } · ${gateLabel(manualDevice)} · ${manualDevice.type}`
                : null}
              . Creates an access request and opens the gate immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gc-manual-plate">Plate number</Label>
              <Input
                id="gc-manual-plate"
                value={manualPlate}
                onChange={(e) => setManualPlate(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitManualPlate();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gc-manual-note">Operator note (optional)</Label>
              <Textarea
                id="gc-manual-note"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="Your note for this manual open"
              />
            </div>
            {manualDevice?.type === "exit" ? (
              <label className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  checked={manualExempted}
                  onCheckedChange={(v) => setManualExempted(v === true)}
                />
                <span>
                  <span className="block text-sm font-medium">
                    Exempt from billing
                  </span>
                  <span className="text-xs text-muted-foreground">
                    No wallet charge. If unchecked, fee may drive the wallet
                    negative.
                  </span>
                </span>
              </label>
            ) : null}
            {manualDevice?.type === "exit" && !manualExempted ? (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted p-3">
                <Label htmlFor="gc-manual-entry-time">
                  Entry time (required if no open session)
                </Label>
                <Input
                  id="gc-manual-entry-time"
                  type="datetime-local"
                  value={manualEntryTime}
                  onChange={(e) => setManualEntryTime(e.target.value)}
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setManualDevice(null)}
                disabled={manualBusy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitManualPlate()}
                disabled={manualBusy || !manualPlate.trim()}
              >
                {manualBusy ? "Opening…" : "Open gate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
