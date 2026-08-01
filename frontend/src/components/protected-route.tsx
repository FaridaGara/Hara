"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { loginHref } from "@/lib/routes";

import { useAuth } from "./auth-provider";
import { PageLoader } from "./states";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      const query = searchParams.toString();
      router.replace(loginHref(`${pathname}${query ? `?${query}` : ""}`));
    }
  }, [pathname, router, searchParams, status]);

  if (status !== "authenticated") {
    return <PageLoader label="Sessiya yoxlanılır…" />;
  }

  return children;
}
