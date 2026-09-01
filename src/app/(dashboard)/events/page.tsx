"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Loader } from "@/components/loaders";

export default function EventsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sessions");
  }, [router]);
  return <Loader label="Opening sessions…" />;
}
