"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Loader } from "@/components/loaders";

export default function OperationsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return <Loader label="Opening dashboard…" />;
}
