"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

import { useAuth } from "./auth-provider";

type GoogleCredentialResponse = { credential?: string };
type AppleSuccessDetail = {
  authorization?: { id_token?: string; state?: string };
  user?: { name?: { firstName?: string; lastName?: string } };
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number>,
          ) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (options: {
          clientId: string;
          scope: string;
          redirectURI: string;
          state: string;
          nonce: string;
          usePopup: boolean;
        }) => void;
      };
    };
  }
}

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const appleClientId = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || "";
const appleRedirectUri = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI || "";

function randomToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function providerErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Sosial hesabla giriş zamanı xəta baş verdi.";
}

export function SocialLoginButtons() {
  const { socialLogin } = useAuth();
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const appleStateRef = useRef("");
  const [pendingProvider, setPendingProvider] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completeLogin = useCallback(
    async (
      provider: "google" | "apple",
      credential: string,
      profile?: { firstName?: string; lastName?: string },
    ) => {
      setError(null);
      setPendingProvider(provider);
      try {
        await socialLogin(provider, credential, profile);
      } catch (caughtError) {
        setError(providerErrorMessage(caughtError));
      } finally {
        setPendingProvider(null);
      }
    },
    [socialLogin],
  );

  const initializeGoogle = useCallback(() => {
    if (!googleClientId || !window.google || !googleButtonRef.current) {
      return;
    }
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => {
        if (response.credential) {
          void completeLogin("google", response.credential);
        } else {
          setError("Google giriş məlumatını qaytarmadı.");
        }
      },
    });
    googleButtonRef.current.replaceChildren();
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: Math.max(240, Math.floor(googleButtonRef.current.clientWidth)),
    });
  }, [completeLogin]);

  const initializeApple = useCallback(() => {
    if (!appleClientId || !appleRedirectUri || !window.AppleID) {
      return;
    }
    appleStateRef.current = randomToken();
    window.AppleID.auth.init({
      clientId: appleClientId,
      scope: "name email",
      redirectURI: appleRedirectUri,
      state: appleStateRef.current,
      nonce: randomToken(),
      usePopup: true,
    });
  }, []);

  useEffect(() => {
    if (!appleClientId || !appleRedirectUri) {
      return;
    }
    const handleSuccess = (event: Event) => {
      const detail = (event as CustomEvent<AppleSuccessDetail>).detail;
      const credential = detail?.authorization?.id_token;
      const responseState = detail?.authorization?.state;
      if (!credential || !responseState || responseState !== appleStateRef.current) {
        setError("Apple giriş cavabı təsdiqlənmədi.");
        return;
      }
      void completeLogin("apple", credential, {
        firstName: detail.user?.name?.firstName,
        lastName: detail.user?.name?.lastName,
      });
    };
    const handleFailure = () => {
      setPendingProvider(null);
      setError("Apple ilə giriş tamamlanmadı.");
    };
    document.addEventListener("AppleIDSignInOnSuccess", handleSuccess);
    document.addEventListener("AppleIDSignInOnFailure", handleFailure);
    return () => {
      document.removeEventListener("AppleIDSignInOnSuccess", handleSuccess);
      document.removeEventListener("AppleIDSignInOnFailure", handleFailure);
    };
  }, [completeLogin]);

  const isConfigured = googleClientId || (appleClientId && appleRedirectUri);

  return (
    <div className="mt-7 space-y-3" aria-label="Sosial hesabla giriş">
      {googleClientId ? (
        <>
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onReady={initializeGoogle}
          />
          <div
            ref={googleButtonRef}
            className={`min-h-11 overflow-hidden rounded-md ${pendingProvider ? "pointer-events-none opacity-60" : ""}`}
          />
        </>
      ) : (
        <button type="button" disabled className="min-h-12 w-full rounded-xl border border-white/15 bg-white px-4 font-semibold text-black opacity-50">
          Google ilə davam et
        </button>
      )}

      {appleClientId && appleRedirectUri ? (
        <>
          <Script
            src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"
            strategy="afterInteractive"
            onReady={initializeApple}
          />
          <div
            id="appleid-signin"
            data-color="black"
            data-border="true"
            data-type="continue"
            data-mode="center-align"
            data-width="100%"
            data-height="48"
            className={pendingProvider ? "pointer-events-none opacity-60" : ""}
          />
        </>
      ) : (
        <button type="button" disabled className="min-h-12 w-full rounded-xl border border-white/15 bg-black px-4 font-semibold text-white opacity-50">
          Apple ilə davam et
        </button>
      )}

      {pendingProvider ? (
        <p role="status" className="text-center text-xs text-white/55">
          {pendingProvider === "google" ? "Google" : "Apple"} hesabı yoxlanılır…
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {!isConfigured ? (
        <p className="text-center text-xs leading-5 text-white/40">
          Sosial giriş deploy dəyişənləri əlavə ediləndən sonra aktiv olacaq.
        </p>
      ) : null}
    </div>
  );
}
