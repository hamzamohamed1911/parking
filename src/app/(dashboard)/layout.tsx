"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Loader } from "@/components/loaders";
import { useAuth } from "@/components/providers/auth-provider";
import { ProjectFilterProvider } from "@/components/providers/project-filter-provider";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();

  if (loading || !user) {
    return <Loader fullScreen label="Starting ops console…" />;
  }

  return (
    <ProjectFilterProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-3 sm:px-6">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ProjectFilterProvider>
  );
}
