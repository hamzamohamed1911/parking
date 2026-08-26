"use client";

import { FormEvent, RefObject } from "react";
import { Banknote, Loader2, Search, X } from "lucide-react";

import { gateLabel } from "@/components/gate-board";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Device, Site } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  ALL_GATES,
  type CashierMe,
  type CashierZone,
  type ZoneTariff,
} from "@/utils/cash/types";

export type CashHeaderSectionProps = {
  me: CashierMe | null;
  projectName: string | null;
  pickedZoneId: string;
  onZoneChange: (value: string) => void;
  pickedSiteId: string;
  onSiteChange: (value: string) => void;
  sites: Site[];
  catalogLoading: boolean;
  zonesCatalog: { id: number; name: string }[];
  pickedGateId: string;
  onGateChange: (value: string) => void;
  exitDevices: Device[];
  gatesLoading: boolean;
  activeZoneIds: number[];
  tariff: ZoneTariff | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: (e?: FormEvent) => void;
  searching: boolean;
  clearSearch: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
};

export function CashHeaderSection(props: CashHeaderSectionProps) {
  const {
    me,
    projectName,
    pickedZoneId,
    onZoneChange,
    pickedSiteId,
    onSiteChange,
    sites,
    catalogLoading,
    zonesCatalog,
    pickedGateId,
    onGateChange,
    exitDevices,
    gatesLoading,
    activeZoneIds,
    tariff,
    query,
    onQueryChange,
    onSearch,
    searching,
    clearSearch,
    searchInputRef,
  } = props;
  return (
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
              Take cash before a car reaches the gate and it can exit within the
              grace window. Waiting exits open the gate immediately. Type a plate
              to narrow the list — it falls back to every on-site stay when
              nothing here owes money.
            </p>
          </div>
          {me?.has_assignment && me.zones.length === 1 ? (
            <Badge variant="outline" className="font-normal">
              {me.zones[0].site_name} · {me.zones[0].name}
            </Badge>
          ) : null}
        </div>

        {me?.has_assignment && me.zones.length > 1 ? (
          <AssignedZonePicker
            zones={me.zones}
            pickedZoneId={pickedZoneId}
            onZoneChange={onZoneChange}
          />
        ) : null}

        {me?.can_pick_zone ? (
          <ProjectWorkspacePicker
            projectName={projectName}
            pickedSiteId={pickedSiteId}
            onSiteChange={onSiteChange}
            sites={sites}
            catalogLoading={catalogLoading}
            pickedZoneId={pickedZoneId}
            onZoneChange={onZoneChange}
            zonesCatalog={zonesCatalog}
          />
        ) : null}

        {activeZoneIds.length > 0 ? (
          <GatePicker
            pickedGateId={pickedGateId}
            onGateChange={onGateChange}
            exitDevices={exitDevices}
            gatesLoading={gatesLoading}
          />
        ) : null}

        {tariff ? <ZoneTariffBar tariff={tariff} /> : null}

        <form onSubmit={onSearch} className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value.toUpperCase())}
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
  );
}

function AssignedZonePicker({
  zones,
  pickedZoneId,
  onZoneChange,
}: {
  zones: CashierZone[];
  pickedZoneId: string;
  onZoneChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5 sm:max-w-sm">
      <label className="text-xs font-medium text-muted-foreground">
        Desk zone
      </label>
      <Select value={pickedZoneId || undefined} onValueChange={onZoneChange}>
        <SelectTrigger className="h-11 rounded-xl bg-background/90">
          <SelectValue placeholder="Select zone" />
        </SelectTrigger>
        <SelectContent>
          {zones.map((zone) => (
            <SelectItem key={zone.id} value={String(zone.id)}>
              {zone.site_name} · {zone.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProjectWorkspacePicker({
  projectName,
  pickedSiteId,
  onSiteChange,
  sites,
  catalogLoading,
  pickedZoneId,
  onZoneChange,
  zonesCatalog,
}: {
  projectName: string | null;
  pickedSiteId: string;
  onSiteChange: (value: string) => void;
  sites: Site[];
  catalogLoading: boolean;
  pickedZoneId: string;
  onZoneChange: (value: string) => void;
  zonesCatalog: { id: number; name: string }[];
}) {
  return (
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
            onValueChange={onSiteChange}
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
            onValueChange={onZoneChange}
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
  );
}

function GatePicker({
  pickedGateId,
  onGateChange,
  exitDevices,
  gatesLoading,
}: {
  pickedGateId: string;
  onGateChange: (value: string) => void;
  exitDevices: Device[];
  gatesLoading: boolean;
}) {
  return (
    <div className="space-y-1.5 sm:max-w-sm">
      <label className="text-xs font-medium text-muted-foreground">Gate</label>
      <Select
        value={pickedGateId}
        onValueChange={onGateChange}
        disabled={gatesLoading || exitDevices.length === 0}
      >
        <SelectTrigger className="h-11 rounded-xl bg-background/90">
          <SelectValue
            placeholder={
              gatesLoading
                ? "Loading gates…"
                : exitDevices.length === 0
                  ? "No exit gates in this zone"
                  : "Select All"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_GATES}>Select All</SelectItem>
          {exitDevices.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Exit Gates</SelectLabel>
              {exitDevices.map((device) => (
                <SelectItem key={device.id} value={String(device.id)}>
                  {gateLabel(device)}
                  {device.zone_name ? ` · ${device.zone_name}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}

function ZoneTariffBar({ tariff }: { tariff: ZoneTariff }) {
  return (
    <dl className="flex flex-wrap items-stretch gap-2">
      <div className="min-w-30 flex-1 rounded-xl border bg-background/70 px-3 py-2">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Zone
        </dt>
        <dd className="truncate text-sm font-semibold">{tariff.zone_name}</dd>
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
  );
}
