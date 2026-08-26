"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { api, login as apiLogin } from "@/lib/api";
import { clearTokens, getAccessToken } from "@/lib/auth-storage";
import type { User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  canDecide: boolean;
  canAdjustWallet: boolean;
  canAccessDashboard: boolean;
  canAccessGateControl: boolean;
  canAccessCash: boolean;
  cashOnly: boolean;
  homePath: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveAccess(user: User | null) {
  const groups = user?.groups ?? [];
  const perms = user?.permissions ?? [];
  const isSuper = Boolean(user?.is_superuser);
  const inOps = groups.includes("Operations");
  const inWallet = groups.includes("Wallet");
  const inControl = groups.includes("Control Room");
  const hasCashierAssignment = Boolean(user?.has_cashier_assignment);
  const canDecide = Boolean(
    isSuper ||
      perms.includes("parking.decide_accessrequest") ||
      inControl ||
      hasCashierAssignment
  );
  const canAdjustWallet = Boolean(
    isSuper || perms.includes("wallets.adjust_wallet")
  );
  const hasRoleGroup = inOps || inWallet || inControl;
  // Assigned cashier without other ops roles: Cash hub only (+ session detail).
  const cashOnly = Boolean(
    user &&
      hasCashierAssignment &&
      !inOps &&
      !inWallet &&
      !inControl &&
      !isSuper
  );
  // Wallet includes Operations access; Operations cannot open Gate Control.
  const canAccessDashboard = Boolean(
    user &&
      !cashOnly &&
      (isSuper || inOps || inWallet || (!hasRoleGroup && !hasCashierAssignment && user.is_staff))
  );
  const canAccessGateControl = Boolean(
    user && !cashOnly && (isSuper || inControl || (canDecide && !hasCashierAssignment))
  );
  // Cash hub: assigned cashiers, Control Room, decide access, or operator wallet.
  const canAccessCash = Boolean(
    user &&
      (isSuper ||
        hasCashierAssignment ||
        inControl ||
        (canDecide && !cashOnly) ||
        Boolean(user.has_operator_wallet))
  );

  const controlRoomOnly =
    inControl && !inOps && !inWallet && !hasCashierAssignment && !isSuper;
  const homePath = cashOnly
    ? "/cash"
    : canAccessGateControl && (controlRoomOnly || !canAccessDashboard)
      ? "/gate-control"
      : canAccessDashboard
        ? "/dashboard"
        : canAccessCash
          ? "/cash"
          : "/login";

  return {
    canDecide,
    canAdjustWallet,
    canAccessDashboard,
    canAccessGateControl,
    canAccessCash,
    cashOnly,
    homePath,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const loadMe = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<User>("auth/me/");
      setUser(me);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const access = useMemo(() => resolveAccess(user), [user]);

  useEffect(() => {
    if (loading) return;
    const isLogin = pathname === "/login";
    if (!user && !isLogin) {
      router.replace("/login");
      return;
    }
    if (user && isLogin) {
      router.replace(access.homePath);
      return;
    }
    const cashSessionDetail =
      access.cashOnly && /^\/sessions\/\d+\/?$/.test(pathname);
    if (
      user &&
      access.cashOnly &&
      !pathname.startsWith("/cash") &&
      !cashSessionDetail
    ) {
      router.replace("/cash");
      return;
    }
    if (
      user &&
      pathname.startsWith("/dashboard") &&
      !access.canAccessDashboard &&
      access.canAccessGateControl
    ) {
      router.replace("/gate-control");
    }
    if (
      user &&
      pathname.startsWith("/gate-control") &&
      !access.canAccessGateControl
    ) {
      router.replace(
        access.canAccessCash
          ? "/cash"
          : access.canAccessDashboard
            ? "/dashboard"
            : "/login"
      );
    }
    if (user && pathname.startsWith("/cash") && !access.canAccessCash) {
      router.replace(
        access.canAccessGateControl
          ? "/gate-control"
          : access.canAccessDashboard
            ? "/dashboard"
            : "/login"
      );
    }
  }, [
    loading,
    user,
    pathname,
    router,
    access.homePath,
    access.canAccessDashboard,
    access.canAccessGateControl,
    access.canAccessCash,
    access.cashOnly,
  ]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(username, password) {
        await apiLogin(username, password);
        const me = await api<User>("auth/me/");
        setUser(me);
        router.replace(resolveAccess(me).homePath);
      },
      logout() {
        clearTokens();
        setUser(null);
        router.replace("/login");
      },
      ...access,
    }),
    [user, loading, router, access]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
