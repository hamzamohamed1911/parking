"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  /** Path prefixes that keep this item highlighted (list + detail pages). */
  matchPaths?: string[];
  badge?: string | number | null;
};

function pathMatches(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`);
}

function itemIsActive(item: NavItem, pathname: string) {
  if (item.matchPaths?.some((prefix) => pathMatches(pathname, prefix))) {
    // Avoid highlighting Dashboard for nested project site pages
    if (
      item.url === "/dashboard" &&
      /^\/projects\/[^/]+\/sites\//.test(pathname)
    ) {
      return false;
    }
    return true;
  }

  // Site dashboards live under /projects/:id/sites/:siteId
  if (
    item.url === "/sites" &&
    /^\/projects\/[^/]+\/sites\//.test(pathname)
  ) {
    return true;
  }

  return pathMatches(pathname, item.url);
}

export function NavMain({
  items,
  label,
}: {
  items: NavItem[];
  label?: string;
}) {
  const pathname = usePathname();

  if (items.length === 0) return null;

  return (
    <SidebarGroup className="px-2 py-1">
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarMenu>
        {items.map((item) => {
          const active = itemIsActive(item, pathname);
          const Icon = item.icon;
          const showBadge =
            item.badge != null && item.badge !== "" && Number(item.badge) !== 0;

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.title}
                className={cn(
                  active && "shadow-[inset_3px_0_0_0_var(--brand-400)]"
                )}
              >
                <Link href={item.url}>
                  {Icon ? <Icon /> : null}
                  <span className="flex-1">{item.title}</span>
                  {showBadge ? (
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#ddd6fe] group-data-[collapsible=icon]:hidden">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
