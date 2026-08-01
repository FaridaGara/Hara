import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hara — Bu həftə nə var?",
  description: "Şəhərdəki tədbirləri kəşf et.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
