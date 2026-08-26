"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayButtonProps } from "react-day-picker";

import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex flex-col gap-4 sm:flex-row sm:gap-6",
        month: "flex w-[252px] flex-col gap-3",
        month_caption: "relative flex h-8 items-center justify-center",
        caption_label: "text-sm font-semibold",
        nav: "absolute inset-x-0 top-0 z-10 flex items-center justify-between px-1",
        button_previous: cn(
          "inline-flex size-8 items-center justify-center rounded-lg border border-input bg-background text-foreground",
          "hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        ),
        button_next: cn(
          "inline-flex size-8 items-center justify-center rounded-lg border border-input bg-background text-foreground",
          "hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 text-center text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative p-0 text-center",
        day_button: cn(
          "inline-flex size-9 items-center justify-center rounded-lg text-sm font-normal transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        ),
        range_start: "rounded-l-lg bg-accent",
        range_middle: "rounded-none bg-accent/60",
        range_end: "rounded-r-lg bg-accent",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        today: "[&>button]:bg-accent [&>button]:font-semibold [&>button]:text-accent-foreground",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-35",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", chevronClass)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn("size-4", chevronClass)} {...chevronProps} />
          ),
        DayButton: CalendarDayButton,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: DayButtonProps) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
          ? ""
          : undefined
      }
      data-range-start={modifiers.range_start ? "" : undefined}
      data-range-end={modifiers.range_end ? "" : undefined}
      data-range-middle={modifiers.range_middle ? "" : undefined}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg text-sm font-normal transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        modifiers.selected &&
          !modifiers.range_start &&
          !modifiers.range_end &&
          !modifiers.range_middle &&
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        modifiers.range_start &&
          "rounded-lg bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        modifiers.range_end &&
          "rounded-lg bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        modifiers.range_middle &&
          "rounded-none bg-transparent text-foreground hover:bg-transparent",
        modifiers.today &&
          !modifiers.selected &&
          !modifiers.range_start &&
          !modifiers.range_end &&
          "bg-accent font-semibold text-accent-foreground",
        modifiers.outside && "opacity-45",
        modifiers.disabled && "pointer-events-none opacity-35",
        className
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
