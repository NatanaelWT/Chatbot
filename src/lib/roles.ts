export function isAdminRole(role: unknown): role is "admin" {
  return role === "admin";
}
