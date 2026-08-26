"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { Loader } from "@/components/loaders";

function ClientRedirectContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const qs = tab ? `?tab=${tab}` : "";
    router.replace(`/wallets/${params.id}${qs}`);
  }, [router, params.id, searchParams]);

  return <Loader label="Opening wallet…" />;
}

export default function ClientRedirectPage() {
  return (
    <Suspense fallback={<Loader label="Opening wallet…" />}>
      <ClientRedirectContent />
    </Suspense>
  );
}
