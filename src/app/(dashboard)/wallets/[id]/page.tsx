"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  CarFront,
  ChevronRight,
  Download,
  ParkingSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Power,
  Trash2,
  Upload,
  UserRound,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { VehicleNoteEditor } from "@/components/vehicle-note-editor";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, apiDownload, apiUpload, ApiError } from "@/lib/api";
import type {
  Paginated,
  Session,
  Transaction,
  Vehicle,
  Wallet,
} from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

const TAB_KEYS = ["wallet", "vehicles", "sessions"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
  return TAB_KEYS.includes(value as TabKey);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const TX_TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "top_up", label: "Top up" },
  { value: "parking_fee", label: "Parking" },
  { value: "operator_validate", label: "Validate" },
  { value: "withdraw", label: "Withdraw" },
] as const;

type TxTypeFilter = (typeof TX_TYPE_FILTERS)[number]["value"];

function transactionTypeMeta(type: string) {
  switch (type) {
    case "top_up":
      return {
        label: "Top up",
        Icon: ArrowDownLeft,
        iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        amountClass: "text-emerald-700 dark:text-emerald-400",
      };
    case "refund":
      return {
        label: "Refund",
        Icon: RotateCcw,
        iconClass: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
        amountClass: "text-sky-800 dark:text-sky-300",
      };
    case "withdraw":
      return {
        label: "Withdraw",
        Icon: ArrowUpRight,
        iconClass: "bg-destructive/15 text-destructive",
        amountClass: "text-destructive",
      };
    case "operator_validate":
      return {
        label: "Operator validate",
        Icon: ParkingSquare,
        iconClass: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
        amountClass: "text-violet-800 dark:text-violet-300",
      };
    case "parking_fee":
      return {
        label: "Parking fee",
        Icon: ParkingSquare,
        iconClass: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        amountClass: "text-amber-800 dark:text-amber-300",
      };
    default:
      return {
        label: type.replaceAll("_", " "),
        Icon: WalletIcon,
        iconClass: "bg-muted text-muted-foreground",
        amountClass: "text-foreground",
      };
  }
}

function formatTxDayLabel(iso: string) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, yesterday)) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatTxTime(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function txDayKey(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  } catch {
    return iso;
  }
}

export default function WalletDetailPage() {
  return (
    <Suspense fallback={<Loader label="Loading wallet…" />}>
      <WalletDetailContent />
    </Suspense>
  );
}

function WalletDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, canAdjustWallet } = useAuth();
  const { setProjectId: setFilterProjectId } = useProjectFilter();
  const walletId = Number(params.id);

  const tabParam = searchParams.get("tab");
  const requestedTab: TabKey = isTabKey(tabParam) ? tabParam : "wallet";

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isExempted, setIsExempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const projectOptions = user?.projects ?? [];

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txCount, setTxCount] = useState(0);
  const [txLoading, setTxLoading] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [txDateRange, setTxDateRange] = useState<DateRangeValue>({});
  const [txTypeFilter, setTxTypeFilter] = useState<TxTypeFilter>("all");
  const [txExporting, setTxExporting] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<"top_up" | "withdraw">("top_up");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);

  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [plate, setPlate] = useState("");
  const [vehicleNote, setVehicleNote] = useState("");
  const [vehicleActive, setVehicleActive] = useState(true);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [vehiclesExporting, setVehiclesExporting] = useState(false);
  const [vehiclesImporting, setVehiclesImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsCount, setSessionsCount] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsExporting, setSessionsExporting] = useState(false);

  const loadWallet = useCallback(async () => {
    if (!Number.isFinite(walletId)) return;
    setLoading(true);
    try {
      const data = await api<Wallet>(`wallets/${walletId}/`);
      setWallet(data);
      setName(data.name);
      setIsActive(data.is_active);
      setIsExempted(Boolean(data.is_exempted));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load wallet");
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  const loadTransactions = useCallback(async () => {
    if (!Number.isFinite(walletId)) return;
    setTxLoading(true);
    try {
      const data = await api<Paginated<Transaction>>("transactions/", {
        query: {
          wallet: walletId,
          page: txPage,
          transaction_type: txTypeFilter === "all" ? undefined : txTypeFilter,
          created_after: txDateRange.from
            ? toStartOfDayIso(txDateRange.from)
            : undefined,
          created_before: txDateRange.to
            ? toEndOfDayIso(txDateRange.to)
            : txDateRange.from
              ? toEndOfDayIso(txDateRange.from)
              : undefined,
        },
      });
      setTransactions(data.results);
      setTxCount(data.count);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load transactions");
      setTransactions([]);
      setTxCount(0);
    } finally {
      setTxLoading(false);
    }
  }, [walletId, txPage, txDateRange.from, txDateRange.to, txTypeFilter]);

  useEffect(() => {
    setTxPage(1);
  }, [txTypeFilter, txDateRange.from, txDateRange.to]);

  // Operator wallets never own a session — they only appear as the payer, so
  // list what this wallet actually settled instead of what its plates parked.
  const isOperator = Boolean(wallet?.is_operator_wallet);
  // Operator wallets cannot own vehicles, so never render that tab for them.
  const activeTab: TabKey =
    isOperator && requestedTab === "vehicles" ? "wallet" : requestedTab;

  const loadSessions = useCallback(async () => {
    if (!Number.isFinite(walletId)) return;
    setSessionsLoading(true);
    try {
      const data = await api<Paginated<Session>>("sessions/", {
        query: isOperator
          ? { paid_by_wallet: walletId, page: 1 }
          : { wallet: walletId, page: 1 },
      });
      setSessions(data.results);
      setSessionsCount(data.count);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load sessions");
      setSessions([]);
      setSessionsCount(0);
    } finally {
      setSessionsLoading(false);
    }
  }, [walletId, isOperator]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    if (wallet?.project != null) {
      setFilterProjectId(wallet.project);
    }
  }, [wallet?.project, setFilterProjectId]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions, wallet?.balance]);

  useEffect(() => {
    // Operator wallets surface the validated-stay count on the wallet tab too.
    if (activeTab === "sessions" || isOperator) void loadSessions();
  }, [activeTab, isOperator, loadSessions]);

  useEffect(() => {
    if (tabParam === "details") {
      router.replace(`/wallets/${walletId}?tab=wallet`, { scroll: false });
    }
  }, [tabParam, walletId, router]);

  useEffect(() => {
    if (wallet?.is_operator_wallet && activeTab === "vehicles") {
      router.replace(`/wallets/${walletId}?tab=wallet`, { scroll: false });
    }
  }, [wallet?.is_operator_wallet, activeTab, walletId, router]);

  function setTab(next: string) {
    const tab = isTabKey(next) ? next : "wallet";
    router.replace(`/wallets/${walletId}?tab=${tab}`, { scroll: false });
  }

  const dirty = useMemo(() => {
    if (!wallet) return false;
    return (
      name.trim() !== wallet.name ||
      isActive !== wallet.is_active ||
      isExempted !== Boolean(wallet.is_exempted) ||
      Number(projectId) !== wallet.project
    );
  }, [wallet, name, isActive, isExempted, projectId]);

  const txHasFilters = Boolean(
    txDateRange.from || txDateRange.to || txTypeFilter !== "all"
  );
  const txPageSize = 25;
  const txTotalPages = Math.max(1, Math.ceil(txCount / txPageSize));

  const txGrouped = useMemo(() => {
    const groups: { key: string; label: string; items: Transaction[] }[] = [];
    for (const tx of transactions) {
      const key = txDayKey(tx.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(tx);
      } else {
        groups.push({
          key,
          label: formatTxDayLabel(tx.created_at),
          items: [tx],
        });
      }
    }
    return groups;
  }, [transactions]);

  const txSummary = useMemo(() => {
    let credits = 0;
    let debits = 0;
    for (const tx of transactions) {
      const n = Number(tx.amount);
      if (Number.isNaN(n)) continue;
      if (n >= 0) credits += n;
      else debits += Math.abs(n);
    }
    return { credits, debits, net: credits - debits };
  }, [transactions]);

  function openEdit() {
    if (!wallet) return;
    setName(wallet.name);
    setProjectId(String(wallet.project));
    setIsActive(wallet.is_active);
    setIsExempted(Boolean(wallet.is_exempted));
    setEditOpen(true);
  }

  async function onSaveDetails(e: FormEvent) {
    e.preventDefault();
    if (!wallet || !dirty) return;
    setSaving(true);
    try {
      const updated = await api<Wallet>(`wallets/${wallet.id}/`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          is_active: isActive,
          is_exempted: wallet.is_operator_wallet ? false : isExempted,
          project: Number(projectId),
        },
      });
      setWallet(updated);
      setName(updated.name);
      setProjectId(String(updated.project));
      setIsActive(updated.is_active);
      setIsExempted(Boolean(updated.is_exempted));
      setEditOpen(false);
      toast.success(
        updated.is_exempted
          ? "Wallet updated · vehicles & open sessions are exempted"
          : "Wallet updated"
      );
      if (activeTab === "sessions") void loadSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  function openAdjust(mode: "top_up" | "withdraw") {
    setAdjustMode(mode);
    setAmount("");
    setReference("");
    setAdjustOpen(true);
  }

  async function onAdjust(e: FormEvent) {
    e.preventDefault();
    if (!wallet?.id) return;
    setAdjustBusy(true);
    try {
      await api(`wallets/${wallet.id}/${adjustMode}/`, {
        method: "POST",
        body: { amount, reference },
      });
      toast.success(
        adjustMode === "top_up"
          ? isOperator
            ? "Cash settled"
            : "Wallet topped up"
          : "Withdrawal complete"
      );
      setAdjustOpen(false);
      await loadWallet();
      await loadTransactions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Wallet action failed");
    } finally {
      setAdjustBusy(false);
    }
  }

  async function onAddVehicle(e: FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    const normalized = plate.trim().toUpperCase();
    if (!normalized) return;
    if (
      (wallet.vehicles ?? []).some(
        (v) => v.plate.trim().toUpperCase() === normalized
      )
    ) {
      toast.error("This plate is already on this wallet");
      return;
    }
    setVehicleBusy(true);
    try {
      await api<Vehicle>("vehicles/", {
        method: "POST",
        body: {
          wallet: wallet.id,
          plate: normalized,
          note: vehicleNote.trim(),
          is_active: vehicleActive,
        },
      });
      toast.success("Vehicle added");
      setVehicleOpen(false);
      setPlate("");
      setVehicleNote("");
      setVehicleActive(true);
      await loadWallet();
      setTab("vehicles");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not add vehicle";
      toast.error(
        /unique|already|exists|duplicate/i.test(message)
          ? "This plate is already registered"
          : message
      );
    } finally {
      setVehicleBusy(false);
    }
  }

  async function toggleVehicle(vehicle: Vehicle) {
    try {
      await api(`vehicles/${vehicle.id}/`, {
        method: "PATCH",
        body: { is_active: !vehicle.is_active },
      });
      toast.success(vehicle.is_active ? "Vehicle deactivated" : "Vehicle activated");
      await loadWallet();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function deleteVehicle(vehicle: Vehicle) {
    if (
      !window.confirm(
        `Remove plate ${vehicle.plate} from this wallet? Past sessions and events for this plate are kept.`
      )
    ) {
      return;
    }
    setVehicleBusy(true);
    try {
      await api(`vehicles/${vehicle.id}/`, { method: "DELETE" });
      toast.success(`${vehicle.plate} removed`);
      await loadWallet();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove vehicle");
    } finally {
      setVehicleBusy(false);
    }
  }

  async function exportTransactions() {
    if (!wallet) return;
    setTxExporting(true);
    try {
      await apiDownload("transactions/export/", {
        filename: `wallet-${wallet.id}-transactions.csv`,
        query: {
          wallet: wallet.id,
          transaction_type: txTypeFilter === "all" ? undefined : txTypeFilter,
          created_after: txDateRange.from
            ? toStartOfDayIso(txDateRange.from)
            : undefined,
          created_before: txDateRange.to
            ? toEndOfDayIso(txDateRange.to)
            : txDateRange.from
              ? toEndOfDayIso(txDateRange.from)
              : undefined,
        },
      });
      toast.success("Transactions exported");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setTxExporting(false);
    }
  }

  async function exportVehicles() {
    if (!wallet) return;
    setVehiclesExporting(true);
    try {
      await apiDownload(`wallets/${wallet.id}/vehicles/export/`, {
        filename: `wallet-${wallet.id}-vehicles.csv`,
      });
      toast.success("Vehicles exported");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setVehiclesExporting(false);
    }
  }

  async function importVehicles() {
    if (!wallet) return;
    const file = importFileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file first");
      return;
    }
    setVehiclesImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiUpload<{
        created: number;
        updated: number;
        removed: number;
        vehicles: Vehicle[];
      }>(`wallets/${wallet.id}/vehicles/import/`, form);
      toast.success(
        `Imported · ${result.created} created · ${result.updated} updated · ${result.removed} removed`
      );
      setImportOpen(false);
      if (importFileRef.current) importFileRef.current.value = "";
      await loadWallet();
      setTab("vehicles");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setVehiclesImporting(false);
    }
  }

  async function exportSessions() {
    if (!wallet) return;
    setSessionsExporting(true);
    try {
      await apiDownload("sessions/export/", {
        query: isOperator
          ? { paid_by_wallet: wallet.id }
          : { wallet: wallet.id },
        filename: `wallet-${wallet.id}-sessions.csv`,
      });
      toast.success("Sessions exported");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setSessionsExporting(false);
    }
  }

  if (loading) {
    return <Loader label="Loading wallet…" />;
  }

  const fromOperators = searchParams.get("from") === "operators";
  const walletsBackHref =
    fromOperators || Boolean(wallet?.is_operator_wallet)
      ? "/wallets?kind=operators"
      : "/wallets";
  const walletsBackLabel =
    fromOperators || Boolean(wallet?.is_operator_wallet)
      ? "Operator wallets"
      : "Client wallets";

  if (!wallet) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <p className="font-medium">Wallet not found</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/wallets">Back to wallets</Link>
        </Button>
      </div>
    );
  }

  const balance = Number(wallet.balance);
  const negative = !Number.isNaN(balance) && balance < 0;
  const vehicles = wallet.vehicles ?? [];
  const openSessions = sessions.filter((s) => !s.end_time).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={walletsBackHref}>
            <ArrowLeft className="size-4" />
            {walletsBackLabel}
          </Link>
        </Button>
      </div>

      <DetailHero
        title={wallet.name}
        badges={
          <>
            <Badge variant={wallet.is_active ? "success" : "secondary"}>
              {wallet.is_active ? "Active" : "Inactive"}
            </Badge>
            {wallet.is_operator_wallet ? (
              <Badge variant="outline">Operator</Badge>
            ) : null}
            {wallet.is_exempted ? (
              <Badge variant="exempt">Exempt</Badge>
            ) : null}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{wallet.project_name}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>#{wallet.id}</span>
            {wallet.is_operator_wallet && wallet.assigned_user_username ? (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3.5" />
                  {wallet.assigned_user_username}
                </span>
              </>
            ) : null}
            {!wallet.is_operator_wallet ? (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span>
                  {vehicles.length} plate{vehicles.length === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </span>
        }
        leading={
          <div
            className={cn(
              "flex size-16 shrink-0 items-center justify-center rounded-2xl text-lg font-bold shadow-md",
              wallet.is_operator_wallet
                ? "bg-secondary text-secondary-foreground shadow-black/5"
                : "bg-primary text-primary-foreground shadow-primary/25"
            )}
          >
            {wallet.is_operator_wallet ? (
              <UserRound className="size-7" />
            ) : (
              initials(wallet.name) || "?"
            )}
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={openEdit}>
              <Pencil className="size-4" />
              Edit
            </Button>
            {canAdjustWallet ? (
              <Button onClick={() => openAdjust("top_up")}>
                <ArrowDownLeft className="size-4" />
                {wallet.is_operator_wallet ? "Settle cash" : "Top up"}
              </Button>
            ) : null}
            {!wallet.is_operator_wallet ? (
              <Button
                variant={canAdjustWallet ? "outline" : "default"}
                onClick={() => {
                  setTab("vehicles");
                  setVehicleOpen(true);
                }}
              >
                <Plus className="size-4" />
                Add vehicle
              </Button>
            ) : null}
          </div>
        }
      />

      {wallet.is_operator_wallet ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold tracking-tight">Operator cash wallet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Every validate charges this wallet, so it runs negative by design —
              the balance is the cash owed back to the company
              {wallet.assigned_user_username
                ? ` by ${wallet.assigned_user_username}`
                : ""}
              .
            </p>
          </div>
          {canAdjustWallet && negative ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => openAdjust("top_up")}
            >
              <ArrowDownLeft className="size-3.5" />
              Settle cash
            </Button>
          ) : null}
        </div>
      ) : null}

      {wallet.is_exempted ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-5 py-4 text-sky-950 dark:text-sky-50 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold tracking-tight">Billing exemption active</p>
            <p className="mt-0.5 text-sm opacity-80">
              Every plate on this wallet parks free. Open sessions and future stays are
              marked exempted automatically.
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={openEdit}>
            Manage
          </Button>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="wallet">
              <WalletIcon className="size-4" />
              Wallet
            </TabsTrigger>
            {!wallet.is_operator_wallet ? (
              <TabsTrigger value="vehicles">
                <CarFront className="size-4" />
                Vehicles
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">
                  {vehicles.length}
                </span>
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="sessions">
              <ParkingSquare className="size-4" />
              {isOperator ? "Validated" : "Sessions"}
              {sessionsCount > 0 ? (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">
                  {sessionsCount}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="wallet" className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative overflow-hidden rounded-3xl border brand-wallet-mesh p-6 text-white shadow-sm sm:p-8">
              <p className="text-sm text-white/70">
                {isOperator
                  ? negative
                    ? "Cash owed to company"
                    : "Operator balance"
                  : "Available balance"}
              </p>
              <p
                className={cn(
                  "mt-2 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl",
                  // A negative operator wallet is the normal working state, so
                  // only a customer wallet going negative is worth alarming.
                  negative && !isOperator && "text-rose-300"
                )}
              >
                {isOperator && negative
                  ? formatMoney(Math.abs(balance), wallet.currency)
                  : formatMoney(wallet.balance, wallet.currency)}
              </p>
              <p className="mt-2 text-sm text-white/55">
                {isOperator
                  ? negative
                    ? `Collected at the desk · settle to clear · ${wallet.currency}`
                    : `Nothing outstanding · ${wallet.currency}`
                  : negative
                    ? "Overdrawn · top up to clear"
                    : `Wallet #${wallet.id} · ${wallet.currency}`}
              </p>
              {canAdjustWallet ? (
                <div className="mt-8 flex flex-wrap gap-2">
                  <Button
                    className="bg-card text-primary hover:bg-card/90"
                    onClick={() => openAdjust("top_up")}
                  >
                    <ArrowDownLeft className="size-4" />
                    {isOperator ? "Settle cash" : "Top up"}
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                    onClick={() => openAdjust("withdraw")}
                  >
                    <ArrowUpRight className="size-4" />
                    Withdraw
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold tracking-tight">At a glance</h3>
              <dl className="mt-4 space-y-3 text-sm">
                {wallet.is_operator_wallet ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Assigned to</dt>
                    <dd className="inline-flex max-w-[60%] items-center gap-1.5 truncate font-medium">
                      <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {wallet.assigned_user_username || "—"}
                      </span>
                    </dd>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Vehicles</dt>
                    <dd className="font-medium tabular-nums">{vehicles.length}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Transactions</dt>
                  <dd className="font-medium tabular-nums">{txCount}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant={wallet.is_active ? "success" : "secondary"}>
                      {wallet.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </dd>
                </div>
                {!isOperator ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Billing</dt>
                    <dd>
                      {wallet.is_exempted ? (
                        <Badge variant="exempt">Exempt</Badge>
                      ) : (
                        <span className="font-medium">Standard</span>
                      )}
                    </dd>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Validated stays</dt>
                      <dd className="font-medium tabular-nums">
                        {sessionsCount}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Owed</dt>
                      <dd
                        className={cn(
                          "font-medium tabular-nums",
                          negative && "text-amber-700 dark:text-amber-300"
                        )}
                      >
                        {negative
                          ? formatMoney(Math.abs(balance), wallet.currency)
                          : formatMoney(0, wallet.currency)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                {isOperator
                  ? "Each validate charges this wallet, so it normally sits negative. Settle when the operator hands the cash in."
                  : wallet.is_exempted
                    ? "This wallet is exempt from parking fees. Top-ups still work for other uses."
                    : "Top ups credit immediately. Withdrawals need enough balance."}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="space-y-3 border-b px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold tracking-tight">Transactions</h3>
                  <p className="text-sm text-muted-foreground">
                    Movements, operators, and remaining balance
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DateRangeFilter
                    value={txDateRange}
                    onChange={setTxDateRange}
                    placeholder="Date range"
                    align="end"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void exportTransactions()}
                    disabled={txExporting || txLoading}
                  >
                    <Download className="size-3.5" />
                    {txExporting ? "Exporting…" : "Export"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadTransactions()}
                    disabled={txLoading}
                  >
                    <RefreshCw
                      className={cn("size-3.5", txLoading && "animate-spin")}
                    />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {TX_TYPE_FILTERS.map((opt) => {
                  const active = txTypeFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTxTypeFilter(opt.value)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {!txLoading && transactions.length > 0 ? (
              <div className="grid grid-cols-3 divide-x border-b bg-muted/20 text-center">
                <div className="px-3 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    In · page
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    +{formatMoney(txSummary.credits, wallet.currency)}
                  </p>
                </div>
                <div className="px-3 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Out · page
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums text-destructive">
                    −{formatMoney(txSummary.debits, wallet.currency)}
                  </p>
                </div>
                <div className="px-3 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Net · page
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-sm font-semibold tabular-nums",
                      txSummary.net >= 0
                        ? "text-foreground"
                        : "text-destructive"
                    )}
                  >
                    {txSummary.net >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(txSummary.net), wallet.currency)}
                  </p>
                </div>
              </div>
            ) : null}

            {txLoading ? (
              <Loader compact label="Loading transactions…" />
            ) : transactions.length === 0 ? (
              <EmptyState
                icon={WalletIcon}
                title={txHasFilters ? "No matching transactions" : "No transactions yet"}
                description={
                  txHasFilters
                    ? "Try a wider date range or a different type filter."
                    : canAdjustWallet
                      ? "Top up to fund this wallet and start the ledger."
                      : "Activity will appear here after wallet movements."
                }
                action={
                  txHasFilters ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTxTypeFilter("all");
                        setTxDateRange({});
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : canAdjustWallet ? (
                    <Button size="sm" onClick={() => openAdjust("top_up")}>
                      <ArrowDownLeft className="size-4" />
                      Top up now
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div>
                {txGrouped.map((group) => (
                  <div key={group.key}>
                    <div className="sticky top-0 z-[1] border-b bg-muted/40 px-5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                    </div>
                    <ul className="divide-y">
                      {group.items.map((tx) => {
                        const amountNum = Number(tx.amount);
                        const credit =
                          !Number.isNaN(amountNum) && amountNum > 0;
                        const meta = transactionTypeMeta(tx.transaction_type);
                        const Icon = meta.Icon;
                        return (
                          <li
                            key={tx.id}
                            className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/35 sm:items-center sm:gap-4"
                          >
                            <div
                              className={cn(
                                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                                meta.iconClass
                              )}
                            >
                              <Icon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold tracking-tight">
                                  {meta.label}
                                </p>
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {tx.reference || "No reference"}
                                {tx.created_by_username
                                  ? ` · by ${tx.created_by_username}`
                                  : " · System"}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                <span className="tabular-nums">
                                  {formatTxTime(tx.created_at)}
                                </span>
                                {tx.session != null ? (
                                  <Link
                                    href={`/sessions/${tx.session}`}
                                    className="font-medium text-primary hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Session #{tx.session}
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={cn(
                                  "text-base font-semibold tabular-nums tracking-tight",
                                  meta.amountClass
                                )}
                              >
                                {credit ? "+" : ""}
                                {formatMoney(tx.amount, wallet.currency)}
                              </p>
                              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                                Remaining{" "}
                                <span className="font-medium text-foreground/80">
                                  {formatMoney(tx.balance_after, wallet.currency)}
                                </span>
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3">
                  <p className="text-sm text-muted-foreground">
                    {txCount === 0
                      ? "0 transactions"
                      : `Showing ${(txPage - 1) * txPageSize + 1}–${Math.min(
                          txPage * txPageSize,
                          txCount
                        )} of ${txCount}`}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={txPage <= 1 || txLoading}
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
                      {txPage}/{txTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={txPage >= txTotalPages || txLoading}
                      onClick={() => setTxPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="vehicles">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Vehicles</h2>
              <p className="text-sm text-muted-foreground">
                Plates authorized for this subscriber. Import replaces the current list
                and activates every plate in the file.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportVehicles()}
                disabled={vehiclesExporting}
              >
                <Download className="size-4" />
                {vehiclesExporting ? "Exporting…" : "Export"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                Import
              </Button>
              <Button onClick={() => setVehicleOpen(true)}>
                <Plus className="size-4" />
                Add vehicle
              </Button>
            </div>
          </div>

          {vehicles.length === 0 ? (
            <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-card text-center">
              <CarFront className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No vehicles yet</p>
              <p className="text-sm text-muted-foreground">Add a plate to get started.</p>
              <Button size="sm" className="mt-1" onClick={() => setVehicleOpen(true)}>
                Add vehicle
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {vehicles.map((vehicle, index) => {
                const noteText = vehicle.note?.trim() ?? "";
                return (
                  <div
                    key={vehicle.id}
                    className={cn(
                      "animate-fade-up group flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition-colors",
                      vehicle.is_active
                        ? "hover:border-primary/25"
                        : "opacity-75 hover:opacity-100"
                    )}
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/vehicles/${encodeURIComponent(vehicle.plate)}`}
                        className={cn(
                          "min-w-0 font-mono text-xl font-bold tracking-[0.16em] transition-colors hover:text-primary",
                          !vehicle.is_active && "text-muted-foreground"
                        )}
                      >
                        {vehicle.plate}
                      </Link>
                      <Badge
                        variant={vehicle.is_active ? "success" : "secondary"}
                        className="shrink-0"
                      >
                        {vehicle.is_active ? "Active" : "Off"}
                      </Badge>
                    </div>

                    <p
                      className={cn(
                        "mt-3 min-h-[2.75rem] line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed",
                        noteText
                          ? "text-muted-foreground"
                          : "text-muted-foreground/55"
                      )}
                    >
                      {noteText || "No note"}
                    </p>

                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground"
                        asChild
                      >
                        <Link
                          href={`/vehicles/${encodeURIComponent(vehicle.plate)}`}
                        >
                          View events
                          <ChevronRight className="size-3.5 opacity-60" />
                        </Link>
                      </Button>
                      <div className="flex items-center gap-0.5">
                        <VehicleNoteEditor
                          variant="icon"
                          vehicleId={vehicle.id}
                          note={vehicle.note}
                          plate={vehicle.plate}
                          onSaved={(next) => {
                            setWallet((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    vehicles: prev.vehicles.map((v) =>
                                      v.id === vehicle.id
                                        ? { ...v, note: next }
                                        : v
                                    ),
                                  }
                                : prev
                            );
                          }}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          onClick={() => void toggleVehicle(vehicle)}
                          disabled={vehicleBusy}
                          aria-label={
                            vehicle.is_active
                              ? `Deactivate ${vehicle.plate}`
                              : `Activate ${vehicle.plate}`
                          }
                          title={vehicle.is_active ? "Deactivate" : "Activate"}
                        >
                          <Power className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void deleteVehicle(vehicle)}
                          disabled={vehicleBusy}
                          aria-label={`Remove ${vehicle.plate}`}
                          title="Remove plate"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sessions">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {isOperator ? "Validated stays" : "Sessions"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isOperator
                  ? "Stays this operator paid for from this wallet"
                  : "Parking stays for this wallet's plates"}
                {openSessions > 0 ? ` · ${openSessions} open` : ""}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportSessions()}
                disabled={sessionsExporting}
              >
                <Download className="size-4" />
                {sessionsExporting ? "Exporting…" : "Export CSV"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadSessions()}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {sessionsLoading ? (
              <Loader compact label="Loading sessions…" />
            ) : sessions.length === 0 ? (
              <div className="flex h-44 flex-col items-center justify-center gap-2 text-center">
                <ParkingSquare className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {isOperator ? "Nothing validated yet" : "No sessions yet"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isOperator
                    ? "Stays appear here once this operator validates a payment."
                    : "Stays appear here once a linked plate enters a site."}
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {sessions.map((session) => {
                  const open = !session.end_time;
                  return (
                    <li
                      key={session.id}
                      className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/sessions/${session.id}`}
                            className="rounded-lg border bg-muted/50 px-2 py-0.5 font-mono text-sm font-semibold tracking-wider text-primary hover:underline"
                          >
                            {session.plate}
                          </Link>
                          <Badge variant={open ? "warning" : "outline"}>
                            {open ? "In progress" : "Closed"}
                          </Badge>
                          <SessionBillingBadges session={session} />
                          {session.allow_negative_balance &&
                          !session.billing_exempt ? (
                            <Badge variant="outline">Overdraft</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {session.site_name}
                          {session.zone_name ? ` · ${session.zone_name}` : ""} · #
                          {session.id}
                        </p>
                      </div>
                      <div className="grid gap-1 text-sm sm:min-w-52 sm:text-right">
                        <p>
                          <span className="text-muted-foreground">In </span>
                          {formatDateTime(session.start_time)}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Out </span>
                          {formatDateTime(session.end_time)}
                        </p>
                        <p className="font-medium tabular-nums">
                          {formatMoney(session.fee, wallet.currency)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit wallet</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSaveDetails}>
            <div className="space-y-2">
              <Label htmlFor="wallet-project">Project</Label>
              <select
                id="wallet-project"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wallet-name">Name</Label>
              <Input
                id="wallet-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            {wallet.is_operator_wallet ? (
              <div className="rounded-xl border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">Operator assignment</p>
                <p className="mt-0.5 text-muted-foreground">
                  {wallet.assigned_user_username
                    ? `Assigned to ${wallet.assigned_user_username}`
                    : "No staff user assigned"}
                  .
                </p>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v === true)}
              />
              Active wallet
            </label>
            {!wallet.is_operator_wallet ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={isExempted}
                  onCheckedChange={(v) => setIsExempted(v === true)}
                />
                <span>
                  <span className="font-medium">Exempt wallet</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    All vehicles skip wallet charges. Open and pending sessions are
                    marked exempted.
                  </span>
                </span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustMode === "top_up"
                ? isOperator
                  ? "Settle operator cash"
                  : "Top up wallet"
                : "Withdraw from wallet"}
            </DialogTitle>
            {isOperator && adjustMode === "top_up" && negative ? (
              <DialogDescription>
                Records cash handed in. Enter{" "}
                {formatMoney(Math.abs(balance), wallet.currency)} to clear the
                full amount owed.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <form className="space-y-4" onSubmit={onAdjust}>
            <div className="rounded-xl border bg-muted/40 px-3 py-2 text-sm">
              {isOperator && negative ? "Currently owed " : "Current balance "}
              <span className="font-semibold tabular-nums">
                {isOperator && negative
                  ? formatMoney(Math.abs(balance), wallet.currency)
                  : formatMoney(wallet.balance, wallet.currency)}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10.00"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Reference</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Optional note"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={adjustBusy}>
                {adjustBusy ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add vehicle</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onAddVehicle}>
            <div className="space-y-2">
              <Label htmlFor="plate">Plate</Label>
              <Input
                id="plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                className="font-mono tracking-wider"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-note">Note</Label>
              <Textarea
                id="vehicle-note"
                value={vehicleNote}
                onChange={(e) => setVehicleNote(e.target.value)}
                placeholder="Optional operator note"
                rows={3}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={vehicleActive}
                onCheckedChange={(v) => setVehicleActive(v === true)}
              />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setVehicleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={vehicleBusy}>
                {vehicleBusy ? "Saving…" : "Add plate"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import vehicles</DialogTitle>
            <DialogDescription>
              CSV must include a <code>plate</code> column. This replaces the wallet&apos;s
              current plates — listed plates become active, others are removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input ref={importFileRef} type="file" accept=".csv,text/csv" />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={vehiclesImporting}
                onClick={() => void importVehicles()}
              >
                {vehiclesImporting ? "Importing…" : "Import & replace"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
