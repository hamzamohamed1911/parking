"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "@/components/providers/auth-provider";

const STORAGE_KEY = "etech-ops-project-id";

type ProjectOption = { id: number; name: string; is_active: boolean };

type ProjectFilterContextValue = {
  /** null = all projects in the user's scope */
  projectId: number | null;
  projectName: string | null;
  label: string;
  projects: ProjectOption[];
  canSelectAll: boolean;
  /** False until localStorage filter has been read */
  ready: boolean;
  setProjectId: (id: number | null) => void;
  /** Spread into api() query when a single project is selected */
  projectQuery: { project?: number };
};

const ProjectFilterContext = createContext<ProjectFilterContextValue | null>(
  null
);

function readStoredId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "" || raw === "all") return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function writeStoredId(id: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.setItem(STORAGE_KEY, "all");
    else window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export function ProjectFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const projects = useMemo(
    () => (user?.projects ?? []).filter((p) => p.is_active !== false),
    [user]
  );
  const canSelectAll = Boolean(user?.all_projects || projects.length > 1);

  const [projectId, setProjectIdState] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProjectIdState(readStoredId());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !user) return;
    const allowed = new Set(projects.map((p) => p.id));
    if (projectId !== null && !allowed.has(projectId)) {
      const next = canSelectAll ? null : projects[0]?.id ?? null;
      setProjectIdState(next);
      writeStoredId(next);
      return;
    }
    if (projectId === null && !canSelectAll && projects.length === 1) {
      setProjectIdState(projects[0].id);
      writeStoredId(projects[0].id);
    }
  }, [hydrated, user, projects, projectId, canSelectAll]);

  const setProjectId = useCallback((id: number | null) => {
    setProjectIdState(id);
    writeStoredId(id);
  }, []);

  const selected = projects.find((p) => p.id === projectId) ?? null;
  const label =
    projectId === null || !selected ? "All projects" : selected.name;

  const projectQuery = useMemo(
    () => (projectId !== null ? { project: projectId } : {}),
    [projectId]
  );

  const value = useMemo<ProjectFilterContextValue>(
    () => ({
      projectId,
      projectName: selected?.name ?? null,
      label,
      projects,
      canSelectAll,
      ready: hydrated,
      setProjectId,
      projectQuery,
    }),
    [
      projectId,
      selected,
      label,
      projects,
      canSelectAll,
      hydrated,
      setProjectId,
      projectQuery,
    ]
  );

  return (
    <ProjectFilterContext.Provider value={value}>
      {children}
    </ProjectFilterContext.Provider>
  );
}

export function useProjectFilter() {
  const ctx = useContext(ProjectFilterContext);
  if (!ctx) {
    throw new Error("useProjectFilter must be used within ProjectFilterProvider");
  }
  return ctx;
}
