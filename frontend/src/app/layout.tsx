import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
