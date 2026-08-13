import { clearSession, setSession } from "@/lib/auth/session";

import { apiRequest } from "./client";
import type {
  AuthSessionResponse,
  AuthTokenPair,
  SocialProvider,
  UserProfile,
  UserProfileUpdate,
} from "./contracts";

export const authApi = {
  async login(email: string, password: string) {
    const tokens = await apiRequest<AuthTokenPair>("/api/auth/login/", {
      method: "POST",
      auth: "none",
      body: { email, password },
    });
    setSession(tokens);
    return tokens;
  },

  async socialLogin(
    provider: SocialProvider,
    credential: string,
    profile?: { firstName?: string; lastName?: string },
  ) {
    const session = await apiRequest<AuthSessionResponse>(
      `/api/auth/social/${provider}/`,
      {
        method: "POST",
        auth: "none",
        body: {
          credential,
          first_name: profile?.firstName || "",
          last_name: profile?.lastName || "",
        },
      },
    );
    setSession(session);
    return session;
  },

  me() {
    return apiRequest<UserProfile>("/api/auth/me/", { auth: "required" });
  },

  updateProfile(profile: Partial<UserProfileUpdate>) {
    return apiRequest<UserProfile>("/api/auth/me/", {
      method: "PATCH",
      auth: "required",
      body: profile,
    });
  },

  logout() {
    clearSession();
  },
};
