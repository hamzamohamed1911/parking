"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Layers,
  Lock,
  LockOpen,
  ParkingSquare,
  Radio,
  RefreshCw,
  ShieldAlert,
  DoorClosed,
  DoorOpen,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { DetailHero } from "@/components/detail-hero";
import { EmptyState } from "@/components/empty-state";
import { Loader } from "@/components/loaders";
import { StatGrid, StatTile } from "@/components/stat-grid";
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
import { api, ApiError } from "@/lib/api";
import type { AccessRequest, Device, SiteDashboard, Zone } from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";

type GateCommand = "pulse" | "open" | "close" | "lock" | "unlock";
type PlateGateAction = "open" | "pulse";

type ZoneBoard = {
  zone: Zone | null;
  zoneId: number;
  zoneName: string;
  parentId: number | null;
  parentName: string | null;
  depth: number;
  entries: Device[];
  exits: Device[];
};

function gateLabel(device: Device) {
  const name = device.name?.trim();
  if (name) return name;
  return `${device.type === "entry" ? "Entry" : "Exit"} #${device.id}`;
}

function sortZones(boards: ZoneBoard[]): ZoneBoard[] {
  const byId = new Map(boards.map((z) => [z.zoneId, z]));

  for (const board of boards) {
    let depth = 0;
    let current = board;
    const seen = new Set<number>();
    while (current.parentId != null && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    board.depth = depth;
  }

  const children = new Map<number | null, ZoneBoard[]>();
  for (const board of boards) {
    const key =
      board.parentId != null && byId.has(board.parentId) ? board.parentId : null;
    const list = children.get(key) || [];
    list.push(board);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  }

  const ordered: ZoneBoard[] = [];
  function walk(parentId: number | null) {
    for (const board of children.get(parentId) || []) {
      ordered.push(board);
      walk(board.zoneId);
    }
  }
  walk(null);
  for (const board of boards) {
    if (!ordered.includes(board)) ordered.push(board);
  }
  return ordered;
}

function buildZoneBoards(zones: Zone[], devices: Device[]): ZoneBoard[] {
  const boards = new Map<number, ZoneBoard>();

  for (const zone of zones) {
    boards.set(zone.id, {
      zone,
      zoneId: zone.id,
      zoneName: zone.name,
      parentId: zone.parent ?? null,
      parentName: zone.parent_name ?? null,
      depth: 0,
      entries: [],
      exits: [],
    });
  }

  for (const device of devices) {
    const zoneId = device.zone || 0;
    let board = boards.get(zoneId);
    if (!board) {
      board = {
        zone: null,
        zoneId,
        zoneName: device.zone_name || (zoneId ? `Zone #${zoneId}` : "Unassigned"),
        parentId: device.zone_parent ?? null,
        parentName: device.zone_parent_name ?? null,
        depth: 0,
        entries: [],
        exits: [],
      };
      boards.set(zoneId, board);
    }
    if (device.type === "exit") board.exits.push(device);
    else board.entries.push(device);
  }

  for (const board of boards.values()) {
    board.entries.sort((a, b) => gateLabel(a).localeCompare(gateLabel(b)));
    board.exits.sort((a, b) => gateLabel(a).localeCompare(gateLabel(b)));
  }

  return sortZones([...boards.values()]);
}

function SiteGateCard({
  device,
  busy,
  busyCmd,
  plateBusy,
  canControlGates,
  onOpen,
  onPulse,
  onClose,
  onLockToggle,
}: {
  device: Device;
  busy: boolean;
  busyCmd: GateCommand | null;
  plateBusy: boolean;
  canControlGates: boolean;
  onOpen: () => void;
  onPulse: () => void;
  onClose: () => void;
  onLockToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
      <div className="border-b bg-primary/5 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold tracking-tight capitalize">
                {device.name?.trim() || `${device.type} gate`}
              </p>
              <Badge variant="secondary">Lane {device.barrier_lane}</Badge>
              <Badge variant={device.enabled ? "success" : "warning"}>
                {device.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {device.gate_locked ? (
                <Badge variant="destructive">Locked</Badge>
              ) : (
                <Badge variant="outline">Unlocked</Badge>
              )}
            </div>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              #{device.id} · {device.ip}
            </p>
          </div>
          <div
            className={cn(
              "flex size-11 items-center justify-center rounded-2xl",
              device.type === "entry"
                ? "bg-accent text-accent-foreground"
                : "bg-secondary text-secondary-foreground"
            )}
          >
            {device.gate_locked ? (
              <Lock className="size-5" />
            ) : (
              <Radio className="size-5" />
            )}
          </div>
        </div>
      </div>

      {canControlGates ? (
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          <Button
            className="h-11"
            disabled={!device.enabled || busy || plateBusy}
            onClick={onOpen}
          >
            <DoorOpen className="size-4" />
            Open
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={!device.enabled || busy}
            onClick={onClose}
          >
            <DoorClosed className="size-4" />
            {busy && busyCmd === "close" ? "…" : "Close"}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={onLockToggle}
          >
            {device.gate_locked ? (
              <LockOpen className="size-4" />
            ) : (
              <Lock className="size-4" />
            )}
            {busy && (busyCmd === "lock" || busyCmd === "unlock")
              ? "…"
              : device.gate_locked
                ? "Unlock"
                : "Lock"}
          </Button>
          <Button
            variant="secondary"
            className="h-11"
            disabled={!device.enabled || busy || device.gate_locked || plateBusy}
            onClick={onPulse}
            title={device.gate_locked ? "Unlock first" : "Momentary open with plate"}
          >
            <Zap className="size-4" />
            Pulse
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function SiteDashboardPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const projectId = Number(params.id);
  const siteId = Number(params.siteId);
  const { canDecide } = useAuth();

  const [data, setData] = useState<SiteDashboard | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyCmd, setBusyCmd] = useState<GateCommand | null>(null);

  const [plateDevice, setPlateDevice] = useState<Device | null>(null);
  const [plateAction, setPlateAction] = useState<PlateGateAction>("pulse");
  const [plate, setPlate] = useState("");
  const [note, setNote] = useState("");
  const [exempted, setExempted] = useState(false);
  const [entryTime, setEntryTime] = useState("");
  const [plateBusy, setPlateBusy] = useState(false);

  const load = useCallback(
    async (soft = false) => {
      if (!Number.isFinite(siteId)) return;
      if (soft) setRefreshing(true);
      else setLoading(true);
      try {
        const [next, zonePage] = await Promise.all([
          api<SiteDashboard>(`sites/${siteId}/dashboard/`),
          api<{ results?: Zone[] } | Zone[]>(`zones/?site=${siteId}&page_size=200`),
        ]);
        if (Number.isFinite(projectId) && next.site.project !== projectId) {
          toast.error("This site does not belong to the selected project.");
          setData(null);
          return;
        }
        setData(next);
        const list = Array.isArray(zonePage) ? zonePage : zonePage.results || [];
        setZones(list);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Failed to load site");
        if (!soft) setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [siteId, projectId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function openPlateModal(device: Device, action: PlateGateAction) {
    setPlateDevice(device);
    setPlateAction(action);
    setPlate("");
    setNote("");
    setExempted(false);
    setEntryTime("");
  }

  async function sendCommand(device: Device, command: GateCommand) {
    setBusyId(device.id);
    setBusyCmd(command);
    try {
      const res = await api<{ detail: string; device: Device }>(
        `devices/${device.id}/${command}/`,
        { method: "POST" }
      );
      toast.success(res.detail);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          devices: prev.devices.map((d) => (d.id === res.device.id ? res.device : d)),
          stats: {
            ...prev.stats,
            devices_locked: prev.devices
              .map((d) => (d.id === res.device.id ? res.device : d))
              .filter((d) => d.gate_locked).length,
          },
        };
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Command failed");
    } finally {
      setBusyId(null);
      setBusyCmd(null);
    }
  }

  async function submitPlateGate() {
    if (!plateDevice) return;
    const trimmed = plate.trim();
    if (!trimmed) {
      toast.error("Enter a plate number");
      return;
    }
    setPlateBusy(true);
    try {
      const result = await api<{
        granted: boolean;
        access_request: AccessRequest | null;
        event_id: number | null;
      }>("access-requests/manual/", {
        method: "POST",
        body: {
          device_id: plateDevice.id,
          plate: trimmed,
          note,
          exempted,
          ...(plateDevice.type === "exit" && !exempted && entryTime
            ? { entry_time: new Date(entryTime).toISOString() }
            : {}),
        },
      });

      if (plateAction === "open") {
        try {
          const res = await api<{ detail: string; device: Device }>(
            `devices/${plateDevice.id}/open/`,
            { method: "POST" }
          );
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              devices: prev.devices.map((d) =>
                d.id === res.device.id ? res.device : d
              ),
            };
          });
        } catch {
          /* plate entry already pulsed; open is best-effort hold */
        }
      }

      toast.success(
        result.granted
          ? plateAction === "open"
            ? "Gate held open for plate"
            : "Gate pulsed for plate"
          : "Processed"
      );
      setPlateDevice(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to process plate");
    } finally {
      setPlateBusy(false);
    }
  }

  const zoneBoards = useMemo(
    () => (data ? buildZoneBoards(zones, data.devices) : []),
    [zones, data]
  );

  if (loading && !data) {
    return <Loader label="Loading site…" />;
  }

  if (!data) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <p className="font-medium">Site not found</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/sites">Back to project</Link>
        </Button>
      </div>
    );
  }

  const { site, stats, devices, open_sessions, pending_requests } = data;
  const entryCount = devices.filter((d) => d.type === "entry").length;
  const exitCount = devices.filter((d) => d.type === "exit").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/sites">
            <ArrowLeft className="size-4" />
            {site.project_name}
          </Link>
        </Button>
      </div>

      <DetailHero
        title={site.name}
        badges={
          <>
            <Badge variant="outline">Site #{site.id}</Badge>
            {stats.pending_requests > 0 ? (
              <Badge variant="warning">{stats.pending_requests} pending</Badge>
            ) : null}
          </>
        }
        description={
          <>
            {site.project_name} · site grace {site.grace_minutes ?? 0} min · zone rates
            below
          </>
        }
        meta={
          <>
            IoT · {site.iot_thing_name || "Not provisioned"}
            {site.provisioned_at ? ` · since ${formatDateTime(site.provisioned_at)}` : ""}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canDecide ? (
              <Button variant="outline" asChild>
                <Link href="/gate-control">Live gate control</Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      <StatGrid>
        <StatTile
          label="Zones"
          value={zones.length || zoneBoards.length}
          icon={Layers}
          hint="Billing areas"
        />
        <StatTile
          label="Entry gates"
          value={entryCount}
          icon={DoorOpen}
          hint={`${devices.filter((d) => d.type === "entry" && d.enabled).length} enabled`}
        />
        <StatTile
          label="Exit gates"
          value={exitCount}
          icon={DoorClosed}
          hint={`${devices.filter((d) => d.type === "exit" && d.enabled).length} enabled`}
        />
        <StatTile
          label="Open sessions"
          value={stats.sessions_open}
          icon={ParkingSquare}
          hint="On site now"
          tone={stats.sessions_open > 0 ? "warn" : "default"}
        />
      </StatGrid>

      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Zones & gates</h2>
          <p className="text-sm text-muted-foreground">
            Open and Pulse require a plate. Close / lock stay direct commands. Zones
            and rates are managed in admin.
          </p>
        </div>

        {zoneBoards.length === 0 ? (
          <div className="rounded-3xl border border-dashed bg-card">
            <EmptyState
              icon={Layers}
              title="No zones or gates"
              description="Zones and devices are provisioned outside this console."
              className="h-48"
            />
          </div>
        ) : (
          <>
            {zoneBoards.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {zoneBoards.map((board) => (
                  <a
                    key={board.zoneId}
                    href={`#site-zone-${board.zoneId}`}
                    className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60"
                  >
                    <Layers className="size-3.5 opacity-70" />
                    <span className={cn(board.depth > 0 && "text-muted-foreground")}>
                      {board.depth > 0 ? `${"· ".repeat(board.depth)}` : ""}
                      {board.zoneName}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {board.entries.length + board.exits.length}
                    </span>
                  </a>
                ))}
              </div>
            ) : null}

            <div className="space-y-5">
              {zoneBoards.map((board) => {
                const nested = board.depth > 0 || Boolean(board.parentName);
                const rate = board.zone;

                return (
                  <section
                    key={board.zoneId}
                    id={`site-zone-${board.zoneId}`}
                    className={cn(
                      "scroll-mt-24 overflow-hidden rounded-2xl border bg-card/40",
                      nested && "border-l-[3px] border-l-sky-600/70"
                    )}
                    style={
                      board.depth > 0
                        ? { marginLeft: Math.min(board.depth, 3) * 12 }
                        : undefined
                    }
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                            nested
                              ? "bg-sky-500/10 text-sky-800 dark:text-sky-200"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Layers className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold tracking-tight">
                              {board.zoneName}
                            </h3>
                            {nested && board.parentName ? (
                              <Badge variant="outline" className="font-normal">
                                Inside {board.parentName}
                              </Badge>
                            ) : null}
                            {rate && !rate.is_active ? (
                              <Badge variant="destructive">Inactive</Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {board.entries.length} entry · {board.exits.length} exit
                            {rate
                              ? ` · ${formatMoney(rate.hourly_rate)}/h + ${formatMoney(rate.additional_fee)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                    </header>

                    {board.entries.length === 0 && board.exits.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No gates assigned to this zone yet.
                      </p>
                    ) : (
                      <div className="grid gap-6 p-4 xl:grid-cols-2">
                        <div className="min-w-0 space-y-3">
                          <div className="rounded-xl border border-success/20 bg-success-muted/30 px-3 py-2.5">
                            <p className="text-sm font-semibold tracking-tight">
                              Entry
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Into {board.zoneName}
                            </p>
                          </div>
                          {board.entries.length === 0 ? (
                            <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                              No entry gates
                            </p>
                          ) : (
                            <div className="grid gap-3">
                              {board.entries.map((device) => (
                                <SiteGateCard
                                  key={device.id}
                                  device={device}
                                  busy={busyId === device.id}
                                  busyCmd={busyId === device.id ? busyCmd : null}
                                  plateBusy={plateBusy}
                                  canControlGates={canDecide}
                                  onOpen={() => openPlateModal(device, "open")}
                                  onPulse={() => openPlateModal(device, "pulse")}
                                  onClose={() => void sendCommand(device, "close")}
                                  onLockToggle={() =>
                                    void sendCommand(
                                      device,
                                      device.gate_locked ? "unlock" : "lock"
                                    )
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div className="rounded-xl border border-warning/25 bg-warning-muted/40 px-3 py-2.5">
                            <p className="text-sm font-semibold tracking-tight">
                              Exit
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Out of {board.zoneName}
                            </p>
                          </div>
                          {board.exits.length === 0 ? (
                            <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                              No exit gates
                            </p>
                          ) : (
                            <div className="grid gap-3">
                              {board.exits.map((device) => (
                                <SiteGateCard
                                  key={device.id}
                                  device={device}
                                  busy={busyId === device.id}
                                  busyCmd={busyId === device.id ? busyCmd : null}
                                  plateBusy={plateBusy}
                                  canControlGates={canDecide}
                                  onOpen={() => openPlateModal(device, "open")}
                                  onPulse={() => openPlateModal(device, "pulse")}
                                  onClose={() => void sendCommand(device, "close")}
                                  onLockToggle={() =>
                                    void sendCommand(
                                      device,
                                      device.gate_locked ? "unlock" : "lock"
                                    )
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold tracking-tight">Open sessions</h2>
            <p className="text-sm text-muted-foreground">Vehicles currently at this site</p>
          </div>
          {open_sessions.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
              <ParkingSquare className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">No open sessions</p>
            </div>
          ) : (
            <ul className="divide-y">
              {open_sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold tracking-wider">
                      {session.plate}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {session.zone_name ? `${session.zone_name} · ` : ""}
                      Since {formatDateTime(session.start_time)}
                    </p>
                  </div>
                  <Badge variant="warning">In progress</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold tracking-tight">Pending requests</h2>
            <p className="text-sm text-muted-foreground">Awaiting staff decision</p>
          </div>
          {pending_requests.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
              <ShieldAlert className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">Queue clear</p>
            </div>
          ) : (
            <ul className="divide-y">
              {pending_requests.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold tracking-wider">
                      {req.plate}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {req.zone_name ? `${req.zone_name} · ` : ""}
                      {req.device_label} · {req.action}
                    </p>
                  </div>
                  {canDecide ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/gate-control">Decide</Link>
                    </Button>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog
        open={Boolean(plateDevice)}
        onOpenChange={(open) => {
          if (!open && !plateBusy) setPlateDevice(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {plateAction === "open" ? "Open gate" : "Pulse gate"}
            </DialogTitle>
            <DialogDescription>
              {plateDevice
                ? `${plateDevice.zone_name ? `${plateDevice.zone_name} · ` : ""}${gateLabel(plateDevice)} · ${plateDevice.type} · lane ${plateDevice.barrier_lane}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-gate-plate">Plate number</Label>
              <Input
                id="site-gate-plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                placeholder="ABC1234"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitPlateGate();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-gate-note">Note (optional)</Label>
              <Input
                id="site-gate-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VIP guest, staff override…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={exempted}
                onCheckedChange={(v) => setExempted(v === true)}
              />
              Exempt from billing
            </label>
            {plateDevice?.type === "exit" && !exempted ? (
              <div className="space-y-2">
                <Label htmlFor="site-gate-entry-time">Entry time (if needed)</Label>
                <Input
                  id="site-gate-entry-time"
                  type="datetime-local"
                  value={entryTime}
                  onChange={(e) => setEntryTime(e.target.value)}
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={plateBusy}
                onClick={() => setPlateDevice(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submitPlateGate()}
                disabled={plateBusy || !plate.trim()}
              >
                {plateBusy
                  ? "Opening…"
                  : plateAction === "open"
                    ? "Open with plate"
                    : "Pulse with plate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
