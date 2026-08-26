import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?:
    | "default"
    | "secondary"
    | "outline"
    | "success"
    | "warning"
    | "destructive"
    | "exempt";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variant === "default" && "border-transparent bg-primary text-primary-foreground",
        variant === "secondary" && "border-transparent bg-secondary text-secondary-foreground",
        variant === "outline" && "text-foreground",
        variant === "success" &&
          "border-transparent bg-success-muted text-success-muted-foreground",
        variant === "warning" &&
          "border-transparent bg-warning-muted text-warning-muted-foreground",
        variant === "destructive" &&
          "border-transparent bg-destructive/15 text-destructive dark:bg-destructive/25",
        variant === "exempt" &&
          "border-sky-500/30 bg-sky-500/15 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/15 dark:text-sky-200",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
