import type { UserStatus } from "../../../generated/prisma/enums";

/**
 * What a signed-in caller is told about their own account.
 *
 * These are only ever shown **after successful authentication** — the caller
 * proved they own the address before learning anything about it. Sign-in
 * remains opaque about whether an account exists at all, so this leaks nothing
 * to someone guessing.
 */
export const STATUS_MESSAGE: Record<Exclude<UserStatus, "active">, string> = {
  pending:
    "Your account is awaiting approval. You will be able to sign in once it has been reviewed.",
  denied: "Your account request was not approved.",
  revoked: "Your access to Sightline has been removed.",
};

/** The single reason code carried on the sign-in URL. */
export type SignInReason = keyof typeof STATUS_MESSAGE;

export function isSignInReason(
  value: string | undefined,
): value is SignInReason {
  return value === "pending" || value === "denied" || value === "revoked";
}

/** Only an approved account may use the application. */
export function hasAccess(status: UserStatus): status is "active" {
  return status === "active";
}
