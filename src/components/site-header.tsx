"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import type { Project, Site, Wallet } from "@/lib/types";

const SECTION_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  operations: "Dashboard",
  "control-room": "Dashboard",
  projects: "Dashboard",
  sessions: "Sessions",
  decisions: "Decisions",
  sites: "Sites",
  vehicles: "Vehicles",
  wallets: "Wallets",
  clients: "Wallets",
  transactions: "Wallets",
  "gate-control": "Gate control",
  cash: "Cash",
};

function HeaderBreadcrumbs() {
  const pathname = usePathname();
  const params = useParams<{ id?: string; siteId?: string; plate?: string }>();
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[0] || "dashboard";

  const isVehicleDetail = section === "vehicles" && Boolean(params.plate);
  const vehiclePlate = params.plate
    ? decodeURIComponent(params.plate).toUpperCase()
    : null;

  const pageTitle = isVehicleDetail
    ? vehiclePlate || "Vehicle"
    : SECTION_TITLES[section] || "Dashboard";

  const isWalletDetail =
    (section === "wallets" || section === "clients") && Boolean(params.id);
  const isProjectDetail =
    section === "projects" && Boolean(params.id) && !params.siteId;
  const isSiteDetail =
    section === "projects" && Boolean(params.id) && Boolean(params.siteId);
  const isSessionDetail = section === "sessions" && Boolean(params.id);

  const [projectName, setProjectName] = useState<string | null>(null);
  const [detailName, setDetailName] = useState<string | null>(null);

  useEffect(() => {
    if (
      !params.id ||
      (!isWalletDetail && !isProjectDetail && !isSiteDetail && !isSessionDetail)
    ) {
      setDetailName(null);
      setProjectName(null);
      return;
    }
    let cancelled = false;

    if (isWalletDetail) {
      void api<Wallet>(`wallets/${params.id}/`)
        .then((w) => {
          if (!cancelled) {
            setDetailName(w.name);
            setProjectName(w.project_name || `Project #${w.project}`);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDetailName(`Wallet #${params.id}`);
            setProjectName(null);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (isSessionDetail) {
      void api<{ plate: string }>(`sessions/${params.id}/`)
        .then((s) => {
          if (!cancelled) setDetailName(s.plate);
        })
        .catch(() => {
          if (!cancelled) setDetailName(`Session #${params.id}`);
        });
      return () => {
        cancelled = true;
      };
    }

    void api<Project>(`projects/${params.id}/`)
      .then((p) => {
        if (!cancelled) setProjectName(p.name);
      })
      .catch(() => {
        if (!cancelled) setProjectName(`Project #${params.id}`);
      });

    if (isSiteDetail && params.siteId) {
      void api<Site>(`sites/${params.siteId}/`)
        .then((s) => {
          if (!cancelled) setDetailName(s.name);
        })
        .catch(() => {
          if (!cancelled) setDetailName(`Site #${params.siteId}`);
        });
    } else if (isProjectDetail) {
      void api<Project>(`projects/${params.id}/`)
        .then((p) => {
          if (!cancelled) setDetailName(p.name);
        })
        .catch(() => {
          if (!cancelled) setDetailName(`Project #${params.id}`);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    isWalletDetail,
    isProjectDetail,
    isSiteDetail,
    isSessionDetail,
    params.id,
    params.siteId,
  ]);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <BreadcrumbLink asChild>
            <Link
              href="/dashboard"
              className="font-medium text-muted-foreground hover:text-primary"
            >
              ETech Ops
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden md:block" />
        {isWalletDetail ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/wallets">Wallets</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            {projectName ? (
              <>
                <BreadcrumbItem className="hidden sm:block">
                  <BreadcrumbLink asChild>
                    <Link href="/wallets">{projectName}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
              </>
            ) : null}
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold">
                {detailName || "Wallet"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : isSessionDetail ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/sessions">Sessions</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold">
                {detailName || "Session"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : isVehicleDetail ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/vehicles">Vehicles</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold font-mono tracking-wider">
                {vehiclePlate || "Vehicle"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : isSiteDetail ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/sites">Sites</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold">
                {detailName || "Site"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : isProjectDetail ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/dashboard">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold">
                {detailName || "Project"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold">{pageTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 bg-background/90 px-1 backdrop-blur-md transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-2 px-3 sm:px-4">
        <SidebarTrigger className="-ml-1 rounded-lg hover:bg-accent" />
        <Separator orientation="vertical" className="mr-1 h-4 opacity-40" />
        <Suspense
          fallback={
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          }
        >
          <HeaderBreadcrumbs />
        </Suspense>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
