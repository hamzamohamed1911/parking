"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { OpsDashboard, OpsProjectRow, OpsTrendDay } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

const CHART_COLORS = {
  primary: "var(--chart-1)",
  success: "var(--chart-success)",
  danger: "var(--chart-danger)",
  secondary: "var(--chart-neutral)",
  info: "var(--chart-info)",
  revenue: "var(--chart-revenue)",
};

/** Axis/grid styling shared by every chart so dark mode stays readable. */
const axisTick = { fontSize: 11, fill: "var(--chart-axis)" } as const;
const gridStroke = "var(--chart-grid)";

type DashboardChartsProps = {
  stats: OpsDashboard["stats"];
  projects: OpsProjectRow[];
  trend: OpsTrendDay[];
  isAll: boolean;
};

export function DashboardCharts({
  stats,
  projects,
  trend,
  isAll,
}: DashboardChartsProps) {
  const currency = stats.revenue_currency || "SAR";
  const paymentRows = [
    {
      name: "Paid",
      value: stats.payment_paid_today,
      color: CHART_COLORS.success,
    },
    {
      name: "Unpaid closed",
      value: stats.sessions_unpaid_closed,
      color: CHART_COLORS.danger,
    },
    {
      name: "Guest",
      value: stats.payment_guest_today,
      color: CHART_COLORS.secondary,
    },
    {
      name: "Operator waived",
      value: stats.payment_operator_waived_today,
      color: CHART_COLORS.info,
    },
  ];
  const paymentChartData = paymentRows.filter((d) => d.value > 0);
  const paymentTotal = paymentRows.reduce((sum, d) => sum + d.value, 0);
  const paidShare =
    paymentTotal > 0
      ? Math.round((stats.payment_paid_today / paymentTotal) * 100)
      : null;

  const eventData = [
    {
      name: "Granted",
      value: stats.events_granted_today,
      fill: CHART_COLORS.success,
    },
    {
      name: "Denied",
      value: stats.events_denied_today,
      fill: CHART_COLORS.danger,
    },
  ];

  const projectBars = projects.slice(0, 8).map((p) => ({
    name: p.name.length > 14 ? `${p.name.slice(0, 12)}…` : p.name,
    sessions: p.sessions_today,
    revenue: Number(p.revenue_today) || 0,
  }));

  const hasTrend = trend.some(
    (d) => d.sessions > 0 || d.revenue > 0 || d.events > 0
  );
  const revenue7d = trend.reduce((sum, d) => sum + (Number(d.revenue) || 0), 0);
  const showProjectRevenue = isAll && projectBars.some((p) => p.revenue > 0);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <FinanceStat
            label="Revenue today"
            value={formatMoney(stats.revenue_today, currency)}
            hint={`${stats.payment_paid_today} paid stay${stats.payment_paid_today === 1 ? "" : "s"}`}
          />
          <FinanceStat
            label="Revenue · 7 days"
            value={formatMoney(revenue7d, currency)}
            hint={`${stats.sessions_today} session${stats.sessions_today === 1 ? "" : "s"} today`}
          />
          <FinanceStat
            label="Payment mix today"
            value={paidShare == null ? "—" : `${paidShare}% paid`}
            hint={
              paymentTotal === 0
                ? "No settled stays yet"
                : `${stats.payment_paid_today} paid · ${stats.sessions_unpaid_closed} unpaid · ${stats.payment_guest_today} guest · ${stats.payment_operator_waived_today} operator waived`
            }
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold tracking-tight">Activity · 7 days</h2>
            <p className="text-sm text-muted-foreground">
              Sessions and revenue, shown separately for clarity
            </p>
          </div>
          {hasTrend ? (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Sessions
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full bg-primary" />
                    Count
                  </span>
                </div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={trend}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={gridStroke}
                      />
                      <XAxis
                        dataKey="label"
                        tick={axisTick}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={axisTick}
                        allowDecimals={false}
                        width={28}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--chart-cursor)" }}
                        content={<TrendTooltip currency={currency} mode="sessions" />}
                      />
                      <Bar
                        dataKey="sessions"
                        name="Sessions"
                        fill={CHART_COLORS.primary}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="border-t border-border/70 pt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Revenue
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: CHART_COLORS.revenue }}
                    />
                    {currency}
                  </span>
                </div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={trend}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={CHART_COLORS.revenue}
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="100%"
                            stopColor={CHART_COLORS.revenue}
                            stopOpacity={0.04}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={gridStroke}
                      />
                      <XAxis
                        dataKey="label"
                        tick={axisTick}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={axisTick}
                        width={36}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) =>
                          Number(v) >= 1000 ? `${Math.round(Number(v) / 100) / 10}k` : String(v)
                        }
                      />
                      <Tooltip
                        cursor={{ stroke: CHART_COLORS.revenue, strokeWidth: 1, strokeDasharray: "4 4" }}
                        content={<TrendTooltip currency={currency} mode="revenue" />}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke={CHART_COLORS.revenue}
                        fill="url(#revenueFill)"
                        strokeWidth={2.5}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-64">
              <EmptyChart message="No session or revenue activity in the last 7 days." />
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold tracking-tight">Payments today</h2>
            <p className="text-sm text-muted-foreground">
              Outcome of completed stays
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <div className="relative mx-auto h-44 w-full max-w-[220px]">
              {paymentChartData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentChartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={56}
                        outerRadius={78}
                        paddingAngle={3}
                      >
                        {paymentChartData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={entry.color}
                            stroke="var(--card)"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipProps} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatMoney(stats.revenue_today, currency).replace(
                        ` ${currency}`,
                        ""
                      )}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {currency} paid
                    </p>
                  </div>
                </>
              ) : (
                <EmptyChart message="No payments settled today." />
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {paymentRows.map((d) => (
                <div
                  key={d.name}
                  className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2 text-center"
                >
                  <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: d.color }}
                    />
                    {d.name}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {d.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold tracking-tight">Gate decisions today</h2>
            <p className="text-sm text-muted-foreground">
              {stats.events_today} ANPR events
            </p>
          </div>
          <div className="h-52">
            {stats.events_today > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={eventData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={gridStroke}
                  />
                  <XAxis
                    dataKey="name"
                    tick={axisTick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={axisTick}
                    allowDecimals={false}
                    width={32}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tooltipProps}
                    cursor={{ fill: "var(--chart-cursor)" }}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {eventData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No camera decisions yet today." />
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold tracking-tight">
              {showProjectRevenue ? "Revenue by project" : isAll ? "Sessions by project" : "Site pressure"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {showProjectRevenue
                ? "Paid revenue today (top 8)."
                : isAll
                  ? "Sessions started today (top 8)."
                  : "Open vs today’s sessions."}
            </p>
          </div>
          <div className="h-52">
            {(isAll ? projectBars.length > 0 : true) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={
                    isAll
                      ? projectBars
                      : [
                          { name: "Open", sessions: stats.sessions_open, revenue: 0 },
                          {
                            name: "Today",
                            sessions: stats.sessions_today,
                            revenue: Number(stats.revenue_today) || 0,
                          },
                        ]
                  }
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={gridStroke}
                  />
                  <XAxis
                    dataKey="name"
                    tick={axisTick}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={axisTick}
                    allowDecimals={false}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tooltipProps}
                    cursor={{ fill: "var(--chart-cursor)" }}
                    formatter={(value: number, name: string) =>
                      name === "revenue"
                        ? [formatMoney(String(value), currency), "Revenue"]
                        : [value, "Sessions"]
                    }
                  />
                  <Bar
                    dataKey={showProjectRevenue ? "revenue" : "sessions"}
                    fill={
                      showProjectRevenue ? CHART_COLORS.revenue : CHART_COLORS.primary
                    }
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No project activity to chart." />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  boxShadow: "0 8px 24px rgba(15, 14, 20, 0.28)",
};

/**
 * Recharts defaults tooltip label/item text to near-black, which disappears on
 * the dark card — pin every layer to theme tokens.
 */
const tooltipProps = {
  contentStyle: tooltipStyle,
  labelStyle: { color: "var(--muted-foreground)", fontSize: 12 },
  itemStyle: { color: "var(--popover-foreground)" },
} as const;

function TrendTooltip({
  active,
  payload,
  label,
  currency,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string;
  currency: string;
  mode: "sessions" | "revenue";
}) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.value;
  const value = typeof raw === "number" ? raw : Number(raw) || 0;

  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-popover-foreground">
        {mode === "revenue"
          ? formatMoney(value, currency)
          : `${value} session${value === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

function FinanceStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
