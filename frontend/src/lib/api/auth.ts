import { clearSession, setSession } from "@/lib/auth/session";

import { apiRequest } from "./client";
import type {
  AuthSessionResponse,
  AuthDeliveryResponse,
  PasswordResetTokenResponse,
  RegistrationRequest,
  SocialProvider,
  UserProfile,
  UserProfileUpdate,
  VerificationPurpose,
} from "./contracts";

export const authApi = {
  async login(identifier: string, password: string) {
    const session = await apiRequest<AuthSessionResponse>("/api/auth/login/", {
      method: "POST",
      auth: "none",
      body: { identifier, password },
    });
    setSession(session);
    return session;
  },

  register(payload: RegistrationRequest) {
    return apiRequest<AuthDeliveryResponse>("/api/auth/register/", {
      method: "POST",
      auth: "none",
      body: payload,
    });
  },

  async verifyEmail(email: string, code: string) {
    const session = await apiRequest<AuthSessionResponse>(
      "/api/auth/verify-email/",
      {
        method: "POST",
        auth: "none",
        body: { email, code },
      },
    );
    setSession(session);
    return session;
  },

  resendVerification(email: string, purpose: VerificationPurpose) {
    return apiRequest<AuthDeliveryResponse>(
      "/api/auth/verification/resend/",
      {
        method: "POST",
        auth: "none",
        body: { email, purpose },
      },
    );
  },

  requestPasswordReset(email: string) {
    return apiRequest<AuthDeliveryResponse>(
      "/api/auth/password-reset/request/",
      {
        method: "POST",
        auth: "none",
        body: { email },
      },
    );
  },

  verifyPasswordReset(email: string, code: string) {
    return apiRequest<PasswordResetTokenResponse>(
      "/api/auth/password-reset/verify/",
      {
        method: "POST",
        auth: "none",
        body: { email, code },
      },
    );
  },

  confirmPasswordReset(
    token: string,
    password: string,
    passwordConfirm: string,
  ) {
    return apiRequest<AuthDeliveryResponse>(
      "/api/auth/password-reset/confirm/",
      {
        method: "POST",
        auth: "none",
        body: {
          token,
          password,
          password_confirm: passwordConfirm,
        },
      },
    );
  },

  async socialLogin(
    provider: SocialProvider,
    credential: string,
    profile?: { firstName?: string; lastName?: string },
    nonce?: string,
  ) {
    const session = await apiRequest<AuthSessionResponse>(
      `/api/auth/social/${provider}/`,
      {
        method: "POST",
        auth: "none",
        body: {
          credential,
          nonce: nonce || "",
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
