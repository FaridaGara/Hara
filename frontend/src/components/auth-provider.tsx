"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { authApi } from "@/lib/api";
import {
  getAccessToken,
  getRefreshToken,
  hasSession,
  subscribeToAuthChange,
} from "@/lib/auth/session";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    const updateStatus = () => {
      setStatus(hasSession() ? "authenticated" : "anonymous");
    };

    updateStatus();
    return subscribeToAuthChange(updateStatus);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await authApi.login(email, password);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ status, login, logout }),
    [status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth yalnız AuthProvider daxilində istifadə edilə bilər.");
  }

  return value;
}

export function authSessionSnapshot() {
  return {
    hasAccessToken: Boolean(getAccessToken()),
    hasRefreshToken: Boolean(getRefreshToken()),
  };
}
