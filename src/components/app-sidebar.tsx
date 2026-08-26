"use client";

import { Suspense } from "react";
import {
  Building2,
  Banknote,
  CarFront,
  ClipboardCheck,
  DoorOpen,
  History,
  LayoutDashboard,
  Loader2,
  SmartphoneNfc,
  Wallet,
} from "lucide-react";

import { NavMain, type NavItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import { useAuth } from "@/components/providers/auth-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

function SidebarNav() {
  const { canAccessDashboard, canAccessGateControl, canAccessCash } =
    useAuth();

  const operations: NavItem[] = canAccessDashboard
    ? [
        {
          title: "Dashboard",
          url: "/dashboard",
          icon: LayoutDashboard,
          matchPaths: ["/dashboard", "/operations", "/control-room", "/projects"],
        },
        {
          title: "Sessions",
          url: "/sessions",
          icon: History,
          matchPaths: ["/sessions"],
        },
        {
          title: "Decisions",
          url: "/decisions",
          icon: ClipboardCheck,
          matchPaths: ["/decisions"],
        },
        {
          title: "Sites",
          url: "/sites",
          icon: Building2,
          matchPaths: ["/sites"],
        },
        {
          title: "Terminals",
          url: "/terminals",
          icon: SmartphoneNfc,
          matchPaths: ["/terminals"],
        },
        {
          title: "Vehicles",
          url: "/vehicles",
          icon: CarFront,
          matchPaths: ["/vehicles"],
        },
        {
          title: "Wallets",
          url: "/wallets",
          icon: Wallet,
          matchPaths: ["/wallets", "/clients", "/transactions"],
        },
      ]
    : [];

  const control: NavItem[] = [];
  if (canAccessGateControl) {
    control.push({
      title: "Gates",
      url: "/gate-control",
      icon: DoorOpen,
      matchPaths: ["/gate-control"],
    });
  }
  if (canAccessCash) {
    control.push({
      title: "Cash",
      url: "/cash",
      icon: Banknote,
      matchPaths: ["/cash"],
    });
  }

  return (
    <>
      {operations.length > 0 ? (
        <NavMain items={operations} label="Operations" />
      ) : null}
      {operations.length > 0 && control.length > 0 ? (
        <SidebarSeparator className="mx-4 my-1" />
      ) : null}
      {control.length > 0 ? <NavMain items={control} label="Control" /> : null}
    </>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="px-2 pt-3">
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <Suspense
          fallback={
            <div className="flex items-center justify-center px-4 py-8">
              <Loader2 className="size-5 animate-spin text-sidebar-foreground/50" />
            </div>
          }
        >
          <SidebarNav />
        </Suspense>
      </SidebarContent>
      <SidebarFooter className="pb-3">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
