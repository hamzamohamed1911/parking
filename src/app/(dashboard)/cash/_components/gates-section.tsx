"use client";

import { RefObject } from "react";
import { Bell, BellOff, Loader2, Radio } from "lucide-react";

import { GateColumn, gateLabel } from "@/components/gate-board";
import { Loader } from "@/components/loaders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StreamStatus } from "@/lib/access-request-stream";
import type { AccessRequest, Device } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { ZoneWithDevices } from "@/utils/cash/types";

export type GatesSectionProps = {
  sectionRef: RefObject<HTMLElement | null>;
  waitingCount: number;
  streamStatus: StreamStatus;
  pickedDeviceId: number | null;
  visibleDevices: Device[];
  alertsOn: boolean;
  onToggleAlerts: () => void;
  onRefreshGates: () => void;
  gatesLoading: boolean;
  hubReady: boolean;
  devices: Device[];
  zonesWithDevices: ZoneWithDevices[];
  pendingByDevice: Record<number, AccessRequest>;
  freshDeviceIds: Set<number>;
  canDecide: boolean;
  onApprove: (row: AccessRequest) => void;
  onDeny: (row: AccessRequest) => void;
  onManual: (device: Device) => void;
  onValidatePayment: (row: AccessRequest) => void;
  onUnmatch: (row: AccessRequest) => void;
  onChargeAtKiosk: (row: AccessRequest) => void;
  onCancelBill: (row: AccessRequest) => void;
  onSendBill: (row: AccessRequest) => void;
  onRefreshBill: (row: AccessRequest) => void;
  paymentActionId: number | null;
  arBusyId: number | null;
};

export function GatesSection(props: GatesSectionProps) {
  const {
    sectionRef,
    waitingCount,
    streamStatus,
    pickedDeviceId,
    visibleDevices,
    alertsOn,
    onToggleAlerts,
    onRefreshGates,
    gatesLoading,
    hubReady,
    devices,
    zonesWithDevices,
    pendingByDevice,
    freshDeviceIds,
    canDecide,
    onApprove,
    onDeny,
    onManual,
    onValidatePayment,
    onUnmatch,
    onChargeAtKiosk,
    onCancelBill,
    onSendBill,
    onRefreshBill,
    paymentActionId,
    arBusyId,
  } = props;
  return (
    <section ref={sectionRef} className="scroll-mt-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Zone gates</h2>
            {waitingCount > 0 ? (
              <Badge variant="warning" className="tabular-nums">
                {waitingCount} waiting
              </Badge>
            ) : null}
            <StreamStatusBadge status={streamStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {pickedDeviceId != null
              ? `Live queue for ${
                  visibleDevices[0]
                    ? gateLabel(visibleDevices[0])
                    : "the selected exit gate"
                }`
              : "Live exit gates in the selected zone"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleAlerts}
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
            onClick={onRefreshGates}
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
      ) : gatesLoading && devices.length === 0 ? (
        <Loader compact label="Loading gates…" />
      ) : (
        <div className="space-y-4">
          {zonesWithDevices.map(({ zone, exits, waiting }) => (
            <div
              key={zone.id}
              className="overflow-hidden rounded-2xl border bg-card/40 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="font-semibold tracking-tight">
                    {zone.site_name} · {zone.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {zone.project_name ? `${zone.project_name} · ` : ""}
                    {exits.length} exit gate
                    {exits.length === 1 ? "" : "s"}
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
              {exits.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
                  No exit gates in this zone.
                </p>
              ) : (
                <div className="grid gap-4 p-4">
                  <GateColumn
                    title="Exit gates"
                    hint="Cars waiting to leave"
                    tone="exit"
                    devices={exits}
                    pendingByDevice={pendingByDevice}
                    freshDeviceIds={freshDeviceIds}
                    canDecide={canDecide}
                    onApprove={onApprove}
                    onDeny={onDeny}
                    onManual={canDecide ? onManual : undefined}
                    onValidatePayment={onValidatePayment}
                    onUnmatch={onUnmatch}
                    onChargeAtKiosk={onChargeAtKiosk}
                    onCancelBill={onCancelBill}
                    onSendBill={onSendBill}
                    onRefreshBill={onRefreshBill}
                    paymentActionId={paymentActionId}
                    unmatchBusy={arBusyId != null}
                    validateBusy={arBusyId != null}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StreamStatusBadge({ status }: { status: StreamStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
        status === "live" && "bg-success-muted text-success-muted-foreground",
        status === "offline" && "bg-destructive/15 text-destructive",
        (status === "connecting" || status === "idle") &&
          "bg-muted text-muted-foreground",
      )}
    >
      <Radio className="size-3" />
      {status === "live"
        ? "Live"
        : status === "connecting"
          ? "Connecting…"
          : status === "offline"
            ? "Reconnecting…"
            : "Idle"}
    </span>
  );
}
