import type { Metadata } from "next";

import { RegistrationForm } from "@/components/registration-form";

export const metadata: Metadata = {
  title: "Qeydiyyat — Hara",
};

export default function RegisterPage() {
  return <RegistrationForm />;
}
