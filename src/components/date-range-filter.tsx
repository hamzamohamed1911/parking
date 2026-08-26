"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateRangeValue = {
  from?: Date;
  to?: Date;
};

type DateRangeFilterProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
};

export function toStartOfDayIso(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function toEndOfDayIso(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function DateRangeFilter({
  value,
  onChange,
  placeholder = "From — To",
  className,
  align = "start",
}: DateRangeFilterProps) {
  const [open, setOpen] = React.useState(false);
  const selected: DateRange | undefined =
    value.from || value.to
      ? { from: value.from, to: value.to }
      : undefined;

  const label = React.useMemo(() => {
    if (value.from && value.to) {
      return `${format(value.from, "MMM d, yyyy")} – ${format(value.to, "MMM d, yyyy")}`;
    }
    if (value.from) {
      return `${format(value.from, "MMM d, yyyy")} – …`;
    }
    return placeholder;
  }, [placeholder, value.from, value.to]);

  const hasValue = Boolean(value.from || value.to);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-10 min-w-[220px] justify-start rounded-xl border-input bg-background px-3 font-normal shadow-none",
              !hasValue && "text-muted-foreground"
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-primary" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          sideOffset={8}
          className="w-auto max-w-[calc(100vw-1.5rem)] overflow-hidden border-border/70 bg-card p-0 shadow-xl"
        >
          <div className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-transparent to-[var(--brand-lavender)]/10 px-4 py-3">
            <p className="text-sm font-semibold tracking-tight">Date range</p>
            <p className="text-xs text-muted-foreground">
              Select a start day, then an end day.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={value.from ?? value.to}
              selected={selected}
              onSelect={(range) => {
                onChange({
                  from: range?.from,
                  to: range?.to,
                });
              }}
              disabled={{ after: new Date() }}
              className="mx-auto"
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                onChange({});
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-lg"
              disabled={!value.from}
              onClick={() => setOpen(false)}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {hasValue ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-xl text-muted-foreground"
          aria-label="Clear date range"
          onClick={() => onChange({})}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
