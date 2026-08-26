"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Loader } from "@/components/loaders";
import { useProjectFilter } from "@/components/providers/project-filter-provider";

export default function ProjectDetailRedirectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { setProjectId } = useProjectFilter();

  useEffect(() => {
    const id = Number(params.id);
    if (Number.isFinite(id)) {
      setProjectId(id);
    }
    router.replace("/dashboard");
  }, [params.id, router, setProjectId]);

  return <Loader label="Opening dashboard…" />;
}
