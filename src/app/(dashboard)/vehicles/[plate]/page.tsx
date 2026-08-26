"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CarFront,
  CheckCircle2,
  Clock3,
  History,
  Layers,
  LogIn,
  LogOut,
  ParkingSquare,
  ShieldX,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";

import { DetailHero } from "@/components/detail-hero";
import { EmptyState } from "@/components/empty-state";
import { Loader } from "@/components/loaders";
import { VehicleNoteEditor } from "@/components/vehicle-note-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { Event, Paginated, ProjectVehicle, Session, Vehicle } from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

function eventTone(decision: string) {
  const d = decision.toLowerCase();
  if (d.includes("allow") || d.includes("approv") || d === "granted") {
    return {
      iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      Icon: CheckCircle2,
    };
  }
  if (d.includes("deny") || d.includes("reject") || d.includes("block")) {
    return {
      iconClass: "bg-destructive/15 text-destructive",
      Icon: ShieldX,
    };
  }
  return {
    iconClass: "bg-muted text-muted-foreground",
    Icon: CarFront,
  };
}

function actionIcon(action: string) {
  const a = action.toLowerCase();
  if (a.includes("exit") || a.includes("out")) return LogOut;
  if (a.includes("entry") || a.includes("enter") || a.includes("in")) return LogIn;
  return History;
}

export default function VehicleDetailPage() {
  const params = useParams<{ plate: string }>();
  const plate = decodeURIComponent(params.plate || "").trim().toUpperCase();

  const [summary, setSummary] = useState<ProjectVehicle | null>(null);
  const [registered, setRegistered] = useState<Vehicle | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsCount, setEventsCount] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!plate) return;
    try {
      const [ops, walletVehicles] = await Promise.all([
        api<{ results: ProjectVehicle[] }>("ops/vehicles/", {
          query: { search: plate },
        }).catch(() => ({ results: [] as ProjectVehicle[] })),
        api<Paginated<Vehicle>>("vehicles/", {
          query: { search: plate },
        }).catch(() => ({ results: [] as Vehicle[], count: 0, next: null, previous: null })),
      ]);
      const exactOps =
        ops.results.find((r) => r.plate.toUpperCase() === plate) ?? null;
      setSummary(exactOps);
      const exactReg =
        walletVehicles.results.find((r) => r.plate.toUpperCase() === plate) ??
        null;
      setRegistered(exactReg);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load plate");
      setSummary(null);
      setRegistered(null);
    }
  }, [plate]);

  const loadEvents = useCallback(async () => {
    if (!plate) return;
    setEventsLoading(true);
    try {
      const data = await api<Paginated<Event>>("events/", {
        query: { plate, page: eventsPage, ordering: "-created_at" },
      });
      setEvents(data.results);
      setEventsCount(data.count);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load events");
      setEvents([]);
      setEventsCount(0);
    } finally {
      setEventsLoading(false);
    }
  }, [plate, eventsPage]);

  const loadSessions = useCallback(async () => {
    if (!plate) return;
    try {
      const data = await api<Paginated<Session>>("sessions/", {
        query: { plate, page: 1 },
      });
      setSessions(data.results);
    } catch {
      setSessions([]);
    }
  }, [plate]);

  useEffect(() => {
    if (!plate) return;
    setLoading(true);
    void Promise.all([loadSummary(), loadSessions()]).finally(() =>
      setLoading(false)
    );
  }, [plate, loadSummary, loadSessions]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const eventsTotalPages = Math.max(1, Math.ceil(eventsCount / 25));
  const walletId = summary?.wallet_id ?? registered?.wallet ?? null;
  const walletName = summary?.wallet_name ?? registered?.wallet_name ?? null;
  const note =
    registered?.note?.trim() || summary?.note?.trim() || "";
  const vehicleId = registered?.id ?? summary?.vehicle_id ?? null;

  if (!plate) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Invalid plate
      </div>
    );
  }

  if (loading) {
    return <Loader label="Loading vehicle…" />;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href="/vehicles">
          <ArrowLeft className="size-4" />
          Vehicles
        </Link>
      </Button>

      <DetailHero
        title={
          <span className="font-mono tracking-[0.12em]">{plate}</span>
        }
        badges={
          <>
            {summary?.is_open ? (
              <Badge variant="warning" className="gap-1">
                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                On site
              </Badge>
            ) : (
              <Badge variant="secondary">Not on site</Badge>
            )}
            {registered ? (
              <Badge variant={registered.is_active ? "success" : "secondary"}>
                {registered.is_active ? "Registered" : "Inactive"}
              </Badge>
            ) : (
              <Badge variant="outline">Unregistered</Badge>
            )}
            {summary?.project_name ? (
              <Badge variant="outline">{summary.project_name}</Badge>
            ) : registered?.project_name ? (
              <Badge variant="outline">{registered.project_name}</Badge>
            ) : null}
          </>
        }
        description={
          summary
            ? `Last seen at ${summary.site_name}${
                summary.zone_name ? ` · ${summary.zone_name}` : ""
              }`
            : "Gate events and parking history for this plate"
        }
        leading={
          <div
            className={cn(
              "flex size-16 items-center justify-center rounded-2xl border-2 font-mono text-sm font-bold tracking-wider",
              summary?.is_open
                ? "border-amber-400/50 bg-amber-500/15"
                : "border-primary/30 bg-primary/10"
            )}
          >
            <CarFront className="size-7" />
          </div>
        }
        actions={
          walletId ? (
            <Button variant="outline" asChild>
              <Link href={`/wallets/${walletId}`}>
                <WalletIcon className="size-4" />
                {walletName || "Wallet"}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Last seen</p>
          <p className="mt-1 text-sm font-semibold">
            {summary?.last_seen ? formatDateTime(summary.last_seen) : "—"}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Sessions</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {summary?.session_count ?? sessions.length}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Events</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{eventsCount}</p>
        </div>
      </div>

      {vehicleId ? (
        <VehicleNoteEditor
          vehicleId={vehicleId}
          note={note}
          plate={plate}
          onSaved={(next) => {
            setRegistered((prev) => (prev ? { ...prev, note: next } : prev));
            setSummary((prev) => (prev ? { ...prev, note: next || null } : prev));
          }}
        />
      ) : (
        <section className="rounded-2xl border border-dashed bg-card/60 p-5 text-sm text-muted-foreground shadow-sm">
          Register this plate on a wallet to add an operator note.
          {walletId ? (
            <>
              {" "}
              <Link
                href={`/wallets/${walletId}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Open wallet
              </Link>
            </>
          ) : null}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold tracking-tight">Latest events</h2>
            <p className="text-sm text-muted-foreground">
              Gate reads and decisions for this plate
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadEvents()}
            disabled={eventsLoading}
          >
            Refresh
          </Button>
        </div>

        {eventsLoading && events.length === 0 ? (
          <Loader compact label="Loading events…" />
        ) : events.length === 0 ? (
          <EmptyState
            icon={History}
            title="No events yet"
            description="Gate activity for this plate will show up here."
          />
        ) : (
          <ul className="divide-y">
            {events.map((event) => {
              const tone = eventTone(event.decision);
              const ActionIcon = actionIcon(event.action);
              const Icon = tone.Icon;
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-3 px-5 py-3.5 sm:items-center sm:gap-4"
                >
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      tone.iconClass
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="gap-1 font-normal capitalize">
                        <ActionIcon className="size-3" />
                        {event.action}
                      </Badge>
                      <Badge
                        variant={
                          event.decision.toLowerCase().includes("deny")
                            ? "destructive"
                            : event.decision.toLowerCase().includes("allow") ||
                                event.decision.toLowerCase().includes("approv")
                              ? "success"
                              : "secondary"
                        }
                        className="capitalize"
                      >
                        {event.decision}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="size-3.5" />
                        {event.site_name}
                      </span>
                      {event.device_label ? (
                        <span className="truncate">{event.device_label}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
                      <Clock3 className="size-3.5" />
                      {formatDateTime(event.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {eventsCount > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Showing {(eventsPage - 1) * 25 + 1}–
              {Math.min(eventsPage * 25, eventsCount)} of {eventsCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={eventsPage <= 1 || eventsLoading}
                onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
                {eventsPage}/{eventsTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={eventsPage >= eventsTotalPages || eventsLoading}
                onClick={() => setEventsPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold tracking-tight">Recent sessions</h2>
          <p className="text-sm text-muted-foreground">
            Latest parking stays for this plate
          </p>
        </div>
        {sessions.length === 0 ? (
          <EmptyState
            icon={ParkingSquare}
            title="No sessions"
            description="Parking stays will appear after this plate enters a site."
            className="py-10"
          />
        ) : (
          <ul className="divide-y">
            {sessions.map((session) => {
              const open = !session.end_time;
              return (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={open ? "warning" : "secondary"}>
                          {open ? "Open" : "Closed"}
                        </Badge>
                        <Badge variant="outline" className="capitalize">
                          {session.payment_status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 className="size-3.5" />
                          {session.site_name}
                        </span>
                        {session.zone_name ? (
                          <span className="inline-flex items-center gap-1">
                            <Layers className="size-3.5 opacity-70" />
                            {session.zone_name}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {formatDateTime(session.start_time)}
                        {session.end_time
                          ? ` → ${formatDateTime(session.end_time)}`
                          : " → now"}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">
                      {formatMoney(session.fee)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
