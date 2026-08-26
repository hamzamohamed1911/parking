"use client";

import { Car, ChevronDown } from "lucide-react";

export type AttentionBannerProps = {
  needsAttentionCount: number;
  onScrollToGates: () => void;
};

export function AttentionBanner(props: AttentionBannerProps) {
  const { needsAttentionCount, onScrollToGates } = props;
  if (needsAttentionCount <= 0) return null;

  return (
    <button
      type="button"
      onClick={onScrollToGates}
      className="flex w-full items-center gap-3 rounded-2xl border border-warning/40 bg-warning-muted px-4 py-3 text-left shadow-sm transition-colors hover:bg-warning-muted/70 sm:px-5"
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/20">
        <Car className="size-4.5 text-warning-muted-foreground" />
        <span className="absolute inset-0 animate-ping rounded-full bg-warning/30" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {needsAttentionCount}{" "}
          {needsAttentionCount === 1 ? "car needs" : "cars need"} a decision
        </span>
        <span className="block text-xs text-muted-foreground">
          Approve or deny them at the gates below.
        </span>
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
