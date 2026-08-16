import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import {
  THEME_INIT_SCRIPT,
  ThemeProvider,
} from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hara — Bu həftə nə var?",
  description: "Şəhərdəki tədbirləri kəşf et.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111118",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az" suppressHydrationWarning>
      <body>
        <Script id="hara-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
