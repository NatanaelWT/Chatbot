export type ImpersonationAccount = {
  id: string;
  role: string;
  status: string;
};

export type ImpersonationDenial =
  | "ACTOR_NOT_ADMIN"
  | "TARGET_NOT_FOUND"
  | "TARGET_IS_SELF"
  | "TARGET_NOT_USER"
  | "TARGET_NOT_ACTIVE";

export function impersonationDenial(
  actor: ImpersonationAccount,
  target: ImpersonationAccount | null,
): ImpersonationDenial | null {
  if (actor.role !== "admin" || actor.status !== "active") return "ACTOR_NOT_ADMIN";
  if (!target) return "TARGET_NOT_FOUND";
  if (target.id === actor.id) return "TARGET_IS_SELF";
  if (target.role !== "user") return "TARGET_NOT_USER";
  if (target.status !== "active") return "TARGET_NOT_ACTIVE";
  return null;
}
