export function emailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "E-poçt ünvanını daxil edin.";
  const parts = email.split("@");
  if (email.length > 254 || parts.length !== 2) return "Düzgün e-poçt ünvanı daxil edin. Məsələn: ad@example.com";
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      !domain.includes(".") || !domain.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) {
    return "Düzgün e-poçt ünvanı daxil edin. Məsələn: ad@example.com";
  }
  return null;
}
export function passwordErrors(password: string): string[] {
  return [
    ...(password.length < 8 ? ["Şifrə ən azı 8 simvoldan ibarət olmalıdır."] : []),
    ...(!/[A-ZƏÖÜİÇŞĞ]/.test(password) ? ["Şifrədə ən azı bir böyük hərf olmalıdır."] : []),
    ...(!/[0-9]/.test(password) ? ["Şifrədə ən azı bir rəqəm olmalıdır."] : []),
  ];
}
