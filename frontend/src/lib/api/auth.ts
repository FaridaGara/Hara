import { clearSession, setSession } from "@/lib/auth/session";

import { apiRequest } from "./client";
import type { AuthTokenPair } from "./contracts";

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

  logout() {
    clearSession();
  },
};
