import "server-only";

/**
 * The error vocabulary for every route handler, per
 * `references/api-conventions.md`.
 *
 * Sightline has no upload surface, so `unsupported_media_type` and
 * `payload_too_large` are deliberately absent.
 */
export type ApiErrorCode =
  | "validation_error"
  | "invalid_state_transition"
  | "duplicate_resource"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

const STATUS: Record<ApiErrorCode, number> = {
  validation_error: 400,
  invalid_state_transition: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  duplicate_resource: 409,
  rate_limited: 429,
  internal_error: 500,
  upstream_unavailable: 503,
};

/**
 * Builds an error response.
 *
 * **Nothing that reaches a client may carry internal detail.** No Prisma error
 * text, no connection string, no invitation token or hash, no Supabase key.
 * `details` is for field-level validation the user can act on, and nothing
 * else — a stack trace in `details` is a leak with good intentions.
 */
export function jsonError(
  error: ApiErrorCode,
  message: string,
  details?: Record<string, string>,
): Response {
  return Response.json(
    details ? { error, message, details } : { error, message },
    { status: STATUS[error] },
  );
}
