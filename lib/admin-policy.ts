import "server-only";

// Aucune identité n’est embarquée dans le code ou transmise au navigateur.
export function isAuthorizedAdmin(userId: string | null, adminId = process.env.AUTHORIZED_ADMIN_USER_ID): boolean {
  return Boolean(adminId?.trim()) && userId !== null && userId === adminId;
}
