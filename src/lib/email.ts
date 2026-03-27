export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildPersonalOrganizationName(email: string): string {
  const localPart = normalizeEmail(email).split("@")[0] || "personal";

  return `${localPart} workspace`;
}
