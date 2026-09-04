"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Building2,
  CarFront,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FolderKanban,
  Gauge,
  History,
  Layers,
  ParkingSquare,
  Plus,
  Search,
  ShieldX,
  UserRound,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardCharts } from "@/components/dashboard-charts";
import {
  DateRangeFilter,
  toEndOfDayIso,
  toStartOfDayIso,
  type DateRangeValue,
} from "@/components/date-range-filter";
import { DetailHero } from "@/components/detail-hero";
import { EmptyState } from "@/components/empty-state";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { useProjectFilter } from "@/components/providers/project-filter-provider";
import { SessionBillingBadges } from "@/components/session-billing-badges";
import { StatGrid, StatTile } from "@/components/stat-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { api, apiDownload, ApiError } from "@/lib/api";
import type {
  AccessRequest,
  Wallet,
  OpsDashboard,
  Paginated,
  ProjectVehicle,
  Session,
  Site,
  Zone,
} from "@/lib/types";
import { cn, formatDateTime, formatDuration, formatMoney } from "@/lib/utils";

const TAB_KEYS = [
  "overview",
  "sessions",
  "access-requests",
  "sites",
  "vehicles",
  "wallets",
] as const;
export type WorkspaceSection = (typeof TAB_KEYS)[number];

export const SECTION_PATHS: Record<WorkspaceSection, string> = {
  overview: "/dashboard",
  sessions: "/sessions",
  "access-requests": "/decisions",
  sites: "/sites",
  vehicles: "/vehicles",
  wallets: "/wallets",
};

type WorkspaceStats = {
  sites: number;
  devices: number;
  devices_enabled: number;
  sessions: number;
  sessions_open: number;
  sessions_unpaid_closed: number;
  vehicles: number;
  wallets: number;
  pending_requests: number;
};

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return TAB_KEYS.includes(value as WorkspaceSection);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function walletBalanceHealth(pct: number | null | undefined, balance: number) {
  if (!Number.isNaN(balance) && balance < 0) {
    return {
      tone: "critical" as const,
      label: "Overdrawn",
      bar: "bg-destructive",
      track: "bg-destructive/15",
    };
  }
  if (pct == null) {
    return {
      tone: "neutral" as const,
      label: "No top-up yet",
      bar: "bg-muted-foreground/40",
      track: "bg-muted",
    };
  }
  if (pct <= 10) {
    return {
      tone: "critical" as const,
      label: `${pct}% of last top-up`,
      bar: "bg-destructive",
      track: "bg-destructive/15",
    };
  }
  if (pct <= 25) {
    return {
      tone: "warning" as const,
      label: `${pct}% of last top-up`,
      bar: "bg-amber-500",
      track: "bg-amber-500/15",
    };
  }
  if (pct <= 50) {
    return {
      tone: "caution" as const,
      label: `${pct}% of last top-up`,
      bar: "bg-amber-400",
      track: "bg-amber-400/15",
    };
  }
  return {
    tone: "ok" as const,
    label: `${pct}% of last top-up`,
    bar: "bg-emerald-500",
    track: "bg-emerald-500/15",
  };
}

const WALLET_BALANCE_PCT_OPTIONS = [
  { value: "all", label: "Any balance level" },
  { value: "10", label: "Critical · ≤ 10%" },
  { value: "25", label: "Low · ≤ 25%" },
  { value: "50", label: "Watch · ≤ 50%" },
  { value: "75", label: "Below 75%" },
] as const;

function formatStayDuration(start: string, end?: string | null) {
  const from = new Date(start).getTime();
  if (Number.isNaN(from)) return "—";
  const to = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(to) || to < from) return "—";
  const mins = Math.round((to - from) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days}d ${h}h` : `${days}d`;
}

function dedupeVehiclesByPlate(rows: ProjectVehicle[]): ProjectVehicle[] {
  const byPlate = new Map<string, ProjectVehicle>();
  for (const row of rows) {
    const key = row.plate.trim().toUpperCase();
    const existing = byPlate.get(key);
    if (!existing) {
      byPlate.set(key, row);
      continue;
    }
    // Prefer an open stay; otherwise the more recent last_seen.
    const preferNew =
      (row.is_open && !existing.is_open) ||
      (row.is_open === existing.is_open &&
        row.last_seen.localeCompare(existing.last_seen) > 0);
    if (preferNew) {
      byPlate.set(key, {
        ...row,
        session_count: Math.max(existing.session_count, row.session_count),
      });
    } else {
      byPlate.set(key, {
        ...existing,
        session_count: Math.max(existing.session_count, row.session_count),
      });
    }
  }
  return Array.from(byPlate.values()).sort((a, b) => {
    if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
    return b.last_seen.localeCompare(a.last_seen);
  });
}

function ZoneLabel({
  name,
  parentName,
  className,
}: {
  name?: string | null;
  parentName?: string | null;
  className?: string;
}) {
  if (!name) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className
      )}
    >
      <Layers className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">
        {name}
        {parentName ? (
          <span className="opacity-70"> · in {parentName}</span>
        ) : null}
      </span>
    </span>
  );
}

function zoneOptionLabel(zone: Zone, showSite: boolean) {
  const nest = zone.parent_name ? ` · in ${zone.parent_name}` : "";
  if (showSite) return `${zone.site_name} · ${zone.name}${nest}`;
  return `${zone.name}${nest}`;
}

function DecisionsList({
  query,
  refreshKey,
  isAll,
  onResetFilters,
}: {
  query: Record<string, string | number | boolean | undefined | null>;
  refreshKey: number;
  isAll: boolean;
  onResetFilters: () => void;
}) {
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  useEffect(() => {
    setPage(1);
  }, [JSON.stringify(query), refreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await api<Paginated<AccessRequest>>("access-requests/", {
          query: { ...query, page },
        });
        if (!cancelled) {
          setRows(data.results);
          setCount(data.count);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof ApiError ? err.message : "Failed to load");
          setRows([]);
          setCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [page, JSON.stringify(query), refreshKey]);

  const medianResolution = (() => {
    const spans = rows
      .filter((row) => row.decided_at)
      .map(
        (row) =>
          new Date(row.decided_at as string).getTime() -
          new Date(row.created_at).getTime()
      )
      .filter((ms) => Number.isFinite(ms) && ms >= 0)
      .sort((a, b) => a - b);
    if (spans.length === 0) return null;
    const mid = spans[Math.floor(spans.length / 2)];
    const at = new Date(0).toISOString();
    return formatDuration(at, new Date(mid).toISOString());
  })();

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {loading ? (
        <Loader compact label="Loading decisions…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No decisions found"
          description="Try a different plate, date range, or site filter."
          action={
            <Button variant="outline" size="sm" onClick={onResetFilters}>
              Reset filters
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {rows.map((row, index) => {
            const approved = row.status === "approved";
            const denied = row.status === "denied";
            const gateOnly = Boolean(row.opened_without_session);
            const resolution = formatDuration(row.created_at, row.decided_at);
            const slowResolution =
              row.decided_at != null &&
              new Date(row.decided_at).getTime() -
                new Date(row.created_at).getTime() >
                2 * 60 * 1000;
            return (
              <li
                key={row.id}
                className="animate-fade-up flex items-start gap-3 px-4 py-4 sm:items-center sm:gap-4 sm:px-5"
                style={{ animationDelay: `${index * 25}ms` }}
              >
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    approved
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : denied
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {approved ? (
                    <CheckCircle2 className="size-5" />
                  ) : denied ? (
                    <ShieldX className="size-5" />
                  ) : (
                    <ClipboardCheck className="size-5" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold tracking-[0.14em]">
                      {row.plate}
                    </span>
                    <Badge
                      variant={
                        approved ? "success" : denied ? "destructive" : "secondary"
                      }
                      className="capitalize"
                    >
                      {row.status}
                    </Badge>
                    <Badge variant="outline" className="font-normal capitalize">
                      {row.action}
                    </Badge>
                    {row.wallet_exempted ? (
                      <Badge variant="exempt">Exempt wallet</Badge>
                    ) : row.exempted ? (
                      <Badge variant="exempt">Waived</Badge>
                    ) : null}
                    {isAll && row.project_name ? (
                      <Badge variant="outline" className="font-normal">
                        {row.project_name}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="size-3.5 shrink-0" />
                      {row.site_name}
                    </span>
                    {row.zone_name ? <ZoneLabel name={row.zone_name} /> : null}
                    {row.device_label ? (
                      <span className="truncate">{row.device_label}</span>
                    ) : null}
                  </div>
                  {row.reason || row.decision_note ? (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {row.reason ? (
                        <p className="line-clamp-2">
                          <span className="font-medium text-foreground/70">
                            System:{" "}
                          </span>
                          {row.reason}
                        </p>
                      ) : null}
                      {row.decision_note ? (
                        <p className="line-clamp-2">
                          <span className="font-medium text-foreground/70">
                            Operator:{" "}
                          </span>
                          {row.decision_note}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex w-[9.5rem] shrink-0 flex-col items-end gap-2 sm:w-40">
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {formatDateTime(row.decided_at || row.created_at)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {row.decided_by_username
                        ? `by ${row.decided_by_username}`
                        : "System"}
                    </p>
                    {resolution ? (
                      <span
                        className={cn(
                          "mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                          slowResolution
                            ? "bg-warning-muted text-warning-muted-foreground"
                            : "bg-muted/80 text-muted-foreground"
                        )}
                        title={`Requested ${formatDateTime(row.created_at)}`}
                      >
                        <Clock3 className="size-3 shrink-0" />
                        {resolution}
                      </span>
                    ) : null}
                  </div>
                  {row.linked_session_id || gateOnly ? (
                    <div className="flex w-full flex-col items-end border-t border-border/70 pt-2">
                      {row.linked_session_id ? (
                        <Link
                          href={`/sessions/${row.linked_session_id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          View session
                          <ChevronRight className="size-3" />
                        </Link>
                      ) : (
                        <Badge variant="secondary" className="font-normal">
                          No session · open only
                        </Badge>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {count === 0
            ? "0 decisions"
            : `Showing ${(page - 1) * pageSize + 1}–${Math.min(
                page * pageSize,
                count
              )} of ${count}`}
          {medianResolution ? (
            <span className="ml-2 opacity-80">
              · median response {medianResolution} on this page
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
            {page}/{totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export type ProjectWorkspaceProps = {
  section: WorkspaceSection;
};

export function ProjectWorkspace(props: ProjectWorkspaceProps) {
  return <ProjectWorkspaceContent {...props} />;
}

function ProjectWorkspaceContent({ section }: ProjectWorkspaceProps) {
  const router = useRouter();
  const { canAccessDashboard, canAccessGateControl } = useAuth();
  const {
    projectId,
    projectName,
    projectQuery,
    label,
    projects,
    ready: filterReady,
  } = useProjectFilter();
  const activeTab = section;
  const isAll = projectId == null;

  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [ops, setOps] = useState<OpsDashboard | null>(null);
  const [projectActive, setProjectActiveFlag] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [vehicles, setVehicles] = useState<ProjectVehicle[]>([]);
  const [openSessions, setOpenSessions] = useState<Session[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const listsRequestId = useRef(0);

  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehicleSiteFilter, setVehicleSiteFilter] = useState("all");
  const [vehicleZoneFilter, setVehicleZoneFilter] = useState("all");

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsCount, setWalletsCount] = useState(0);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletSearch, setWalletSearch] = useState("");
  const [walletDebounced, setWalletDebounced] = useState("");
  const [walletBalancePct, setWalletBalancePct] = useState("all");
  const [walletPage, setWalletPage] = useState(1);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletName, setWalletName] = useState("");
  const [walletActive, setWalletActive] = useState(true);
  const [walletExempted, setWalletExempted] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletProjectId, setWalletProjectId] = useState("");
  const [walletKind, setWalletKind] = useState<"clients" | "operators">(() => {
    if (typeof window === "undefined") return "clients";
    return new URLSearchParams(window.location.search).get("kind") === "operators"
      ? "operators"
      : "clients";
  });
  const [walletKindCounts, setWalletKindCounts] = useState({
    clients: 0,
    operators: 0,
  });

  const [sessionsList, setSessionsList] = useState<Session[]>([]);
  const [sessionsCount, setSessionsCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionDebounced, setSessionDebounced] = useState("");
  const [sessionPayment, setSessionPayment] = useState("all");
  const [sessionWaiver, setSessionWaiver] = useState("all");
  const [sessionStatus, setSessionStatus] = useState("all");
  const [sessionExempt, setSessionExempt] = useState("all");
  const [sessionMethod, setSessionMethod] = useState("all");
  const [sessionMatched, setSessionMatched] = useState("all");
  const [sessionSiteId, setSessionSiteId] = useState("all");
  const [sessionZoneId, setSessionZoneId] = useState("all");
  const [sessionDateRange, setSessionDateRange] = useState<DateRangeValue>({});
  const [sessionsExporting, setSessionsExporting] = useState(false);

  const [arSearch, setArSearch] = useState("");
  const [arDebounced, setArDebounced] = useState("");
  const [arStatus, setArStatus] = useState("all");
  const [arSiteId, setArSiteId] = useState("all");
  const [arZoneId, setArZoneId] = useState("all");
  const [arDateRange, setArDateRange] = useState<DateRangeValue>({});
  const [arExporting, setArExporting] = useState(false);
  const [arRefreshKey, setArRefreshKey] = useState(0);

  useEffect(() => {
    const fallback = projects[0] ? String(projects[0].id) : "";
    const scoped = projectId != null ? String(projectId) : fallback;
    setWalletProjectId(scoped);
  }, [projectId, projects]);

  useEffect(() => {
    setVehicleSiteFilter("all");
    setVehicleZoneFilter("all");
    setWalletPage(1);
    setSessionsPage(1);
    setSessionSiteId("all");
    setSessionZoneId("all");
    setArSiteId("all");
    setArZoneId("all");
  }, [projectId]);

  useEffect(() => {
    setSessionZoneId("all");
  }, [sessionSiteId]);

  useEffect(() => {
    setArZoneId("all");
  }, [arSiteId]);

  useEffect(() => {
    setVehicleZoneFilter("all");
  }, [vehicleSiteFilter]);

  const loadDashboard = useCallback(async () => {
    if (!canAccessDashboard) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api<OpsDashboard>("ops/dashboard/", {
        query: { ...projectQuery },
      });
      setOps(data);
      setStats({
        sites: data.stats.sites,
        devices: data.stats.devices,
        devices_enabled: data.stats.devices_enabled,
        sessions: data.stats.sessions_total,
        sessions_open: data.stats.sessions_open,
        sessions_unpaid_closed: data.stats.sessions_unpaid_closed,
        vehicles: data.stats.vehicles,
        wallets: data.stats.wallets,
        pending_requests: data.stats.pending_requests,
      });
      if (projectId != null) {
        const row = data.projects.find((p) => p.id === projectId);
        setProjectActiveFlag(row?.is_active ?? true);
      } else {
        setProjectActiveFlag(true);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load dashboard"
      );
      setOps(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [canAccessDashboard, projectId, projectQuery]);

  const loadLists = useCallback(async () => {
    if (!canAccessDashboard) {
      setListsLoading(false);
      return;
    }
    const requestId = ++listsRequestId.current;
    setListsLoading(true);
    const errors: string[] = [];
    const scopedProject = projectId;
    const stillCurrent = () => requestId === listsRequestId.current;

    try {
      const sitesData = await api<Paginated<Site>>("sites/", {
        query: {
          ...(scopedProject != null ? { project: scopedProject } : {}),
          page: 1,
          page_size: 100,
        },
      });
      if (stillCurrent()) setSites(sitesData.results ?? []);
    } catch (err) {
      if (stillCurrent()) {
        setSites([]);
        errors.push(
          err instanceof ApiError ? err.message : "Failed to load sites"
        );
      }
    }

    try {
      const zonesData = await api<Paginated<Zone> | Zone[]>("zones/", {
        query: {
          ...(scopedProject != null ? { project: scopedProject } : {}),
          page_size: 500,
          is_active: true,
        },
      });
      const list = Array.isArray(zonesData)
        ? zonesData
        : zonesData.results ?? [];
      if (stillCurrent()) setZones(list);
    } catch (err) {
      if (stillCurrent()) {
        setZones([]);
        errors.push(
          err instanceof ApiError ? err.message : "Failed to load zones"
        );
      }
    }

    try {
      const vehiclesPath =
        scopedProject != null
          ? `projects/${scopedProject}/vehicles/`
          : "ops/vehicles/";
      const vehiclesData = await api<{
        count: number;
        results: ProjectVehicle[];
      }>(vehiclesPath);
      if (stillCurrent()) setVehicles(dedupeVehiclesByPlate(vehiclesData.results ?? []));
    } catch (err) {
      if (!stillCurrent()) return;
      if (scopedProject == null && projects.length > 0) {
        try {
          const all: ProjectVehicle[] = [];
          await Promise.all(
            projects.map(async (p) => {
              const data = await api<{
                count: number;
                results: ProjectVehicle[];
              }>(`projects/${p.id}/vehicles/`);
              for (const row of data.results ?? []) {
                all.push({
                  ...row,
                  project_id: row.project_id ?? p.id,
                  project_name: row.project_name ?? p.name,
                });
              }
            })
          );
          if (stillCurrent()) setVehicles(dedupeVehiclesByPlate(all));
        } catch (fallbackErr) {
          if (stillCurrent()) {
            setVehicles([]);
            errors.push(
              fallbackErr instanceof ApiError
                ? fallbackErr.message
                : "Failed to load vehicles"
            );
          }
        }
      } else if (stillCurrent()) {
        setVehicles([]);
        errors.push(
          err instanceof ApiError ? err.message : "Failed to load vehicles"
        );
      }
    }

    if (stillCurrent()) {
      if (errors.length) toast.error(errors[0]);
      setListsLoading(false);
    }
  }, [canAccessDashboard, projectId, projects]);

  const loadOpenSessions = useCallback(async () => {
    if (!canAccessDashboard) {
      setOpenSessions([]);
      return;
    }
    try {
      const sessionsData = await api<Paginated<Session>>("sessions/", {
        query: {
          ...projectQuery,
          open: "1",
          page: 1,
          page_size: 25,
        },
      });
      setOpenSessions(sessionsData.results ?? []);
    } catch (err) {
      setOpenSessions([]);
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load sessions"
      );
    }
  }, [canAccessDashboard, projectQuery]);

  useEffect(() => {
    if (!filterReady) return;
    void loadDashboard();
  }, [filterReady, loadDashboard]);

  useEffect(() => {
    if (!filterReady) return;
    void loadLists();
  }, [filterReady, loadLists]);

  useEffect(() => {
    if (!filterReady || activeTab !== "overview") return;
    void loadOpenSessions();
  }, [filterReady, activeTab, loadOpenSessions]);

  useEffect(() => {
    const t = setTimeout(() => setWalletDebounced(walletSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [walletSearch]);

  useEffect(() => {
    setWalletPage(1);
  }, [walletDebounced, walletBalancePct, walletKind]);

  useEffect(() => {
    const t = setTimeout(() => setSessionDebounced(sessionSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [sessionSearch]);

  const sessionQuery = useMemo(
    () => ({
      ...projectQuery,
      search: sessionDebounced || undefined,
      payment_status:
        sessionPayment === "all" ? undefined : sessionPayment,
      waiver_kind: sessionWaiver === "all" ? undefined : sessionWaiver,
      ...(sessionStatus === "open" ? { open: "1" } : {}),
      ...(sessionStatus === "closed" ? { closed: "1" } : {}),
      billing_exempt:
        sessionExempt === "all"
          ? undefined
          : sessionExempt === "yes"
            ? "1"
            : "0",
      billing_method:
        sessionMethod === "all" ? undefined : sessionMethod,
      exit_matched:
        sessionMatched === "all"
          ? undefined
          : sessionMatched === "yes"
            ? "1"
            : "0",
      site: sessionSiteId === "all" ? undefined : sessionSiteId,
      zone: sessionZoneId === "all" ? undefined : sessionZoneId,
      start_after: sessionDateRange.from
        ? toStartOfDayIso(sessionDateRange.from)
        : undefined,
      start_before: sessionDateRange.to
        ? toEndOfDayIso(sessionDateRange.to)
        : sessionDateRange.from
          ? toEndOfDayIso(sessionDateRange.from)
          : undefined,
    }),
    [
      projectQuery,
      sessionDebounced,
      sessionPayment,
      sessionWaiver,
      sessionStatus,
      sessionExempt,
      sessionMethod,
      sessionMatched,
      sessionSiteId,
      sessionZoneId,
      sessionDateRange.from,
      sessionDateRange.to,
    ]
  );

  useEffect(() => {
    const t = setTimeout(() => setArDebounced(arSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [arSearch]);

  const accessRequestQuery = useMemo(
    () => ({
      ...projectQuery,
      // Always history mode — never pending or timeout.
      decided: "1",
      search: arDebounced || undefined,
      status: arStatus === "all" ? undefined : arStatus,
      site: arSiteId === "all" ? undefined : arSiteId,
      zone: arZoneId === "all" ? undefined : arZoneId,
      ordering: "-decided_at",
      decided_after: arDateRange.from
        ? toStartOfDayIso(arDateRange.from)
        : undefined,
      decided_before: arDateRange.to
        ? toEndOfDayIso(arDateRange.to)
        : arDateRange.from
          ? toEndOfDayIso(arDateRange.from)
          : undefined,
    }),
    [
      projectQuery,
      arDebounced,
      arStatus,
      arSiteId,
      arZoneId,
      arDateRange.from,
      arDateRange.to,
    ]
  );

  useEffect(() => {
    setSessionsPage(1);
  }, [sessionQuery]);

  const loadWallets = useCallback(async () => {
    setWalletsLoading(true);
    try {
      const data = await api<Paginated<Wallet>>("wallets/", {
        query: {
          ...projectQuery,
          page: walletPage,
          search: walletDebounced || undefined,
          max_balance_pct_of_last_topup:
            walletBalancePct === "all" ? undefined : walletBalancePct,
          operator: walletKind === "operators" ? "1" : "0",
        },
      });
      setWallets(data.results);
      setWalletsCount(data.count);
      setWalletKindCounts((prev) => ({
        ...prev,
        [walletKind]: data.count,
      }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load wallets");
      setWallets([]);
      setWalletsCount(0);
    } finally {
      setWalletsLoading(false);
    }
  }, [projectQuery, walletPage, walletDebounced, walletBalancePct, walletKind]);

  const loadWalletKindCounts = useCallback(async () => {
    try {
      const [clients, operators] = await Promise.all([
        api<Paginated<Wallet>>("wallets/", {
          query: { ...projectQuery, operator: "0", page: 1 },
        }),
        api<Paginated<Wallet>>("wallets/", {
          query: { ...projectQuery, operator: "1", page: 1 },
        }),
      ]);
      setWalletKindCounts({
        clients: clients.count,
        operators: operators.count,
      });
    } catch {
      /* list load surfaces errors */
    }
  }, [projectQuery]);

  useEffect(() => {
    if (activeTab !== "wallets") return;
    void loadWallets();
  }, [activeTab, loadWallets]);

  useEffect(() => {
    if (activeTab !== "wallets") return;
    void loadWalletKindCounts();
  }, [activeTab, loadWalletKindCounts]);

  function selectWalletKind(next: "clients" | "operators") {
    if (next === walletKind) return;
    setWalletKind(next);
    setWalletPage(1);
    if (activeTab === "wallets") {
      const href =
        next === "operators" ? "/wallets?kind=operators" : "/wallets";
      router.replace(href, { scroll: false });
    }
  }

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await api<Paginated<Session>>("sessions/", {
        query: {
          ...sessionQuery,
          page: sessionsPage,
          page_size: 25,
        },
      });
      setSessionsList(data.results);
      setSessionsCount(data.count);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load sessions"
      );
      setSessionsList([]);
      setSessionsCount(0);
    } finally {
      setSessionsLoading(false);
    }
  }, [sessionQuery, sessionsPage]);

  useEffect(() => {
    if (activeTab !== "sessions") return;
    void loadSessions();
  }, [activeTab, loadSessions]);

  function setTab(next: string) {
    const tab = isWorkspaceSection(next) ? next : "overview";
    router.push(SECTION_PATHS[tab]);
  }

  async function refreshAll() {
    await Promise.all([
      loadDashboard(),
      loadLists(),
      activeTab === "overview" ? loadOpenSessions() : Promise.resolve(),
      activeTab === "wallets" ? loadWallets() : Promise.resolve(),
      activeTab === "sessions" ? loadSessions() : Promise.resolve(),
    ]);
  }

  const walletTotalPages = Math.max(1, Math.ceil(walletsCount / 25));
  const sessionsTotalPages = Math.max(1, Math.ceil(sessionsCount / 25));

  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.trim().toUpperCase();
    return vehicles.filter((row) => {
      if (vehicleSiteFilter !== "all" && String(row.site_id) !== vehicleSiteFilter) {
        return false;
      }
      if (
        vehicleZoneFilter !== "all" &&
        String(row.zone_id ?? "") !== vehicleZoneFilter
      ) {
        return false;
      }
      if (!q) return true;
      const haystack =
        `${row.plate} ${row.wallet_name ?? ""} ${row.site_name} ${row.zone_name ?? ""} ${row.project_name ?? ""} ${row.note ?? ""}`.toUpperCase();
      return haystack.includes(q);
    });
  }, [vehicles, vehicleSearch, vehicleSiteFilter, vehicleZoneFilter]);

  const sessionZones = useMemo(() => {
    if (sessionSiteId === "all") return zones;
    return zones.filter((z) => String(z.site) === sessionSiteId);
  }, [zones, sessionSiteId]);

  const arZones = useMemo(() => {
    if (arSiteId === "all") return zones;
    return zones.filter((z) => String(z.site) === arSiteId);
  }, [zones, arSiteId]);

  const vehicleZones = useMemo(() => {
    if (vehicleSiteFilter === "all") return zones;
    return zones.filter((z) => String(z.site) === vehicleSiteFilter);
  }, [zones, vehicleSiteFilter]);

  const openByZone = useMemo(() => {
    type ZoneBucket = {
      key: string;
      siteId: number;
      siteName: string;
      projectId: number | null;
      zoneId: number | null;
      zoneName: string | null;
      count: number;
    };
    const buckets = new Map<string, ZoneBucket>();
    for (const session of openSessions) {
      const siteId = session.site;
      const zoneId = session.zone ?? null;
      const key = `${siteId}:${zoneId ?? "none"}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const siteMeta = sites.find((s) => s.id === siteId);
      buckets.set(key, {
        key,
        siteId,
        siteName: session.site_name || siteMeta?.name || `Site #${siteId}`,
        projectId:
          session.project ??
          siteMeta?.project ??
          (typeof projectId === "number" ? projectId : null),
        zoneId,
        zoneName: session.zone_name?.trim() || null,
        count: 1,
      });
    }
    return [...buckets.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.siteName.localeCompare(b.siteName) ||
        (a.zoneName || "").localeCompare(b.zoneName || "")
    );
  }, [openSessions, sites, projectId]);

  async function onCreateWallet(e: FormEvent) {
    e.preventDefault();
    if (walletKind !== "clients") return;
    const targetProject = Number(walletProjectId || projectId);
    if (!Number.isFinite(targetProject)) {
      toast.error("Choose a project for this wallet");
      return;
    }
    setWalletBusy(true);
    try {
      const created = await api<Wallet>("wallets/", {
        method: "POST",
        body: {
          name: walletName,
          is_active: walletActive,
          is_exempted: walletExempted,
          project: targetProject,
        },
      });
      toast.success("Wallet created");
      setWalletOpen(false);
      setWalletName("");
      setWalletActive(true);
      setWalletExempted(false);
      await Promise.all([loadDashboard(), loadWallets()]);
      router.push(`/wallets/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create wallet");
    } finally {
      setWalletBusy(false);
    }
  }

  if (loading && !stats) {
    return <Loader />;
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <p className="font-medium">Could not load dashboard</p>
        <Button className="mt-4" variant="outline" onClick={() => void loadDashboard()}>
          Retry
        </Button>
      </div>
    );
  }

  const openVehicleCount = vehicles.filter((v) => v.is_open).length;
  const title = isAll ? "All projects" : projectName || label;
  const scopeLabel = isAll
    ? "Across every project in your scope"
    : `Project dashboard · #${projectId}`;

  return (
    <div className="space-y-6">
      {activeTab === "overview" ? (
        <>
          <DetailHero
            title={title}
            badges={
              <>
                {isAll ? (
                  <Badge variant="outline">
                    <FolderKanban className="size-3.5" />
                    {projects.length} project{projects.length === 1 ? "" : "s"}
                  </Badge>
                ) : (
                  <Badge variant={projectActive ? "success" : "secondary"}>
                    {projectActive ? "Active" : "Inactive"}
                  </Badge>
                )}
                {stats.pending_requests > 0 ? (
                  <Badge variant="warning">{stats.pending_requests} pending</Badge>
                ) : null}
                {stats.sessions_open > 0 ? (
                  <Badge variant="warning">{stats.sessions_open} open now</Badge>
                ) : null}
                {stats.sessions_unpaid_closed > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSessionStatus("closed");
                      setSessionPayment("pending");
                      setTab("sessions");
                    }}
                    className="inline-flex"
                  >
                    <Badge variant="destructive" className="cursor-pointer">
                      {stats.sessions_unpaid_closed} unpaid closed
                    </Badge>
                  </button>
                ) : null}
              </>
            }
            description={scopeLabel}
            leading={
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-md shadow-primary/25">
                {isAll ? <FolderKanban className="size-7" /> : initials(title) || "?"}
              </div>
            }
            actions={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void refreshAll()}>
                  Refresh
                </Button>
                {canAccessGateControl ? (
                  stats.pending_requests > 0 ? (
                    <Button asChild>
                      <Link href="/gate-control">Review gates</Link>
                    </Button>
                  ) : (
                    <Button variant="outline" asChild>
                      <Link href="/gate-control">Gate control</Link>
                    </Button>
                  )
                ) : null}
              </div>
            }
          />

          <StatGrid>
            <StatTile
              label="Sites"
              value={stats.sites}
              icon={Building2}
              hint="Parking locations"
              onClick={() => setTab("sites")}
              active={false}
            />
            <StatTile
              label="Sessions"
              value={stats.sessions}
              icon={ParkingSquare}
              hint={
                stats.sessions_unpaid_closed > 0
                  ? `${stats.sessions_open} open · ${stats.sessions_unpaid_closed} unpaid closed`
                  : `${stats.sessions_open} open now`
              }
              tone={
                stats.sessions_unpaid_closed > 0 || stats.sessions_open > 0
                  ? "warn"
                  : "default"
              }
              onClick={() => setTab("sessions")}
              active={false}
            />
            <StatTile
              label="Vehicles"
              value={stats.vehicles}
              icon={CarFront}
              hint={openVehicleCount ? `${openVehicleCount} on site` : "Plates seen here"}
              onClick={() => setTab("vehicles")}
              active={false}
            />
            <StatTile
              label="Wallets"
              value={stats.wallets}
              icon={WalletIcon}
              hint="Linked subscribers"
              onClick={() => setTab("wallets")}
              active={false}
            />
          </StatGrid>
        </>
      ) : null}

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsContent value="overview" className="space-y-5">
          {ops ? (
            <DashboardCharts
              stats={ops.stats}
              projects={ops.projects}
              trend={ops.trend_7d ?? []}
              isAll={isAll}
            />
          ) : (
            <div className="rounded-2xl border bg-card shadow-sm">
              <Loader compact label="Loading finance overview…" />
            </div>
          )}

          {openByZone.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="border-b px-5 py-4">
                <h2 className="font-semibold tracking-tight">Open by zone</h2>
                <p className="text-sm text-muted-foreground">
                  Where vehicles are parked right now
                  {isAll ? " across your projects" : ""}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {openByZone.map((row) => {
                  const href =
                    row.projectId != null
                      ? `/projects/${row.projectId}/sites/${row.siteId}`
                      : null;
                  const label = (
                    <>
                      <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{row.siteName}</span>
                      <span className="text-muted-foreground/50">—</span>
                      <span className="text-muted-foreground">
                        {row.zoneName || "No zone"}
                      </span>
                      <Badge variant="secondary" className="tabular-nums">
                        {row.count}
                      </Badge>
                    </>
                  );
                  const className =
                    "inline-flex max-w-full items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60";
                  return href ? (
                    <Link key={row.key} href={href} className={className}>
                      {label}
                    </Link>
                  ) : (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => {
                        setSessionStatus("open");
                        setSessionSiteId(String(row.siteId));
                        setSessionZoneId(
                          row.zoneId != null ? String(row.zoneId) : "all"
                        );
                        setTab("sessions");
                      }}
                      className={className}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold tracking-tight">Live on site</h2>
                <p className="text-sm text-muted-foreground">
                  Open parking sessions right now
                  {isAll ? " across your projects" : ""}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {stats.sessions_open > 0 ? (
                  <Badge variant="warning">{stats.sessions_open} open</Badge>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setTab("sessions")}>
                  All sessions
                </Button>
              </div>
            </div>
            {listsLoading ? (
              <Loader compact label="Loading open sessions…" />
            ) : openSessions.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-medium">Lots are clear</p>
                <p className="text-sm text-muted-foreground">
                  No open sessions right now.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {openSessions.slice(0, 6).map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold tracking-wider">
                        <Link
                          href={`/sessions/${session.id}`}
                          className="text-primary hover:underline"
                        >
                          {session.plate}
                        </Link>
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="size-3.5 shrink-0" />
                          {session.site_name}
                          {isAll && session.project_name
                            ? ` · ${session.project_name}`
                            : ""}
                        </span>
                        {session.zone_name ? (
                          <ZoneLabel name={session.zone_name} />
                        ) : null}
                      </div>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      Since {formatDateTime(session.start_time)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="sessions">
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Sessions</h2>
                <p className="text-sm text-muted-foreground">
                  Parking stays, fees, and payment status
                  {isAll ? " across your projects" : " for this project"}.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full shrink-0 sm:w-auto"
                disabled={sessionsExporting}
                onClick={() => {
                  void (async () => {
                    setSessionsExporting(true);
                    try {
                      await apiDownload("sessions/export/", {
                        query: sessionQuery,
                        filename: "sessions.csv",
                      });
                      toast.success("Sessions exported");
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError ? err.message : "Export failed"
                      );
                    } finally {
                      setSessionsExporting(false);
                    }
                  })();
                }}
              >
                <Download className="size-4" />
                {sessionsExporting ? "Exporting…" : "Export CSV"}
              </Button>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm">
              <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="Search plate…"
                    className="h-10 rounded-xl border-0 bg-muted/50 pl-9 shadow-none focus-visible:ring-1"
                    aria-label="Search sessions by plate"
                  />
                </div>
                <DateRangeFilter
                  value={sessionDateRange}
                  onChange={setSessionDateRange}
                  placeholder="Session dates"
                />
                <Select value={sessionStatus} onValueChange={setSessionStatus}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[8.5rem]" aria-label="Stay status">
                    <SelectValue placeholder="Stay status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stays</SelectItem>
                    <SelectItem value="open">Open only</SelectItem>
                    <SelectItem value="closed">Closed only</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sessionPayment} onValueChange={setSessionPayment}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[9rem]" aria-label="Payment status">
                    <SelectValue placeholder="Payment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All payments</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="exempted">Waived</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sessionWaiver} onValueChange={setSessionWaiver}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[9rem]" aria-label="Waiver kind">
                    <SelectValue placeholder="Waiver" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All waivers</SelectItem>
                    <SelectItem value="guest">Guest</SelectItem>
                    <SelectItem value="policy">Policy exempt</SelectItem>
                    <SelectItem value="operator">Operator waived</SelectItem>
                    <SelectItem value="grace">Grace</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sessionExempt} onValueChange={setSessionExempt}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[8.5rem]" aria-label="Billing">
                    <SelectValue placeholder="Billing" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All billing</SelectItem>
                    <SelectItem value="yes">Exempt</SelectItem>
                    <SelectItem value="no">Billable</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sessionMethod} onValueChange={setSessionMethod}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[8.5rem]" aria-label="Payment method">
                    <SelectValue placeholder="Method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All methods</SelectItem>
                    <SelectItem value="wallet">Wallet</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sessionMatched} onValueChange={setSessionMatched}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[9rem]" aria-label="Exit match">
                    <SelectValue placeholder="Exit match" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All matches</SelectItem>
                    <SelectItem value="yes">Exit matched</SelectItem>
                    <SelectItem value="no">Not matched</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sessionSiteId} onValueChange={setSessionSiteId}>
                  <SelectTrigger variant="filter" className="w-auto min-w-[9rem] max-w-[14rem]" aria-label="Site">
                    <SelectValue placeholder="Site" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sites</SelectItem>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={String(site.id)}>
                        {isAll ? `${site.project_name} · ${site.name}` : site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sessionZoneId}
                  onValueChange={setSessionZoneId}
                  disabled={sessionZones.length === 0}
                >
                  <SelectTrigger variant="filter" className="w-auto min-w-[9rem] max-w-[14rem]" aria-label="Zone">
                    <SelectValue placeholder="Zone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All zones</SelectItem>
                    {sessionZones.map((zone) => (
                      <SelectItem key={zone.id} value={String(zone.id)}>
                        {zoneOptionLabel(zone, sessionSiteId === "all" || isAll)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {sessionsLoading ? (
              <Loader compact label="Loading sessions…" />
            ) : sessionsList.length === 0 ? (
              <EmptyState
                icon={History}
                title="No sessions found"
                description="Try adjusting search, dates, or status filters."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSessionSearch("");
                      setSessionDateRange({});
                      setSessionStatus("all");
                      setSessionPayment("all");
                      setSessionWaiver("all");
                      setSessionExempt("all");
                      setSessionMethod("all");
                      setSessionMatched("all");
                      setSessionSiteId("all");
                      setSessionZoneId("all");
                    }}
                  >
                    Reset filters
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y">
                {sessionsList.map((session, index) => {
                  const open = !session.end_time;
                  return (
                    <li
                      key={session.id}
                      className="animate-fade-up"
                      style={{ animationDelay: `${index * 25}ms` }}
                    >
                      <Link
                        href={`/sessions/${session.id}`}
                        className={cn(
                          "group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/40 sm:items-center sm:gap-4 sm:px-5",
                          open && "bg-amber-500/[0.04]"
                        )}
                      >
                        <div
                          className={cn(
                            "rounded-xl border-2 px-3 py-2 font-mono text-sm font-bold tracking-[0.16em] transition-transform group-hover:scale-[1.02]",
                            open
                              ? "border-amber-400/45 bg-amber-500/15 text-foreground"
                              : "border-primary/25 bg-primary/10 text-foreground"
                          )}
                        >
                          {session.plate}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {open ? (
                              <Badge variant="warning" className="gap-1">
                                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                                Open
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Closed</Badge>
                            )}
                            <SessionBillingBadges session={session} showMethod />
                            {isAll && session.project_name ? (
                              <Badge variant="outline" className="font-normal">
                                {session.project_name}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Building2 className="size-3.5 shrink-0" />
                              {session.site_name}
                            </span>
                            {session.zone_name ? (
                              <ZoneLabel name={session.zone_name} />
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Clock3 className="size-3" />
                              {formatDateTime(session.start_time)}
                              {session.end_time
                                ? ` → ${formatDateTime(session.end_time)}`
                                : " → now"}
                            </span>
                            <span className="tabular-nums">
                              {formatStayDuration(
                                session.start_time,
                                session.end_time
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 sm:min-w-[5.5rem] sm:pt-0">
                          <p className="text-base font-semibold tabular-nums tracking-tight">
                            {formatMoney(session.fee)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Fee</p>
                        </div>

                        <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary sm:mt-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {sessionsCount === 0
                  ? "0 sessions"
                  : `Showing ${(sessionsPage - 1) * 25 + 1}–${Math.min(
                      sessionsPage * 25,
                      sessionsCount
                    )} of ${sessionsCount}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={sessionsPage <= 1 || sessionsLoading}
                  onClick={() => setSessionsPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
                  {sessionsPage}/{sessionsTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={sessionsPage >= sessionsTotalPages || sessionsLoading}
                  onClick={() => setSessionsPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="access-requests" className="space-y-4">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Decisions</h2>
                <p className="text-sm text-muted-foreground">
                  Approved and denied gate decisions
                  {isAll ? " across your projects" : " for this project"}.
                  Timeouts are hidden.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setArRefreshKey((k) => k + 1)}
                >
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={arExporting}
                  onClick={() => {
                    void (async () => {
                      setArExporting(true);
                      try {
                        await apiDownload("access-requests/export/", {
                          query: accessRequestQuery,
                          filename: "access-requests.csv",
                        });
                        toast.success("Decisions exported");
                      } catch (err) {
                        toast.error(
                          err instanceof ApiError ? err.message : "Export failed"
                        );
                      } finally {
                        setArExporting(false);
                      }
                    })();
                  }}
                >
                  <Download className="size-4" />
                  {arExporting ? "Exporting…" : "Export CSV"}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={arSearch}
                  onChange={(e) => setArSearch(e.target.value)}
                  placeholder="Search plate…"
                  className="h-10 rounded-xl border-0 bg-muted/50 pl-9 shadow-none focus-visible:ring-1"
                  aria-label="Search decisions by plate"
                />
              </div>
              <DateRangeFilter
                value={arDateRange}
                onChange={setArDateRange}
                placeholder="Decision dates"
              />
              <Select value={arStatus} onValueChange={setArStatus}>
                <SelectTrigger variant="filter" className="w-auto min-w-[10rem]" aria-label="Decision status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Approved & denied</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                </SelectContent>
              </Select>
              <Select value={arSiteId} onValueChange={setArSiteId}>
                <SelectTrigger variant="filter" className="w-auto min-w-[9rem] max-w-[14rem]" aria-label="Site">
                  <SelectValue placeholder="Site" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={String(site.id)}>
                      {isAll ? `${site.project_name} · ${site.name}` : site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={arZoneId}
                onValueChange={setArZoneId}
                disabled={arZones.length === 0}
              >
                <SelectTrigger variant="filter" className="w-auto min-w-[9rem] max-w-[14rem]" aria-label="Zone">
                  <SelectValue placeholder="Zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All zones</SelectItem>
                  {arZones.map((zone) => (
                    <SelectItem key={zone.id} value={String(zone.id)}>
                      {zoneOptionLabel(zone, arSiteId === "all" || isAll)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DecisionsList
            query={accessRequestQuery}
            refreshKey={arRefreshKey}
            isAll={isAll}
            onResetFilters={() => {
              setArSearch("");
              setArDateRange({});
              setArStatus("all");
              setArSiteId("all");
              setArZoneId("all");
            }}
          />
        </TabsContent>

        <TabsContent value="sites">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight">Sites</h2>
            <p className="text-sm text-muted-foreground">
              Active locations
              {isAll ? " across your projects" : ""}.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {listsLoading ? (
              <Loader compact label="Loading sites…" />
            ) : sites.length === 0 ? (
              <div className="flex h-44 flex-col items-center justify-center gap-2 text-center">
                <Building2 className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">No sites yet</p>
                <p className="text-sm text-muted-foreground">
                  Sites appear here once they are configured for this scope.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {sites.map((site, index) => (
                  <li
                    key={site.id}
                    className="animate-fade-up"
                    style={{ animationDelay: `${index * 35}ms` }}
                  >
                    <Link
                      href={`/projects/${site.project}/sites/${site.id}`}
                      className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium tracking-tight group-hover:text-primary">
                            {site.name}
                          </p>
                          <Badge variant="outline">#{site.id}</Badge>
                          {isAll ? (
                            <Badge variant="secondary">{site.project_name}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatMoney(site.hourly_rate)}/h +{" "}
                          {formatMoney(site.additional_fee)} fee
                          {site.zone_count != null
                            ? ` · ${site.zone_count} zone${site.zone_count === 1 ? "" : "s"}`
                            : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          IoT · {site.iot_thing_name || "Not provisioned"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl border bg-muted/40 px-3 py-2 text-center min-w-16">
                          <p className="text-xs text-muted-foreground">Entry</p>
                          <p className="font-semibold tabular-nums">
                            {site.entry_device_count ?? 0}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-muted/40 px-3 py-2 text-center min-w-16">
                          <p className="text-xs text-muted-foreground">Exit</p>
                          <p className="font-semibold tabular-nums">
                            {site.exit_device_count ?? 0}
                          </p>
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="vehicles">
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Vehicles</h2>
                <p className="text-sm text-muted-foreground">
                  Unique plates seen
                  {isAll ? " across your projects" : " at this project"} — open the
                  plate for latest gate events.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  placeholder="Search plate, wallet, site…"
                  className="h-10 rounded-xl border-0 bg-muted/50 pl-9 shadow-none focus-visible:ring-1"
                  aria-label="Search vehicles"
                />
              </div>
              <Select value={vehicleSiteFilter} onValueChange={setVehicleSiteFilter}>
                <SelectTrigger variant="filter" className="w-auto min-w-[9rem] max-w-[14rem]" aria-label="Site">
                  <SelectValue placeholder="Site" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {isAll ? `${s.project_name} · ${s.name}` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={vehicleZoneFilter}
                onValueChange={setVehicleZoneFilter}
                disabled={vehicleZones.length === 0}
              >
                <SelectTrigger variant="filter" className="w-auto min-w-[9rem] max-w-[14rem]" aria-label="Zone">
                  <SelectValue placeholder="Zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All zones</SelectItem>
                  {vehicleZones.map((zone) => (
                    <SelectItem key={zone.id} value={String(zone.id)}>
                      {zoneOptionLabel(
                        zone,
                        vehicleSiteFilter === "all" || isAll
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {listsLoading ? (
              <Loader compact label="Loading vehicles…" />
            ) : filteredVehicles.length === 0 ? (
              <EmptyState
                icon={CarFront}
                title={vehicles.length === 0 ? "No vehicles yet" : "No matches"}
                description={
                  vehicles.length === 0
                    ? "Plates appear here after a session starts at a site."
                    : "Try another search, site, or zone filter."
                }
                action={
                  vehicles.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setVehicleSearch("");
                        setVehicleSiteFilter("all");
                        setVehicleZoneFilter("all");
                      }}
                    >
                      Reset filters
                    </Button>
                  ) : null
                }
              />
            ) : (
              <ul className="divide-y">
                {filteredVehicles.map((row, index) => (
                  <li
                    key={row.plate}
                    className="animate-fade-up"
                    style={{ animationDelay: `${index * 25}ms` }}
                  >
                    <Link
                      href={`/vehicles/${encodeURIComponent(row.plate)}`}
                      className={cn(
                        "group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/40 sm:items-center sm:gap-4 sm:px-5",
                        row.is_open && "bg-amber-500/[0.04]"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-xl border-2 px-3 py-2 font-mono text-sm font-bold tracking-[0.16em] transition-transform group-hover:scale-[1.02]",
                          row.is_open
                            ? "border-amber-400/45 bg-amber-500/15 text-foreground"
                            : "border-primary/25 bg-primary/10 text-foreground"
                        )}
                      >
                        {row.plate}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.is_open ? (
                            <Badge variant="warning" className="gap-1">
                              <span className="size-1.5 animate-pulse rounded-full bg-current" />
                              On site
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Last visit</Badge>
                          )}
                          {isAll && row.project_name ? (
                            <Badge variant="outline" className="font-normal">
                              {row.project_name}
                            </Badge>
                          ) : null}
                          {row.is_active === false ? (
                            <Badge variant="secondary">Inactive</Badge>
                          ) : null}
                          {!row.wallet_id ? (
                            <Badge variant="outline">No wallet</Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Building2 className="size-3.5 shrink-0" />
                            {row.site_name}
                          </span>
                          {row.zone_name ? (
                            <ZoneLabel name={row.zone_name} />
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {row.wallet_id && row.wallet_name ? (
                            <span>
                              Wallet{" "}
                              <span className="font-medium text-foreground/80">
                                {row.wallet_name}
                              </span>
                            </span>
                          ) : (
                            <span>Unregistered plate</span>
                          )}
                          <span className="tabular-nums">
                            {row.session_count} session
                            {row.session_count === 1 ? "" : "s"}
                          </span>
                        </div>
                        {row.note?.trim() ? (
                          <p className="line-clamp-2 text-sm text-foreground/80">
                            {row.note}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 sm:min-w-[7rem] sm:pt-0">
                        <p className="text-[11px] text-muted-foreground">Last seen</p>
                        <p className="text-sm font-medium tabular-nums">
                          {formatDateTime(row.last_seen)}
                        </p>
                      </div>

                      <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary sm:mt-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {!listsLoading && filteredVehicles.length > 0 ? (
              <div className="border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {filteredVehicles.length} plate
                {filteredVehicles.length === 1 ? "" : "s"}
                {filteredVehicles.length !== vehicles.length
                  ? ` (filtered from ${vehicles.length})`
                  : ""}
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="wallets">
          <div className="mb-4 space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Wallets</h2>
                  <p className="text-sm text-muted-foreground">
                    {walletKind === "operators"
                      ? "Cash validate / settle wallets for cashiers"
                      : "Prepaid client wallets and linked plates"}
                    {isAll ? " · all projects" : ""}.
                  </p>
                </div>
                <div
                  className="inline-flex rounded-xl border bg-muted/50 p-1"
                  role="tablist"
                  aria-label="Wallet kind"
                >
                  {(
                    [
                      {
                        id: "clients" as const,
                        label: "Clients",
                        count: walletKindCounts.clients,
                        Icon: Building2,
                      },
                      {
                        id: "operators" as const,
                        label: "Operators",
                        count: walletKindCounts.operators,
                        Icon: UserRound,
                      },
                    ] as const
                  ).map((tab) => {
                    const active = walletKind === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => selectWalletKind(tab.id)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <tab.Icon className="size-3.5 opacity-70" />
                        {tab.label}
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                            active
                              ? "bg-muted text-foreground"
                              : "bg-background/60 text-muted-foreground"
                          )}
                        >
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {walletKind === "clients" ? (
                <Button
                  className="w-full shrink-0 sm:w-auto"
                  onClick={() => setWalletOpen(true)}
                >
                  <Plus className="size-4" />
                  New client wallet
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={walletSearch}
                  onChange={(e) => setWalletSearch(e.target.value)}
                  placeholder={
                    walletKind === "operators"
                      ? "Search name or staff username…"
                      : "Search client wallet…"
                  }
                  className="h-10 rounded-xl border-0 bg-muted/50 pl-9 shadow-none focus-visible:ring-1"
                  aria-label="Search wallets"
                />
              </div>
              <div className="relative sm:w-[220px]">
                <Select
                  value={walletBalancePct}
                  onValueChange={setWalletBalancePct}
                >
                  <SelectTrigger
                    variant="filter"
                    className="w-full pl-9"
                    aria-label="Filter by remaining balance vs last top-up"
                  >
                    <SelectValue placeholder="Balance" />
                  </SelectTrigger>
                  <SelectContent>
                    {WALLET_BALANCE_PCT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Gauge className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            {walletDebounced || walletBalancePct !== "all" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Filters</span>
                {walletDebounced ? (
                  <button
                    type="button"
                    onClick={() => setWalletSearch("")}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    “{walletDebounced}”
                    <X className="size-3.5 text-muted-foreground" />
                  </button>
                ) : null}
                {walletBalancePct !== "all" ? (
                  <button
                    type="button"
                    onClick={() => setWalletBalancePct("all")}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    {WALLET_BALANCE_PCT_OPTIONS.find((o) => o.value === walletBalancePct)
                      ?.label ?? `≤ ${walletBalancePct}%`}
                    <X className="size-3.5 text-muted-foreground" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setWalletSearch("");
                    setWalletBalancePct("all");
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Clear all
                </button>
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {walletsLoading ? (
              <Loader compact label="Loading wallets…" />
            ) : wallets.length === 0 ? (
              <EmptyState
                icon={walletKind === "operators" ? UserRound : WalletIcon}
                title={
                  walletDebounced || walletBalancePct !== "all"
                    ? "No wallets match"
                    : walletKind === "operators"
                      ? "No operator wallets yet"
                      : "No client wallets yet"
                }
                description={
                  walletDebounced || walletBalancePct !== "all"
                    ? "Try clearing search or the balance filter."
                    : walletKind === "operators"
                      ? "Operator wallets appear here once they are assigned to staff."
                      : "Create a client wallet to link plates and track prepaid balance."
                }
                action={
                  walletDebounced || walletBalancePct !== "all" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setWalletSearch("");
                        setWalletBalancePct("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : walletKind === "clients" ? (
                    <Button size="sm" onClick={() => setWalletOpen(true)}>
                      <Plus className="size-4" />
                      New client wallet
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y">
                {wallets.map((wallet, index) => {
                  const balance = Number(wallet.balance);
                  const low = !Number.isNaN(balance) && balance < 0;
                  const pct = wallet.balance_pct_of_last_topup;
                  const health = walletBalanceHealth(pct, balance);
                  const plates = wallet.vehicles ?? [];
                  const platePreview = plates.slice(0, 3);
                  const plateExtra = Math.max(0, plates.length - platePreview.length);
                  const showBar =
                    walletKind === "clients" &&
                    pct != null &&
                    (health.tone === "critical" ||
                      health.tone === "warning" ||
                      health.tone === "caution");
                  const barWidth =
                    pct == null ? 0 : Math.max(2, Math.min(100, pct));
                  const detailHref =
                    walletKind === "operators"
                      ? `/wallets/${wallet.id}?from=operators`
                      : `/wallets/${wallet.id}`;

                  return (
                    <li
                      key={wallet.id}
                      className="animate-fade-up"
                      style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                    >
                      <Link
                        href={detailHref}
                        className={cn(
                          "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:gap-4 sm:px-5",
                          !wallet.is_active && "opacity-70"
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold shadow-sm ring-1 ring-black/5 transition-transform group-hover:scale-[1.03]",
                            walletKind === "operators"
                              ? "bg-secondary text-secondary-foreground"
                              : wallet.is_active
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-secondary-foreground"
                          )}
                        >
                          {walletKind === "operators" ? (
                            <UserRound className="size-5" />
                          ) : (
                            initials(wallet.name) || "?"
                          )}
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate text-[15px] font-semibold tracking-tight group-hover:text-primary">
                              {wallet.name}
                            </p>
                            {!wallet.is_active ? (
                              <Badge variant="secondary">Inactive</Badge>
                            ) : null}
                            {wallet.is_exempted ? (
                              <Badge variant="exempt">Exempt</Badge>
                            ) : null}
                            {isAll ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {wallet.project_name}
                              </span>
                            ) : null}
                          </div>

                          {walletKind === "operators" ? (
                            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <UserRound className="size-3.5 shrink-0 opacity-70" />
                              <span className="truncate">
                                {wallet.assigned_user_username
                                  ? wallet.assigned_user_username
                                  : "Unassigned"}
                              </span>
                              <span className="text-muted-foreground/50">·</span>
                              <span className="shrink-0">Validate / settle</span>
                            </p>
                          ) : plates.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {platePreview.map((v) => (
                                <span
                                  key={v.id}
                                  className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-foreground/80"
                                >
                                  {v.plate}
                                </span>
                              ))}
                              {plateExtra > 0 ? (
                                <span className="text-[11px] text-muted-foreground">
                                  +{plateExtra}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              No plates linked
                            </p>
                          )}

                          {showBar ? (
                            <div className="flex max-w-[14rem] items-center gap-2">
                              <div
                                className={cn(
                                  "h-1 flex-1 overflow-hidden rounded-full",
                                  health.track
                                )}
                                role="progressbar"
                                aria-valuenow={Math.round(pct!)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label="Balance relative to last top-up"
                              >
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-[width] duration-300",
                                    health.bar
                                  )}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span className="text-[10px] tabular-nums text-muted-foreground">
                                {Math.round(pct!)}%
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                          <div className="text-right">
                            <p
                              className={cn(
                                "text-base font-semibold tabular-nums tracking-tight sm:text-lg",
                                low
                                  ? "text-destructive"
                                  : health.tone === "critical" ||
                                      health.tone === "warning"
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-foreground"
                              )}
                            >
                              {formatMoney(wallet.balance, wallet.currency)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {low
                                ? "Overdrawn"
                                : health.tone === "critical" ||
                                    health.tone === "warning"
                                  ? "Low balance"
                                  : walletKind === "operators"
                                    ? "Operator"
                                    : `${plates.length} plate${plates.length === 1 ? "" : "s"}`}
                            </p>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {wallets.length > 0 || walletsCount > 0 ? (
              <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  {walletsCount === 0
                    ? "0 wallets"
                    : `Showing ${(walletPage - 1) * 25 + 1}–${Math.min(
                        walletPage * 25,
                        walletsCount
                      )} of ${walletsCount}`}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={walletPage <= 1 || walletsLoading}
                    onClick={() => setWalletPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
                    {walletPage}/{walletTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={walletPage >= walletTotalPages || walletsLoading}
                    onClick={() => setWalletPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={walletOpen}
        onOpenChange={(open) => {
          setWalletOpen(open);
          if (!open) {
            setWalletExempted(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isAll ? "New client wallet" : `New client wallet in ${title}`}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onCreateWallet}>
            {isAll || projects.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="wallet-project">Project</Label>
                <Select
                  value={walletProjectId || undefined}
                  onValueChange={setWalletProjectId}
                >
                  <SelectTrigger id="wallet-project" aria-label="Project">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="wallet-name">Name</Label>
              <Input
                id="wallet-name"
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
                placeholder="Acme Logistics"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={walletActive}
                onCheckedChange={(v) => setWalletActive(v === true)}
              />
              Active
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={walletExempted}
                onCheckedChange={(v) => setWalletExempted(v === true)}
              />
              <span>
                <span className="font-medium">Exempt wallet</span>
                <span className="mt-0.5 block text-muted-foreground">
                  All plates for this wallet skip parking charges.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWalletOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={walletBusy}>
                {walletBusy ? "Saving…" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
