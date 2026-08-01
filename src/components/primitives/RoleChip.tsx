import { StatusChip } from "./StatusChip";

/**
 * Two roles, closed set. Admin wears the model accent; viewer stays neutral.
 *
 * Both are always labelled — the tint distinguishes them at a glance, the word
 * is what actually communicates.
 */
export function RoleChip({ role }: { role: "admin" | "viewer" }) {
  return (
    <StatusChip
      label={role === "admin" ? "Admin" : "Viewer"}
      tone={role === "admin" ? "accent" : "neutral"}
    />
  );
}
