"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value ?? internal;

  function setValue(next: string) {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  }

  return (
    <TabsContext.Provider value={{ value: current, setValue }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-11 w-full items-center gap-1 rounded-xl border bg-muted/60 p-1 text-muted-foreground sm:w-auto",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  value,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const { value: current, setValue } = useTabs();
  const active = current === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all sm:flex-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card text-foreground shadow-sm"
          : "hover:bg-background/60 hover:text-foreground",
        className
      )}
      onClick={() => setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
}

function TabsContent({
  value,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const { value: current } = useTabs();
  if (current !== value) return null;

  return (
    <div
      role="tabpanel"
      data-state="active"
      className={cn("mt-6 animate-fade-up", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
