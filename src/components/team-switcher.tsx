"use client";

import { Check, ChevronsUpDown } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { useAuth } from "@/components/providers/auth-provider";
import { useProjectFilter } from "@/components/providers/project-filter-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function TeamSwitcher() {
  const { isMobile, state } = useSidebar();
  const { user } = useAuth();
  const {
    projectId,
    label,
    projects,
    canSelectAll,
    setProjectId,
  } = useProjectFilter();
  const fixedCashierScope = Boolean(user?.has_cashier_assignment);

  if (fixedCashierScope) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="h-12 cursor-default px-2.5 hover:bg-transparent"
          >
            <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-[#0b0b0d]">
              <BrandLogo variant="mark" priority={true} />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-bold tracking-[0.08em] text-white">
                ET Parking
              </span>
              <span className="truncate text-[10px] uppercase tracking-[0.14em] text-white/45">
                Assigned cashier zones
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-12 px-2.5 hover:bg-white/[0.06] data-[state=open]:bg-white/[0.06]"
            >
              <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-[#0b0b0d]">
                <BrandLogo variant="mark" priority={true} />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold tracking-[0.08em] text-white">
                  ET Parking
                </span>
                <span className="truncate text-[10px] uppercase tracking-[0.14em] text-white/45">
                  {label}
                </span>
              </div>
              {state === "expanded" || isMobile ? (
                <ChevronsUpDown className="ml-auto size-4 text-white/40 group-data-[collapsible=icon]:hidden" />
              ) : null}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Filter by project
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canSelectAll ? (
              <DropdownMenuItem
                onClick={() => setProjectId(null)}
                className="gap-2"
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    projectId === null ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">All projects</span>
              </DropdownMenuItem>
            ) : null}
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => setProjectId(project.id)}
                className="gap-2"
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    projectId === project.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
            {projects.length === 0 ? (
              <DropdownMenuItem disabled>No projects available</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
