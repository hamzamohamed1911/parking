"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Loader } from "@/components/loaders";

export default function TransactionsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/wallets");
  }, [router]);
  return <Loader label="Opening wallets…" />;
}
