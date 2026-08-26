"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Loader2,
  Search,
  SmartphoneNfc,
} from "lucide-react";
import { toast } from "sonner";

import {
  DateRangeFilter,
  toEndOfDayIso,
  toStartOfDayIso,
  type DateRangeValue,
} from "@/components/date-range-filter";
import { EmptyState } from "@/components/empty-state";
import { Loader } from "@/components/loaders";
import { useProjectFilter } from "@/components/providers/project-filter-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, apiDownload, ApiError } from "@/lib/api";
import type {
  KioskCredential,
  Paginated,
  PaymentIntent,
  Site,
} from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function paymentStatusVariant(
  status: string
): "success" | "warning" | "destructive" | "outline" {
  if (status === "paid") return "success";
  if (status === "pending" || status === "created") return "warning";
  if (status === "failed" || status === "cancelled") return "destructive";
  return "outline";
}

function TerminalsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { projectQuery, projectId } = useProjectFilter();
  const isAll = projectId == null;

  const initialTab =
    searchParams.get("tab") === "payments" ||
    searchParams.get("credential") ||
    searchParams.get("device")
      ? "payments"
      : "terminals";
  const [tab, setTab] = useState<"terminals" | "payments">(initialTab);

  // —— Terminals tab ——
  const [credSearch, setCredSearch] = useState("");
  const debouncedCredSearch = useDebounced(credSearch);
  const [credActive, setCredActive] = useState<"all" | "1" | "0">("all");
  const [credPage, setCredPage] = useState(1);
  const [credentials, setCredentials] = useState<KioskCredential[]>([]);
  const [credCount, setCredCount] = useState(0);
  const [credLoading, setCredLoading] = useState(true);

  // —— Payments tab ——
  const [paySearch, setPaySearch] = useState("");
  const debouncedPaySearch = useDebounced(paySearch);
  const [payStatus, setPayStatus] = useState("all");
  const [payDateRange, setPayDateRange] = useState<DateRangeValue>({});
  const [payCredential, setPayCredential] = useState(
    searchParams.get("credential") || ""
  );
  const [payDevice, setPayDevice] = useState(searchParams.get("device") || "");
  const [paySite, setPaySite] = useState("all");
  const [payPage, setPayPage] = useState(1);
  const [payments, setPayments] = useState<PaymentIntent[]>([]);
  const [payCount, setPayCount] = useState(0);
  const [payLoading, setPayLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);

  const syncUrl = useCallback(
    (next: {
      tab?: string;
      credential?: string;
      device?: string;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      const nextTab = next.tab ?? tab;
      if (nextTab === "payments") params.set("tab", "payments");
      else params.delete("tab");
      const cred = next.credential !== undefined ? next.credential : payCredential;
      const device = next.device !== undefined ? next.device : payDevice;
      if (cred) params.set("credential", cred);
      else params.delete("credential");
      if (device) params.set("device", device);
      else params.delete("device");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, tab, payCredential, payDevice]
  );

  const credQuery = useMemo(
    () => ({
      page: credPage,
      page_size: 25,
      search: debouncedCredSearch || undefined,
      is_active: credActive === "all" ? undefined : credActive,
      ...projectQuery,
    }),
    [credPage, debouncedCredSearch, credActive, projectQuery]
  );

  const payQuery = useMemo(() => {
    const q: Record<string, string | number | undefined> = {
      page: payPage,
      page_size: 25,
      search: debouncedPaySearch || undefined,
      status: payStatus === "all" ? undefined : payStatus,
      credential: payCredential || undefined,
      device: payDevice || undefined,
      site: paySite === "all" ? undefined : paySite,
      paid_at_after: payDateRange.from
        ? toStartOfDayIso(payDateRange.from)
        : undefined,
      paid_at_before: payDateRange.to
        ? toEndOfDayIso(payDateRange.to)
        : undefined,
      ...projectQuery,
    };
    return q;
  }, [
    payPage,
    debouncedPaySearch,
    payStatus,
    payCredential,
    payDevice,
    paySite,
    payDateRange,
    projectQuery,
  ]);

  useEffect(() => {
    setCredPage(1);
  }, [debouncedCredSearch, credActive, projectQuery]);

  useEffect(() => {
    setPayPage(1);
  }, [
    debouncedPaySearch,
    payStatus,
    payCredential,
    payDevice,
    paySite,
    payDateRange,
    projectQuery,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreds() {
      setCredLoading(true);
      try {
        const data = await api<Paginated<KioskCredential>>(
          "payments/kiosk-credentials/",
          { query: credQuery }
        );
        if (!cancelled) {
          setCredentials(data.results || []);
          setCredCount(data.count || 0);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof ApiError
              ? err.message
              : "Could not load terminals"
          );
        }
      } finally {
        if (!cancelled) setCredLoading(false);
      }
    }
    void loadCreds();
    return () => {
      cancelled = true;
    };
  }, [credQuery]);

  useEffect(() => {
    if (tab !== "payments") return;
    let cancelled = false;
    async function loadPayments() {
      setPayLoading(true);
      try {
        const data = await api<Paginated<PaymentIntent>>("payments/intents/", {
          query: payQuery,
        });
        if (!cancelled) {
          setPayments(data.results || []);
          setPayCount(data.count || 0);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof ApiError
              ? err.message
              : "Could not load terminal payments"
          );
        }
      } finally {
        if (!cancelled) setPayLoading(false);
      }
    }
    void loadPayments();
    return () => {
      cancelled = true;
    };
  }, [tab, payQuery]);

  useEffect(() => {
    let cancelled = false;
    async function loadSites() {
      try {
        const data = await api<Paginated<Site>>("sites/", {
          query: { page_size: 100, ...projectQuery },
        });
        if (!cancelled) setSites(data.results || []);
      } catch {
        /* ignore */
      }
    }
    void loadSites();
    return () => {
      cancelled = true;
    };
  }, [projectQuery]);

  function viewPaymentsFor(row: KioskCredential) {
    setPayCredential(String(row.id));
    setPayDevice("");
    setTab("payments");
    setPayPage(1);
    syncUrl({ tab: "payments", credential: String(row.id), device: "" });
  }

  function clearPaymentTerminalFilter() {
    setPayCredential("");
    setPayDevice("");
    syncUrl({ credential: "", device: "" });
  }

  const credTotalPages = Math.max(1, Math.ceil(credCount / 25));
  const payTotalPages = Math.max(1, Math.ceil(payCount / 25));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Terminals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review exit kiosk terminals and card payments
          {isAll ? " across your projects" : " for this project"}. Pairing and
          terminal setup stay in admin.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = v === "payments" ? "payments" : "terminals";
          setTab(next);
          syncUrl({ tab: next });
        }}
      >
        <TabsList>
          <TabsTrigger value="terminals">Terminals</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="terminals" className="space-y-4">
          <div className="flex flex-col gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={credSearch}
                onChange={(e) => setCredSearch(e.target.value)}
                placeholder="Search label, Tid, device…"
                className="h-10 rounded-xl border-0 bg-muted/50 pl-9 shadow-none focus-visible:ring-1"
              />
            </div>
            <select
              className="flex h-10 rounded-xl border-0 bg-muted/50 px-3 text-sm shadow-none"
              value={credActive}
              onChange={(e) =>
                setCredActive(e.target.value as "all" | "1" | "0")
              }
            >
              <option value="all">All statuses</option>
              <option value="1">Active only</option>
              <option value="0">Inactive only</option>
            </select>
          </div>

          {credLoading && credentials.length === 0 ? (
            <Loader label="Loading terminals…" />
          ) : credentials.length === 0 ? (
            <EmptyState
              icon={SmartphoneNfc}
              title="No terminals yet"
              description="Provision kiosk credentials in admin, then they appear here."
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card/80 shadow-sm">
              {credentials.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold tracking-tight">
                        {row.label?.trim() || row.device_name}
                      </p>
                      <Badge variant={row.is_active ? "success" : "outline"}>
                        {row.is_active ? "Active" : "Inactive"}
                      </Badge>
                      {isAll ? (
                        <Badge variant="outline" className="font-normal">
                          {row.project_name}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.site_name} · {row.device_name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      Tid {row.nearpay_terminal_id || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                    <p className="text-[11px] text-muted-foreground">
                      Last used{" "}
                      {row.last_used_at
                        ? formatDateTime(row.last_used_at)
                        : "never"}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewPaymentsFor(row)}
                    >
                      View payments
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {credCount > 25 ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                Showing {(credPage - 1) * 25 + 1}–
                {Math.min(credPage * 25, credCount)} of {credCount}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={credPage <= 1}
                  onClick={() => setCredPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={credPage >= credTotalPages}
                  onClick={() => setCredPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Terminal payments
              </h2>
              <p className="text-sm text-muted-foreground">
                Card bills from exit kiosks
                {payCredential
                  ? " · filtered to one terminal"
                  : payDevice
                    ? " · filtered to one device"
                    : ""}
                .
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full shrink-0 sm:w-auto"
              disabled={exporting}
              onClick={() => {
                void (async () => {
                  setExporting(true);
                  try {
                    const { page: _p, page_size: _ps, ...exportQuery } =
                      payQuery;
                    await apiDownload("payments/intents/export/", {
                      query: exportQuery,
                      filename: "terminal-payments.csv",
                    });
                    toast.success("Payments exported");
                  } catch (err) {
                    toast.error(
                      err instanceof ApiError ? err.message : "Export failed"
                    );
                  } finally {
                    setExporting(false);
                  }
                })();
              }}
            >
              <Download className="size-4" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm">
            <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={paySearch}
                  onChange={(e) => setPaySearch(e.target.value)}
                  placeholder="Plate, reference, txn id…"
                  className="h-10 rounded-xl border-0 bg-muted/50 pl-9 shadow-none focus-visible:ring-1"
                />
              </div>
              <DateRangeFilter
                value={payDateRange}
                onChange={setPayDateRange}
                placeholder="Paid dates"
              />
              <select
                className="flex h-10 rounded-xl border-0 bg-muted/50 px-3 text-sm shadow-none"
                value={payStatus}
                onChange={(e) => setPayStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="created">Created</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                className="flex h-10 rounded-xl border-0 bg-muted/50 px-3 text-sm shadow-none"
                value={paySite}
                onChange={(e) => setPaySite(e.target.value)}
              >
                <option value="all">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
              {payCredential || payDevice ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearPaymentTerminalFilter}
                >
                  Clear terminal filter
                </Button>
              ) : null}
            </div>
          </div>

          {payLoading && payments.length === 0 ? (
            <Loader label="Loading payments…" />
          ) : payments.length === 0 ? (
            <EmptyState
              icon={SmartphoneNfc}
              title="No payments found"
              description="Try widening the date range or clearing filters."
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card/80 shadow-sm">
              {payments.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-semibold tracking-wide">
                        {row.plate}
                      </span>
                      <Badge variant={paymentStatusVariant(row.status)}>
                        {row.status}
                      </Badge>
                      {isAll && row.project_name ? (
                        <Badge variant="outline" className="font-normal">
                          {row.project_name}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.site_name}
                      {row.device_name ? ` · ${row.device_name}` : ""}
                      {row.kiosk_label || row.nearpay_terminal_id
                        ? ` · ${
                            row.kiosk_label ||
                            `Tid ${row.nearpay_terminal_id}`
                          }`
                        : ""}
                    </p>
                    {row.provider_transaction_id ? (
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {row.provider || "txn"} {row.provider_transaction_id}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-base font-semibold tabular-nums">
                      {formatMoney(row.amount, row.currency)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(row.paid_at || row.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {payCount > 25 ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                Showing {(payPage - 1) * 25 + 1}–
                {Math.min(payPage * 25, payCount)} of {payCount}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={payPage <= 1}
                  onClick={() => setPayPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={payPage >= payTotalPages}
                  onClick={() => setPayPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function TerminalsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className={cn("size-6 animate-spin text-muted-foreground")} />
        </div>
      }
    >
      <TerminalsPageInner />
    </Suspense>
  );
}
