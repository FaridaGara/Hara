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
import type {
  AuthDeliveryResponse,
  RegistrationRequest,
  SocialProvider,
  UserProfile,
  UserProfileUpdate,
} from "@/lib/api";
import {
  getAccessToken,
  getRefreshToken,
  hasSession,
  subscribeToAuthChange,
} from "@/lib/auth/session";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  status: AuthStatus;
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegistrationRequest) => Promise<AuthDeliveryResponse>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  socialLogin: (
    provider: SocialProvider,
    credential: string,
    profile?: { firstName?: string; lastName?: string },
    nonce?: string,
  ) => Promise<void>;
  updateProfile: (profile: Partial<UserProfileUpdate>) => Promise<UserProfile>;
  refreshProfile: () => Promise<UserProfile | null>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const updateStatus = () => {
      if (hasSession()) {
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("anonymous");
      }
    };

    updateStatus();
    if (hasSession()) {
      void authApi.me().then(setUser).catch(() => undefined);
    }
    return subscribeToAuthChange(updateStatus);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login(email, password);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const register = useCallback((payload: RegistrationRequest) => {
    return authApi.register(payload);
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const session = await authApi.verifyEmail(email, code);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const socialLogin = useCallback(
    async (
      provider: SocialProvider,
      credential: string,
      profile?: { firstName?: string; lastName?: string },
      nonce?: string,
    ) => {
      const session = await authApi.socialLogin(
        provider,
        credential,
        profile,
        nonce,
      );
      setUser(session.user);
      setStatus("authenticated");
    },
    [],
  );

  const updateProfile = useCallback(async (profile: Partial<UserProfileUpdate>) => {
    const updatedUser = await authApi.updateProfile(profile);
    setUser(updatedUser);
    return updatedUser;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!hasSession()) {
      setUser(null);
      return null;
    }
    const profile = await authApi.me();
    setUser(profile);
    return profile;
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      login,
      register,
      verifyEmail,
      socialLogin,
      updateProfile,
      refreshProfile,
      logout,
    }),
    [
      status,
      user,
      login,
      register,
      verifyEmail,
      socialLogin,
      updateProfile,
      refreshProfile,
      logout,
    ],
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
