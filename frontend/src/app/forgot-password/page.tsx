import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Şifrə bərpası — Hara",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
